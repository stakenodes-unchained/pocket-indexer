/**
 * Event Processor
 * Main entry point for processing events from blocks
 */

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
    // Extract events from block (both transaction and block-level events)
    const eventData = extractEventsFromBlock(blockData, blockResultsData, chain);
    
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

