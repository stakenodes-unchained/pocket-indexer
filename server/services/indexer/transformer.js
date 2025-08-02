const { fromBase64, toHex } = require('@cosmjs/encoding');
const { sha256 } = require('@cosmjs/crypto');

/**
 * Hash transaction to get its ID
 * @param {string} rawTx - Base64 encoded transaction
 * @returns {string}
 */
function hashTx(rawTx) {
  return toHex(sha256(fromBase64(rawTx))).toUpperCase();
}

/**
 * Extract transaction details from a transaction response
 * @param {Object} txResponse - Transaction response from RPC
 * @param {string} blockTimestamp - Block timestamp
 * @returns {Object} Transaction details
 */
function extractTransactionDetails(txResponse, blockTimestamp) {
  
  const tx = txResponse.tx;
  const txResult = txResponse.tx_response || txResponse;
  
  
  // Extract basic info
  const details = {
    hash: txResult.txhash || txResult.hash,
    height: txResult.height,
    status: txResult.code === 0,
    timestamp: txResult.timestamp || blockTimestamp,
    gas_wanted: txResult.gas_wanted,
    gas_used: txResult.gas_used,
    fee: tx?.auth_info?.fee,
    memo: tx?.body?.memo || '',
    messages: tx?.body?.messages || [],
    signatures: tx?.signatures || [],
  };

  // Extract sender from first signer
  if (tx?.auth_info?.signer_infos?.[0]) {
    const signerInfo = tx.auth_info.signer_infos[0];
    if (signerInfo.public_key?.key) {
      details.sender = signerInfo.public_key.key;
    } else if (signerInfo.public_key?.value) {
      // Handle base64 encoded public key
      details.sender = signerInfo.public_key.value;
    }
  }

  // Extract message types and amounts
  if (details.messages && details.messages.length > 0) {
    details.type = details.messages[0]['@type'] || 'unknown';
    
    // Extract amount from first message if available
    const firstMsg = details.messages[0];
    if (firstMsg.amount && firstMsg.amount.length > 0) {
      details.amount = firstMsg.amount[0].amount || '0';
    } else if (firstMsg.stake?.amount) {
      details.amount = firstMsg.stake.amount;
    } else if (firstMsg.value?.amount) {
      details.amount = firstMsg.value.amount;
    } else {
      details.amount = '0';
    }

    // Extract recipient if available
    if (firstMsg.to_address) {
      details.recipient = firstMsg.to_address;
    } else if (firstMsg.recipient) {
      details.recipient = firstMsg.recipient;
    } else if (firstMsg.validator_address) {
      details.recipient = firstMsg.validator_address;
    } else if (firstMsg.operator_address) {
      details.recipient = firstMsg.operator_address;
    } else if (firstMsg.delegator_address) {
      details.recipient = firstMsg.delegator_address;
    } else {
      details.recipient = '';
    }
  }

  return details;
}

/**
 * Transforms a raw block from the RPC into a DB-ready format
 * @param {any} rawBlock - The raw block data from the RPC
 * @returns {any}
 */
function transformBlock(rawBlock) {
  return {
    id: rawBlock.block.header.hash,
    height: parseInt(rawBlock.block.header.height, 10),
    hash: rawBlock.block.header.hash,
    timestamp: new Date(rawBlock.block.header.time),
    proposer: rawBlock.block.header.proposer_address,
    transactions: (rawBlock.block.data.txs || []).map(tx => ({
      hash: hashTx(tx),
      raw: tx,
      // These will be populated when we fetch full transaction details from RPC
      sender: '',
      recipient: '',
      amount: '0',
      type: 'unknown',
      status: 'pending',
      timestamp: new Date(rawBlock.block.header.time),
    })),
  };
}

module.exports = {
  transformBlock,
  extractTransactionDetails,
  hashTx,
}; 