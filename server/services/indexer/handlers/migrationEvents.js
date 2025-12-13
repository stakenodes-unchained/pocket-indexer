/**
 * Migration Event Handlers
 * Handles Morse network migration events
 */

const { connectClients, pgPool } = require('../db');

/**
 * Helper to parse uPOKT amount string to numeric
 */
function parseUpokt(upoktString) {
  if (!upoktString) return 0;
  const str = String(upoktString);
  const match = str.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Handle EventImportMorseClaimableAccounts
 * Creates migration event record
 */
async function handleImportMorseClaimableAccounts(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      created_at_height,
      morse_account_state_hash,
      num_accounts,
      metadata
    } = event;
    
    // Create migration event
    await client.query(`
      INSERT INTO migration_events (
        event_type,
        morse_account_state_hash,
        num_accounts,
        created_at_height,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'EventImportMorseClaimableAccounts',
      morse_account_state_hash ? Buffer.from(morse_account_state_hash, 'hex') : null,
      num_accounts,
      created_at_height,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventImportMorseClaimableAccounts' };
  } catch (error) {
    console.error('Error handling EventImportMorseClaimableAccounts:', error);
    return { success: false, error: error.message, event_type: 'EventImportMorseClaimableAccounts' };
  }
}

/**
 * Handle EventMorseAccountClaimed
 * Creates migration event record
 */
async function handleMorseAccountClaimed(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      session_end_height,
      shannon_dest_address,
      morse_src_address,
      claimed_balance,
      metadata
    } = event;
    
    // Create migration event
    await client.query(`
      INSERT INTO migration_events (
        event_type,
        morse_src_address,
        shannon_dest_address,
        claimed_balance,
        session_end_height,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      'EventMorseAccountClaimed',
      morse_src_address,
      shannon_dest_address,
      parseUpokt(claimed_balance),
      session_end_height,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventMorseAccountClaimed' };
  } catch (error) {
    console.error('Error handling EventMorseAccountClaimed:', error);
    return { success: false, error: error.message, event_type: 'EventMorseAccountClaimed' };
  }
}

/**
 * Handle EventMorseApplicationClaimed
 * Creates migration event record, updates application if applicable
 */
async function handleMorseApplicationClaimed(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      session_end_height,
      morse_src_address,
      application,
      claimed_balance,
      claimed_application_stake,
      metadata
    } = event;
    
    // Create migration event
    await client.query(`
      INSERT INTO migration_events (
        event_type,
        morse_src_address,
        claimed_balance,
        claimed_application_stake,
        session_end_height,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      'EventMorseApplicationClaimed',
      morse_src_address,
      parseUpokt(claimed_balance),
      parseUpokt(claimed_application_stake),
      session_end_height,
      application ? JSON.stringify(application) : null,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    // Update application if provided
    if (application && application.address) {
      await client.query(`
        UPDATE applications 
        SET 
          staked_amount = $1,
          stake_denom = $2,
          status = 'staked',
          last_seen = $3
        WHERE 
          address = $4
      `, [
        parseFloat(application.stake?.amount || '0'),
        application.stake?.denom || 'upokt',
        metadata.block_timestamp,
        application.address
      ]);
    }
    
    return { success: true, event_type: 'EventMorseApplicationClaimed' };
  } catch (error) {
    console.error('Error handling EventMorseApplicationClaimed:', error);
    return { success: false, error: error.message, event_type: 'EventMorseApplicationClaimed' };
  }
}

/**
 * Handle EventMorseSupplierClaimed
 * Creates migration event record, updates supplier if applicable
 */
async function handleMorseSupplierClaimed(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      session_end_height,
      claimed_balance,
      morse_node_address,
      morse_output_address,
      claim_signer_type,
      claimed_supplier_stake,
      supplier,
      metadata
    } = event;
    
    // Create migration event
    await client.query(`
      INSERT INTO migration_events (
        event_type,
        morse_node_address,
        morse_output_address,
        claim_signer_type,
        claimed_balance,
        claimed_supplier_stake,
        session_end_height,
        entity_data,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      'EventMorseSupplierClaimed',
      morse_node_address,
      morse_output_address,
      claim_signer_type,
      parseUpokt(claimed_balance),
      parseUpokt(claimed_supplier_stake),
      session_end_height,
      supplier ? JSON.stringify(supplier) : null,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    // Update supplier if provided
    if (supplier) {
      const operatorAddress = supplier.operator_address || supplier.address;
      if (operatorAddress) {
        await client.query(`
          UPDATE suppliers 
          SET 
            staked_amount = $1,
            status = 'staked',
            last_seen = $2
          WHERE 
            address = $3
        `, [
          parseFloat(supplier.stake?.amount || '0'),
          metadata.block_timestamp,
          operatorAddress
        ]);
      }
    }
    
    return { success: true, event_type: 'EventMorseSupplierClaimed' };
  } catch (error) {
    console.error('Error handling EventMorseSupplierClaimed:', error);
    return { success: false, error: error.message, event_type: 'EventMorseSupplierClaimed' };
  }
}

/**
 * Handle EventMorseAccountRecovered
 * Creates migration event record
 */
async function handleMorseAccountRecovered(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      session_end_height,
      recovered_balance,
      shannon_dest_address,
      morse_src_address,
      metadata
    } = event;
    
    // Create migration event
    await client.query(`
      INSERT INTO migration_events (
        event_type,
        morse_src_address,
        shannon_dest_address,
        recovered_balance,
        session_end_height,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      'EventMorseAccountRecovered',
      morse_src_address,
      shannon_dest_address,
      parseUpokt(recovered_balance),
      session_end_height,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventMorseAccountRecovered' };
  } catch (error) {
    console.error('Error handling EventMorseAccountRecovered:', error);
    return { success: false, error: error.message, event_type: 'EventMorseAccountRecovered' };
  }
}

module.exports = {
  handleImportMorseClaimableAccounts,
  handleMorseAccountClaimed,
  handleMorseApplicationClaimed,
  handleMorseSupplierClaimed,
  handleMorseAccountRecovered
};

