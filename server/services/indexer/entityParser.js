// Placeholder: import types as needed
// const { Tx, TxResponse } = require('../../../types/transaction');

// See: https://buf.build/bryanchriswhite/pocket/docs/3d404cb70123401a9d523da16abe7628
// Pocket Supplier: https://buf.build/bryanchriswhite/pocket/docs/main:pocket.supplier#pocket.supplier.MsgStakeSupplier

/**
 * Classify transaction by message type
 * @param {any} tx
 * @returns {string}
 */
function classifyTransaction(tx) {
  try {
    if (!tx) {
      console.warn("No transaction provided to classifyTransaction");
      return 'unknown';
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction", tx);
      return 'unknown';
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      console.warn("No valid messages array in transaction");
      return 'unknown';
    }
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        // Pocket-specific messages
        if (msgType.startsWith('pocket.supplier.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (supplier)` : 'supplier';
        }
        if (msgType.startsWith('pocket.app.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (application)` : 'application';
        }
        if (msgType.startsWith('pocket.application.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (application)` : 'application';
        }
        if (msgType.startsWith('pocket.pos.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (node)` : 'node';
        }
        if (msgType.startsWith('pocket.relay.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (relay)` : 'relay';
        }
        if (msgType.startsWith('pocket.bank.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (bank)` : 'bank';
        }
        if (msgType.startsWith('pocket.proof.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (proof)` : 'proof';
        }
        if (msgType.startsWith('pocket.service.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (service)` : 'service';
        }
        
        if (msgType.startsWith('pocket.gateway.')) {
          const parts = msgType.split('.');
          return parts.length > 0 ? `${parts[parts.length - 1]} (gateway)` : 'gateway';
        }
        
        // Cosmos SDK messages
        if (msgType.startsWith('cosmos.bank.')) {
          const parts = msgType.split('.');
          // e.g. cosmos.bank.v1beta1.MsgSend
          return parts.length > 3 ? `${parts[3]} (bank)` : 'bank';
        }
        if (msgType.startsWith('cosmos.staking.')) {
          const parts = msgType.split('.');
          // e.g. cosmos.staking.v1beta1.MsgDelegate
          return parts.length > 3 ? `${parts[3]} (node)` : 'node';
        }
        if (msgType.startsWith('cosmos.distr.')) {
          const parts = msgType.split('.');
          return parts.length > 3 ? `${parts[3]} (rewards)` : 'rewards';
        }
        if (msgType.startsWith('cosmos.gov.')) {
          const parts = msgType.split('.');
          return parts.length > 3 ? `${parts[3]} (governance)` : 'governance';
        }
        if (msgType.startsWith('cosmos.slashing.')) {
          const parts = msgType.split('.');
          return parts.length > 3 ? `${parts[3]} (slashing)` : 'slashing';
        }
        if (msgType.startsWith('cosmos.authz.')) {
          const parts = msgType.split('.');
          return parts.length > 3 ? `${parts[3]} (authz)` : 'authz';
        }
      } catch (msgError) {
        console.warn("Error processing individual message:", msgError.message);
        continue;
      }
    }
    
    // If we get here, we found messages but none matched our patterns
    return 'unknown';
  } catch (error) {
    console.error("Error in classifyTransaction:", error.message);
    return 'unknown';
  }
}

/**
 * Parse suppliers from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseSuppliers(tx, block, chain) {
  try {
    const suppliers = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseSuppliers");
      return suppliers;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseSuppliers", Object.keys(tx));
      return suppliers;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return suppliers;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        // Pocket Supplier Messages
        if (msgType === 'pocket.supplier.MsgStakeSupplier') {
          const supplier = {
            address: msg.operator_address || msg.signer || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            staked_amount: msg.stake?.amount || '0',
            stake_change: msg.stake?.amount || '0', // Track the incremental change
            status: 'staked',
            service_url: msg.services?.[0]?.endpoints?.[0]?.url || null,
            last_seen: timestamp,
            geo: null,
          };
          
          // Validate required fields
          if (supplier.address) {
            suppliers.push(supplier);
          }
        }
        
        if (msgType === 'pocket.supplier.MsgUnstakeSupplier') {
          // Extract current stake amount from transaction events
          let currentStakeAmount = '0';
          if (tx.tx_response?.events) {
            for (const event of tx.tx_response.events) {
              if (event.type === 'pocket.supplier.EventSupplierUnbondingBegin') {
                for (const attr of event.attributes) {
                  if (attr.key === 'supplier' && attr.value) {
                    try {
                      const supplierData = JSON.parse(attr.value);
                      currentStakeAmount = supplierData.stake?.amount || '0';
                      break;
                    } catch (e) {
                      console.warn('Failed to parse supplier data from event:', e.message);
                    }
                  }
                }
                break;
              }
            }
          }
          
          const supplier = {
            address: msg.operator_address || '',
            public_key: msg.public_key || null,
            staked_amount: '0',
            stake_change: `-${currentStakeAmount}`, // Negative change for unstaking
            status: 'unstaked',
            service_url: null,
            last_seen: timestamp,
            geo: null,
          };
          
          // Validate required fields
          if (supplier.address) {
            suppliers.push(supplier);
          }
        }
        
        if (msgType === 'pocket.supplier.MsgEditSupplier') {
          const supplier = {
            address: msg.operator_address || '',
            public_key: msg.public_key || null,
            staked_amount: msg.stake?.amount || '0',
            status: 'edited',
            service_url: msg.services?.[0]?.endpoints?.[0]?.url || null,
            last_seen: timestamp,
            geo: null,
          };
          
          // Validate required fields
          if (supplier.address) {
            suppliers.push(supplier);
          }
        }
        
        // Cosmos Staking Messages (for validators/suppliers)
        if (msgType === 'cosmos.staking.v1beta1.MsgCreateValidator' || msgType === 'cosmos.staking.MsgCreateValidator') {
          const supplier = {
            address: msg.validator_address || '',
            public_key: msg.pubkey?.key || null,
            staked_amount: msg.value?.amount || '0',
            status: 'staked',
            service_url: null,
            last_seen: timestamp,
            geo: null,
          };
          
          // Validate required fields
          if (supplier.address) {
            suppliers.push(supplier);
          }
        }
        
        if (msgType === 'cosmos.staking.v1beta1.MsgDelegate' || msgType === 'cosmos.staking.MsgDelegate') {
          const supplier = {
            address: msg.delegator_address || '',
            public_key: null,
            staked_amount: msg.amount?.amount || '0',
            status: 'delegated',
            service_url: null,
            last_seen: timestamp,
            geo: null,
          };
          
          // Validate required fields
          if (supplier.address) {
            suppliers.push(supplier);
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseSuppliers:", msgError.message);
        continue;
      }
    }
    
    return suppliers;
  } catch (error) {
    console.error("Error in parseSuppliers:", error.message);
    return [];
  }
}

/**
 * Parse applications from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseApplications(tx, block, chain) {
  try {
    const apps = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseApplications");
      return apps;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseApplications", Object.keys(tx));
      return apps;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return apps;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        // Pocket App Messages
        if (msgType === 'pocket.app.MsgStakeApp') {
          const app = {
            address: msg.operator_address || msg.address || '',
            public_key: msg.public_key || null,
            staked_amount: msg.stake?.amount || '0',
            status: 'staked',
            chains: Array.isArray(msg.chains) ? msg.chains : [],
            last_seen: timestamp,
          };
          
          // Validate required fields
          if (app.address) {
            apps.push(app);
          }
        }
        
        if (msgType === 'pocket.app.MsgUnstakeApp') {
          const app = {
            address: msg.operator_address || msg.address || '',
            public_key: msg.public_key || null,
            staked_amount: '0',
            status: 'unstaked',
            chains: [],
            last_seen: timestamp,
          };
          
          // Validate required fields
          if (app.address) {
            apps.push(app);
          }
        }
        
        if (msgType === 'pocket.app.MsgEditApp') {
          const app = {
            address: msg.operator_address || '',
            public_key: msg.public_key || null,
            staked_amount: msg.stake?.amount || '0',
            status: 'edited',
            chains: Array.isArray(msg.chains) ? msg.chains : [],
            last_seen: timestamp,
          };
          
          // Validate required fields
          if (app.address) {
            apps.push(app);
          }
        }
        
        // Pocket Application Messages (singular form)
        if (msgType === 'pocket.application.MsgDelegateToGateway') {
          const app = {
            address: msg.application_address || msg.app_address || '',
            chain: chain || 'unknown',
            public_key: null,
            staked_amount: msg.amount?.amount || '0',
            status: 'delegated',
            chains: [],
            last_seen: timestamp,
          };
          
          // Validate required fields
          if (app.address) {
            apps.push(app);
          }
        }
        
        if (msgType === 'pocket.application.MsgUndelegateFromGateway') {
          const app = {
            address: msg.application_address || msg.app_address || '',
            chain: chain || 'unknown',
            public_key: null,
            staked_amount: '0',
            status: 'undelegated',
            chains: [],
            last_seen: timestamp,
          };
          
          // Validate required fields
          if (app.address) {
            apps.push(app);
          }
        }
        
        if (msgType === 'pocket.application.MsgStakeApplication') {
          const app = {
            address: msg.application_address || msg.address || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            staked_amount: msg.stake?.amount || '0',
            stake_change: msg.stake?.amount || '0', // Track the incremental change
            status: 'staked',
            chains: Array.isArray(msg.chains) ? msg.chains : [],
            last_seen: timestamp,
          };
          
          // Validate required fields
          if (app.address) {
            apps.push(app);
          }
        }
        
        if (msgType === 'pocket.application.MsgUnstakeApplication') {
          // Extract current stake amount from transaction events
          let currentStakeAmount = '0';
          if (tx.tx_response?.events) {
            for (const event of tx.tx_response.events) {
              if (event.type === 'pocket.application.EventApplicationUnbondingBegin') {
                for (const attr of event.attributes) {
                  if (attr.key === 'application' && attr.value) {
                    try {
                      const appData = JSON.parse(attr.value);
                      currentStakeAmount = appData.stake?.amount || '0';
                      break;
                    } catch (e) {
                      console.warn('Failed to parse application data from event:', e.message);
                    }
                  }
                }
                break;
              }
            }
          }
          
          const app = {
            address: msg.application_address || msg.address || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            staked_amount: '0',
            stake_change: `-${currentStakeAmount}`, // Negative change for unstaking
            status: 'unstaked',
            chains: [],
            last_seen: timestamp,
          };
          
          // Validate required fields
          if (app.address) {
            apps.push(app);
          }
        }

        // Ownership transfer (track as application update)
        if (msgType === 'pocket.application.MsgTransferApplication') {
          const app = {
            address: msg.destination_address || '',
            public_key: null,
            staked_amount: '0',
            status: 'transferred',
            chains: [],
            last_seen: timestamp,
          };
          if (app.address) {
            apps.push(app);
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseApplications:", msgError.message);
        continue;
      }
    }
    
    return apps;
  } catch (error) {
    console.error("Error in parseApplications:", error.message);
    return [];
  }
}

/**
 * Parse staking events from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseStakingEvents(tx, block, chain) {
  try {
    const events = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseStakingEvents");
      return events;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseStakingEvents", Object.keys(tx));
      return events;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return events;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        // Pocket Supplier Events
        if (msgType === 'pocket.supplier.MsgStakeSupplier') {
          const event = {
            address: msg.operator_address || msg.signer || '',
            chain: chain || 'unknown',
            type: 'supplier',
            amount: msg.stake?.amount || '0',
            event: 'stake',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        if (msgType === 'pocket.supplier.MsgUnstakeSupplier') {
          const event = {
            address: msg.operator_address || '',
            chain: chain || 'unknown',
            type: 'supplier',
            amount: '0',
            event: 'unstake',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        // Pocket App Events
        if (msgType === 'pocket.app.MsgStakeApp') {
          const event = {
            address: msg.operator_address || msg.address || '',
            chain: chain || 'unknown',
            type: 'application',
            amount: msg.stake?.amount || '0',
            event: 'stake',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        if (msgType === 'pocket.app.MsgUnstakeApp') {
          const event = {
            address: msg.operator_address || msg.address || '',
            chain: chain || 'unknown',
            type: 'application',
            amount: '0',
            event: 'unstake',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        // Pocket Application Events (singular form)
        if (msgType === 'pocket.application.MsgDelegateToGateway') {
          const event = {
            address: msg.application_address || msg.app_address || '',
            type: 'application',
            amount: msg.amount?.amount || '0',
            event: 'delegate_to_gateway',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        if (msgType === 'pocket.application.MsgUndelegateFromGateway') {
          const event = {
            address: msg.application_address || msg.app_address || '',
            type: 'application',
            amount: msg.amount?.amount || '0',
            event: 'undelegate_from_gateway',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        if (msgType === 'pocket.application.MsgStakeApplication') {
          const event = {
            address: msg.application_address || msg.address || '',
            type: 'application',
            amount: msg.stake?.amount || '0',
            event: 'stake',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        if (msgType === 'pocket.application.MsgUnstakeApplication') {
          const event = {
            address: msg.application_address || msg.address || '',
            type: 'application',
            amount: '0',
            event: 'unstake',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        // Pocket Gateway Events
        if (msgType === 'pocket.gateway.MsgStakeGateway') {
          const event = {
            address: msg.address || msg.operator_address || msg.gateway_address || '',
            chain: chain || 'unknown',
            type: 'gateway',
            amount: msg.stake?.amount || '0',
            event: 'stake',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        if (msgType === 'pocket.gateway.MsgUnstakeGateway') {
          const event = {
            address: msg.address || msg.operator_address || msg.gateway_address || '',
            chain: chain || 'unknown',
            type: 'gateway',
            amount: '0',
            event: 'unstake',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        // Cosmos Staking Events
        if (msgType === 'cosmos.staking.v1beta1.MsgDelegate' || msgType === 'cosmos.staking.MsgDelegate') {
          const event = {
            address: msg.delegator_address || '',
            type: 'delegator',
            amount: msg.amount?.amount || '0',
            event: 'delegate',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        if (msgType === 'cosmos.staking.v1beta1.MsgUndelegate' || msgType === 'cosmos.staking.MsgUndelegate') {
          const event = {
            address: msg.delegator_address || '',
            type: 'delegator',
            amount: msg.amount?.amount || '0',
            event: 'undelegate',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        if (msgType === 'cosmos.staking.v1beta1.MsgBeginRedelegate' || msgType === 'cosmos.staking.MsgBeginRedelegate') {
          const event = {
            address: msg.delegator_address || '',
            type: 'delegator',
            amount: msg.amount?.amount || '0',
            event: 'redelegate',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
        
        // Cosmos Distribution Events
        if (msgType === 'cosmos.distr.v1beta1.MsgWithdrawDelegatorReward' || msgType === 'cosmos.distr.MsgWithdrawDelegatorReward') {
          const event = {
            address: msg.delegator_address || '',
            type: 'delegator',
            amount: null, // Rewards amount varies
            event: 'withdraw_reward',
            timestamp: timestamp,
          };
          
          if (event.address) {
            events.push(event);
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseStakingEvents:", msgError.message);
        continue;
      }
    }
    
    return events;
  } catch (error) {
    console.error("Error in parseStakingEvents:", error.message);
    return [];
  }
}

/**
 * Parse claims from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseClaims(tx, block) {
  try {
    const claims = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseClaims");
      return claims;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseClaims", Object.keys(tx));
      return claims;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return claims;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        // Pocket Proof Messages
        if (msgType === 'pocket.proof.MsgCreateClaim') {
          const claim = {
            supplier_operator_address: msg.supplier_operator_address || '',
            application_address: msg.session_header?.application_address || '',
            service_id: msg.session_header?.service_id || '',
            session_id: msg.session_header?.session_id || '',
            session_start_block_height: msg.session_header?.session_start_block_height || 0,
            session_end_block_height: msg.session_header?.session_end_block_height || 0,
            root_hash: msg.root_hash || '',
            timestamp: timestamp,
            status: 'pending_validation'
          };
          
          // Validate required fields
          if (claim.supplier_operator_address && claim.application_address) {
            claims.push(claim);
          }
        }
        
        if (msgType === 'pocket.proof.MsgSubmitProof') {
          const claim = {
            supplier_operator_address: msg.supplier_operator_address || '',
            application_address: msg.session_header?.application_address || '',
            service_id: msg.session_header?.service_id || '',
            session_id: msg.session_header?.session_id || '',
            session_start_block_height: msg.session_header?.session_start_block_height || 0,
            session_end_block_height: msg.session_header?.session_end_block_height || 0,
            proof: msg.proof || '',
            timestamp: timestamp,
            status: 'proof_submitted'
          };
          
          // Validate required fields
          if (claim.supplier_operator_address && claim.application_address) {
            claims.push(claim);
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseClaims:", msgError.message);
        continue;
      }
    }
    
    return claims;
  } catch (error) {
    console.error("Error in parseClaims:", error.message);
    return [];
  }
}

/**
 * Parse services from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseServices(tx, block, chain) {
  try {
    const services = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseServices");
      return services;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseServices", Object.keys(tx));
      return services;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return services;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        // Pocket Supplier Services
        if (msgType === 'pocket.supplier.MsgStakeSupplier' && Array.isArray(msg.services)) {
          for (const service of msg.services) {
            try {
              const serviceObj = {
                supplier_address: msg.operator_address || msg.signer || '',
                chain: service.service_id || '',
                service_url: service.endpoints?.[0]?.url || null,
                status: 'active',
                last_checked: timestamp,
              };
              
              if (serviceObj.supplier_address && serviceObj.chain) {
                services.push(serviceObj);
              }
            } catch (serviceError) {
              console.warn("Error processing individual service:", serviceError.message);
              continue;
            }
          }
        }
        
        if (msgType === 'pocket.supplier.MsgEditSupplier' && Array.isArray(msg.services)) {
          for (const service of msg.services) {
            try {
              const serviceObj = {
                supplier_address: msg.operator_address || '',
                chain: service.service_id || '',
                service_url: service.endpoints?.[0]?.url || null,
                status: 'edited',
                last_checked: timestamp,
              };
              
              if (serviceObj.supplier_address && serviceObj.chain) {
                services.push(serviceObj);
              }
            } catch (serviceError) {
              console.warn("Error processing individual service:", serviceError.message);
              continue;
            }
          }
        }
        
        if (msgType === 'pocket.supplier.MsgUnstakeSupplier' && Array.isArray(msg.services)) {
          for (const service of msg.services) {
            try {
              const serviceObj = {
                supplier_address: msg.operator_address || '',
                chain: service.service_id || '',
                service_url: null,
                status: 'inactive',
                last_checked: timestamp,
              };
              
              if (serviceObj.supplier_address && serviceObj.chain) {
                services.push(serviceObj);
              }
            } catch (serviceError) {
              console.warn("Error processing individual service:", serviceError.message);
              continue;
            }
          }
        }
        
        // Pocket Service Messages
        // Pocket Service Messages
        if (msgType === 'pocket.service.MsgAddService') {
          const service = {
            supplier_address: msg.owner_address || '',
            chain: msg.service?.id || '',
            service_url: null, // MsgAddService doesn't have service_url
            status: 'active',
            last_checked: timestamp,
          };
          
          if (service.supplier_address && service.chain) {
            services.push(service);
          }
        }
        
        if (msgType === 'pocket.service.MsgAddServiceResponse') {
          const service = {
            supplier_address: msg.supplier_operator_address || '',
            chain: msg.service_id || '',
            service_url: msg.service_url || null,
            status: 'active',
            last_checked: timestamp,
          };
          
          if (service.supplier_address && service.chain) {
            services.push(service);
          }
        }
        
        if (msgType === 'pocket.service.MsgUpdateServiceResponse') {
          const service = {
            supplier_address: msg.supplier_operator_address || '',
            chain: msg.service_id || '',
            service_url: msg.service_url || null,
            status: 'updated',
            last_checked: timestamp,
          };
          
          if (service.supplier_address && service.chain) {
            services.push(service);
          }
        }
        
        // Pocket Gateway Service Messages
        if (msgType === 'pocket.gateway.MsgStakeGateway' && Array.isArray(msg.services)) {
          for (const service of msg.services) {
            try {
              const serviceObj = {
                supplier_address: msg.address || msg.operator_address || msg.gateway_address || '',
                chain: service.service_id || '',
                service_url: service.endpoints?.[0]?.url || null,
                status: 'active',
                last_checked: timestamp,
              };
              
              if (serviceObj.supplier_address && serviceObj.chain) {
                services.push(serviceObj);
              }
            } catch (serviceError) {
              console.warn("Error processing individual gateway service:", serviceError.message);
              continue;
            }
          }
        }
        
        if (msgType === 'pocket.gateway.MsgEditGateway' && Array.isArray(msg.services)) {
          for (const service of msg.services) {
            try {
              const serviceObj = {
                supplier_address: msg.address || msg.operator_address || msg.gateway_address || '',
                chain: service.service_id || '',
                service_url: service.endpoints?.[0]?.url || null,
                status: 'edited',
                last_checked: timestamp,
              };
              
              if (serviceObj.supplier_address && serviceObj.chain) {
                services.push(serviceObj);
              }
            } catch (serviceError) {
              console.warn("Error processing individual gateway service:", serviceError.message);
              continue;
            }
          }
        }
        
        if (msgType === 'pocket.gateway.MsgUnstakeGateway' && Array.isArray(msg.services)) {
          for (const service of msg.services) {
            try {
              const serviceObj = {
                supplier_address: msg.address || msg.operator_address || msg.gateway_address || '',
                chain: service.service_id || '',
                service_url: null,
                status: 'inactive',
                last_checked: timestamp,
              };
              
              if (serviceObj.supplier_address && serviceObj.chain) {
                services.push(serviceObj);
              }
            } catch (serviceError) {
              console.warn("Error processing individual gateway service:", serviceError.message);
              continue;
            }
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseServices:", msgError.message);
        continue;
      }
    }
    
    return services;
  } catch (error) {
    console.error("Error in parseServices:", error.message);
    return [];
  }
}

/**
 * Parse nodes from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseNodes(tx, block, chain) {
  try {
    const nodes = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseNodes");
      return nodes;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseNodes", Object.keys(tx));
      return nodes;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return nodes;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        // Pocket POS Messages
        if (msgType === 'pocket.pos.MsgStake') {
          const node = {
            address: msg.operator_address || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            staked_amount: msg.stake?.amount || '0',
            stake_change: msg.stake?.amount || '0', // Track the incremental change
            status: 'staked',
            geo: msg.geo || null,
            last_seen: timestamp,
            service_url: null,
          };
          
          if (node.address) {
            nodes.push(node);
          }
        }
        
        if (msgType === 'pocket.pos.MsgUnstake') {
          const node = {
            address: msg.operator_address || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            status: 'unstaked',
            geo: null,
            last_seen: timestamp,
            service_url: null,
          };
          
          if (node.address) {
            nodes.push(node);
          }
        }
        
        if (msgType === 'pocket.pos.MsgEditValidator') {
          const node = {
            address: msg.operator_address || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            status: 'edited',
            geo: msg.geo || null,
            last_seen: timestamp,
            service_url: null,
          };
          
          if (node.address) {
            nodes.push(node);
          }
        }
        
        // Cosmos Staking Messages
        if (msgType === 'cosmos.staking.v1beta1.MsgCreateValidator' || msgType === 'cosmos.staking.MsgCreateValidator') {
          const node = {
            address: msg.validator_address || '',
            chain: chain || 'unknown',
            public_key: msg.pubkey?.key || null,
            staked_amount: msg.value?.amount || '0',
            stake_change: msg.value?.amount || '0', // Track the incremental change
            status: 'active',
            geo: null,
            last_seen: timestamp,
            service_url: null,
          };
          
          if (node.address) {
            nodes.push(node);
          }
        }
        
        if (msgType === 'cosmos.staking.v1beta1.MsgEditValidator' || msgType === 'cosmos.staking.MsgEditValidator') {
          const node = {
            address: msg.validator_address || '',
            public_key: null,
            status: 'edited',
            geo: null,
            last_seen: timestamp,
            service_url: null,
          };
          
          if (node.address) {
            nodes.push(node);
          }
        }
        
        // Cosmos Slashing Messages
        if (msgType === 'cosmos.slashing.v1beta1.MsgUnjail' || msgType === 'cosmos.slashing.MsgUnjail') {
          const node = {
            address: msg.validator_addr || '',
            public_key: null,
            status: 'unjailed',
            geo: null,
            last_seen: timestamp,
            service_url: null,
          };
          
          if (node.address) {
            nodes.push(node);
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseNodes:", msgError.message);
        continue;
      }
    }
    
    return nodes;
  } catch (error) {
    console.error("Error in parseNodes:", error.message);
    return [];
  }
}

/**
 * Parse relay proofs
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseRelays(tx, block, chain) {
  try {
    const relays = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseRelays");
      return relays;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseRelays", Object.keys(tx));
      return relays;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return relays;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        if (msgType === 'pocket.relay.MsgRelayProof') {
          const relay = {
            supplier_address: msg.supplier_address || '',
            application_address: msg.application_address || '',
            session_id: msg.session_id || '',
            chain: chain || 'unknown',
            proof: msg.proof || '',
            timestamp: timestamp,
          };
          
          // Validate required fields
          if (relay.supplier_address && relay.application_address && relay.session_id) {
            relays.push(relay);
          }
        }
        
        // Handle MsgSubmitProof as relay records
        if (msgType === 'pocket.proof.MsgSubmitProof') {
          const relay = {
            supplier_address: msg.supplier_operator_address || '',
            application_address: msg.session_header?.application_address || '',
            session_id: msg.session_header?.session_id || '',
            chain: chain || 'unknown',
            proof: msg.proof || '',
            timestamp: timestamp,
          };
          
          // Validate required fields
          if (relay.supplier_address && relay.application_address && relay.session_id) {
            relays.push(relay);
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseRelays:", msgError.message);
        continue;
      }
    }
    
    return relays;
  } catch (error) {
    console.error("Error in parseRelays:", error.message);
    return [];
  }
}

/**
 * Parse governance actions
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseGovernance(tx, block, chain) {
  try {
    const governance = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseGovernance");
      return governance;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseGovernance", Object.keys(tx));
      return governance;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return governance;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const msgType = msg['@type'];
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        if (msgType === '/cosmos.gov.MsgSubmitProposal') {
          const gov = {
            proposer: msg.proposer || '',
            proposal_id: null, // Will be set after proposal creation
            proposal_type: msg.content?.['@type'] || '',
            status: 'submitted',
            timestamp: timestamp,
          };
          
          if (gov.proposer) {
            governance.push(gov);
          }
        }
        
        if (msgType === '/cosmos.gov.MsgVote') {
          const gov = {
            voter: msg.voter || '',
            proposal_id: msg.proposal_id || '',
            vote: msg.option || '',
            timestamp: timestamp,
          };
          
          if (gov.voter && gov.proposal_id) {
            governance.push(gov);
          }
        }
        
        if (msgType === '/cosmos.gov.MsgDeposit') {
          const gov = {
            depositor: msg.depositor || '',
            proposal_id: msg.proposal_id || '',
            amount: msg.amount?.[0]?.amount || '0',
            timestamp: timestamp,
          };
          
          if (gov.depositor && gov.proposal_id) {
            governance.push(gov);
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseGovernance:", msgError.message);
        continue;
      }
    }
    
    return governance;
  } catch (error) {
    console.error("Error in parseGovernance:", error.message);
    return [];
  }
}

/**
 * Parse gateways from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseGateways(tx, block, chain) {
  try {
    const gateways = [];
    
    if (!tx) {
      console.warn("No transaction provided to parseGateways");
      return gateways;
    }
    
    if (!tx.body?.messages && !tx.messages) {
      console.warn("No messages found in transaction for parseGateways", Object.keys(tx));
      return gateways;
    }
    
    const messages = tx.body?.messages || tx.messages;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return gateways;
    }
    
    const timestamp = block?.block?.header?.time || block?.timestamp || new Date().toISOString();
    
    for (const msg of messages) {
      try {
        if (!msg || typeof msg !== 'object') {
          continue;
        }
        
        const rawType = msg['@type'];
        const msgType = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
        
        if (!msgType || typeof msgType !== 'string') {
          continue;
        }
        
        // Pocket Gateway Messages
        if (msgType === 'pocket.gateway.MsgStakeGateway') {
          const gateway = {
            address: msg.address || msg.operator_address || msg.gateway_address || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            staked_amount: msg.stake?.amount || '0',
            stake_change: msg.stake?.amount || '0', // Track the incremental change
            status: 'staked',
            service_url: msg.services?.[0]?.endpoints?.[0]?.url || null,
            last_seen: timestamp,
            geo: null,
          };
          
          // Validate required fields
          if (gateway.address) {
            gateways.push(gateway);
          }
        }
        
        if (msgType === 'pocket.gateway.MsgUnstakeGateway') {
          // Extract current stake amount from transaction events
          let currentStakeAmount = '0';
          if (tx.tx_response?.events) {
            for (const event of tx.tx_response.events) {
              if (event.type === 'pocket.gateway.EventGatewayUnbondingBegin') {
                for (const attr of event.attributes) {
                  if (attr.key === 'gateway' && attr.value) {
                    try {
                      const gatewayData = JSON.parse(attr.value);
                      currentStakeAmount = gatewayData.stake?.amount || '0';
                      break;
                    } catch (e) {
                      console.warn('Failed to parse gateway data from event:', e.message);
                    }
                  }
                }
                break;
              }
            }
          }
          
          const gateway = {
            address: msg.address || msg.operator_address || msg.gateway_address || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            staked_amount: '0',
            stake_change: `-${currentStakeAmount}`, // Negative change for unstaking
            status: 'unstaked',
            service_url: null,
            last_seen: timestamp,
            geo: null,
          };
          
          // Validate required fields
          if (gateway.address) {
            gateways.push(gateway);
          }
        }
        
        if (msgType === 'pocket.gateway.MsgEditGateway') {
          const gateway = {
            address: msg.address || msg.operator_address || msg.gateway_address || '',
            chain: chain || 'unknown',
            public_key: msg.public_key || null,
            staked_amount: msg.stake?.amount || '0',
            status: 'edited',
            service_url: msg.services?.[0]?.endpoints?.[0]?.url || null,
            last_seen: timestamp,
            geo: null,
          };
          
          // Validate required fields
          if (gateway.address) {
            gateways.push(gateway);
          }
        }
      } catch (msgError) {
        console.warn("Error processing individual message in parseGateways:", msgError.message);
        continue;
      }
    }
    
    return gateways;
  } catch (error) {
    console.error("Error in parseGateways:", error.message);
    return [];
  }
}

module.exports = {
  classifyTransaction,
  parseSuppliers,
  parseApplications,
  parseStakingEvents,
  parseClaims,
  parseServices,
  parseNodes,
  parseRelays,
  parseGovernance,
  parseGateways,
}; 