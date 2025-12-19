/**
 * Account Event Handlers
 * Handles account-related events (coin_spent, coin_received, transfer, message, mint, commission, rewards, burn, coinbase)
 * These events track account balances, minting, and transfers for applications, suppliers, gateways, and validators
 */

const { connectClients, pgPool } = require('../db');
const { updateBalanceAndStake, parseUpokt } = require('../balanceUpdater');

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
    const client = pgPool;
    
    const {
      spender,
      amount,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    const amountValue = extractAmount(amount);
    
    // Store coin spent event
    await client.query(`
      INSERT INTO account_events (
        event_type,
        account_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'coin_spent',
      spender,
      amountValue,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Update account balance and entity stake (if entity)
    if (chain && spender) {
      await updateBalanceAndStake(
        spender,
        chain,
        -amountValue, // Debit balance
        -amountValue, // Debit stake if entity
        null, // Auto-detect entity type
        metadata.block_height,
        metadata.created_timestamp
      );
    }
    
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
    const client = pgPool;
    
    const {
      receiver,
      amount,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    const amountValue = extractAmount(amount);
    
    // Store coin received event
    await client.query(`
      INSERT INTO account_events (
        event_type,
        account_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'coin_received',
      receiver,
      amountValue,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Update account balance and entity stake (if entity)
    if (chain && receiver) {
      await updateBalanceAndStake(
        receiver,
        chain,
        amountValue, // Credit balance
        amountValue, // Credit stake if entity
        null, // Auto-detect entity type
        metadata.block_height,
        metadata.created_timestamp
      );
    }
    
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
    const client = pgPool;
    
    const {
      sender,
      recipient,
      amount,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    const amountValue = extractAmount(amount);
    
    // Store transfer event
    await client.query(`
      INSERT INTO account_transfers (
        sender_address,
        recipient_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      sender,
      recipient,
      amountValue,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Update balances for both sender and recipient
    if (chain) {
      // Debit sender
      if (sender) {
        await updateBalanceAndStake(
          sender,
          chain,
          -amountValue, // Debit balance
          -amountValue, // Debit stake if entity
          null, // Auto-detect entity type
          metadata.block_height,
          metadata.created_timestamp
        );
      }
      
      // Credit recipient
      if (recipient) {
        await updateBalanceAndStake(
          recipient,
          chain,
          amountValue, // Credit balance
          amountValue, // Credit stake if entity
          null, // Auto-detect entity type
          metadata.block_height,
          metadata.created_timestamp
        );
      }
    }
    
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
    const client = pgPool;
    
    const {
      sender,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    
    // Store message event (for tracking message activity)
    await client.query(`
      INSERT INTO account_events (
        event_type,
        account_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'message',
      sender,
      0, // No amount for message events
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Message events don't affect balances
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
    const client = pgPool;
    
    const {
      amount,
      bonded_ratio,
      inflation,
      annual_provisions,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    const amountValue = extractAmount(amount);
    
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
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      amountValue,
      bonded_ratio ? parseFloat(bonded_ratio) : null,
      inflation ? parseFloat(inflation) : null,
      annual_provisions ? extractAmount(annual_provisions) : null,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Mint events increase total supply but don't directly affect individual account balances
    // The actual balance changes come from coin_received events that follow minting
    // So we don't update balances here
    
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
    const client = pgPool;
    
    const {
      validator,
      amount,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    const amountValue = extractAmount(amount);
    
    // Store commission event
    await client.query(`
      INSERT INTO validator_events (
        event_type,
        validator_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'commission',
      validator,
      amountValue,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Update account balance and entity stake (if validator entity)
    if (chain && validator) {
      await updateBalanceAndStake(
        validator,
        chain,
        amountValue, // Credit balance
        amountValue, // Credit stake if validator entity
        null, // Auto-detect entity type
        metadata.block_height,
        metadata.created_timestamp
      );
    }
    
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
    const client = pgPool;
    
    const {
      validator,
      amount,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    const amountValue = extractAmount(amount);
    
    // Store rewards event
    await client.query(`
      INSERT INTO validator_events (
        event_type,
        validator_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'rewards',
      validator,
      amountValue,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Update account balance and entity stake (if validator entity)
    if (chain && validator) {
      await updateBalanceAndStake(
        validator,
        chain,
        amountValue, // Credit balance
        amountValue, // Credit stake if validator entity
        null, // Auto-detect entity type
        metadata.block_height,
        metadata.created_timestamp
      );
    }
    
    return { success: true, event_type: 'rewards' };
  } catch (error) {
    console.error('Error handling rewards:', error);
    return { success: false, error: error.message, event_type: 'rewards' };
  }
}

/**
 * Handle burn event
 * Tracks when tokens are burned (destroyed)
 */
async function handleBurn(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      burner,
      amount,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    const amountValue = extractAmount(amount);
    
    // Store burn event
    await client.query(`
      INSERT INTO account_events (
        event_type,
        account_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'burn',
      burner,
      amountValue,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Update account balance and entity stake (if entity)
    if (chain && burner) {
      await updateBalanceAndStake(
        burner,
        chain,
        -amountValue, // Debit balance
        -amountValue, // Debit stake if entity
        null, // Auto-detect entity type
        metadata.block_height,
        metadata.created_timestamp
      );
    }
    
    return { success: true, event_type: 'burn' };
  } catch (error) {
    console.error('Error handling burn:', error);
    return { success: false, error: error.message, event_type: 'burn' };
  }
}

/**
 * Handle coinbase event
 * Tracks coinbase transactions (block rewards)
 */
async function handleCoinbase(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      minter,
      amount,
      mode,
      metadata
    } = event;
    
    const chain = metadata.chain || null;
    const amountValue = extractAmount(amount);
    
    // Store coinbase event
    await client.query(`
      INSERT INTO account_events (
        event_type,
        account_address,
        amount,
        mode,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'coinbase',
      minter,
      amountValue,
      mode || 'Unknown',
      metadata.block_height,
      metadata.transaction_hash,
      chain,
      metadata.created_timestamp
    ]);
    
    // Update account balance and entity stake (if entity)
    if (chain && minter) {
      await updateBalanceAndStake(
        minter,
        chain,
        amountValue, // Credit balance
        amountValue, // Credit stake if entity
        null, // Auto-detect entity type
        metadata.block_height,
        metadata.created_timestamp
      );
    }
    
    return { success: true, event_type: 'coinbase' };
  } catch (error) {
    console.error('Error handling coinbase:', error);
    return { success: false, error: error.message, event_type: 'coinbase' };
  }
}

/**
 * Handle tx event
 * Tracks transaction metadata (informational only, doesn't affect balances)
 * Note: Transaction data is already stored in transactions table, so this is just for event completeness
 */
async function handleTx(event) {
  try {
    // The "tx" event is informational and contains transaction metadata
    // Since we already track transactions in the transactions table,
    // we don't need to store this event separately
    // We just acknowledge it to avoid "Unknown event type" warnings
    
    // Optionally, we could store it in account_events for completeness
    // but it's redundant with the transactions table
    
    return { success: true, event_type: 'tx', note: 'Transaction metadata already tracked in transactions table' };
  } catch (error) {
    console.error('Error handling tx:', error);
    return { success: false, error: error.message, event_type: 'tx' };
  }
}

module.exports = {
  handleCoinSpent,
  handleCoinReceived,
  handleTransfer,
  handleMessage,
  handleMint,
  handleCommission,
  handleRewards,
  handleBurn,
  handleCoinbase,
  handleTx
};

