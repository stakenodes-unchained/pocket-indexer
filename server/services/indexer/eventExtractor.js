/**
 * Event Extractor
 * Extracts events from block data (both transaction events and block-level events)
 */

/**
 * Extract all events from a block
 * @param {Object} blockData - The block data from RPC
 * @param {Object} blockResultsData - Optional block_results data from Tendermint block_results endpoint
 * @returns {Array} Array of events with metadata
 */
function extractEventsFromBlock(blockData, blockResultsData = null) {
  const events = [];
  
  if (!blockData) {
    return events;
  }

  const blockHeight = parseInt(blockData.block?.header?.height || blockData.sdk_block?.header?.height || '0', 10);
  const blockTimestamp = blockData.block?.header?.time || blockData.sdk_block?.header?.time || new Date().toISOString();
  
  // Extract transaction events
  // Events are in block.txs_results[].events or in individual transaction responses
  const txsResults = blockData.txs_results || [];
  
  for (let txIndex = 0; txIndex < txsResults.length; txIndex++) {
    const txResult = txsResults[txIndex];
    const txHash = txResult.tx_hash || txResult.hash || null;
    const txEvents = txResult.events || [];
    
    for (let eventIndex = 0; eventIndex < txEvents.length; eventIndex++) {
      const event = txEvents[eventIndex];
      events.push({
        event,
        metadata: {
          block_height: blockHeight,
          block_timestamp: blockTimestamp,
          transaction_hash: txHash,
          event_source: 'transaction',
          event_index: eventIndex,
          tx_index: txIndex,
          created_timestamp: new Date().toISOString()
        }
      });
    }
  }
  
  // Extract block-level events (from BeginBlock/EndBlock hooks)
  // These can come from multiple sources:
  // 1. blockData.finalize_block_events (if present in block data)
  // 2. blockResultsData.result.finalize_block_events (from block_results API - primary source)
  // 3. blockData.result_begin_block?.events / blockData.result_end_block?.events (legacy)
  
  const finalizeBlockEventsFromBlock = blockData.finalize_block_events || [];
  const finalizeBlockEventsFromResults = blockResultsData?.result?.finalize_block_events || [];
  const beginBlockEvents = blockData.result_begin_block?.events || [];
  const endBlockEvents = blockData.result_end_block?.events || [];
  
  // Combine all block-level events, prioritizing block_results API data
  // Use block_results finalize_block_events if available, otherwise fallback to blockData
  const finalizeBlockEvents = finalizeBlockEventsFromResults.length > 0 
    ? finalizeBlockEventsFromResults 
    : finalizeBlockEventsFromBlock;
  
  const allBlockEvents = [...finalizeBlockEvents, ...beginBlockEvents, ...endBlockEvents];
  
  // Log block-level events for debugging
  if (allBlockEvents.length > 0) {
    console.log(`[EventExtractor] Block ${blockHeight}: Found ${allBlockEvents.length} block-level events`);
    const eventTypes = allBlockEvents.map(e => e.type || e.event_type || 'unknown').filter(Boolean);
    if (eventTypes.length > 0) {
      console.log(`[EventExtractor] Block-level event types:`, [...new Set(eventTypes)].join(', '));
    }
  }
  
  for (let eventIndex = 0; eventIndex < allBlockEvents.length; eventIndex++) {
    const event = allBlockEvents[eventIndex];
    events.push({
      event,
      metadata: {
        block_height: blockHeight,
        block_timestamp: blockTimestamp,
        transaction_hash: null, // Block-level events are not linked to transactions
        event_source: 'block',
        event_index: eventIndex,
        tx_index: null,
        created_timestamp: new Date().toISOString()
      }
    });
  }
  
  return events;
}

/**
 * Extract events from transaction data (when processing individual transactions)
 * @param {Object} txData - Transaction data with tx_response
 * @param {Object} blockData - Block data for metadata
 * @returns {Array} Array of events with metadata
 */
function extractEventsFromTransaction(txData, blockData) {
  const events = [];
  
  if (!txData) {
    return events;
  }

  const blockHeight = parseInt(blockData?.block?.header?.height || blockData?.height || '0', 10);
  const blockTimestamp = blockData?.block?.header?.time || blockData?.timestamp || new Date().toISOString();
  
  // Get events from tx_response
  const txResponse = txData.tx_response || txData;
  const txHash = txResponse.txhash || txResponse.hash || txData.hash || null;
  const txEvents = txResponse.events || [];
  
  // Log EventClaimSettled events in transactions for debugging
  const claimSettledEvents = txEvents.filter(e => 
    e.type?.includes('ClaimSettled') || e.type?.includes('claim_settled')
  );
  if (claimSettledEvents.length > 0) {
    console.log(`[EventExtractor] Transaction ${txHash?.substring(0, 16)}... has ${claimSettledEvents.length} EventClaimSettled event(s)`);
  }
  
  for (let eventIndex = 0; eventIndex < txEvents.length; eventIndex++) {
    const event = txEvents[eventIndex];
    events.push({
      event,
      metadata: {
        block_height: blockHeight,
        block_timestamp: blockTimestamp,
        transaction_hash: txHash,
        event_source: 'transaction',
        event_index: eventIndex,
        tx_index: null,
        created_timestamp: new Date().toISOString()
      }
    });
  }
  
  return events;
}

module.exports = {
  extractEventsFromBlock,
  extractEventsFromTransaction
};

