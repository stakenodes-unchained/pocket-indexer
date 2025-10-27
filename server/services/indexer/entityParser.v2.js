// Pocket Indexer Entity Parser (v2)
// Single-source, doc-aligned parsers for Applications, Suppliers, Gateways, Services, Claims

function normalizePocketMsgType(msgType) {
  try {
    if (!msgType || typeof msgType !== 'string') return '';
    const noPrefix = msgType.replace(/^\//, '');
    const parts = noPrefix.split('.');
    const filtered = parts.filter(p => !/^v\d+(alpha\d+|beta\d+)?$/i.test(p));
    return filtered.join('.');
  } catch (_) {
    return msgType;
  }
}

// Generic safe accessors
function getMessages(txEnvelope) {
  const tx = txEnvelope?.tx || txEnvelope;
  return tx?.body?.messages || tx?.messages || [];
}

function getTimestamp(block) {
  return block?.block?.header?.time || block?.timestamp || new Date().toISOString();
}

// Event extractors
function extractFromEvents(txEnvelope, eventTypePrefixes, attributeKeys) {
  const out = [];
  const events = txEnvelope?.tx_response?.events;
  if (!Array.isArray(events)) return out;
  for (const ev of events) {
    if (!ev?.type || !eventTypePrefixes.some(pref => ev.type.startsWith(pref))) continue;
    for (const attr of ev.attributes || []) {
      if (!attr?.key || !attr?.value) continue;
      if (!attributeKeys.includes(attr.key)) continue;
      try {
        const obj = JSON.parse(attr.value);
        out.push(obj);
      } catch (_) {}
    }
  }
  return out;
}

// Helper: extract a numeric session end height for unstakes from any pocket.* event
function extractUnstakeSessionEndHeight(txEnvelope) {
  try {
    const events = txEnvelope?.tx_response?.events;
    if (!Array.isArray(events)) return undefined;
    for (const ev of events) {
      if (!ev?.type || !ev.type.startsWith('pocket.')) continue;
      for (const attr of ev.attributes || []) {
        if (!attr?.key || !attr?.value) continue;
        if (attr.key === 'unstake_session_end_height' || attr.key.endsWith('.unstake_session_end_height')) {
          return attr.value;
        }
      }
    }
    return undefined;
  } catch (_) { return undefined; }
}

// Classifier
function classifyTransaction(txEnvelope) {
  try {
    const messages = getMessages(txEnvelope);
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType.startsWith('pocket.application.')) return 'application';
      if (msgType.startsWith('pocket.supplier.')) return 'supplier';
      if (msgType.startsWith('pocket.gateway.')) return 'gateway';
      if (msgType.startsWith('pocket.service.')) return 'service';
      if (msgType.startsWith('pocket.proof.')) return 'proof';
    }
    return 'unknown';
  } catch (_) { return 'unknown'; }
}

// Applications
function parseApplications(txEnvelope, block, chain) {
  try {
    const apps = [];
    const messages = getMessages(txEnvelope);
    const timestamp = getTimestamp(block);

    const evApps = extractFromEvents(
      txEnvelope,
      ['pocket.application.', 'pocket.migration.'],
      ['application', 'migrated_application']
    );
    const firstEv = evApps[0] || {};

    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType === 'pocket.application.MsgStakeApplication') {
        const servicesFromMsg = Array.isArray(msg.services) ? msg.services.map(s => s?.service_id).filter(Boolean) : [];
        const app = {
          address: firstEv.address || msg.address || msg.application_address || msg.app_address || '',
          staked_amount: (firstEv.stake && firstEv.stake.amount) || msg.stake?.amount || '0',
          stake_denom: (firstEv.stake && firstEv.stake.denom) || msg.stake?.denom || null,
          chains: firstEv.services?.map(s => s?.service_id).filter(Boolean) || servicesFromMsg,
          // Full service configs from message body when available
          service_configs: Array.isArray(msg.services) ? msg.services.map(s => ({
            service_id: s?.service_id || '',
            endpoints: Array.isArray(s?.endpoints) ? s.endpoints.filter(Boolean) : [],
            config_options: s?.config_options || {}
          })).filter(sc => sc.service_id) : [],
          chain,
          status: 'staked',
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.application.MsgUnstakeApplication') {
        const app = {
          address: firstEv.address || msg.address || msg.application_address || msg.app_address || '',
          status: 'unstake_requested',
          unstake_session_end_height: extractUnstakeSessionEndHeight(txEnvelope),
          chain,
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.application.MsgDelegateToGateway') {
        const app = {
          address: msg.application_address || msg.app_address || '',
          gateway_address: msg.gateway_address || null,
          status: 'delegated',
          chain,
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.application.MsgUndelegateFromGateway') {
        const app = {
          address: msg.application_address || msg.app_address || '',
          gateway_address: msg.gateway_address || null,
          status: 'undelegated',
          chain,
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.application.MsgTransferApplication') {
        const app = {
          address: msg.destination_address || '',
          source_address: msg.source_address || undefined,
          status: 'transfer_pending',
          chain,
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.migration.MsgClaimMorseApplication') {
        const app = {
          address: firstEv.address || msg.pocket_address || msg.shannon_address || msg.application_address || msg.app_address || '',
          staked_amount: (firstEv.stake && firstEv.stake.amount) || undefined,
          stake_denom: (firstEv.stake && firstEv.stake.denom) || undefined,
          chains: firstEv.services?.map(s => s?.service_id).filter(Boolean) || [],
          status: 'migrated',
          chain,
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
    }
    return apps;
  } catch (_) { return []; }
}

// Suppliers
function parseSuppliers(txEnvelope, block, chain) {
  try {
    const out = [];
    const messages = getMessages(txEnvelope);
    const timestamp = getTimestamp(block);
    const evSupp = extractFromEvents(txEnvelope, ['pocket.supplier.', 'pocket.migration.'], ['supplier', 'migrated_supplier'])[0] || {};

    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType === 'pocket.supplier.MsgStakeSupplier') {
        const sup = {
          operator_address: evSupp.operator_address || msg.operator_address || '',
          staked_amount: (evSupp.stake && evSupp.stake.amount) || msg.stake?.amount || '0',
      stake_denom: (evSupp.stake && evSupp.stake.denom) || msg.stake?.denom || null,
          services: evSupp.services?.map(s => s?.service_id).filter(Boolean) || (Array.isArray(msg.services) ? msg.services.map(s => s?.service_id).filter(Boolean) : []),
      service_configs: Array.isArray(msg.services) ? msg.services.map(s => ({
        service_id: s?.service_id || '',
        endpoints: Array.isArray(s?.endpoints) ? s.endpoints.filter(Boolean) : [],
        config_options: s?.config_options || {}
      })).filter(sc => sc.service_id) : [],
          chain,
          status: 'staked',
          last_seen: timestamp,
        };
        if (sup.operator_address) out.push(sup);
      }
      if (msgType === 'pocket.supplier.MsgUnstakeSupplier') {
        const sup = {
          operator_address: msg.operator_address || '',
          status: 'unstake_requested',
          unstake_session_end_height: extractUnstakeSessionEndHeight(txEnvelope),
          chain,
          last_seen: timestamp,
        };
        if (sup.operator_address) out.push(sup);
      }
    }
    return out;
  } catch (_) { return []; }
}

// Gateways
function parseGateways(txEnvelope, block, chain) {
  try {
    const out = [];
    const messages = getMessages(txEnvelope);
    const timestamp = getTimestamp(block);
    const evGw = extractFromEvents(txEnvelope, ['pocket.gateway.', 'pocket.migration.'], ['gateway', 'migrated_gateway'])[0] || {};
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType === 'pocket.gateway.MsgStakeGateway') {
        const gw = {
          address: evGw.address || msg.address || '',
          staked_amount: (evGw.stake && evGw.stake.amount) || msg.stake?.amount || '0',
      stake_denom: (evGw.stake && evGw.stake.denom) || msg.stake?.denom || null,
          chain,
          status: 'staked',
          last_seen: timestamp,
        };
        if (gw.address) out.push(gw);
      }
      if (msgType === 'pocket.gateway.MsgUnstakeGateway') {
        const gw = {
          address: msg.address || '',
          status: 'unstake_requested',
          unstake_session_end_height: extractUnstakeSessionEndHeight(txEnvelope),
          chain,
          last_seen: timestamp,
        };
        if (gw.address) out.push(gw);
      }
    }
    return out;
  } catch (_) { return []; }
}

// Services
function parseServices(txEnvelope, block, chain) {
  try {
    const out = [];
    const messages = getMessages(txEnvelope);
    const timestamp = getTimestamp(block);

    // Only track unique service definitions from MsgAddService (network-wide services)
    // Don't count supplier/gateway advertisements as separate services
    const evSvc = extractFromEvents(txEnvelope, ['pocket.service.'], ['service'])[0] || {};
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType === 'pocket.service.MsgAddService') {
        const id = evSvc.id || msg.service?.id || msg.service_id || '';
        if (!id) continue;
        out.push({
          id,
          owner_address: msg.owner_address || null,
          status: 'added',
          last_seen: timestamp,
        });
      }
      // Supplier service advertisements (per-operator service configs)
      if (msgType === 'pocket.supplier.MsgStakeSupplier' || msgType === 'pocket.supplier.MsgEditSupplier') {
        const servicesArr = Array.isArray(msg.services) ? msg.services : [];
        const operator = msg.operator_address || null;
        for (const s of servicesArr) {
          const serviceId = s?.service_id || null;
          if (!operator || !serviceId) continue;
          const firstEndpoint = Array.isArray(s.endpoints) ? s.endpoints.find(Boolean) : null;
          out.push({
            supplier_address: operator,
            chain: serviceId,
            service_url: typeof firstEndpoint === 'string' ? firstEndpoint : (firstEndpoint?.url || null),
            status: msgType.endsWith('EditSupplier') ? 'edited' : 'active',
            last_checked: timestamp,
          });
        }
      }
      // Gateway service advertisements
      if (msgType === 'pocket.gateway.MsgStakeGateway' || msgType === 'pocket.gateway.MsgEditGateway') {
        const servicesArr = Array.isArray(msg.services) ? msg.services : [];
        const gatewayAddr = msg.address || null;
        for (const s of servicesArr) {
          const serviceId = s?.service_id || null;
          if (!gatewayAddr || !serviceId) continue;
          const firstEndpoint = Array.isArray(s.endpoints) ? s.endpoints.find(Boolean) : null;
          out.push({
            supplier_address: gatewayAddr,
            chain: serviceId,
            service_url: typeof firstEndpoint === 'string' ? firstEndpoint : (firstEndpoint?.url || null),
            status: msgType.endsWith('EditGateway') ? 'edited' : 'active',
            last_checked: timestamp,
          });
        }
      }
    }

    // Note: We now include supplier/gateway service advertisements for persistence in services table,
    // while network-wide unique services (MsgAddService) are routed to network_services.

    return out;
  } catch (_) { return []; }
}

// Claims/Proofs
function parseClaims(txEnvelope, block, chain) {
  try {
    // Skip claims parsing for now due to performance issues
    // Claims are temporary and should be tracked differently
    return [];
    
    // Original logic (commented out for performance):
    // const out = [];
    // const messages = getMessages(txEnvelope);
    // const timestamp = getTimestamp(block);
    // for (const msg of messages) {
    //   const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
    //   if (msgType === 'pocket.proof.MsgCreateClaim') {
    //     const sh = msg.session_header || {};
    //     out.push({
    //       supplier_operator_address: msg.supplier_operator_address || msg.signer || '',
    //       application_address: sh.application_address || '',
    //       service_id: sh.service_id || '',
    //       session_id: sh.session_id || '',
    //       session_start_block_height: sh.session_start_block_height || 0,
    //       session_end_block_height: sh.session_end_block_height || 0,
    //       status: 'claimed',
    //       settled: false, // Claims start as unsettled
    //       last_seen: timestamp,
    //     });
    //   }
    // }
    // return out;
  } catch (_) { return []; }
}

// Proof Submissions - parse proof submission events from transaction events
function parseProofSubmissions(txEnvelope, block, chain) {
  try {
    const proofSubmissions = [];
    
    if (!txEnvelope) return proofSubmissions;
    
    // Get events from tx_response or from tx_data (which stores the full JSON stringified response)
    let events = txEnvelope.tx_response?.events || [];
    let transactionHash = txEnvelope.tx_response?.hash || txEnvelope.txhash || '';
    
    // If no events in tx_response, try to parse from tx_data
    // The tx_data field contains the full transaction response object with nested tx_response
    if (!Array.isArray(events) || events.length === 0) {
      try {
        if (txEnvelope.tx_data) {
          const txData = typeof txEnvelope.tx_data === 'string' ? JSON.parse(txEnvelope.tx_data) : txEnvelope.tx_data;
          // Events are nested in tx_response within the stored data
          events = txData?.tx_response?.events || txData?.events || [];
          if (!transactionHash && txData?.tx_response?.txhash) {
            transactionHash = txData.tx_response.txhash;
          }
        }
      } catch (parseError) {
        // If parsing fails, events remains empty array
      }
    }
    
    if (!Array.isArray(events) || events.length === 0) {
      return proofSubmissions;
    }
    
    const timestamp = getTimestamp(block);
    const blockHeight = parseInt(block?.block?.header?.height || block?.height || 0);
    // Look for EventProofSubmitted events
    for (const event of events) {
      if (event.type === 'pocket.proof.EventProofSubmitted') {
        try {
          // Extract attributes from the event
          const attributes = event.attributes || [];
          const submission = {
            transaction_hash: transactionHash,
            block_height: blockHeight,
            timestamp: timestamp,
            chain: chain || '',
            supplier_operator_address: '',
            application_address: '',
            service_id: '',
            session_id: '',
            session_end_block_height: 0,
            claim_proof_status_int: 0,
            claimed_upokt: '',
            num_claimed_compute_units: 0,
            num_estimated_compute_units: 0,
            num_relays: 0,
            msg_index: 0
          };
          
          // Parse attributes
          for (const attr of attributes) {
            if (!attr.key || !attr.value) continue;
            
            switch (attr.key) {
              case 'supplier_operator_address':
                submission.supplier_operator_address = attr.value.replace(/"/g, '');
                break;
              case 'application_address':
                submission.application_address = attr.value.replace(/"/g, '');
                break;
              case 'service_id':
                submission.service_id = attr.value.replace(/"/g, '');
                break;
              case 'session_end_block_height':
                submission.session_end_block_height = parseInt(attr.value.replace(/"/g, '')) || 0;
                break;
              case 'claim_proof_status_int':
                submission.claim_proof_status_int = parseInt(attr.value) || 0;
                break;
              case 'claimed_upokt':
                // Handle both formats: "252upokt" or {"denom":"upokt","amount":"252"}
                let claimedValue = attr.value.replace(/"/g, '');
                try {
                  // Try to parse as JSON first
                  const parsed = JSON.parse(attr.value);
                  if (parsed.amount && parsed.denom) {
                    claimedValue = parsed.amount + parsed.denom;
                  }
                } catch (e) {
                  // Not JSON, use as is
                }
                submission.claimed_upokt = claimedValue;
                break;
              case 'num_claimed_compute_units':
                submission.num_claimed_compute_units = parseInt(attr.value.replace(/"/g, '')) || 0;
                break;
              case 'num_estimated_compute_units':
                submission.num_estimated_compute_units = parseInt(attr.value.replace(/"/g, '')) || 0;
                break;
              case 'num_relays':
                submission.num_relays = parseInt(attr.value.replace(/"/g, '')) || 0;
                break;
              case 'msg_index':
                submission.msg_index = parseInt(attr.value) || 0;
                break;
            }
          }
          
          // Get session_id from the transaction messages if not found in events
          const tx = txEnvelope.tx || txEnvelope;
          if (!submission.session_id && tx?.body?.messages) {
            const messages = tx.body.messages;
            if (messages[submission.msg_index]?.session_header?.session_id) {
              submission.session_id = messages[submission.msg_index].session_header.session_id;
            }
          }

          proofSubmissions.push(submission);
        } catch (eventError) {
          // Skip invalid events
          // continue;
          console.log(eventError)
        }
      }
    }
    return proofSubmissions;
  } catch (error) { 
    // log error
    console.log("error", error)
    return []; 
  }
}

// Staking events (high-level rollup, minimal)
function parseStakingEvents(txEnvelope, block, chain) {
  try {
    const out = [];
    const messages = getMessages(txEnvelope);
    const timestamp = getTimestamp(block);
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType === 'pocket.application.MsgStakeApplication') {
        out.push({
          address: msg.application_address || msg.app_address || msg.address || '',
          chain,
          type: 'application',
          amount: String(msg.stake?.amount || '0'),
          event: 'stake',
          timestamp,
        });
      }
      if (msgType === 'pocket.application.MsgUnstakeApplication') {
        out.push({
          address: msg.application_address || msg.app_address || msg.address || '',
          chain,
          type: 'application',
          amount: '0',
          event: 'unstake',
          timestamp,
        });
      }
      if (msgType === 'pocket.supplier.MsgStakeSupplier') {
        out.push({
          address: msg.operator_address || msg.signer || '',
          chain,
          type: 'supplier',
          amount: String(msg.stake?.amount || '0'),
          event: 'stake',
          timestamp,
        });
      }
      if (msgType === 'pocket.supplier.MsgUnstakeSupplier') {
        out.push({
          address: msg.operator_address || '',
          chain,
          type: 'supplier',
          amount: '0',
          event: 'unstake',
          timestamp,
        });
      }
      if (msgType === 'pocket.gateway.MsgStakeGateway') {
        out.push({
          address: msg.address || msg.gateway_address || '',
          chain,
          type: 'gateway',
          amount: String(msg.stake?.amount || '0'),
          event: 'stake',
          timestamp,
        });
      }
      if (msgType === 'pocket.gateway.MsgUnstakeGateway') {
        out.push({
          address: msg.address || msg.gateway_address || '',
          chain,
          type: 'gateway',
          amount: '0',
          event: 'unstake',
          timestamp,
        });
      }
    }
    // Filter out any malformed events without address
    return out.filter(e => e.address);
  } catch (_) { return []; }
}

// Placeholders to satisfy interface
function parseRelays() { return []; }
function parseNodes() { return []; }

// Relationships: application delegations and service configs
function parseRelationships(txEnvelope, block, chain) {
  try {
    const rels = { applicationDelegations: [], applicationServiceConfigs: [] };
    const messages = getMessages(txEnvelope);
    const timestamp = getTimestamp(block);
    const evApps = extractFromEvents(
      txEnvelope,
      ['pocket.application.', 'pocket.migration.'],
      ['application', 'migrated_application']
    );
    const firstEv = evApps[0] || {};
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType === 'pocket.application.MsgDelegateToGateway') {
        const application_address = msg.application_address || msg.app_address || '';
        const gateway_address = msg.gateway_address || null;
        if (application_address && gateway_address) {
          rels.applicationDelegations.push({ application_address, gateway_address, action: 'add', last_seen: timestamp });
        }
      }
      if (msgType === 'pocket.application.MsgUndelegateFromGateway') {
        const application_address = msg.application_address || msg.app_address || '';
        const gateway_address = msg.gateway_address || null;
        if (application_address && gateway_address) {
          rels.applicationDelegations.push({ application_address, gateway_address, action: 'remove', last_seen: timestamp });
        }
      }
      if (msgType === 'pocket.application.MsgStakeApplication') {
        const address = firstEv.address || msg.address || '';
        const fromEv = firstEv.services?.map(s => s?.service_id).filter(Boolean) || [];
        const fromMsg = Array.isArray(msg.services) ? msg.services.map(s => s?.service_id).filter(Boolean) : [];
        const serviceIds = (fromEv.length ? fromEv : fromMsg);
        for (const sid of serviceIds) {
          rels.applicationServiceConfigs.push({ application_address: address, service_id: sid, action: 'add', last_seen: timestamp });
        }
      }
      if (msgType === 'pocket.migration.MsgClaimMorseApplication') {
        const address = firstEv.address || msg.pocket_address || msg.shannon_address || '';
        const serviceIds = firstEv.services?.map(s => s?.service_id).filter(Boolean) || [];
        for (const sid of serviceIds) {
          rels.applicationServiceConfigs.push({ application_address: address, service_id: sid, action: 'add', last_seen: timestamp });
        }
      }
    }
    return rels;
  } catch (_) { return { applicationDelegations: [], applicationServiceConfigs: [] }; }
}

module.exports = {
  normalizePocketMsgType,
  classifyTransaction,
  parseApplications,
  parseSuppliers,
  parseGateways,
  parseServices,
  parseClaims,
  parseRelays,
  parseNodes,
  parseStakingEvents,
  parseRelationships,
  parseProofSubmissions,
};


