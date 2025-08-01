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
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return 'unknown'
  };
  var msgType = null
  
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    var msgType = msg['@type'];
    
    // Pocket-specific messages
    if (msgType?.startsWith('/pocket.supplier.')) return 'supplier';
    if (msgType?.startsWith('/pocket.app.')) return 'application';
    if (msgType?.startsWith('/pocket.pos.')) return 'node';
    if (msgType?.startsWith('/pocket.relay.')) return 'relay';
    if (msgType?.startsWith('/pocket.bank.')) return 'bank';
    if (msgType?.startsWith('/pocket.proof.')) return 'proof';
    if (msgType?.startsWith('/pocket.service.')) return 'service';
    
    // Cosmos SDK messages
    if (msgType?.startsWith('/cosmos.bank.')) return 'bank';
    if (msgType?.startsWith('/cosmos.staking.')) return 'node';
    if (msgType?.startsWith('/cosmos.distr.')) return 'rewards';
    if (msgType?.startsWith('/cosmos.gov.')) return 'governance';
    if (msgType?.startsWith('/cosmos.slashing.')) return 'slashing';
    if (msgType?.startsWith('/cosmos.authz.')) return 'authz';
  }
  
  return msgType;
}

/**
 * Parse suppliers from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseSuppliers(tx, block) {
  const suppliers = [];
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return suppliers
  };
  
  
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    const msgType = msg['@type'];
    
    // Pocket Supplier Messages
    if (msgType === '/pocket.supplier.MsgStakeSupplier') {
      suppliers.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        staked_amount: msg.stake?.amount,
        status: 'staked',
        service_url: msg.services?.[0]?.endpoints?.[0]?.url || null,
        last_seen: block.block?.header?.time || block.timestamp,
        geo: null,
      });
    }
    
    if (msgType === '/pocket.supplier.MsgUnstakeSupplier') {
      suppliers.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        staked_amount: '0',
        status: 'unstaked',
        service_url: null,
        last_seen: block.block?.header?.time || block.timestamp,
        geo: null,
      });
    }
    
    if (msgType === '/pocket.supplier.MsgEditSupplier') {
      suppliers.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        staked_amount: msg.stake?.amount,
        status: 'edited',
        service_url: msg.services?.[0]?.endpoints?.[0]?.url || null,
        last_seen: block.block?.header?.time || block.timestamp,
        geo: null,
      });
    }
    
    // Cosmos Staking Messages (for validators/suppliers)
    if (msgType === '/cosmos.staking.MsgCreateValidator') {
      suppliers.push({
        address: msg.validator_address,
        public_key: msg.pubkey?.key || null,
        staked_amount: msg.value?.amount,
        status: 'staked',
        service_url: null,
        last_seen: block.block?.header?.time || block.timestamp,
        geo: null,
      });
    }
    
    if (msgType === '/cosmos.staking.MsgDelegate') {
      suppliers.push({
        address: msg.delegator_address,
        public_key: null,
        staked_amount: msg.amount?.amount,
        status: 'delegated',
        service_url: null,
        last_seen: block.block?.header?.time || block.timestamp,
        geo: null,
      });
    }
  }
  
  return suppliers;
}

/**
 * Parse applications from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseApplications(tx, block) {
  const apps = [];
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return apps
  };
  
  
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    const msgType = msg['@type'];
    
    // Pocket App Messages
    if (msgType === '/pocket.app.MsgStakeApp') {
      apps.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        staked_amount: msg.stake?.amount,
        status: 'staked',
        chains: msg.chains || [],
        last_seen: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/pocket.app.MsgUnstakeApp') {
      apps.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        staked_amount: '0',
        status: 'unstaked',
        chains: [],
        last_seen: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/pocket.app.MsgEditApp') {
      apps.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        staked_amount: msg.stake?.amount,
        status: 'edited',
        chains: msg.chains || [],
        last_seen: block.block?.header?.time || block.timestamp,
      });
    }
  }
  
  return apps;
}

/**
 * Parse staking events from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseStakingEvents(tx, block) {
  const events = [];
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return events
  };
  
  
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    const msgType = msg['@type'];
    
    // Pocket Supplier Events
    if (msgType === '/pocket.supplier.MsgStakeSupplier') {
      events.push({
        address: msg.operator_address,
        type: 'supplier',
        amount: msg.stake?.amount,
        event: 'stake',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/pocket.supplier.MsgUnstakeSupplier') {
      events.push({
        address: msg.operator_address,
        type: 'supplier',
        amount: '0',
        event: 'unstake',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    // Pocket App Events
    if (msgType === '/pocket.app.MsgStakeApp') {
      events.push({
        address: msg.operator_address,
        type: 'application',
        amount: msg.stake?.amount,
        event: 'stake',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/pocket.app.MsgUnstakeApp') {
      events.push({
        address: msg.operator_address,
        type: 'application',
        amount: '0',
        event: 'unstake',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    // Cosmos Staking Events
    if (msgType === '/cosmos.staking.MsgDelegate') {
      events.push({
        address: msg.delegator_address,
        type: 'delegator',
        amount: msg.amount?.amount,
        event: 'delegate',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/cosmos.staking.MsgUndelegate') {
      events.push({
        address: msg.delegator_address,
        type: 'delegator',
        amount: msg.amount?.amount,
        event: 'undelegate',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/cosmos.staking.MsgBeginRedelegate') {
      events.push({
        address: msg.delegator_address,
        type: 'delegator',
        amount: msg.amount?.amount,
        event: 'redelegate',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    // Cosmos Distribution Events
    if (msgType === '/cosmos.distr.MsgWithdrawDelegatorReward') {
      events.push({
        address: msg.delegator_address,
        type: 'delegator',
        amount: null, // Rewards amount varies
        event: 'withdraw_reward',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
  }
  
  return events;
}

/**
 * Parse claims from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseClaims(tx, block) {
  const claims = [];
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return claims
  };
  
  
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    const msgType = msg['@type'];
    
    // Pocket Proof Messages
    if (msgType === '/pocket.proof.MsgCreateClaim') {
      claims.push({
        supplier_operator_address: msg.supplier_operator_address,
        application_address: msg.session_header?.application_address,
        service_id: msg.session_header?.service_id,
        session_id: msg.session_header?.session_id,
        session_start_block_height: msg.session_header?.session_start_block_height,
        session_end_block_height: msg.session_header?.session_end_block_height,
        root_hash: msg.root_hash,
        timestamp: block.block?.header?.time || block.timestamp,
        status: 'pending_validation'
      });
    }
    
    if (msgType === '/pocket.proof.MsgSubmitProof') {
      claims.push({
        supplier_operator_address: msg.supplier_operator_address,
        application_address: msg.session_header?.application_address,
        service_id: msg.session_header?.service_id,
        session_id: msg.session_header?.session_id,
        session_start_block_height: msg.session_header?.session_start_block_height,
        session_end_block_height: msg.session_header?.session_end_block_height,
        proof: msg.proof,
        timestamp: block.block?.header?.time || block.timestamp,
        status: 'proof_submitted'
      });
    }
  }
  
  return claims;
}

/**
 * Parse services from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseServices(tx, block) {
  const services = [];
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return services
  };
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    const msgType = msg['@type'];
    
    // Pocket Supplier Services
    if (msgType === '/pocket.supplier.MsgStakeSupplier' && Array.isArray(msg.services)) {
      for (const service of msg.services) {
        services.push({
          supplier_address: msg.operator_address,
          chain: service.service_id,
          service_url: service.endpoints?.[0]?.url || null,
          status: 'active',
          last_checked: block.block?.header?.time || block.timestamp,
        });
      }
    }
    
    if (msgType === '/pocket.supplier.MsgEditSupplier' && Array.isArray(msg.services)) {
      for (const service of msg.services) {
        services.push({
          supplier_address: msg.operator_address,
          chain: service.service_id,
          service_url: service.endpoints?.[0]?.url || null,
          status: 'edited',
          last_checked: block.block?.header?.time || block.timestamp,
        });
      }
    }
    
    if (msgType === '/pocket.supplier.MsgUnstakeSupplier' && Array.isArray(msg.services)) {
      for (const service of msg.services) {
        services.push({
          supplier_address: msg.operator_address,
          chain: service.service_id,
          service_url: null,
          status: 'inactive',
          last_checked: block.block?.header?.time || block.timestamp,
        });
      }
    }
    
    // Pocket Service Messages
    if (msgType === '/pocket.service.MsgAddServiceResponse') {
      services.push({
        supplier_address: msg.supplier_operator_address,
        chain: msg.service_id,
        service_url: msg.service_url || null,
        status: 'active',
        last_checked: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/pocket.service.MsgUpdateServiceResponse') {
      services.push({
        supplier_address: msg.supplier_operator_address,
        chain: msg.service_id,
        service_url: msg.service_url || null,
        status: 'updated',
        last_checked: block.block?.header?.time || block.timestamp,
      });
    }
  }
  
  return services;
}

/**
 * Parse nodes from a transaction
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseNodes(tx, block) {
  const nodes = [];
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return nodes
  };
  
  
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    const msgType = msg['@type'];
    
    // Pocket POS Messages
    if (msgType === '/pocket.pos.MsgStake') {
      nodes.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        status: 'staked',
        geo: msg.geo || null,
        last_seen: block.block?.header?.time || block.timestamp,
        service_url: null,
      });
    }
    
    if (msgType === '/pocket.pos.MsgUnstake') {
      nodes.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        status: 'unstaked',
        geo: null,
        last_seen: block.block?.header?.time || block.timestamp,
        service_url: null,
      });
    }
    
    if (msgType === '/pocket.pos.MsgEditValidator') {
      nodes.push({
        address: msg.operator_address,
        public_key: msg.public_key || null,
        status: 'edited',
        geo: msg.geo || null,
        last_seen: block.block?.header?.time || block.timestamp,
        service_url: null,
      });
    }
    
    // Cosmos Staking Messages
    if (msgType === '/cosmos.staking.MsgCreateValidator') {
      nodes.push({
        address: msg.validator_address,
        public_key: msg.pubkey?.key || null,
        status: 'active',
        geo: null,
        last_seen: block.block?.header?.time || block.timestamp,
        service_url: null,
      });
    }
    
    if (msgType === '/cosmos.staking.MsgEditValidator') {
      nodes.push({
        address: msg.validator_address,
        public_key: null,
        status: 'edited',
        geo: null,
        last_seen: block.block?.header?.time || block.timestamp,
        service_url: null,
      });
    }
    
    // Cosmos Slashing Messages
    if (msgType === '/cosmos.slashing.MsgUnjail') {
      nodes.push({
        address: msg.validator_addr,
        public_key: null,
        status: 'unjailed',
        geo: null,
        last_seen: block.block?.header?.time || block.timestamp,
        service_url: null,
      });
    }
  }
  
  return nodes;
}

/**
 * Parse relay proofs
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseRelays(tx, block) {
  const relays = [];
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return relays
  };
  
  
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    const msgType = msg['@type'];
    
    if (msgType === '/pocket.relay.MsgRelayProof') {
      relays.push({
        supplier_address: msg.supplier_address,
        application_address: msg.application_address,
        session_id: msg.session_id,
        chain: msg.chain,
        proof: msg.proof,
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
  }
  
  return relays;
}

/**
 * Parse governance actions
 * @param {any} tx
 * @param {any} block
 * @returns {Array}
 */
function parseGovernance(tx, block) {
  const governance = [];
  if (!tx.body?.messages && !tx.messages) {
    console.warn("No body in tx", tx);
    return governance
  };
  
  
  const messages = tx.body?.messages || tx.messages;
  for (const msg of messages) {
    const msgType = msg['@type'];
    
    if (msgType === '/cosmos.gov.MsgSubmitProposal') {
      governance.push({
        proposer: msg.proposer,
        proposal_id: null, // Will be set after proposal creation
        proposal_type: msg.content?.['@type'],
        status: 'submitted',
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/cosmos.gov.MsgVote') {
      governance.push({
        voter: msg.voter,
        proposal_id: msg.proposal_id,
        vote: msg.option,
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
    
    if (msgType === '/cosmos.gov.MsgDeposit') {
      governance.push({
        depositor: msg.depositor,
        proposal_id: msg.proposal_id,
        amount: msg.amount?.[0]?.amount,
        timestamp: block.block?.header?.time || block.timestamp,
      });
    }
  }
  
  return governance;
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
}; 