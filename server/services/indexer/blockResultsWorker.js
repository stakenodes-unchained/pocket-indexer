/**
 * Block Results Worker
 * Background worker that processes block_results queue asynchronously
 */

const { parentPort, workerData } = require('worker_threads');
const { fetchBlockResultsByHeight, fetchBlockByHeight } = require('./rpc');
const { processBlockEvents } = require('./eventProcessor');
const {
  dequeueBlockResults,
  markProcessed,
  markFailed,
  getReadyDelayedItems,
  getQueueSize
} = require('./blockResultsQueue');

const { rpcName, blockResultsRpcUrl, rpcUrl, id } = workerData;

// Configuration
const POLL_INTERVAL_MS = parseInt(process.env.BLOCK_RESULTS_POLL_INTERVAL_MS || '5000', 10); // 5 seconds default
const BATCH_SIZE = parseInt(process.env.BLOCK_RESULTS_BATCH_SIZE || '10', 10); // Batch size for dequeuing
const PARALLEL_PROCESSING_LIMIT = parseInt(process.env.BLOCK_RESULTS_PARALLEL_LIMIT || '5', 10); // Max parallel block processing
const RATE_LIMIT_DELAY_MS = parseInt(process.env.BLOCK_RESULTS_RATE_LIMIT_MS || '100', 10); // 100ms between requests
const STATS_REPORT_INTERVAL_MS = parseInt(process.env.BLOCK_RESULTS_STATS_INTERVAL_MS || '30000', 10); // 30 seconds default
const ASYNC_EVENTS = process.env.BLOCK_RESULTS_ASYNC_EVENTS !== 'false'; // Process events asynchronously (default: true)

// Stats tracking
let stats = {
  processedCount: 0,
  failedCount: 0,
  processingTimes: [], // Keep last 100 processing times for average calculation
  currentBlockHeight: null, // Current/last processed block height
  lastProcessedBlockHeight: null // Last successfully processed block height
};

function log(message) {
  parentPort.postMessage({ type: 'log', data: message });
}

function reportError(message) {
  parentPort.postMessage({ type: 'error', data: message });
}

function reportStats() {
  const avgProcessingTime = stats.processingTimes.length > 0
    ? stats.processingTimes.reduce((sum, t) => sum + t, 0) / stats.processingTimes.length
    : 0;
  
  const successRate = (stats.processedCount + stats.failedCount) > 0
    ? (stats.processedCount / (stats.processedCount + stats.failedCount)) * 100
    : 100;
  
  parentPort.postMessage({
    type: 'stats',
    data: {
      rpcName,
      processedCount: stats.processedCount,
      failedCount: stats.failedCount,
      successRate: parseFloat(successRate.toFixed(2)),
      avgProcessingTimeMs: parseFloat(avgProcessingTime.toFixed(2)),
      currentBlockHeight: stats.currentBlockHeight,
      lastProcessedBlockHeight: stats.lastProcessedBlockHeight,
      status: 'running'
    }
  });
}

/**
 * Process a single block_results item
 */
async function processBlockResultsItem(item) {
  const { height } = item;
  const startTime = Date.now();
  
  // Update current block height when starting to process
  stats.currentBlockHeight = height;
  
  try {
    log(`[BlockResultsWorker ${id}] Processing block_results for height ${height}`);
    
    // Fetch block_results
    const blockResultsData = await fetchBlockResultsByHeight(height, blockResultsRpcUrl);
    
    if (!blockResultsData || !blockResultsData.result) {
      throw new Error('Invalid block_results response');
    }
    
    // Get block data - try RPC first (we need the full block structure for event processing)
    // The DB block format might not match what eventExtractor expects
    let blockData = null;
    if (rpcUrl) {
      try {
        blockData = await fetchBlockByHeight(height, rpcUrl);
      } catch (error) {
        log(`[BlockResultsWorker ${id}] Could not fetch block ${height} from RPC: ${error.message}`);
        // Create minimal block structure if we can't get full block data
        // This is sufficient for processing block-level events from block_results
        blockData = {
          block: {
            header: {
              height: height.toString(),
              time: new Date().toISOString()
            }
          }
        };
      }
    } else {
      // No RPC URL, create minimal structure
      blockData = {
        block: {
          header: {
            height: height.toString(),
            time: new Date().toISOString()
          }
        }
      };
    }
    
    // Mark as processed immediately (before event processing)
    // This allows the queue to continue processing other blocks
    await markProcessed(rpcName, height);
    
    // Process events asynchronously (fire-and-forget if ASYNC_EVENTS is true)
    const processEvents = async () => {
      try {
        const eventResults = await processBlockEvents(blockData, blockResultsData, rpcName);
        if (eventResults.length > 0) {
          const successCount = eventResults.filter(r => r.success).length;
          log(`[BlockResultsWorker ${id}] Processed ${eventResults.length} block events from block_results (${successCount} successful) for height ${height}`);
        }
      } catch (error) {
        console.error(`[BlockResultsWorker ${id}] Error processing events for height ${height}:`, error.message);
      }
    };
    
    if (ASYNC_EVENTS) {
      // Fire-and-forget: process events in background
      processEvents().catch(error => {
        console.error(`[BlockResultsWorker ${id}] Unhandled error in async event processing for height ${height}:`, error);
      });
    } else {
      // Wait for event processing (for backward compatibility)
      await processEvents();
    }
    
    // Update stats
    const processingTime = Date.now() - startTime;
    stats.processedCount++;
    stats.processingTimes.push(processingTime);
    // Keep only last 100 processing times
    if (stats.processingTimes.length > 100) {
      stats.processingTimes.shift();
    }
    
    // Update block height tracking
    stats.currentBlockHeight = height;
    stats.lastProcessedBlockHeight = height;
    
    return { success: true, height };
  } catch (error) {
    console.error(`[BlockResultsWorker ${id}] Error processing block_results for height ${height}:`, error.message);
    
    // Mark as failed (will requeue if retries not exceeded)
    const requeued = await markFailed(rpcName, height, item);
    
    if (requeued) {
      log(`[BlockResultsWorker ${id}] Requeued block ${height} for retry (attempt ${item.retries})`);
    } else {
      reportError(`Block ${height} failed after ${item.retries} retries`);
    }
    
    // Update stats (only count final failures, not retries)
    if (!requeued) {
      stats.failedCount++;
    }
    
    return { success: false, height, error: error.message };
  }
}

/**
 * Process ready delayed items
 */
async function processDelayedItems() {
  try {
    const readyItems = await getReadyDelayedItems(rpcName);
    if (readyItems.length > 0) {
      log(`[BlockResultsWorker ${id}] Found ${readyItems.length} delayed items ready for processing`);
    }
  } catch (error) {
    console.error(`[BlockResultsWorker ${id}] Error processing delayed items:`, error.message);
  }
}

/**
 * Process items with concurrency limit
 */
async function processItemsWithConcurrency(items, limit) {
  const results = [];
  const executing = [];
  
  for (const item of items) {
    const promise = processBlockResultsItem(item).then(result => {
      executing.splice(executing.indexOf(promise), 1);
      return result;
    });
    
    results.push(promise);
    executing.push(promise);
    
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  
  return Promise.allSettled(results);
}

/**
 * Main processing loop
 */
async function processQueue() {
  let consecutiveEmptyPolls = 0;
  const maxEmptyPolls = 10; // After 10 empty polls, increase interval
  let lastStatsReport = Date.now();
  
  while (true) {
    try {
      // First, check for delayed items that are ready
      await processDelayedItems();
      
      // Dequeue items up to batch size
      const items = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const item = await dequeueBlockResults(rpcName);
        if (!item) {
          break; // Queue is empty
        }
        items.push(item);
        // Update current block height to the highest queued item
        if (item.height && (!stats.currentBlockHeight || item.height > stats.currentBlockHeight)) {
          stats.currentBlockHeight = item.height;
        }
      }
      
      if (items.length > 0) {
        consecutiveEmptyPolls = 0;
        
        // Process items in parallel with concurrency limit
        const results = await processItemsWithConcurrency(items, PARALLEL_PROCESSING_LIMIT);
        const processedCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
        const failedCount = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.success)).length;
        
        if (processedCount > 0 || failedCount > 0) {
          log(`[BlockResultsWorker ${id}] Processed ${processedCount} block_results items (${failedCount} failed)`);
        }
      } else {
        consecutiveEmptyPolls++;
        
        // Get queue size for monitoring
        const queueSize = await getQueueSize(rpcName);
        if (queueSize > 0) {
          // Queue has items but we didn't get any - might be processing locks
          // Continue polling
          consecutiveEmptyPolls = 0;
        }
      }
      
      // Report stats periodically
      const now = Date.now();
      if (now - lastStatsReport >= STATS_REPORT_INTERVAL_MS) {
        reportStats();
        lastStatsReport = now;
      }
      
      // Adjust polling interval based on queue activity
      const pollInterval = consecutiveEmptyPolls > maxEmptyPolls 
        ? POLL_INTERVAL_MS * 2  // Double interval if queue is consistently empty
        : POLL_INTERVAL_MS;
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      console.error(`[BlockResultsWorker ${id}] Error in processing loop:`, error);
      reportError(`Processing loop error: ${error.message}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

/**
 * Start the worker
 */
async function start() {
  log(`[BlockResultsWorker ${id}] Starting block_results worker for ${rpcName}`);
  log(`[BlockResultsWorker ${id}] Poll interval: ${POLL_INTERVAL_MS}ms, Batch size: ${BATCH_SIZE}, Parallel limit: ${PARALLEL_PROCESSING_LIMIT}, Async events: ${ASYNC_EVENTS}, Rate limit: ${RATE_LIMIT_DELAY_MS}ms`);
  
  // Send initial stats
  reportStats();
  
  try {
    await processQueue();
  } catch (error) {
    console.error(`[BlockResultsWorker ${id}] Fatal error:`, error);
    reportError(`Fatal error: ${error.message}`);
    // Send final stats with error status
    parentPort.postMessage({
      type: 'stats',
      data: {
        rpcName,
        processedCount: stats.processedCount,
        failedCount: stats.failedCount,
        successRate: (stats.processedCount + stats.failedCount) > 0
          ? parseFloat(((stats.processedCount / (stats.processedCount + stats.failedCount)) * 100).toFixed(2))
          : 100,
        avgProcessingTimeMs: stats.processingTimes.length > 0
          ? parseFloat((stats.processingTimes.reduce((sum, t) => sum + t, 0) / stats.processingTimes.length).toFixed(2))
          : 0,
        currentBlockHeight: stats.currentBlockHeight,
        lastProcessedBlockHeight: stats.lastProcessedBlockHeight,
        status: 'error'
      }
    });
    process.exit(1);
  }
}

// Start the worker
start().catch(error => {
  console.error(`[BlockResultsWorker ${id}] Failed to start:`, error);
  process.exit(1);
});

