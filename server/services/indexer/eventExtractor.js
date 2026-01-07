/**
 * Event Extractor
 * Extracts events from block data (both transaction events and block-level events)
 */

/**
 * Extract all events from a block
 * @param {Object} blockData - The block data from RPC
 * @param {Object} blockResultsData - Optional block_results data from Tendermint block_results endpoint
 * @param {String} chain - Chain identifier (e.g., "pokt-mainnet")
 * @returns {Array} Array of events with metadata
 */
function extractEventsFromBlock(blockData, blockResultsData = null, chain = null) {
  const events = [];
  
  if (!blockData && !blockResultsData) {
    return events;
  }

  // Get block height and timestamp - prioritize blockResultsData if available
  let blockHeight = 0;
  let blockTimestamp = new Date().toISOString();
  
  if (blockResultsData?.result?.height) {
    blockHeight = parseInt(blockResultsData.result.height, 10);
  } else if (blockData) {
    blockHeight = parseInt(blockData.block?.header?.height || blockData.sdk_block?.header?.height || '0', 10);
  }
  
  if (blockData) {
    blockTimestamp = blockData.block?.header?.time || blockData.sdk_block?.header?.time || blockTimestamp;
  }
  
  // Extract transaction events
  // Priority: block_results.txs_results (most complete) > blockData.txs_results
  let txsResults = [];
  
  if (blockResultsData?.result?.txs_results && Array.isArray(blockResultsData.result.txs_results)) {
    // Use transaction results from block_results API (most complete source)
    txsResults = blockResultsData.result.txs_results;
  } else if (blockData?.txs_results && Array.isArray(blockData.txs_results)) {
    // Fallback to blockData transaction results
    txsResults = blockData.txs_results;
  }
  
  for (let txIndex = 0; txIndex < txsResults.length; txIndex++) {
    const txResult = txsResults[txIndex];
    // Transaction hash might not be in block_results, try to get it from blockData if available
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
          chain: chain,
          created_timestamp: blockTimestamp
        }
      });
    }
  }
  
  // Extract block-level events (from BeginBlock/EndBlock hooks)
  // Priority: block_results API (finalize_block_events) > blockData fallbacks
  // Note: block_results API uses finalize_block_events which contains both BeginBlock and EndBlock events
  let beginBlockEvents = [];
  let endBlockEvents = [];
  let finalizeBlockEvents = [];
  
  // Primary source: block_results API
  if (blockResultsData?.result) {
    // block_results API uses finalize_block_events (contains both BeginBlock and EndBlock events)
    if (Array.isArray(blockResultsData.result.finalize_block_events)) {
      finalizeBlockEvents = blockResultsData.result.finalize_block_events;
    }
    // Some chains might have separate begin_block_events and end_block_events
    if (Array.isArray(blockResultsData.result.begin_block_events)) {
      beginBlockEvents = blockResultsData.result.begin_block_events;
    }
    if (Array.isArray(blockResultsData.result.end_block_events)) {
      endBlockEvents = blockResultsData.result.end_block_events;
    }
  }
  
  // Fallback sources from blockData (legacy formats)
  if (finalizeBlockEvents.length === 0 && blockData) {
    finalizeBlockEvents = blockData.finalize_block_events || [];
  }
  if (beginBlockEvents.length === 0 && blockData) {
    beginBlockEvents = blockData.result_begin_block?.events || blockData.begin_block_events || [];
  }
  if (endBlockEvents.length === 0 && blockData) {
    endBlockEvents = blockData.result_end_block?.events || blockData.end_block_events || [];
  }
  
  const allBlockEvents = [...finalizeBlockEvents, ...beginBlockEvents, ...endBlockEvents];
  
  // Log block-level events for debugging
  if (allBlockEvents.length > 0) {
    console.log(`[EventExtractor] Block ${blockHeight}: Found ${allBlockEvents.length} block-level events (${beginBlockEvents.length} begin, ${endBlockEvents.length} end, ${finalizeBlockEvents.length} finalize)`);
    const eventTypes = allBlockEvents.map(e => e.type || e.event_type || 'unknown').filter(Boolean);
    if (eventTypes.length > 0) {
      console.log(`[EventExtractor] Block-level event types:`, [...new Set(eventTypes)].join(', '));
    }
  }
  
  // Log transaction events summary
  if (txsResults.length > 0) {
    const totalTxEvents = txsResults.reduce((sum, tx) => sum + (tx.events?.length || 0), 0);
    console.log(`[EventExtractor] Block ${blockHeight}: Found ${txsResults.length} transactions with ${totalTxEvents} total transaction events`);
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
        chain: chain,
        created_timestamp: blockTimestamp
      }
    });
  }
  
  return events;
}

/**
 * Extract events from transaction data (when processing individual transactions)
 * @param {Object} txData - Transaction data with tx_response
 * @param {Object} blockData - Block data for metadata
 * @param {String} chain - Chain identifier (e.g., "pokt-mainnet")
 * @returns {Array} Array of events with metadata
 */
function extractEventsFromTransaction(txData, blockData, chain = null) {
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
        chain: chain,
        created_timestamp: blockTimestamp
      }
    });
  }
  
  return events;
}

module.exports = {
  extractEventsFromBlock,
  extractEventsFromTransaction
};

