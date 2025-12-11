/**
 * Account Event Handlers
 * Handles account-related events (coin_spent, coin_received, transfer, message, mint, commission, rewards)
 * These events track account balances, minting, and transfers for applications, suppliers, gateways, and validators
 */

const { connectClients, pgClient } = require('../db');

/**
 * Helper to parse uPOKT amount string to numeric
 */
function parseUpokt(upoktString) {
  if (!upoktString) return 0;
  const str = String(upoktString);
  // Handle format like "5214.000658256326821571upokt" or just "5214upokt"
  const match = str.match(/^(\d+(?:\.\d+)?)/);
  return match ? Math.floor(parseFloat(match[1])) : 0;
}

/**
 * Helper to extract amount from various formats
 */
function extractAmount(amountString) {
  if (!amountString) return 0;
  return parseUpokt(amountString);
}

/**
 * Handle coin_spent event
 * Tracks when coins are spent from an account
 */
async function handleCoinSpent(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      spender,
      amount,
      mode,
      metadata
    } = event;
    
    // Store coin spent event
    await client.query(`
      INSERT INTO account_events (
        event_type,
        account_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      'coin_spent',
      spender,
      extractAmount(amount),
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'coin_spent' };
  } catch (error) {
    console.error('Error handling coin_spent:', error);
    return { success: false, error: error.message, event_type: 'coin_spent' };
  }
}

/**
 * Handle coin_received event
 * Tracks when coins are received by an account
 */
async function handleCoinReceived(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      receiver,
      amount,
      mode,
      metadata
    } = event;
    
    // Store coin received event
    await client.query(`
      INSERT INTO account_events (
        event_type,
        account_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      'coin_received',
      receiver,
      extractAmount(amount),
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'coin_received' };
  } catch (error) {
    console.error('Error handling coin_received:', error);
    return { success: false, error: error.message, event_type: 'coin_received' };
  }
}

/**
 * Handle transfer event
 * Tracks transfers between accounts
 */
async function handleTransfer(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      sender,
      recipient,
      amount,
      mode,
      metadata
    } = event;
    
    // Store transfer event
    await client.query(`
      INSERT INTO account_transfers (
        sender_address,
        recipient_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      sender,
      recipient,
      extractAmount(amount),
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'transfer' };
  } catch (error) {
    console.error('Error handling transfer:', error);
    return { success: false, error: error.message, event_type: 'transfer' };
  }
}

/**
 * Handle message event
 * Tracks message senders (for context)
 */
async function handleMessage(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      sender,
      mode,
      metadata
    } = event;
    
    // Store message event (for tracking message activity)
    await client.query(`
      INSERT INTO account_events (
        event_type,
        account_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      'message',
      sender,
      0, // No amount for message events
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'message' };
  } catch (error) {
    console.error('Error handling message:', error);
    return { success: false, error: error.message, event_type: 'message' };
  }
}

/**
 * Handle mint event
 * Tracks token minting (inflation, bonded ratio, etc.)
 */
async function handleMint(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      amount,
      bonded_ratio,
      inflation,
      annual_provisions,
      mode,
      metadata
    } = event;
    
    // Store mint event
    await client.query(`
      INSERT INTO mint_events (
        amount,
        bonded_ratio,
        inflation,
        annual_provisions,
        mode,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      extractAmount(amount),
      bonded_ratio ? parseFloat(bonded_ratio) : null,
      inflation ? parseFloat(inflation) : null,
      annual_provisions ? extractAmount(annual_provisions) : null,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'mint' };
  } catch (error) {
    console.error('Error handling mint:', error);
    return { success: false, error: error.message, event_type: 'mint' };
  }
}

/**
 * Handle commission event
 * Tracks validator commission payments
 */
async function handleCommission(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      validator,
      amount,
      mode,
      metadata
    } = event;
    
    // Store commission event
    await client.query(`
      INSERT INTO validator_events (
        event_type,
        validator_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      'commission',
      validator,
      extractAmount(amount),
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'commission' };
  } catch (error) {
    console.error('Error handling commission:', error);
    return { success: false, error: error.message, event_type: 'commission' };
  }
}

/**
 * Handle rewards event
 * Tracks validator rewards
 */
async function handleRewards(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      validator,
      amount,
      mode,
      metadata
    } = event;
    
    // Store rewards event
    await client.query(`
      INSERT INTO validator_events (
        event_type,
        validator_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      'rewards',
      validator,
      extractAmount(amount),
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'rewards' };
  } catch (error) {
    console.error('Error handling rewards:', error);
    return { success: false, error: error.message, event_type: 'rewards' };
  }
}

module.exports = {
  handleCoinSpent,
  handleCoinReceived,
  handleTransfer,
  handleMessage,
  handleMint,
  handleCommission,
  handleRewards
};

