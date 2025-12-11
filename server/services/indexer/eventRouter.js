/**
 * Event Router
 * Routes parsed events to appropriate handlers based on event type and module
 */

const pLimit = require('p-limit');
const tokenomicsHandlers = require('./handlers/tokenomicsEvents');
const applicationHandlers = require('./handlers/applicationEvents');
const supplierHandlers = require('./handlers/supplierEvents');
const gatewayHandlers = require('./handlers/gatewayEvents');
const proofHandlers = require('./handlers/proofEvents');
const serviceHandlers = require('./handlers/serviceEvents');
const migrationHandlers = require('./handlers/migrationEvents');
const accountHandlers = require('./handlers/accountEvents');

// Concurrency limit for event routing (default: 10)
const EVENT_CONCURRENCY_LIMIT = parseInt(process.env.BLOCK_RESULTS_EVENT_CONCURRENCY || '10', 10);
const limit = pLimit(EVENT_CONCURRENCY_LIMIT);

/**
 * Route an event to the appropriate handler
 * @param {Object} parsedEvent - Parsed event object
 * @returns {Promise<Object>} Handler result
 */
async function routeEvent(parsedEvent) {
  if (!parsedEvent || !parsedEvent.event_type) {
    console.warn('Invalid event passed to router:', parsedEvent);
    return { success: false, error: 'Invalid event' };
  }

  const eventType = parsedEvent.event_type;
  
  try {
    // Tokenomics events
    if (eventType.includes('EventClaim') || eventType.includes('tokenomics') ||
        eventType === 'EventSupplierSlashed' ||
        eventType === 'EventApplicationOverserviced' ||
        eventType === 'EventApplicationReimbursementRequest') {
      return await handleTokenomicsEvent(parsedEvent);
    }
    
    // Application events
    else if (eventType.startsWith('EventApplication') || 
             eventType === 'EventRedelegation' ||
             eventType.startsWith('EventTransfer')) {
      return await handleApplicationEvent(parsedEvent);
    }
    
    // Supplier events
    else if (eventType.startsWith('EventSupplier')) {
      return await handleSupplierEvent(parsedEvent);
    }
    
    // Gateway events
    else if (eventType.startsWith('EventGateway')) {
      return await handleGatewayEvent(parsedEvent);
    }
    
    // Proof events
    else if (eventType.startsWith('EventProof') || 
             eventType === 'EventClaimCreated' ||
             eventType === 'EventClaimUpdated') {
      return await handleProofEvent(parsedEvent);
    }
    
    // Service events
    else if (eventType === 'EventRelayMiningDifficultyUpdated') {
      return await handleServiceEvent(parsedEvent);
    }
    
    // Migration events
    else if (eventType.startsWith('EventMorse') || 
             eventType === 'EventImportMorseClaimableAccounts') {
      return await handleMigrationEvent(parsedEvent);
    }
    
    // Account/Balance events (Cosmos SDK standard events)
    else if (eventType === 'coin_spent' ||
             eventType === 'coin_received' ||
             eventType === 'transfer' ||
             eventType === 'message' ||
             eventType === 'mint' ||
             eventType === 'commission' ||
             eventType === 'rewards') {
      return await handleAccountEvent(parsedEvent);
    }
    
    // Unknown event type
    else {
      console.warn(`Unknown event type: ${eventType}`);
      return { success: false, error: `Unknown event type: ${eventType}` };
    }
  } catch (error) {
    console.error(`Error routing event ${eventType}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle tokenomics events
 */
async function handleTokenomicsEvent(event) {
  const { event_type } = event;
  
  switch (event_type) {
    case 'EventClaimSettled':
      return await tokenomicsHandlers.handleClaimSettled(event);
    case 'EventClaimExpired':
      return await tokenomicsHandlers.handleClaimExpired(event);
    case 'EventSupplierSlashed':
      return await tokenomicsHandlers.handleSupplierSlashed(event);
    case 'EventApplicationOverserviced':
      return await tokenomicsHandlers.handleApplicationOverserviced(event);
    case 'EventClaimDiscarded':
      return await tokenomicsHandlers.handleClaimDiscarded(event);
    case 'EventApplicationReimbursementRequest':
      return await tokenomicsHandlers.handleApplicationReimbursementRequest(event);
    default:
      return { success: false, error: `Unknown tokenomics event: ${event_type}` };
  }
}

/**
 * Handle application events
 */
async function handleApplicationEvent(event) {
  const { event_type } = event;
  
  switch (event_type) {
    case 'EventApplicationStaked':
      return await applicationHandlers.handleApplicationStaked(event);
    case 'EventRedelegation':
      return await applicationHandlers.handleRedelegation(event);
    case 'EventTransferBegin':
      return await applicationHandlers.handleTransferBegin(event);
    case 'EventTransferEnd':
      return await applicationHandlers.handleTransferEnd(event);
    case 'EventTransferError':
      return await applicationHandlers.handleTransferError(event);
    case 'EventApplicationUnbondingBegin':
      return await applicationHandlers.handleApplicationUnbondingBegin(event);
    case 'EventApplicationUnbondingEnd':
      return await applicationHandlers.handleApplicationUnbondingEnd(event);
    case 'EventApplicationUnbondingCanceled':
      return await applicationHandlers.handleApplicationUnbondingCanceled(event);
    default:
      return { success: false, error: `Unknown application event: ${event_type}` };
  }
}

/**
 * Handle supplier events
 */
async function handleSupplierEvent(event) {
  const { event_type } = event;
  
  switch (event_type) {
    case 'EventSupplierStaked':
      return await supplierHandlers.handleSupplierStaked(event);
    case 'EventSupplierUnbondingBegin':
      return await supplierHandlers.handleSupplierUnbondingBegin(event);
    case 'EventSupplierUnbondingEnd':
      return await supplierHandlers.handleSupplierUnbondingEnd(event);
    case 'EventSupplierUnbondingCanceled':
      return await supplierHandlers.handleSupplierUnbondingCanceled(event);
    case 'EventSupplierServiceConfigActivated':
      return await supplierHandlers.handleSupplierServiceConfigActivated(event);
    default:
      return { success: false, error: `Unknown supplier event: ${event_type}` };
  }
}

/**
 * Handle gateway events
 */
async function handleGatewayEvent(event) {
  const { event_type } = event;
  
  switch (event_type) {
    case 'EventGatewayStaked':
      return await gatewayHandlers.handleGatewayStaked(event);
    case 'EventGatewayUnbondingBegin':
      return await gatewayHandlers.handleGatewayUnbondingBegin(event);
    case 'EventGatewayUnbondingEnd':
      return await gatewayHandlers.handleGatewayUnbondingEnd(event);
    case 'EventGatewayUnbondingCanceled':
      return await gatewayHandlers.handleGatewayUnbondingCanceled(event);
    default:
      return { success: false, error: `Unknown gateway event: ${event_type}` };
  }
}

/**
 * Handle proof events
 */
async function handleProofEvent(event) {
  const { event_type } = event;
  
  switch (event_type) {
    case 'EventClaimCreated':
      return await proofHandlers.handleClaimCreated(event);
    case 'EventClaimUpdated':
      return await proofHandlers.handleClaimUpdated(event);
    case 'EventProofSubmitted':
      return await proofHandlers.handleProofSubmitted(event);
    case 'EventProofUpdated':
      return await proofHandlers.handleProofUpdated(event);
    case 'EventProofValidityChecked':
      return await proofHandlers.handleProofValidityChecked(event);
    default:
      return { success: false, error: `Unknown proof event: ${event_type}` };
  }
}

/**
 * Handle service events
 */
async function handleServiceEvent(event) {
  const { event_type } = event;
  
  switch (event_type) {
    case 'EventRelayMiningDifficultyUpdated':
      return await serviceHandlers.handleRelayMiningDifficultyUpdated(event);
    default:
      return { success: false, error: `Unknown service event: ${event_type}` };
  }
}

/**
 * Handle migration events
 */
async function handleMigrationEvent(event) {
  const { event_type } = event;
  
  switch (event_type) {
    case 'EventImportMorseClaimableAccounts':
      return await migrationHandlers.handleImportMorseClaimableAccounts(event);
    case 'EventMorseAccountClaimed':
      return await migrationHandlers.handleMorseAccountClaimed(event);
    case 'EventMorseApplicationClaimed':
      return await migrationHandlers.handleMorseApplicationClaimed(event);
    case 'EventMorseSupplierClaimed':
      return await migrationHandlers.handleMorseSupplierClaimed(event);
    case 'EventMorseAccountRecovered':
      return await migrationHandlers.handleMorseAccountRecovered(event);
    default:
      return { success: false, error: `Unknown migration event: ${event_type}` };
  }
}

/**
 * Handle account/balance events
 */
async function handleAccountEvent(event) {
  const { event_type } = event;
  
  switch (event_type) {
    case 'coin_spent':
      return await accountHandlers.handleCoinSpent(event);
    case 'coin_received':
      return await accountHandlers.handleCoinReceived(event);
    case 'transfer':
      return await accountHandlers.handleTransfer(event);
    case 'message':
      return await accountHandlers.handleMessage(event);
    case 'mint':
      return await accountHandlers.handleMint(event);
    case 'commission':
      return await accountHandlers.handleCommission(event);
    case 'rewards':
      return await accountHandlers.handleRewards(event);
    default:
      return { success: false, error: `Unknown account event: ${event_type}` };
  }
}

/**
 * Process multiple events in parallel with concurrency control
 * @param {Array} parsedEvents - Array of parsed events
 * @returns {Promise<Array>} Array of handler results
 */
async function routeEvents(parsedEvents) {
  // Process all events in parallel with concurrency limit
  const promises = parsedEvents.map(event => 
    limit(async () => {
      try {
        return await routeEvent(event);
      } catch (error) {
        console.error(`Error processing event ${event?.event_type}:`, error);
        return { success: false, error: error.message, event_type: event?.event_type };
      }
    })
  );
  
  const results = await Promise.all(promises);
  return results;
}

module.exports = {
  routeEvent,
  routeEvents
};

