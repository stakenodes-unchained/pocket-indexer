/**
 * Block Results Worker
 * Background worker that processes block_results queue asynchronously
 */

const { parentPort, workerData } = require('worker_threads');
const { fetchBlockResultsByHeight, fetchBlockByHeight, fetchLatestBlock } = require('./rpc');
const { processBlockEvents } = require('./eventProcessor');
const {
  leaseScanDequeueBlockResults,
  markProcessed,
  markFailed,
  getReadyDelayedItems,
  addToDelayedQueue,
  getQueueSize,
  getDelayedItemsCount,
  getProcessingItemsCount,
  getQueueHealth,
  recoverStaleProcessingItems
} = require('./blockResultsQueue');
const { pgPool, connectClients } = require('./db');

const { rpcName, blockResultsRpcUrl, rpcUrl, id, blockResultsRole } = workerData;

// Configuration
const POLL_INTERVAL_MS = parseInt(process.env.BLOCK_RESULTS_POLL_INTERVAL_MS || '500', 10); // 1 second default
// Reduced default batch size from 10 to 8 to reduce memory usage
const BATCH_SIZE = parseInt(process.env.BLOCK_RESULTS_BATCH_SIZE || '8', 10); // Batch size for dequeuing
// Reduced default parallel limit from 5 to 3 to reduce memory usage  
const PARALLEL_PROCESSING_LIMIT = parseInt(process.env.BLOCK_RESULTS_PARALLEL_LIMIT || '10', 10); // Max parallel block processing
const RATE_LIMIT_DELAY_MS = parseInt(process.env.BLOCK_RESULTS_RATE_LIMIT_MS || '100', 10); // 100ms between requests
const STATS_REPORT_INTERVAL_MS = parseInt(process.env.BLOCK_RESULTS_STATS_INTERVAL_MS || '30000', 10); // 30 seconds default
const ASYNC_EVENTS = process.env.BLOCK_RESULTS_ASYNC_EVENTS !== 'false'; // Process events asynchronously (default: true)
const LAG_BLOCKS = parseInt(process.env.BLOCK_RESULTS_LAG_BLOCKS || '5', 10); // Number of blocks to lag behind current height
const CURRENT_WINDOW_BLOCKS = parseInt(process.env.BLOCK_RESULTS_CURRENT_WINDOW_BLOCKS || '50', 10);
const LEASE_SCAN_COUNT = parseInt(process.env.BLOCK_RESULTS_LEASE_SCAN_COUNT || '8', 10);
const HEARTBEAT_LOG_INTERVAL_MS = parseInt(process.env.BLOCK_RESULTS_HEARTBEAT_INTERVAL_MS || '60000', 10); // 60 seconds default

// Stats tracking
let stats = {
  processedCount: 0,
  failedCount: 0,
  skippedCount: 0, // Blocks skipped due to lag
  processingTimes: [], // Keep last 50 processing times for average calculation (reduced from 100 to save memory)
  currentBlockHeight: null, // Current/last processed block height
  lastProcessedBlockHeight: null, // Last successfully processed block height
  currentChainHeight: null, // Current chain height (from RPC)
  processingLag: null // Blocks behind current height
};

function log(message) {
  const timestamp = new Date().toISOString();
  parentPort.postMessage({ type: 'log', data: `[${timestamp}] ${message}` });
  // Also log to console for immediate visibility
  console.log(`[${timestamp}] [BlockResultsWorker ${id}] ${message}`);
}

function reportError(message) {
  const timestamp = new Date().toISOString();
  parentPort.postMessage({ type: 'error', data: `[${timestamp}] ${message}` });
  console.error(`[${timestamp}] [BlockResultsWorker ${id}] ERROR: ${message}`);
}

const WORKER_ROLE = blockResultsRole === 'current' ? 'current' : 'historical';

async function reportStats() {
  const avgProcessingTime = stats.processingTimes.length > 0
    ? stats.processingTimes.reduce((sum, t) => sum + t, 0) / stats.processingTimes.length
    : 0;
  
  const totalAttempts = stats.processedCount + stats.failedCount;
  const successRate = totalAttempts > 0
    ? (stats.processedCount / totalAttempts) * 100
    : 100;
  
  // Get queue health metrics
  let queueHealth = null;
  try {
    queueHealth = await getQueueHealth(rpcName, stats.currentChainHeight);
  } catch (error) {
    // Ignore errors in stats reporting
  }
  
  parentPort.postMessage({
    type: 'stats',
    data: {
      rpcName,
      role: WORKER_ROLE,
      processedCount: stats.processedCount,
      failedCount: stats.failedCount,
      skippedCount: stats.skippedCount,
      successRate: parseFloat(successRate.toFixed(2)),
      avgProcessingTimeMs: parseFloat(avgProcessingTime.toFixed(2)),
      currentBlockHeight: stats.currentBlockHeight,
      lastProcessedBlockHeight: stats.lastProcessedBlockHeight,
      currentChainHeight: stats.currentChainHeight,
      processingLag: stats.processingLag,
      queueHealth: queueHealth,
      status: 'running'
    }
  });
}

/**
 * Check if block results data already exists in database for a block
 * @param {number} height - Block height
 * @returns {Promise<boolean>} True if data exists (status = 'processed'), false otherwise
 */
async function hasBlockResultsData(height) {
  try {
    await connectClients();
    
    // Check if block has been processed successfully in block_results_processed table
    const result = await pgPool.query(
      `SELECT 1 FROM block_results_processed 
       WHERE chain = $1 AND height = $2 AND status = 'processed' 
       LIMIT 1`,
      [rpcName, height]
    );
    
    return result.rows.length > 0;
  } catch (error) {
    log(`Error checking if block ${height} has existing data: ${error.message}`);
    // On error, assume no data exists
    return false;
  }
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
    log(`Dequeued block ${height} for processing`);
    
    // Check if data already exists in database for this block
    const hasData = await hasBlockResultsData(height);
    if (hasData) {
      log(`Block ${height} already has data in block_results_processed table, will process and update status`);
    }
    
    // Check lag before processing (if RPC URL is available)
    if (rpcUrl) {
      try {
        const latestBlock = await fetchLatestBlock(rpcUrl);
        const currentChainHeight = parseInt(latestBlock.block.header.height, 10);
        stats.currentChainHeight = currentChainHeight;
        
        const allowedMaxHeight = currentChainHeight - LAG_BLOCKS;
        stats.processingLag = currentChainHeight - height;
        
        if (height > allowedMaxHeight) {
          const blocksAhead = height - allowedMaxHeight;
          log(`Skipping block ${height} - too recent (current chain: ${currentChainHeight}, allowed max: ${allowedMaxHeight}, ${blocksAhead} blocks ahead)`);
          
          // Requeue with delay (wait until it's within lag range)
          // Calculate delay: estimate block time (assume ~6 seconds per block)
          const blockTimeSeconds = 6;
          const delaySeconds = blocksAhead * blockTimeSeconds;
          await addToDelayedQueue(rpcName, item, delaySeconds);
          
          stats.skippedCount++;
          await markProcessed(rpcName, height, 'skipped', `Too recent: ${blocksAhead} blocks ahead of allowed max`);
          return { success: true, height, skipped: true, reason: 'too_recent', blocksAhead };
        }
        
        log(`Block ${height} is within lag range (chain: ${currentChainHeight}, lag: ${stats.processingLag} blocks)`);
      } catch (error) {
        log(`Could not check chain height for lag check: ${error.message}, proceeding with processing`);
      }
    }
    
    log(`Fetching block_results for height ${height}`);
    const fetchStartTime = Date.now();
    
    // Fetch block_results
    const blockResultsData = await fetchBlockResultsByHeight(height, blockResultsRpcUrl);
    
    const fetchTime = Date.now() - fetchStartTime;
    
    // Calculate response size for monitoring large responses
    // Use a safe method that doesn't stringify the entire object (which can exceed string length limits)
    let responseSizeMB = '0.00';
    try {
      // Try to calculate size, but catch errors for very large objects
      const responseSize = JSON.stringify(blockResultsData).length;
      responseSizeMB = (responseSize / 1024 / 1024).toFixed(2);
    } catch (error) {
      // For very large objects, estimate size based on structure
      // This is a rough estimate but avoids the string length limit error
      // Catch all string length related errors (RangeError with "Invalid string length" message)
      const isStringLengthError = error instanceof RangeError || 
        (error.message && (
          error.message.includes('Invalid string length') ||
          error.message.includes('Cannot create a string longer than') ||
          error.message.includes('0x1fffffe8') ||
          error.message.includes('string length')
        ));
      
      if (isStringLengthError) {
        const result = blockResultsData?.result;
        const txsCount = result?.txs_results?.length || 0;
        const finalizeBlockEventsCount = result?.finalize_block_events?.length || 0;
        
        // Estimate: ~50KB per tx, ~1KB per event
        const estimatedTxSize = txsCount * 50;
        const estimatedEventSize = finalizeBlockEventsCount;
        const estimatedSize = (estimatedTxSize + estimatedEventSize) / 1024; // Convert to MB
        responseSizeMB = estimatedSize.toFixed(2);
        log(`WARNING: Block ${height} too large to calculate exact size (${error.message || 'Invalid string length'}), estimated: ${responseSizeMB}MB`);
      } else {
        // Re-throw if it's not a string length error
        throw error;
      }
    }
    
    // Count data in response
    const result = blockResultsData?.result;
    const txsCount = result?.txs_results?.length || 0;
    const finalizeBlockEventsCount = result?.finalize_block_events?.length || 0;
    const beginBlockEventsCount = result?.begin_block_events?.length || 0;
    const endBlockEventsCount = result?.end_block_events?.length || 0;
    const totalTxEvents = result?.txs_results?.reduce((sum, tx) => sum + (tx.events?.length || 0), 0) || 0;
    
    log(`Fetched block_results for height ${height} in ${fetchTime}ms (${responseSizeMB}MB, ${txsCount} txs, ${totalTxEvents} tx events, ${finalizeBlockEventsCount} finalize_block, ${beginBlockEventsCount} begin_block, ${endBlockEventsCount} end_block events)`);
    
    if (parseFloat(responseSizeMB) > 5) {
      log(`WARNING: Large block_results response (${responseSizeMB}MB) for height ${height}`);
    }
    
    // Check for "height not available" error - this means the block is pruned/not available
    // Don't retry, just mark as processed and skip
    if (blockResultsData?.error) {
      const errorMessage = blockResultsData.error.message || blockResultsData.error.data || '';
      const errorData = blockResultsData.error.data || '';
      
      // Check if this is a "height not available" error (block is pruned or below lowest height)
      if (errorMessage.includes('not available') || 
          errorData.includes('not available') ||
          errorMessage.includes('lowest height') ||
          errorData.includes('lowest height')) {
        log(`Block ${height} is not available (pruned or below lowest height), skipping: ${errorData || errorMessage}`);
        // Mark as processed so we don't retry
        await markProcessed(rpcName, height, 'skipped', `Height not available: ${errorData || errorMessage}`);
        stats.skippedCount++;
        return { success: true, height, skipped: true, reason: 'height_not_available' };
      }
      
      // For other errors, throw to trigger retry logic
      throw new Error(blockResultsData.error.message || blockResultsData.error.data || 'Unknown RPC error');
    }
    
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
    
    log(`Processing events for block ${height}`);
    const eventStartTime = Date.now();
    
    // Process events asynchronously (fire-and-forget if ASYNC_EVENTS is true)
    const processEvents = async () => {
      try {
        // Validate we have data to process
        const result = blockResultsData?.result;
        if (!result) {
          log(`WARNING: block_results has no result object for height ${height}`);
          return;
        }
        
        // Log data availability for debugging
        const hasTxsResults = result.txs_results && Array.isArray(result.txs_results) && result.txs_results.length > 0;
        const hasFinalizeBlockEvents = result.finalize_block_events && Array.isArray(result.finalize_block_events) && result.finalize_block_events.length > 0;
        const hasBeginBlockEvents = result.begin_block_events && Array.isArray(result.begin_block_events) && result.begin_block_events.length > 0;
        const hasEndBlockEvents = result.end_block_events && Array.isArray(result.end_block_events) && result.end_block_events.length > 0;
        
        if (!hasTxsResults && !hasFinalizeBlockEvents && !hasBeginBlockEvents && !hasEndBlockEvents) {
          log(`WARNING: block_results for height ${height} has no transaction results or block events`);
        }
        
        const eventResults = await processBlockEvents(blockData, blockResultsData, rpcName);
        if (eventResults.length > 0) {
          const successCount = eventResults.filter(r => r.success).length;
          const failedResults = eventResults.filter(r => !r.success);
          const failedCount = failedResults.length;
          const eventTime = Date.now() - eventStartTime;
          log(`Processed ${eventResults.length} events from block_results (${successCount} successful, ${failedCount} failed) for height ${height} in ${eventTime}ms`);
          
          if (failedCount > 0) {
            log(`WARNING: ${failedCount} events failed to process for height ${height}`);
            const failedSummary = failedResults
              .map(result => `${result?.event_type || 'unknown'}(${result?.error || 'unknown_error'})`)
              .join(', ');
            log(`Failed events for height ${height}: ${failedSummary}`);
          }
        } else {
          // Only log if we expected events but got none
          if (hasTxsResults || hasFinalizeBlockEvents || hasBeginBlockEvents || hasEndBlockEvents) {
            log(`WARNING: No events extracted from block_results for height ${height} despite having data (${hasTxsResults ? 'has txs' : ''} ${hasFinalizeBlockEvents ? 'has finalize_block' : ''} ${hasBeginBlockEvents ? 'has begin_block' : ''} ${hasEndBlockEvents ? 'has end_block' : ''})`);
          } else {
            log(`No events found in block_results for height ${height} (empty block)`);
          }
        }
      } catch (error) {
        log(`Error processing events for height ${height}: ${error.message}`);
        console.error(`[BlockResultsWorker ${id}] Error processing events for height ${height}:`, error);
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
    
    // Mark as processed immediately (after fetching and before event processing completes)
    // This allows the queue to continue processing other blocks
    await markProcessed(rpcName, height, 'processed');
    
    // Update stats
    const processingTime = Date.now() - startTime;
    stats.processedCount++;
    stats.processingTimes.push(processingTime);
    // Keep only last 50 processing times (reduced from 100 to save memory)
    if (stats.processingTimes.length > 50) {
      stats.processingTimes.shift();
    }
    
    // Update block height tracking
    stats.currentBlockHeight = height;
    stats.lastProcessedBlockHeight = height;
    
    log(`Successfully processed block ${height} in ${processingTime}ms`);
    
    // Send stats immediately after processing to prevent stale status during long operations
    // This ensures the parent process knows the worker is alive even during 3-4 minute block processing
    await reportStats();
    
    return { success: true, height };
  } catch (error) {
    const processingTime = Date.now() - startTime;
    log(`Error processing block_results for height ${height} after ${processingTime}ms: ${error.message}`);
    console.error(`[BlockResultsWorker ${id}] Error processing block_results for height ${height}:`, error.message);
    
    // Mark as failed (will requeue if retries not exceeded)
    const requeued = await markFailed(rpcName, height, item);
    
    if (requeued) {
      log(`Requeued block ${height} for retry (attempt ${item.retries + 1})`);
    } else {
      // Mark as failed in tracking
      await markProcessed(rpcName, height, 'failed', error.message);
      reportError(`Block ${height} failed after ${item.retries} retries: ${error.message}`);
    }
    
    // Update stats (only count final failures, not retries)
    if (!requeued) {
      stats.failedCount++;
    }
    
    // Send stats immediately after failure to prevent stale status
    await reportStats();
    
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
      log(`Found ${readyItems.length} delayed items ready for processing`);
      const heights = readyItems.map(item => item.height).join(', ');
      log(`Delayed items heights: ${heights}`);
    }
  } catch (error) {
    log(`Error processing delayed items: ${error.message}`);
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
  let lastHeartbeatLog = Date.now();
  
  while (true) {
    try {
      let latestHeight = null;
      let minCurrentHeight = null;
      if (rpcUrl) {
        try {
          const latestBlock = await fetchLatestBlock(rpcUrl);
          latestHeight = parseInt(latestBlock.block.header.height, 10);
          minCurrentHeight = Number.isFinite(latestHeight)
            ? Math.max(0, latestHeight - CURRENT_WINDOW_BLOCKS)
            : null;
          stats.currentChainHeight = latestHeight;
        } catch (error) {
          log(`Could not fetch latest height for lease-scan: ${error.message}`);
        }
      }

      // First, check for delayed items that are ready
      await processDelayedItems();
      
      // Dequeue items up to batch size
      const items = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        const item = await leaseScanDequeueBlockResults(rpcName, {
          role: WORKER_ROLE,
          latestHeight,
          windowBlocks: CURRENT_WINDOW_BLOCKS,
          scanCount: LEASE_SCAN_COUNT
        });
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
        const heights = items.map(item => item.height).join(', ');
        log(`Dequeued ${items.length} items: heights ${heights}`);
        
        // Process items in parallel with concurrency limit
        const results = await processItemsWithConcurrency(items, PARALLEL_PROCESSING_LIMIT);
        const processedCount = results.filter(r => r.status === 'fulfilled' && r.value?.success && !r.value?.skipped).length;
        const skippedCount = results.filter(r => r.status === 'fulfilled' && r.value?.skipped).length;
        const failedCount = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.success && !r.value?.skipped)).length;
        
        if (processedCount > 0 || failedCount > 0 || skippedCount > 0) {
          log(`Batch complete: ${processedCount} processed, ${skippedCount} skipped, ${failedCount} failed`);
        }
      } else {
        consecutiveEmptyPolls++;
        
        // Get queue metrics for monitoring
        const queueSize = await getQueueSize(rpcName);
        const delayedItems = await getDelayedItemsCount(rpcName);
        const processingItems = await getProcessingItemsCount(rpcName);
        
        if (queueSize > 0 || delayedItems > 0 || processingItems > 0) {
          // Queue has items but we didn't get any - might be processing locks
          // Continue polling
          consecutiveEmptyPolls = 0;
          if (queueSize > 0) {
            log(`Queue has ${queueSize} items but none dequeued (role=${WORKER_ROLE}, latest_height=${latestHeight ?? 'unknown'}, min_current_height=${minCurrentHeight ?? 'n/a'}, window=${CURRENT_WINDOW_BLOCKS}, scan_count=${LEASE_SCAN_COUNT}, delayed=${delayedItems}, processing=${processingItems})`);
          }
        }
      }
      
      // Periodic heartbeat log even when idle
      const now = Date.now();
      if (now - lastHeartbeatLog >= HEARTBEAT_LOG_INTERVAL_MS) {
        const queueSize = await getQueueSize(rpcName);
        const delayedItems = await getDelayedItemsCount(rpcName);
        const processingItems = await getProcessingItemsCount(rpcName);
        log(`Heartbeat: queue=${queueSize}, delayed=${delayedItems}, processing=${processingItems}, last_processed=${stats.lastProcessedBlockHeight || 'none'}, lag=${stats.processingLag !== null ? stats.processingLag + ' blocks' : 'unknown'}`);
        lastHeartbeatLog = now;
      }
      
      // Report stats periodically
      if (now - lastStatsReport >= STATS_REPORT_INTERVAL_MS) {
        await reportStats();
        lastStatsReport = now;
      }
      
      // Adjust polling interval based on queue activity
      const pollInterval = consecutiveEmptyPolls > maxEmptyPolls 
        ? POLL_INTERVAL_MS * 2  // Double interval if queue is consistently empty
        : POLL_INTERVAL_MS;
      
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
    } catch (error) {
      log(`Error in processing loop: ${error.message}`);
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
  log(`Starting block_results worker for ${rpcName} (role=${WORKER_ROLE})`);
  log(`Configuration: poll_interval=${POLL_INTERVAL_MS}ms, batch_size=${BATCH_SIZE}, parallel_limit=${PARALLEL_PROCESSING_LIMIT}, async_events=${ASYNC_EVENTS}, rate_limit=${RATE_LIMIT_DELAY_MS}ms, lag_blocks=${LAG_BLOCKS}, current_window_blocks=${CURRENT_WINDOW_BLOCKS}, lease_scan_count=${LEASE_SCAN_COUNT}`);
  
  // Recover items with stale processing locks from previous crashes
  try {
    const recoveredCount = await recoverStaleProcessingItems(rpcName);
    if (recoveredCount > 0) {
      log(`Recovered ${recoveredCount} items with stale processing locks`);
    } else {
      log(`No stale processing locks found`);
    }
  } catch (error) {
    log(`Error during recovery: ${error.message}`);
    console.error(`[BlockResultsWorker ${id}] Error during recovery:`, error.message);
  }
  
  // Log initial queue status
  try {
    const queueSize = await getQueueSize(rpcName);
    const delayedItems = await getDelayedItemsCount(rpcName);
    const processingItems = await getProcessingItemsCount(rpcName);
    log(`Initial queue status: queue=${queueSize}, delayed=${delayedItems}, processing=${processingItems}`);
  } catch (error) {
    log(`Could not get initial queue status: ${error.message}`);
  }
  
  // Send initial stats
  await reportStats();
  
  try {
    await processQueue();
  } catch (error) {
    console.error(`[BlockResultsWorker ${id}] Fatal error:`, error);
    reportError(`Fatal error: ${error.message}`);
    // Send final stats with error status
    const totalAttempts = stats.processedCount + stats.failedCount;
    parentPort.postMessage({
      type: 'stats',
      data: {
        rpcName,
        processedCount: stats.processedCount,
        failedCount: stats.failedCount,
        skippedCount: stats.skippedCount,
        successRate: totalAttempts > 0
          ? parseFloat(((stats.processedCount / totalAttempts) * 100).toFixed(2))
          : 100,
        avgProcessingTimeMs: stats.processingTimes.length > 0
          ? parseFloat((stats.processingTimes.reduce((sum, t) => sum + t, 0) / stats.processingTimes.length).toFixed(2))
          : 0,
        currentBlockHeight: stats.currentBlockHeight,
        lastProcessedBlockHeight: stats.lastProcessedBlockHeight,
        currentChainHeight: stats.currentChainHeight,
        processingLag: stats.processingLag,
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

