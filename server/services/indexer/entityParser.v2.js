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
          chains: firstEv.services?.map(s => s?.service_id).filter(Boolean) || servicesFromMsg,
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
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.application.MsgDelegateToGateway') {
        const app = {
          address: msg.application_address || msg.app_address || '',
          gateway_address: msg.gateway_address || null,
          status: 'delegated',
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.application.MsgUndelegateFromGateway') {
        const app = {
          address: msg.application_address || msg.app_address || '',
          gateway_address: msg.gateway_address || null,
          status: 'undelegated',
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.application.MsgTransferApplication') {
        const app = {
          address: msg.destination_address || '',
          source_address: msg.source_address || undefined,
          status: 'transfer_pending',
          last_seen: timestamp,
        };
        if (app.address) apps.push(app);
      }
      if (msgType === 'pocket.migration.MsgClaimMorseApplication') {
        const app = {
          address: firstEv.address || msg.pocket_address || msg.shannon_address || msg.application_address || msg.app_address || '',
          staked_amount: (firstEv.stake && firstEv.stake.amount) || undefined,
          chains: firstEv.services?.map(s => s?.service_id).filter(Boolean) || [],
          status: 'migrated',
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
          services: evSupp.services?.map(s => s?.service_id).filter(Boolean) || (Array.isArray(msg.services) ? msg.services.map(s => s?.service_id).filter(Boolean) : []),
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

    // 1) Services defined in pocket.service.* messages (network-wide services)
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
    }

    // 2) Services advertised by suppliers in stake/edit/unstake (per-operator service configs)
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if ((msgType === 'pocket.supplier.MsgStakeSupplier' || msgType === 'pocket.supplier.MsgEditSupplier') && Array.isArray(msg.services)) {
        for (const svc of msg.services) {
          const serviceId = svc?.service_id;
          if (!serviceId) continue;
          out.push({
            supplier_operator_address: msg.operator_address || msg.signer || '',
            service_id: serviceId,
            status: msgType.endsWith('EditSupplier') ? 'edited' : 'active',
            last_seen: timestamp,
            endpoint_url: Array.isArray(svc.endpoints) && svc.endpoints[0]?.url ? svc.endpoints[0].url : null,
          });
        }
      }
      if (msgType === 'pocket.supplier.MsgUnstakeSupplier' && Array.isArray(msg.services)) {
        for (const svc of msg.services) {
          const serviceId = svc?.service_id;
          if (!serviceId) continue;
          out.push({
            supplier_operator_address: msg.operator_address || '',
            service_id: serviceId,
            status: 'inactive',
            last_seen: timestamp,
            endpoint_url: null,
          });
        }
      }
    }

    // 3) Services advertised by gateways in stake/edit/unstake
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if ((msgType === 'pocket.gateway.MsgStakeGateway' || msgType === 'pocket.gateway.MsgEditGateway') && Array.isArray(msg.services)) {
        for (const svc of msg.services) {
          const serviceId = svc?.service_id;
          if (!serviceId) continue;
          out.push({
            gateway_address: msg.address || msg.operator_address || msg.gateway_address || '',
            service_id: serviceId,
            status: msgType.endsWith('EditGateway') ? 'edited' : 'active',
            last_seen: timestamp,
            endpoint_url: Array.isArray(svc.endpoints) && svc.endpoints[0]?.url ? svc.endpoints[0].url : null,
          });
        }
      }
      if (msgType === 'pocket.gateway.MsgUnstakeGateway' && Array.isArray(msg.services)) {
        for (const svc of msg.services) {
          const serviceId = svc?.service_id;
          if (!serviceId) continue;
          out.push({
            gateway_address: msg.address || msg.operator_address || msg.gateway_address || '',
            service_id: serviceId,
            status: 'inactive',
            last_seen: timestamp,
            endpoint_url: null,
          });
        }
      }
    }

    return out;
  } catch (_) { return []; }
}

// Claims/Proofs
function parseClaims(txEnvelope, block, chain) {
  try {
    const out = [];
    const messages = getMessages(txEnvelope);
    const timestamp = getTimestamp(block);
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType === 'pocket.proof.MsgCreateClaim') {
        const sh = msg.session_header || {};
        out.push({
          supplier_operator_address: msg.supplier_operator_address || msg.signer || '',
          application_address: sh.application_address || '',
          service_id: sh.service_id || '',
          session_id: sh.session_id || '',
          session_start_block_height: sh.session_start_block_height || 0,
          session_end_block_height: sh.session_end_block_height || 0,
          status: 'claimed',
          last_seen: timestamp,
        });
      }
    }
    return out;
  } catch (_) { return []; }
}

// Staking events (high-level rollup, minimal)
function parseStakingEvents(txEnvelope, block, chain) {
  try {
    const out = [];
    const messages = getMessages(txEnvelope);
    const timestamp = getTimestamp(block);
    for (const msg of messages) {
      const msgType = normalizePocketMsgType(typeof msg?.['@type'] === 'string' ? msg['@type'] : '');
      if (msgType === 'pocket.application.MsgStakeApplication') out.push({ entity: 'application', action: 'stake', last_seen: timestamp });
      if (msgType === 'pocket.application.MsgUnstakeApplication') out.push({ entity: 'application', action: 'unstake', last_seen: timestamp });
      if (msgType === 'pocket.supplier.MsgStakeSupplier') out.push({ entity: 'supplier', action: 'stake', last_seen: timestamp });
      if (msgType === 'pocket.supplier.MsgUnstakeSupplier') out.push({ entity: 'supplier', action: 'unstake', last_seen: timestamp });
      if (msgType === 'pocket.gateway.MsgStakeGateway') out.push({ entity: 'gateway', action: 'stake', last_seen: timestamp });
      if (msgType === 'pocket.gateway.MsgUnstakeGateway') out.push({ entity: 'gateway', action: 'unstake', last_seen: timestamp });
    }
    return out;
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
};


