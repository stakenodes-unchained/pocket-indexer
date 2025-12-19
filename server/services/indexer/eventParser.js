/**
 * Event Parser
 * Parses typed events from Cosmos SDK event structure
 * Maps event types to structured data models
 */

/**
 * Parse event attributes into a key-value map
 * Cosmos SDK events have attributes as array of {key, value} objects
 * @param {Array} attributes - Event attributes array
 * @returns {Object} Parsed attributes as key-value map
 */
function parseEventAttributes(attributes) {
  const parsed = {};
  
  if (!Array.isArray(attributes)) {
    return parsed;
  }
  
  for (const attr of attributes) {
    if (!attr || !attr.key || attr.value === undefined) {
      continue;
    }
    
    const key = attr.key;
    let value = attr.value;
    
    // Try to parse JSON values
    if (typeof value === 'string') {
      // Handle escaped quotes and remove outer quotes
      // Values can be like: "\"value\"" or "value" or just value
      let cleanedValue = value;
      
      // First, try to parse as JSON (handles escaped quotes)
      try {
        const jsonValue = JSON.parse(value);
        // If it parsed to a string, use that (removes outer quotes and unescapes)
        if (typeof jsonValue === 'string') {
          parsed[key] = jsonValue;
        } else {
          parsed[key] = jsonValue;
        }
      } catch (e) {
        // If JSON parsing fails, try simple quote removal
        cleanedValue = value.replace(/^["']|["']$/g, '');
        // Also handle escaped quotes
        cleanedValue = cleanedValue.replace(/\\"/g, '"');
        parsed[key] = cleanedValue;
      }
    } else {
      parsed[key] = value;
    }
  }
  
  return parsed;
}

/**
 * Extract typed event data from event structure
 * @param {Object} event - Raw event object
 * @param {Object} metadata - Event metadata
 * @returns {Object|null} Parsed event data or null if parsing fails
 */
function parseTypedEvent(event, metadata) {
  if (!event || !event.type) {
    return null;
  }
  
  const eventType = event.type;
  const attributes = parseEventAttributes(event.attributes || []);
  
  // Log EventClaimSettled events for debugging
  if (eventType.includes('ClaimSettled') || eventType.includes('claim_settled')) {
    console.log(`[EventParser] Found claim settled event: type=${eventType}, block=${metadata?.block_height}`);
  }
  
  // Create base event structure
  const parsedEvent = {
    event_type: eventType,
    attributes,
    metadata
  };
  
  // Extract common fields based on event type
  // Tokenomics events
  if (eventType === 'pocket.tokenomics.EventClaimSettled') {
    return parseClaimSettledEvent(attributes, metadata);
  } else if (eventType === 'pocket.tokenomics.EventClaimExpired') {
    return parseClaimExpiredEvent(attributes, metadata);
  } else if (eventType === 'pocket.tokenomics.EventSupplierSlashed') {
    return parseSupplierSlashedEvent(attributes, metadata);
  } else if (eventType === 'pocket.tokenomics.EventApplicationOverserviced') {
    return parseApplicationOverservicedEvent(attributes, metadata);
  } else if (eventType === 'pocket.tokenomics.EventClaimDiscarded') {
    return parseClaimDiscardedEvent(attributes, metadata);
  } else if (eventType === 'pocket.tokenomics.EventApplicationReimbursementRequest') {
    return parseApplicationReimbursementRequestEvent(attributes, metadata);
  }
  
  // Application events
  else if (eventType === 'pocket.application.EventApplicationStaked') {
    return parseApplicationStakedEvent(attributes, metadata);
  } else if (eventType === 'pocket.application.EventRedelegation') {
    return parseRedelegationEvent(attributes, metadata);
  } else if (eventType === 'pocket.application.EventTransferBegin') {
    return parseTransferBeginEvent(attributes, metadata);
  } else if (eventType === 'pocket.application.EventTransferEnd') {
    return parseTransferEndEvent(attributes, metadata);
  } else if (eventType === 'pocket.application.EventTransferError') {
    return parseTransferErrorEvent(attributes, metadata);
  } else if (eventType === 'pocket.application.EventApplicationUnbondingBegin') {
    return parseApplicationUnbondingBeginEvent(attributes, metadata);
  } else if (eventType === 'pocket.application.EventApplicationUnbondingEnd') {
    return parseApplicationUnbondingEndEvent(attributes, metadata);
  } else if (eventType === 'pocket.application.EventApplicationUnbondingCanceled') {
    return parseApplicationUnbondingCanceledEvent(attributes, metadata);
  }
  
  // Supplier events
  else if (eventType === 'pocket.supplier.EventSupplierStaked') {
    return parseSupplierStakedEvent(attributes, metadata);
  } else if (eventType === 'pocket.supplier.EventSupplierUnbondingBegin') {
    return parseSupplierUnbondingBeginEvent(attributes, metadata);
  } else if (eventType === 'pocket.supplier.EventSupplierUnbondingEnd') {
    return parseSupplierUnbondingEndEvent(attributes, metadata);
  } else if (eventType === 'pocket.supplier.EventSupplierUnbondingCanceled') {
    return parseSupplierUnbondingCanceledEvent(attributes, metadata);
  } else if (eventType === 'pocket.supplier.EventSupplierServiceConfigActivated') {
    return parseSupplierServiceConfigActivatedEvent(attributes, metadata);
  }
  
  // Gateway events
  else if (eventType === 'pocket.gateway.EventGatewayStaked') {
    return parseGatewayStakedEvent(attributes, metadata);
  } else if (eventType === 'pocket.gateway.EventGatewayUnbondingBegin') {
    return parseGatewayUnbondingBeginEvent(attributes, metadata);
  } else if (eventType === 'pocket.gateway.EventGatewayUnbondingEnd') {
    return parseGatewayUnbondingEndEvent(attributes, metadata);
  } else if (eventType === 'pocket.gateway.EventGatewayUnbondingCanceled') {
    return parseGatewayUnbondingCanceledEvent(attributes, metadata);
  }
  
  // Proof events
  else if (eventType === 'pocket.proof.EventClaimCreated') {
    return parseClaimCreatedEvent(attributes, metadata);
  } else if (eventType === 'pocket.proof.EventClaimUpdated') {
    return parseClaimUpdatedEvent(attributes, metadata);
  } else if (eventType === 'pocket.proof.EventProofSubmitted') {
    return parseProofSubmittedEvent(attributes, metadata);
  } else if (eventType === 'pocket.proof.EventProofUpdated') {
    return parseProofUpdatedEvent(attributes, metadata);
  } else if (eventType === 'pocket.proof.EventProofValidityChecked') {
    return parseProofValidityCheckedEvent(attributes, metadata);
  }
  
  // Service events
  else if (eventType === 'pocket.service.EventRelayMiningDifficultyUpdated') {
    return parseRelayMiningDifficultyUpdatedEvent(attributes, metadata);
  }
  
  // Migration events
  else if (eventType === 'pocket.migration.EventImportMorseClaimableAccounts') {
    return parseImportMorseClaimableAccountsEvent(attributes, metadata);
  } else if (eventType === 'pocket.migration.EventMorseAccountClaimed') {
    return parseMorseAccountClaimedEvent(attributes, metadata);
  } else if (eventType === 'pocket.migration.EventMorseApplicationClaimed') {
    return parseMorseApplicationClaimedEvent(attributes, metadata);
  } else if (eventType === 'pocket.migration.EventMorseSupplierClaimed') {
    return parseMorseSupplierClaimedEvent(attributes, metadata);
  } else if (eventType === 'pocket.migration.EventMorseAccountRecovered') {
    return parseMorseAccountRecoveredEvent(attributes, metadata);
  }
  
  // Account/Balance events (Cosmos SDK standard events)
  else if (eventType === 'coin_spent') {
    return parseCoinSpentEvent(attributes, metadata);
  } else if (eventType === 'coin_received') {
    return parseCoinReceivedEvent(attributes, metadata);
  } else if (eventType === 'transfer') {
    return parseTransferEvent(attributes, metadata);
  } else if (eventType === 'message') {
    return parseMessageEvent(attributes, metadata);
  } else if (eventType === 'mint') {
    return parseMintEvent(attributes, metadata);
  } else if (eventType === 'commission') {
    return parseCommissionEvent(attributes, metadata);
  } else if (eventType === 'rewards') {
    return parseRewardsEvent(attributes, metadata);
  } else if (eventType === 'burn') {
    return parseBurnEvent(attributes, metadata);
  } else if (eventType === 'coinbase') {
    return parseCoinbaseEvent(attributes, metadata);
  } else if (eventType === 'tx') {
    return parseTxEvent(attributes, metadata);
  }
  
  // Unknown event type - return generic structure
  return parsedEvent;
}

// Helper function to extract nested object from attributes
function extractNestedObject(attributes, key) {
  const value = attributes[key];
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }
  return value || null;
}

// Helper function to extract numeric value
function extractNumeric(attributes, key, defaultValue = 0) {
  const value = attributes[key];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

// Helper function to extract string value
function extractString(attributes, key, defaultValue = '') {
  const value = attributes[key];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return String(value);
}

// Tokenomics event parsers
function parseClaimSettledEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  const rewardDistribution = extractNestedObject(attributes, 'reward_distribution') || {};
  
  // Extract session_id - check multiple possible locations
  // 1. Direct attribute (most common)
  // 2. From nested claim object
  // 3. From claim.session_header
  let sessionId = extractString(attributes, 'session_id');
  if (!sessionId && claim) {
    sessionId = claim.session_id || claim.session_header?.session_id;
  }
  
  // Log if session_id was found for debugging
  if (sessionId) {
    console.log(`[EventParser] EventClaimSettled: Found session_id=${sessionId.substring(0, 20)}...`);
  } else {
    console.log(`[EventParser] EventClaimSettled: No session_id found in attributes or claim object`);
  }
  
  return {
    event_type: 'EventClaimSettled',
    session_id: sessionId || null, // Explicitly set to null if not found
    proof_requirement_int: extractNumeric(attributes, 'proof_requirement_int'),
    num_relays: extractNumeric(attributes, 'num_relays'),
    num_claimed_compute_units: extractNumeric(attributes, 'num_claimed_compute_units'),
    num_estimated_compute_units: extractNumeric(attributes, 'num_estimated_compute_units'),
    claimed_upokt: extractString(attributes, 'claimed_upokt'),
    service_id: extractString(attributes, 'service_id') || claim.service_id || claim.session_header?.service_id,
    application_address: extractString(attributes, 'application_address') || claim.application_address || claim.session_header?.application_address,
    session_end_block_height: extractNumeric(attributes, 'session_end_block_height') || claim.session_end_block_height || claim.session_header?.session_end_block_height,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: extractString(attributes, 'supplier_operator_address') || claim.supplier_operator_address,
    reward_distribution: rewardDistribution,
    metadata
  };
}

function parseClaimExpiredEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  
  return {
    event_type: 'EventClaimExpired',
    expiration_reason: extractNumeric(attributes, 'expiration_reason'),
    num_relays: extractNumeric(attributes, 'num_relays'),
    num_claimed_compute_units: extractNumeric(attributes, 'num_claimed_compute_units'),
    num_estimated_compute_units: extractNumeric(attributes, 'num_estimated_compute_units'),
    claimed_upokt: extractString(attributes, 'claimed_upokt'),
    service_id: extractString(attributes, 'service_id') || claim.service_id || claim.session_header?.service_id,
    application_address: extractString(attributes, 'application_address') || claim.application_address || claim.session_header?.application_address,
    session_end_block_height: extractNumeric(attributes, 'session_end_block_height') || claim.session_end_block_height || claim.session_header?.session_end_block_height,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: extractString(attributes, 'supplier_operator_address') || claim.supplier_operator_address,
    metadata
  };
}

function parseSupplierSlashedEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  
  return {
    event_type: 'EventSupplierSlashed',
    proof_missing_penalty: extractString(attributes, 'proof_missing_penalty'),
    service_id: extractString(attributes, 'service_id') || claim.service_id || claim.session_header?.service_id,
    application_address: extractString(attributes, 'application_address') || claim.application_address || claim.session_header?.application_address,
    session_end_block_height: extractNumeric(attributes, 'session_end_block_height') || claim.session_end_block_height || claim.session_header?.session_end_block_height,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: extractString(attributes, 'supplier_operator_address') || claim.supplier_operator_address,
    metadata
  };
}

function parseApplicationOverservicedEvent(attributes, metadata) {
  return {
    event_type: 'EventApplicationOverserviced',
    application_addr: extractString(attributes, 'application_addr'),
    supplier_operator_addr: extractString(attributes, 'supplier_operator_addr'),
    expected_burn: extractString(attributes, 'expected_burn'),
    effective_burn: extractString(attributes, 'effective_burn'),
    metadata
  };
}

function parseClaimDiscardedEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  
  return {
    event_type: 'EventClaimDiscarded',
    error: extractString(attributes, 'error'),
    service_id: extractString(attributes, 'service_id') || claim.service_id || claim.session_header?.service_id,
    application_address: extractString(attributes, 'application_address') || claim.application_address || claim.session_header?.application_address,
    session_end_block_height: extractNumeric(attributes, 'session_end_block_height') || claim.session_end_block_height || claim.session_header?.session_end_block_height,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: extractString(attributes, 'supplier_operator_address') || claim.supplier_operator_address,
    metadata
  };
}

function parseApplicationReimbursementRequestEvent(attributes, metadata) {
  // Amount might be a JSON string or an object, try to parse it
  let amount = attributes['amount'];
  if (typeof amount === 'string') {
    try {
      amount = JSON.parse(amount);
    } catch (e) {
      // If parsing fails, keep as string
    }
  }
  
  return {
    event_type: 'EventApplicationReimbursementRequest',
    application_addr: extractString(attributes, 'application_addr'),
    supplier_operator_addr: extractString(attributes, 'supplier_operator_addr'),
    supplier_owner_addr: extractString(attributes, 'supplier_owner_addr'),
    service_id: extractString(attributes, 'service_id'),
    session_id: extractString(attributes, 'session_id'),
    amount: amount, // Keep as object if parsed, or string if not
    metadata
  };
}

// Application event parsers
function parseApplicationStakedEvent(attributes, metadata) {
  const application = extractNestedObject(attributes, 'application') || {};
  
  return {
    event_type: 'EventApplicationStaked',
    application,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    metadata
  };
}

function parseRedelegationEvent(attributes, metadata) {
  const application = extractNestedObject(attributes, 'application') || {};
  
  return {
    event_type: 'EventRedelegation',
    application,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    metadata
  };
}

function parseTransferBeginEvent(attributes, metadata) {
  const sourceApplication = extractNestedObject(attributes, 'source_application') || {};
  
  return {
    event_type: 'EventTransferBegin',
    source_address: extractString(attributes, 'source_address'),
    destination_address: extractString(attributes, 'destination_address'),
    source_application: sourceApplication,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    transfer_end_height: extractNumeric(attributes, 'transfer_end_height'),
    metadata
  };
}

function parseTransferEndEvent(attributes, metadata) {
  const destinationApplication = extractNestedObject(attributes, 'destination_application') || {};
  
  return {
    event_type: 'EventTransferEnd',
    source_address: extractString(attributes, 'source_address'),
    destination_address: extractString(attributes, 'destination_address'),
    destination_application: destinationApplication,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    transfer_end_height: extractNumeric(attributes, 'transfer_end_height'),
    metadata
  };
}

function parseTransferErrorEvent(attributes, metadata) {
  const sourceApplication = extractNestedObject(attributes, 'source_application') || {};
  
  return {
    event_type: 'EventTransferError',
    source_address: extractString(attributes, 'source_address'),
    destination_address: extractString(attributes, 'destination_address'),
    source_application: sourceApplication,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    error: extractString(attributes, 'error'),
    metadata
  };
}

function parseApplicationUnbondingBeginEvent(attributes, metadata) {
  const application = extractNestedObject(attributes, 'application') || {};
  
  return {
    event_type: 'EventApplicationUnbondingBegin',
    application,
    reason: extractNumeric(attributes, 'reason'),
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    unbonding_end_height: extractNumeric(attributes, 'unbonding_end_height'),
    metadata
  };
}

function parseApplicationUnbondingEndEvent(attributes, metadata) {
  const application = extractNestedObject(attributes, 'application') || {};
  
  return {
    event_type: 'EventApplicationUnbondingEnd',
    application,
    reason: extractNumeric(attributes, 'reason'),
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    unbonding_end_height: extractNumeric(attributes, 'unbonding_end_height'),
    metadata
  };
}

function parseApplicationUnbondingCanceledEvent(attributes, metadata) {
  const application = extractNestedObject(attributes, 'application') || {};
  
  return {
    event_type: 'EventApplicationUnbondingCanceled',
    application,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    metadata
  };
}

// Supplier event parsers
function parseSupplierStakedEvent(attributes, metadata) {
  return {
    event_type: 'EventSupplierStaked',
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    operator_address: extractString(attributes, 'operator_address'),
    metadata
  };
}

function parseSupplierUnbondingBeginEvent(attributes, metadata) {
  const supplier = extractNestedObject(attributes, 'supplier') || {};
  
  return {
    event_type: 'EventSupplierUnbondingBegin',
    supplier,
    reason: extractNumeric(attributes, 'reason'),
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    unbonding_end_height: extractNumeric(attributes, 'unbonding_end_height'),
    metadata
  };
}

function parseSupplierUnbondingEndEvent(attributes, metadata) {
  const supplier = extractNestedObject(attributes, 'supplier') || {};
  
  return {
    event_type: 'EventSupplierUnbondingEnd',
    supplier,
    reason: extractNumeric(attributes, 'reason'),
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    unbonding_end_height: extractNumeric(attributes, 'unbonding_end_height'),
    metadata
  };
}

function parseSupplierUnbondingCanceledEvent(attributes, metadata) {
  const supplier = extractNestedObject(attributes, 'supplier') || {};
  
  return {
    event_type: 'EventSupplierUnbondingCanceled',
    supplier,
    height: extractNumeric(attributes, 'height'),
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    metadata
  };
}

function parseSupplierServiceConfigActivatedEvent(attributes, metadata) {
  return {
    event_type: 'EventSupplierServiceConfigActivated',
    activation_height: extractNumeric(attributes, 'activation_height'),
    operator_address: extractString(attributes, 'operator_address'),
    service_id: extractString(attributes, 'service_id'),
    metadata
  };
}

// Gateway event parsers
function parseGatewayStakedEvent(attributes, metadata) {
  const gateway = extractNestedObject(attributes, 'gateway') || {};
  
  return {
    event_type: 'EventGatewayStaked',
    gateway,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    metadata
  };
}

function parseGatewayUnbondingBeginEvent(attributes, metadata) {
  const gateway = extractNestedObject(attributes, 'gateway') || {};
  
  return {
    event_type: 'EventGatewayUnbondingBegin',
    gateway,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    unbonding_end_height: extractNumeric(attributes, 'unbonding_end_height'),
    metadata
  };
}

function parseGatewayUnbondingEndEvent(attributes, metadata) {
  const gateway = extractNestedObject(attributes, 'gateway') || {};
  
  return {
    event_type: 'EventGatewayUnbondingEnd',
    gateway,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    unbonding_end_height: extractNumeric(attributes, 'unbonding_end_height'),
    metadata
  };
}

function parseGatewayUnbondingCanceledEvent(attributes, metadata) {
  const gateway = extractNestedObject(attributes, 'gateway') || {};
  
  return {
    event_type: 'EventGatewayUnbondingCanceled',
    gateway,
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    metadata
  };
}

// Proof event parsers
function parseClaimCreatedEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  
  return {
    event_type: 'EventClaimCreated',
    num_relays: extractNumeric(attributes, 'num_relays'),
    num_claimed_compute_units: extractNumeric(attributes, 'num_claimed_compute_units'),
    num_estimated_compute_units: extractNumeric(attributes, 'num_estimated_compute_units'),
    claimed_upokt: extractString(attributes, 'claimed_upokt'),
    service_id: extractString(attributes, 'service_id') || claim.service_id || claim.session_header?.service_id,
    application_address: extractString(attributes, 'application_address') || claim.application_address || claim.session_header?.application_address,
    session_end_block_height: extractNumeric(attributes, 'session_end_block_height') || claim.session_end_block_height || claim.session_header?.session_end_block_height,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: extractString(attributes, 'supplier_operator_address') || claim.supplier_operator_address,
    metadata
  };
}

function parseClaimUpdatedEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  
  return {
    event_type: 'EventClaimUpdated',
    num_relays: extractNumeric(attributes, 'num_relays'),
    num_claimed_compute_units: extractNumeric(attributes, 'num_claimed_compute_units'),
    num_estimated_compute_units: extractNumeric(attributes, 'num_estimated_compute_units'),
    claimed_upokt: extractString(attributes, 'claimed_upokt'),
    service_id: extractString(attributes, 'service_id') || claim.service_id || claim.session_header?.service_id,
    application_address: extractString(attributes, 'application_address') || claim.application_address || claim.session_header?.application_address,
    session_end_block_height: extractNumeric(attributes, 'session_end_block_height') || claim.session_end_block_height || claim.session_header?.session_end_block_height,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: extractString(attributes, 'supplier_operator_address') || claim.supplier_operator_address,
    metadata
  };
}

function parseProofSubmittedEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  
  return {
    event_type: 'EventProofSubmitted',
    num_relays: extractNumeric(attributes, 'num_relays'),
    num_claimed_compute_units: extractNumeric(attributes, 'num_claimed_compute_units'),
    num_estimated_compute_units: extractNumeric(attributes, 'num_estimated_compute_units'),
    claimed_upokt: extractString(attributes, 'claimed_upokt'),
    service_id: extractString(attributes, 'service_id') || claim.service_id || claim.session_header?.service_id,
    application_address: extractString(attributes, 'application_address') || claim.application_address || claim.session_header?.application_address,
    session_end_block_height: extractNumeric(attributes, 'session_end_block_height') || claim.session_end_block_height || claim.session_header?.session_end_block_height,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: extractString(attributes, 'supplier_operator_address') || claim.supplier_operator_address,
    metadata
  };
}

function parseProofUpdatedEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  
  return {
    event_type: 'EventProofUpdated',
    num_relays: extractNumeric(attributes, 'num_relays'),
    num_claimed_compute_units: extractNumeric(attributes, 'num_claimed_compute_units'),
    num_estimated_compute_units: extractNumeric(attributes, 'num_estimated_compute_units'),
    claimed_upokt: extractString(attributes, 'claimed_upokt'),
    service_id: extractString(attributes, 'service_id') || claim.service_id || claim.session_header?.service_id,
    application_address: extractString(attributes, 'application_address') || claim.application_address || claim.session_header?.application_address,
    session_end_block_height: extractNumeric(attributes, 'session_end_block_height') || claim.session_end_block_height || claim.session_header?.session_end_block_height,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: extractString(attributes, 'supplier_operator_address') || claim.supplier_operator_address,
    metadata
  };
}

function parseProofValidityCheckedEvent(attributes, metadata) {
  const claim = extractNestedObject(attributes, 'claim') || {};
  
  // Try multiple attribute name variations
  const serviceId = extractString(attributes, 'service_id') || 
                    extractString(attributes, 'serviceId') ||
                    claim.service_id || 
                    claim.session_header?.service_id;
  
  const applicationAddress = extractString(attributes, 'application_address') || 
                            extractString(attributes, 'applicationAddress') ||
                            claim.application_address || 
                            claim.session_header?.application_address;
  
  const sessionEndBlockHeight = extractNumeric(attributes, 'session_end_block_height') || 
                                extractNumeric(attributes, 'sessionEndBlockHeight') ||
                                claim.session_end_block_height || 
                                claim.session_header?.session_end_block_height;
  
  const supplierOperatorAddress = extractString(attributes, 'supplier_operator_address') || 
                                  extractString(attributes, 'supplierOperatorAddress') ||
                                  claim.supplier_operator_address || 
                                  claim.session_header?.supplier_operator_address;
  
  // Log if critical fields are missing for debugging
  if (!supplierOperatorAddress || !applicationAddress || !serviceId || !sessionEndBlockHeight) {
    console.warn('[EventParser] EventProofValidityChecked: Missing fields', {
      has_supplier_operator_address: !!supplierOperatorAddress,
      has_application_address: !!applicationAddress,
      has_service_id: !!serviceId,
      has_session_end_block_height: !!sessionEndBlockHeight,
      block_height: metadata?.block_height,
      attribute_keys: Object.keys(attributes || {}),
      has_claim_object: !!claim && Object.keys(claim).length > 0
    });
  }
  
  return {
    event_type: 'EventProofValidityChecked',
    block_height: extractNumeric(attributes, 'block_height') || metadata?.block_height,
    failure_reason: extractString(attributes, 'failure_reason') || null,
    service_id: serviceId,
    application_address: applicationAddress,
    session_end_block_height: sessionEndBlockHeight,
    claim_proof_status_int: extractNumeric(attributes, 'claim_proof_status_int'),
    supplier_operator_address: supplierOperatorAddress,
    metadata
  };
}

// Service event parsers
function parseRelayMiningDifficultyUpdatedEvent(attributes, metadata) {
  return {
    event_type: 'EventRelayMiningDifficultyUpdated',
    service_id: extractString(attributes, 'service_id'),
    prev_target_hash_hex_encoded: extractString(attributes, 'prev_target_hash_hex_encoded'),
    new_target_hash_hex_encoded: extractString(attributes, 'new_target_hash_hex_encoded'),
    prev_num_relays_ema: extractNumeric(attributes, 'prev_num_relays_ema'),
    new_num_relays_ema: extractNumeric(attributes, 'new_num_relays_ema'),
    metadata
  };
}

// Migration event parsers
function parseImportMorseClaimableAccountsEvent(attributes, metadata) {
  return {
    event_type: 'EventImportMorseClaimableAccounts',
    created_at_height: extractNumeric(attributes, 'created_at_height'),
    morse_account_state_hash: extractString(attributes, 'morse_account_state_hash'),
    num_accounts: extractNumeric(attributes, 'num_accounts'),
    metadata
  };
}

function parseMorseAccountClaimedEvent(attributes, metadata) {
  return {
    event_type: 'EventMorseAccountClaimed',
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    shannon_dest_address: extractString(attributes, 'shannon_dest_address'),
    morse_src_address: extractString(attributes, 'morse_src_address'),
    claimed_balance: extractString(attributes, 'claimed_balance'),
    metadata
  };
}

function parseMorseApplicationClaimedEvent(attributes, metadata) {
  const application = extractNestedObject(attributes, 'application') || {};
  
  return {
    event_type: 'EventMorseApplicationClaimed',
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    morse_src_address: extractString(attributes, 'morse_src_address'),
    application,
    claimed_balance: extractString(attributes, 'claimed_balance'),
    claimed_application_stake: extractString(attributes, 'claimed_application_stake'),
    metadata
  };
}

function parseMorseSupplierClaimedEvent(attributes, metadata) {
  const supplier = extractNestedObject(attributes, 'supplier') || {};
  
  return {
    event_type: 'EventMorseSupplierClaimed',
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    claimed_balance: extractString(attributes, 'claimed_balance'),
    morse_node_address: extractString(attributes, 'morse_node_address'),
    morse_output_address: extractString(attributes, 'morse_output_address'),
    claim_signer_type: extractNumeric(attributes, 'claim_signer_type'),
    claimed_supplier_stake: extractString(attributes, 'claimed_supplier_stake'),
    supplier,
    metadata
  };
}

function parseMorseAccountRecoveredEvent(attributes, metadata) {
  return {
    event_type: 'EventMorseAccountRecovered',
    session_end_height: extractNumeric(attributes, 'session_end_height'),
    recovered_balance: extractString(attributes, 'recovered_balance'),
    shannon_dest_address: extractString(attributes, 'shannon_dest_address'),
    morse_src_address: extractString(attributes, 'morse_src_address'),
    metadata
  };
}

// Account/Balance event parsers
function parseCoinSpentEvent(attributes, metadata) {
  return {
    event_type: 'coin_spent',
    spender: extractString(attributes, 'spender'),
    amount: extractString(attributes, 'amount'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseCoinReceivedEvent(attributes, metadata) {
  return {
    event_type: 'coin_received',
    receiver: extractString(attributes, 'receiver'),
    amount: extractString(attributes, 'amount'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseTransferEvent(attributes, metadata) {
  return {
    event_type: 'transfer',
    sender: extractString(attributes, 'sender'),
    recipient: extractString(attributes, 'recipient'),
    amount: extractString(attributes, 'amount'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseMessageEvent(attributes, metadata) {
  return {
    event_type: 'message',
    sender: extractString(attributes, 'sender'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseMintEvent(attributes, metadata) {
  return {
    event_type: 'mint',
    amount: extractString(attributes, 'amount'),
    bonded_ratio: extractString(attributes, 'bonded_ratio'),
    inflation: extractString(attributes, 'inflation'),
    annual_provisions: extractString(attributes, 'annual_provisions'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseCommissionEvent(attributes, metadata) {
  return {
    event_type: 'commission',
    validator: extractString(attributes, 'validator'),
    amount: extractString(attributes, 'amount'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseRewardsEvent(attributes, metadata) {
  return {
    event_type: 'rewards',
    validator: extractString(attributes, 'validator'),
    amount: extractString(attributes, 'amount'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseBurnEvent(attributes, metadata) {
  return {
    event_type: 'burn',
    burner: extractString(attributes, 'burner'),
    amount: extractString(attributes, 'amount'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseCoinbaseEvent(attributes, metadata) {
  return {
    event_type: 'coinbase',
    minter: extractString(attributes, 'minter'),
    amount: extractString(attributes, 'amount'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

function parseTxEvent(attributes, metadata) {
  return {
    event_type: 'tx',
    height: extractString(attributes, 'height'),
    hash: extractString(attributes, 'hash'),
    fee: extractString(attributes, 'fee'),
    mode: extractString(attributes, 'mode'),
    metadata
  };
}

module.exports = {
  parseTypedEvent,
  parseEventAttributes
};

