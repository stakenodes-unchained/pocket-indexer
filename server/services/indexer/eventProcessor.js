const { extractEventsFromBlock, extractEventsFromTransaction } = require('./eventExtractor');
const { parseTypedEvent } = require('./eventParser');
const { routeEvents } = require('./eventRouter');

// Configuration for batch processing
const EVENT_PARSE_BATCH_SIZE = parseInt(process.env.BLOCK_RESULTS_EVENT_PARSE_BATCH_SIZE || '10000', 10);

/**
 * Process events in batches to prevent memory exhaustion
 * @param {Array} eventData - Array of event data objects
 * @param {String} blockHeight - Block height for logging
 * @param {String} chain - Chain identifier
 * @returns {Promise<Array>} Array of parsed events
 */
async function parseEventsInBatches(eventData, blockHeight, chain = null) {
  const totalEvents = eventData.length;
  const parsedEvents = [];
  let parseFailures = 0;
  const startTime = Date.now();
  const totalBatches = Math.ceil(totalEvents / EVENT_PARSE_BATCH_SIZE);
  
  console.log(
    `[EventProcessor] Starting batch parsing for block ${blockHeight} (chain=${chain || 'unknown'}): ` +
    `${totalEvents} total events, batch size: ${EVENT_PARSE_BATCH_SIZE}, ` +
    `${totalBatches} batches to process`
  );
  
  // Process events in batches
  for (let i = 0; i < totalEvents; i += EVENT_PARSE_BATCH_SIZE) {
    // Yield to event loop between batches to prevent CPU soft locks
    await new Promise(resolve => setImmediate(resolve));
    
    const batch = eventData.slice(i, i + EVENT_PARSE_BATCH_SIZE);
    const batchNum = Math.floor(i / EVENT_PARSE_BATCH_SIZE) + 1;
    const batchStartTime = Date.now();
    const batchSize = batch.length;
    const eventsProcessed = Math.min(i + EVENT_PARSE_BATCH_SIZE, totalEvents);
    const progressPercent = ((eventsProcessed / totalEvents) * 100).toFixed(1);
    
    try {
      console.log(
        `[EventProcessor] Processing batch ${batchNum}/${totalBatches} for block ${blockHeight}: ` +
        `${batchSize} events (${eventsProcessed}/${totalEvents}, ${progressPercent}% complete)`
      );
      
      // Parse batch in controlled concurrency to avoid CPU locks
      // Process in smaller chunks within each batch (max 1000 concurrent promises)
      const CONCURRENT_PARSE_LIMIT = 1000;
      const batchResults = [];
      
      for (let j = 0; j < batch.length; j += CONCURRENT_PARSE_LIMIT) {
        const chunk = batch.slice(j, j + CONCURRENT_PARSE_LIMIT);
        const parsePromises = chunk.map(async ({ event, metadata }) => {
          try {
            const parsed = parseTypedEvent(event, metadata);
            return parsed;
          } catch (error) {
            console.error(`[EventProcessor] Error parsing event ${event?.type} in block ${blockHeight}:`, error.message);
            parseFailures += 1;
            return null;
          }
        });
        
        const chunkResults = await Promise.all(parsePromises);
        batchResults.push(...chunkResults);
        
        // Yield to event loop after each chunk within batch
        if (j + CONCURRENT_PARSE_LIMIT < batch.length) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      
      const batchFailed = batchSize - batchParsed.length;
      parsedEvents.push(...batchParsed);
      
      const batchTime = Date.now() - batchStartTime;
      const batchRate = batchSize > 0 ? (batchSize / (batchTime / 1000)).toFixed(0) : 0;
      const elapsedTime = Date.now() - startTime;
      const avgRate = eventsProcessed > 0 ? (eventsProcessed / (elapsedTime / 1000)).toFixed(0) : 0;
      const estimatedRemaining = totalEvents - eventsProcessed;
      const estimatedTimeRemaining = avgRate > 0 ? Math.round(estimatedRemaining / avgRate) : 0;
      
      // Log progress for all batches (not just large blocks)
      console.log(
        `[EventProcessor] Completed batch ${batchNum}/${totalBatches} for block ${blockHeight}: ` +
        `${batchParsed.length} parsed, ${batchFailed} failed, ` +
        `batch time: ${batchTime}ms (${batchRate} events/sec), ` +
        `total progress: ${parsedEvents.length}/${totalEvents} parsed ` +
        `(${avgRate} events/sec avg, ~${estimatedTimeRemaining}s remaining)`
      );
      
      // Log detailed progress for large blocks
      if (totalEvents > 100000 && batchNum % 10 === 0) {
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
        const heapTotalMB = (memoryUsage.heapTotal / 1024 / 1024).toFixed(2);
        console.log(
          `[EventProcessor] Progress checkpoint for block ${blockHeight}: ` +
          `${parsedEvents.length}/${totalEvents} events parsed (${((parsedEvents.length / totalEvents) * 100).toFixed(1)}%), ` +
          `elapsed: ${(elapsedTime / 1000).toFixed(1)}s, ` +
          `memory: ${heapUsedMB}MB/${heapTotalMB}MB heap`
        );
      }
    } catch (error) {
      const batchTime = Date.now() - batchStartTime;
      console.error(
        `[EventProcessor] Error parsing batch ${batchNum}/${totalBatches} for block ${blockHeight} ` +
        `after ${batchTime}ms: ${error.message}`
      );
      console.error(`[EventProcessor] Stack trace:`, error.stack);
      // Continue with next batch instead of failing completely
    }
  }
  
  const totalTime = Date.now() - startTime;
  const successCount = parsedEvents.length;
  const successRate = totalEvents > 0 ? ((successCount / totalEvents) * 100).toFixed(2) : 0;
  const overallRate = totalTime > 0 ? (totalEvents / (totalTime / 1000)).toFixed(0) : 0;
  
  console.log(
    `[EventProcessor] Completed batch parsing for block ${blockHeight} (chain=${chain || 'unknown'}): ` +
    `${successCount}/${totalEvents} events parsed successfully (${successRate}% success rate), ` +
    `${parseFailures} parse failures, ` +
    `total time: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s), ` +
    `average rate: ${overallRate} events/sec`
  );
  
  if (parseFailures > 0) {
    console.warn(
      `[EventProcessor] Warning: Failed to parse ${parseFailures}/${totalEvents} events for block ${blockHeight} (chain=${chain || 'unknown'})`
    );
  }
  
  return parsedEvents;
}

/**
 * Process events from a block
 * @param {Object} blockData - Block data from RPC
 * @param {Object} blockResultsData - Optional block_results data from Tendermint block_results endpoint
 * @param {String} chain - Chain identifier (e.g., "pokt-mainnet")
 * @returns {Promise<Array>} Array of processing results
 */
async function processBlockEvents(blockData, blockResultsData = null, chain = null) {
  try {
    const blockHeight = blockData?.block?.header?.height || blockData?.header?.height || 'unknown';
    // Extract events from block (both transaction and block-level events)
    const eventData = extractEventsFromBlock(blockData, blockResultsData, chain);
    
    if (eventData.length === 0) {
      return [];
    }
    
    const rawEventTypeCounts = eventData.reduce((acc, { event }) => {
      const type = event?.type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Log event counts (truncate for very large blocks)
    const eventTypeSummary = eventData.length > 100000
      ? `${Object.keys(rawEventTypeCounts).length} event types, ${eventData.length} total events`
      : Object.entries(rawEventTypeCounts)
          .map(([type, count]) => `${type}=${count}`)
          .join(', ');
    
    console.log(
      `[EventProcessor] Extracted ${eventData.length} raw events for block ${blockHeight} (chain=${chain || 'unknown'}): ${eventTypeSummary}`
    );
    
    // Parse events in batches to prevent memory exhaustion
    const parsedEvents = await parseEventsInBatches(eventData, blockHeight, chain);
    
    if (parsedEvents.length === 0) {
      return [];
    }
    
    const parsedEventTypeCounts = parsedEvents.reduce((acc, evt) => {
      const type = evt?.event_type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    // Log parsed event counts (truncate for very large blocks)
    const parsedEventTypeSummary = parsedEvents.length > 100000
      ? `${Object.keys(parsedEventTypeCounts).length} event types, ${parsedEvents.length} total events`
      : Object.entries(parsedEventTypeCounts)
          .map(([type, count]) => `${type}=${count}`)
          .join(', ');
    
    console.log(
      `[EventProcessor] Parsed ${parsedEvents.length}/${eventData.length} events for block ${blockHeight} (chain=${chain || 'unknown'}): ${parsedEventTypeSummary}`
    );
    
    // Route and process events (routeEvents already has concurrency limits)
    const results = await routeEvents(parsedEvents);
    const successCount = results.filter(r => r?.success).length;
    const failedResults = results.filter(r => !r?.success);
    
    if (results.length > 0) {
      console.log(
        `[EventProcessor] Routed ${results.length} events for block ${blockHeight} (chain=${chain || 'unknown'}): ${successCount} successful, ${failedResults.length} failed`
      );
    }
    
    if (failedResults.length > 0) {
      // Truncate failure summary for very large blocks
      const failureSummary = failedResults.length > 100
        ? `${failedResults.length} failed events (too many to list)`
        : failedResults
            .map(r => `${r?.event_type || 'unknown'}(${r?.error || 'unknown_error'})`)
            .join(', ');
      console.warn(
        `[EventProcessor] Failed events for block ${blockHeight} (chain=${chain || 'unknown'}): ${failureSummary}`
      );
    }
    
    return results;
  } catch (error) {
    console.error(`[EventProcessor] Error processing block events for block ${blockData?.block?.header?.height || blockData?.header?.height || 'unknown'}:`, error);
    // Return empty array instead of throwing to prevent worker crash
    return [];
  }
}

/**
 * Process events from a transaction
 * @param {Object} txData - Transaction data with tx_response
 * @param {Object} blockData - Block data for metadata
 * @param {String} chain - Chain identifier (e.g., "pokt-mainnet")
 * @returns {Promise<Array>} Array of processing results
 */
async function processTransactionEvents(txData, blockData, chain = null) {
  try {
    // Extract events from transaction
    const eventData = extractEventsFromTransaction(txData, blockData, chain);
    
    if (eventData.length === 0) {
      return [];
    }
    
    // For transactions, events are typically small, but use batch processing for safety
    const blockHeight = blockData?.block?.header?.height || blockData?.header?.height || 'unknown';
    const parsedEvents = await parseEventsInBatches(eventData, blockHeight, chain);
    
    if (parsedEvents.length === 0) {
      return [];
    }
    
    // Route and process events
    const results = await routeEvents(parsedEvents);
    
    return results;
  } catch (error) {
    console.error('Error processing transaction events:', error);
    return [];
  }
}

module.exports = {
  processBlockEvents,
  processTransactionEvents
};

