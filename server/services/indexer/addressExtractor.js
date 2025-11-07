/**
 * Address extraction utility for transactions
 * Extracts all addresses from transaction data based on message types
 */

/**
 * Extract all addresses from a transaction
 * @param {Object} tx - Transaction object (may have sender, recipient)
 * @param {Object} txData - Full transaction data (tx_data JSONB from database)
 * @returns {Array<string>} Array of unique, non-empty addresses
 */
function extractAllAddresses(tx, txData) {
  const addresses = new Set();

  // Extract from transaction-level fields
  if (tx?.sender && typeof tx.sender === 'string' && tx.sender.trim()) {
    addresses.add(tx.sender.trim());
  }
  if (tx?.recipient && typeof tx.recipient === 'string' && tx.recipient.trim()) {
    addresses.add(tx.recipient.trim());
  }

  // Parse txData if it's a string
  let parsedTxData = txData;
  if (typeof txData === 'string') {
    try {
      parsedTxData = JSON.parse(txData);
    } catch (e) {
      // If parsing fails, return what we have so far
      return Array.from(addresses);
    }
  }

  if (!parsedTxData || typeof parsedTxData !== 'object') {
    return Array.from(addresses);
  }

  // Extract from messages in tx.body.messages
  const messages = parsedTxData?.tx?.body?.messages || parsedTxData?.body?.messages || parsedTxData?.messages || [];
  
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg || typeof msg !== 'object') continue;
      
      extractAddressesFromMessage(msg, addresses);
    }
  }

  // Extract from transaction events if available
  const events = parsedTxData?.tx_response?.events || parsedTxData?.events || [];
  if (Array.isArray(events)) {
    for (const event of events) {
      if (!event || typeof event !== 'object') continue;
      
      // Extract from event attributes
      const attributes = event.attributes || [];
      if (Array.isArray(attributes)) {
        for (const attr of attributes) {
          if (attr?.key && attr?.value && typeof attr.value === 'string') {
            // Check if this attribute might contain an address
            const key = attr.key.toLowerCase();
            if (key.includes('address') || key.includes('sender') || key.includes('recipient')) {
              const value = attr.value.trim();
              if (value && value.length > 0) {
                addresses.add(value);
              }
            }
          }
        }
      }
    }
  }

  return Array.from(addresses).filter(addr => addr && addr.length > 0);
}

/**
 * Extract addresses from a single message based on message type
 * @param {Object} msg - Message object
 * @param {Set<string>} addresses - Set to add addresses to
 */
function extractAddressesFromMessage(msg, addresses) {
  if (!msg || typeof msg !== 'object') return;

  const msgType = msg['@type'] || msg.type || '';
  const normalizedType = typeof msgType === 'string' ? msgType.replace(/^\//, '') : '';

  // Generic address fields (check these for all messages)
  const genericFields = [
    'address',
    'recipient',
    'sender',
    'from_address',
    'to_address',
    'delegator_address',
    'validator_address',
    'operator_address',
    'application_address',
    'app_address',
    'gateway_address',
    'supplier_operator_address',
    'owner_address',
    'signer',
    'source_address',
    'destination_address',
    'authority',
    'morse_address',
    'pocket_address'
  ];

  for (const field of genericFields) {
    if (msg[field] && typeof msg[field] === 'string' && msg[field].trim()) {
      addresses.add(msg[field].trim());
    }
  }

  // Message-type-specific extraction
  if (normalizedType.startsWith('pocket.application.')) {
    // Application messages
    if (msg.address) addresses.add(String(msg.address).trim());
    if (msg.app_address) addresses.add(String(msg.app_address).trim());
    if (msg.application_address) addresses.add(String(msg.application_address).trim());
    if (msg.gateway_address) addresses.add(String(msg.gateway_address).trim());
    if (msg.source_address) addresses.add(String(msg.source_address).trim());
    if (msg.destination_address) addresses.add(String(msg.destination_address).trim());
  } else if (normalizedType.startsWith('pocket.supplier.')) {
    // Supplier messages
    if (msg.signer) addresses.add(String(msg.signer).trim());
    if (msg.owner_address) addresses.add(String(msg.owner_address).trim());
    if (msg.operator_address) addresses.add(String(msg.operator_address).trim());
    if (msg.supplier_operator_address) addresses.add(String(msg.supplier_operator_address).trim());
  } else if (normalizedType.startsWith('pocket.gateway.')) {
    // Gateway messages
    if (msg.address) addresses.add(String(msg.address).trim());
    if (msg.gateway_address) addresses.add(String(msg.gateway_address).trim());
  } else if (normalizedType.startsWith('pocket.service.')) {
    // Service messages
    if (msg.owner_address) addresses.add(String(msg.owner_address).trim());
  } else if (normalizedType.startsWith('pocket.proof.')) {
    // Proof messages
    if (msg.supplier_operator_address) addresses.add(String(msg.supplier_operator_address).trim());
    // Extract from session_header if present (nested structure)
    if (msg.session_header && typeof msg.session_header === 'object') {
      if (msg.session_header.application_address) {
        addresses.add(String(msg.session_header.application_address).trim());
      }
      // Recursively extract addresses from session_header
      extractAddressesFromMessage(msg.session_header, addresses);
    }
  } else if (normalizedType.startsWith('pocket.migration.')) {
    // Migration messages
    if (msg.authority) addresses.add(String(msg.authority).trim());
    if (msg.morse_address) addresses.add(String(msg.morse_address).trim());
    if (msg.pocket_address) addresses.add(String(msg.pocket_address).trim());
  } else if (normalizedType.startsWith('cosmos.bank.')) {
    // Cosmos bank messages
    if (msg.from_address) addresses.add(String(msg.from_address).trim());
    if (msg.to_address) addresses.add(String(msg.to_address).trim());
    // MsgMultiSend has inputs and outputs
    if (Array.isArray(msg.inputs)) {
      for (const input of msg.inputs) {
        if (input?.address) addresses.add(String(input.address).trim());
      }
    }
    if (Array.isArray(msg.outputs)) {
      for (const output of msg.outputs) {
        if (output?.address) addresses.add(String(output.address).trim());
      }
    }
  } else if (normalizedType.startsWith('cosmos.staking.')) {
    // Cosmos staking messages
    if (msg.delegator_address) addresses.add(String(msg.delegator_address).trim());
    if (msg.validator_address) addresses.add(String(msg.validator_address).trim());
    if (msg.validator_src_address) addresses.add(String(msg.validator_src_address).trim());
    if (msg.validator_dst_address) addresses.add(String(msg.validator_dst_address).trim());
  } else if (normalizedType.startsWith('cosmos.distribution.')) {
    // Cosmos distribution messages
    if (msg.delegator_address) addresses.add(String(msg.delegator_address).trim());
    if (msg.validator_address) addresses.add(String(msg.validator_address).trim());
    if (msg.withdraw_address) addresses.add(String(msg.withdraw_address).trim());
  }
}

module.exports = {
  extractAllAddresses
};

