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
 * @returns {Promise<Array>} Array of processing results
 */
async function processBlockEvents(blockData, blockResultsData = null) {
  try {
    // Extract events from block (both transaction and block-level events)
    const eventData = extractEventsFromBlock(blockData, blockResultsData);
    
    if (eventData.length === 0) {
      return [];
    }
    
    // Parse all events
    const parsedEvents = [];
    for (const { event, metadata } of eventData) {
      try {
        const parsed = parseTypedEvent(event, metadata);
        if (parsed) {
          parsedEvents.push(parsed);
        }
      } catch (error) {
        console.error(`Error parsing event ${event?.type}:`, error);
        // Continue with other events
      }
    }
    
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
 * @returns {Promise<Array>} Array of processing results
 */
async function processTransactionEvents(txData, blockData) {
  try {
    // Extract events from transaction
    const eventData = extractEventsFromTransaction(txData, blockData);
    
    if (eventData.length === 0) {
      return [];
    }
    
    // Parse all events
    const parsedEvents = [];
    for (const { event, metadata } of eventData) {
      try {
        const parsed = parseTypedEvent(event, metadata);
        if (parsed) {
          parsedEvents.push(parsed);
        }
      } catch (error) {
        console.error(`Error parsing event ${event?.type}:`, error);
        // Continue with other events
      }
    }
    
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

