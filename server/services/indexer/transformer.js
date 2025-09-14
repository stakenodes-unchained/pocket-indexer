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

  // Helper: sum coin arrays (string amounts)
  function sumCoins(coinArray) {
    try {
      if (!Array.isArray(coinArray)) return '0';
      let total = 0n;
      for (const c of coinArray) {
        const amt = BigInt((c && c.amount) ? String(c.amount) : '0');
        total += amt;
      }
      return total.toString();
    } catch {
      return '0';
    }
  }
  function coinDenomSummary(coinArray) {
    if (!Array.isArray(coinArray) || coinArray.length === 0) return null;
    const denoms = Array.from(new Set(coinArray.map(c => c && c.denom).filter(Boolean)));
    if (denoms.length === 1) return denoms[0];
    return 'MULTI';
  }

  // Extract message types and amounts
  if (details.messages && details.messages.length > 0) {
    const rawType = details.messages[0]['@type'] || 'unknown';
    details.type = typeof rawType === 'string' ? rawType.replace(/^\//, '') : rawType;
    
    // Extract amount from first message (type-aware)
    const firstMsg = details.messages[0];
    const msgType = details.type;
    let amount = '0';
    if (msgType === 'cosmos.bank.v1beta1.MsgSend' || msgType === 'cosmos.bank.MsgSend') {
      amount = sumCoins(firstMsg.amount);
      details.amount_denom = coinDenomSummary(firstMsg.amount);
    } else if (msgType === 'cosmos.bank.v1beta1.MsgMultiSend' || msgType === 'cosmos.bank.MsgMultiSend') {
      amount = sumCoins(firstMsg.outputs?.flatMap(o => o.coins) || []);
      details.amount_denom = coinDenomSummary(firstMsg.outputs?.flatMap(o => o.coins) || []);
    } else if (
      msgType === 'cosmos.staking.v1beta1.MsgDelegate' || msgType === 'cosmos.staking.MsgDelegate' ||
      msgType === 'cosmos.staking.v1beta1.MsgUndelegate' || msgType === 'cosmos.staking.MsgUndelegate' ||
      msgType === 'cosmos.staking.v1beta1.MsgBeginRedelegate' || msgType === 'cosmos.staking.MsgBeginRedelegate'
    ) {
      amount = String(firstMsg.amount?.amount || '0');
      details.amount_denom = firstMsg.amount?.denom || null;
    } else if (
      msgType === 'pocket.application.MsgStakeApplication' ||
      msgType === 'pocket.supplier.MsgStakeSupplier' ||
      msgType === 'pocket.gateway.MsgStakeGateway' ||
      msgType === 'pocket.app.MsgStakeApp'
    ) {
      amount = String(firstMsg.stake?.amount || '0');
      details.amount_denom = firstMsg.stake?.denom || null;
    } else if (
      msgType === 'pocket.application.MsgUnstakeApplication' ||
      msgType === 'pocket.supplier.MsgUnstakeSupplier' ||
      msgType === 'pocket.gateway.MsgUnstakeGateway' ||
      msgType === 'pocket.app.MsgUnstakeApp'
    ) {
      amount = '0';
      details.amount_denom = null;
    } else {
      // Fallbacks
      if (Array.isArray(firstMsg.amount) && firstMsg.amount.length > 0) {
        amount = String(firstMsg.amount[0]?.amount || '0');
        details.amount_denom = firstMsg.amount[0]?.denom || coinDenomSummary(firstMsg.amount) || null;
      } else if (firstMsg.value?.amount) {
        amount = String(firstMsg.value.amount);
        details.amount_denom = firstMsg.value?.denom || null;
      } else if (firstMsg.stake?.amount) {
        amount = String(firstMsg.stake.amount);
        details.amount_denom = firstMsg.stake?.denom || null;
      } else {
        amount = '0';
        details.amount_denom = null;
      }
    }
    details.amount = amount;

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
    } else if (firstMsg.application_address) {
      details.recipient = firstMsg.application_address;
    } else if (firstMsg.address) {
      details.recipient = firstMsg.address;
    } else {
      details.recipient = '';
    }
  }

  // Compute numeric fee amount (sum of coins)
  const feeCoins = tx?.auth_info?.fee?.amount;
  details.fee_amount = Array.isArray(feeCoins) ? feeCoins.reduce((acc, c) => {
    try {
      return (BigInt(acc) + BigInt((c && c.amount) ? String(c.amount) : '0')).toString();
    } catch {
      return acc;
    }
  }, '0') : '0';
  details.fee_denom = Array.isArray(feeCoins) ? coinDenomSummary(feeCoins) : null;

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