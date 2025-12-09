/**
 * Event Router
 * Routes parsed events to appropriate handlers based on event type and module
 */

const tokenomicsHandlers = require('./handlers/tokenomicsEvents');
const applicationHandlers = require('./handlers/applicationEvents');
const supplierHandlers = require('./handlers/supplierEvents');
const gatewayHandlers = require('./handlers/gatewayEvents');
const proofHandlers = require('./handlers/proofEvents');
const serviceHandlers = require('./handlers/serviceEvents');
const migrationHandlers = require('./handlers/migrationEvents');

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
 * Process multiple events in order
 * @param {Array} parsedEvents - Array of parsed events
 * @returns {Promise<Array>} Array of handler results
 */
async function routeEvents(parsedEvents) {
  const results = [];
  
  for (const event of parsedEvents) {
    try {
      const result = await routeEvent(event);
      results.push(result);
    } catch (error) {
      console.error(`Error processing event ${event?.event_type}:`, error);
      results.push({ success: false, error: error.message, event_type: event?.event_type });
    }
  }
  
  return results;
}

module.exports = {
  routeEvent,
  routeEvents
};

