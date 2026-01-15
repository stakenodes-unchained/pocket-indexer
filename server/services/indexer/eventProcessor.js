const { extractEventsFromBlock, extractEventsFromTransaction } = require('./eventExtractor');
const { parseTypedEvent } = require('./eventParser');
const { routeEvents } = require('./eventRouter');

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
    console.log(
      `[EventProcessor] Extracted ${eventData.length} raw events for block ${blockHeight} (chain=${chain || 'unknown'}): ${Object.entries(rawEventTypeCounts)
        .map(([type, count]) => `${type}=${count}`)
        .join(', ')}`
    );
    
    // Parse all events in parallel
    let parseFailures = 0;
    const parsePromises = eventData.map(async ({ event, metadata }) => {
      try {
        const parsed = parseTypedEvent(event, metadata);
        return parsed;
      } catch (error) {
        console.error(`Error parsing event ${event?.type}:`, error);
        parseFailures += 1;
        return null; // Return null for failed parsing
      }
    });
    
    const parsedResults = await Promise.all(parsePromises);
    const parsedEvents = parsedResults.filter(parsed => parsed !== null);
    
    if (parsedEvents.length === 0) {
      return [];
    }
    
    if (parseFailures > 0) {
      console.warn(
        `[EventProcessor] Failed to parse ${parseFailures}/${eventData.length} events for block ${blockHeight} (chain=${chain || 'unknown'})`
      );
    }
    
    const parsedEventTypeCounts = parsedEvents.reduce((acc, evt) => {
      const type = evt?.event_type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    console.log(
      `[EventProcessor] Parsed ${parsedEvents.length}/${eventData.length} events for block ${blockHeight} (chain=${chain || 'unknown'}): ${Object.entries(parsedEventTypeCounts)
        .map(([type, count]) => `${type}=${count}`)
        .join(', ')}`
    );
    
    // Route and process events
    const results = await routeEvents(parsedEvents);
    const successCount = results.filter(r => r?.success).length;
    const failedResults = results.filter(r => !r?.success);
    
    if (results.length > 0) {
      console.log(
        `[EventProcessor] Routed ${results.length} events for block ${blockHeight} (chain=${chain || 'unknown'}): ${successCount} successful, ${failedResults.length} failed`
      );
    }
    
    if (failedResults.length > 0) {
      const failureSummary = failedResults
        .map(r => `${r?.event_type || 'unknown'}(${r?.error || 'unknown_error'})`)
        .join(', ');
      console.warn(
        `[EventProcessor] Failed events for block ${blockHeight} (chain=${chain || 'unknown'}): ${failureSummary}`
      );
    }
    
    return results;
  } catch (error) {
    console.error('Error processing block events:', error);
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
    
    // Parse all events in parallel
    const parsePromises = eventData.map(async ({ event, metadata }) => {
      try {
        const parsed = parseTypedEvent(event, metadata);
        return parsed;
      } catch (error) {
        console.error(`Error parsing event ${event?.type}:`, error);
        return null; // Return null for failed parsing
      }
    });
    
    const parsedResults = await Promise.all(parsePromises);
    const parsedEvents = parsedResults.filter(parsed => parsed !== null);
    
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

