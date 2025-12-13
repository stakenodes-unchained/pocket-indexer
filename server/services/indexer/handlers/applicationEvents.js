/**
 * Application Event Handlers
 * Handles all application-related events (staking, unbonding, transfers, etc.)
 */

const { connectClients, pgPool } = require('../db');

/**
 * Handle EventApplicationStaked
 * Updates application state (is_active, stake), creates lifecycle event
 */
async function handleApplicationStaked(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const { application, session_end_height, metadata } = event;
    
    if (!application || !application.address) {
      return { success: false, error: 'Missing application data', event_type: 'EventApplicationStaked' };
    }
    
    const address = application.address;
    const stakedAmount = application.stake?.amount || '0';
    const stakeDenom = application.stake?.denom || 'upokt';
    
    // Update application state
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
      parseFloat(stakedAmount) || 0,
      stakeDenom,
      metadata.block_timestamp,
      address
    ]);
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        session_end_height,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      'application',
      address,
      'staked',
      session_end_height,
      JSON.stringify(application),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventApplicationStaked' };
  } catch (error) {
    console.error('Error handling EventApplicationStaked:', error);
    return { success: false, error: error.message, event_type: 'EventApplicationStaked' };
  }
}

/**
 * Handle EventRedelegation
 * Updates application delegations, creates lifecycle event
 */
async function handleRedelegation(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const { application, session_end_height, metadata } = event;
    
    if (!application || !application.address) {
      return { success: false, error: 'Missing application data', event_type: 'EventRedelegation' };
    }
    
    const address = application.address;
    const delegateeGateways = application.delegatee_gateway_addresses || [];
    
    // Update application delegations
    // Note: This assumes we have a delegations table or handle it in applications table
    await client.query(`
      UPDATE applications 
      SET 
        delegatee_gateway_addresses = $1,
        last_seen = $2
      WHERE 
        address = $3
    `, [
      JSON.stringify(delegateeGateways),
      metadata.block_timestamp,
      address
    ]);
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        session_end_height,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      'application',
      address,
      'redelegation',
      session_end_height,
      JSON.stringify(application),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventRedelegation' };
  } catch (error) {
    console.error('Error handling EventRedelegation:', error);
    return { success: false, error: error.message, event_type: 'EventRedelegation' };
  }
}

/**
 * Handle EventTransferBegin
 * Creates lifecycle event for transfer start
 */
async function handleTransferBegin(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      source_address,
      destination_address,
      source_application,
      session_end_height,
      transfer_end_height,
      metadata
    } = event;
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        session_end_height,
        transfer_source_address,
        transfer_destination_address,
        transfer_end_height,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      'application',
      source_address,
      'transfer_begin',
      session_end_height,
      source_address,
      destination_address,
      transfer_end_height,
      source_application ? JSON.stringify(source_application) : null,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventTransferBegin' };
  } catch (error) {
    console.error('Error handling EventTransferBegin:', error);
    return { success: false, error: error.message, event_type: 'EventTransferBegin' };
  }
}

/**
 * Handle EventTransferEnd
 * Creates lifecycle event for transfer completion
 */
async function handleTransferEnd(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      source_address,
      destination_address,
      destination_application,
      session_end_height,
      transfer_end_height,
      metadata
    } = event;
    
    // Update destination application
    if (destination_application && destination_application.address) {
      await client.query(`
        UPDATE applications 
        SET 
          address = $1,
          staked_amount = $2,
          stake_denom = $3,
          status = 'staked',
          last_seen = $4
        WHERE 
          address = $1
      `, [
        destination_application.address,
        parseFloat(destination_application.stake?.amount || '0'),
        destination_application.stake?.denom || 'upokt',
        metadata.block_timestamp
      ]);
    }
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        session_end_height,
        transfer_source_address,
        transfer_destination_address,
        transfer_end_height,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      'application',
      destination_address,
      'transfer_end',
      session_end_height,
      source_address,
      destination_address,
      transfer_end_height,
      destination_application ? JSON.stringify(destination_application) : null,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventTransferEnd' };
  } catch (error) {
    console.error('Error handling EventTransferEnd:', error);
    return { success: false, error: error.message, event_type: 'EventTransferEnd' };
  }
}

/**
 * Handle EventTransferError
 * Creates lifecycle event for transfer failure
 */
async function handleTransferError(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      source_address,
      destination_address,
      source_application,
      session_end_height,
      error: errorMessage,
      metadata
    } = event;
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        session_end_height,
        transfer_source_address,
        transfer_destination_address,
        error_message,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      'application',
      source_address,
      'transfer_error',
      session_end_height,
      source_address,
      destination_address,
      errorMessage,
      source_application ? JSON.stringify(source_application) : null,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventTransferError' };
  } catch (error) {
    console.error('Error handling EventTransferError:', error);
    return { success: false, error: error.message, event_type: 'EventTransferError' };
  }
}

/**
 * Handle EventApplicationUnbondingBegin
 * Updates application unbonding status, creates lifecycle event
 */
async function handleApplicationUnbondingBegin(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      application,
      reason,
      session_end_height,
      unbonding_end_height,
      metadata
    } = event;
    
    if (!application || !application.address) {
      return { success: false, error: 'Missing application data', event_type: 'EventApplicationUnbondingBegin' };
    }
    
    const address = application.address;
    
    // Update application unbonding status
    await client.query(`
      UPDATE applications 
      SET 
        unstake_session_end_height = $1,
        status = 'unstake_requested',
        last_seen = $2
      WHERE 
        address = $3
    `, [
      unbonding_end_height,
      metadata.block_timestamp,
      address
    ]);
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        reason,
        session_end_height,
        unbonding_end_height,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      'application',
      address,
      'unbonding_begin',
      reason,
      session_end_height,
      unbonding_end_height,
      JSON.stringify(application),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventApplicationUnbondingBegin' };
  } catch (error) {
    console.error('Error handling EventApplicationUnbondingBegin:', error);
    return { success: false, error: error.message, event_type: 'EventApplicationUnbondingBegin' };
  }
}

/**
 * Handle EventApplicationUnbondingEnd
 * Updates application unbonding completion, creates lifecycle event
 */
async function handleApplicationUnbondingEnd(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      application,
      reason,
      session_end_height,
      unbonding_end_height,
      metadata
    } = event;
    
    if (!application || !application.address) {
      return { success: false, error: 'Missing application data', event_type: 'EventApplicationUnbondingEnd' };
    }
    
    const address = application.address;
    
    // Update application - unbonding complete, set inactive
    await client.query(`
      UPDATE applications 
      SET 
        status = 'unstaked',
        last_seen = $1
      WHERE 
        address = $2
    `, [
      metadata.block_timestamp,
      address
    ]);
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        reason,
        session_end_height,
        unbonding_end_height,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      'application',
      address,
      'unbonding_end',
      reason,
      session_end_height,
      unbonding_end_height,
      JSON.stringify(application),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventApplicationUnbondingEnd' };
  } catch (error) {
    console.error('Error handling EventApplicationUnbondingEnd:', error);
    return { success: false, error: error.message, event_type: 'EventApplicationUnbondingEnd' };
  }
}

/**
 * Handle EventApplicationUnbondingCanceled
 * Updates application unbonding cancellation, creates lifecycle event
 */
async function handleApplicationUnbondingCanceled(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      application,
      session_end_height,
      metadata
    } = event;
    
    if (!application || !application.address) {
      return { success: false, error: 'Missing application data', event_type: 'EventApplicationUnbondingCanceled' };
    }
    
    const address = application.address;
    
    // Update application - cancel unbonding, reactivate
    await client.query(`
      UPDATE applications 
      SET 
        unstake_session_end_height = NULL,
        status = 'staked',
        last_seen = $1
      WHERE 
        address = $2
    `, [
      metadata.block_timestamp,
      address
    ]);
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        session_end_height,
        entity_data,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      'application',
      address,
      'unbonding_canceled',
      session_end_height,
      JSON.stringify(application),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventApplicationUnbondingCanceled' };
  } catch (error) {
    console.error('Error handling EventApplicationUnbondingCanceled:', error);
    return { success: false, error: error.message, event_type: 'EventApplicationUnbondingCanceled' };
  }
}

module.exports = {
  handleApplicationStaked,
  handleRedelegation,
  handleTransferBegin,
  handleTransferEnd,
  handleTransferError,
  handleApplicationUnbondingBegin,
  handleApplicationUnbondingEnd,
  handleApplicationUnbondingCanceled
};

