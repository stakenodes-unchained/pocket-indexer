/**
 * Supplier Event Handlers
 * Handles all supplier-related events (staking, unbonding, service config activation)
 */

const { connectClients, pgClient } = require('../db');

/**
 * Handle EventSupplierStaked
 * Updates supplier state (is_active, stake), creates lifecycle event
 */
async function handleSupplierStaked(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const { operator_address, session_end_height, metadata } = event;
    
    if (!operator_address) {
      return { success: false, error: 'Missing operator_address', event_type: 'EventSupplierStaked' };
    }
    
    // Update supplier state
    // Note: We may need to fetch supplier data from chain or use existing data
    await client.query(`
      UPDATE suppliers 
      SET 
        status = 'staked',
        last_seen = $1
      WHERE 
        address = $2
    `, [
      metadata.block_timestamp,
      operator_address
    ]);
    
    // Create lifecycle event
    await client.query(`
      INSERT INTO entity_lifecycle_events (
        entity_type,
        entity_address,
        event_type,
        session_end_height,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      'supplier',
      operator_address,
      'staked',
      session_end_height,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventSupplierStaked' };
  } catch (error) {
    console.error('Error handling EventSupplierStaked:', error);
    return { success: false, error: error.message, event_type: 'EventSupplierStaked' };
  }
}

/**
 * Handle EventSupplierUnbondingBegin
 * Updates supplier unbonding status, creates lifecycle event
 */
async function handleSupplierUnbondingBegin(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      supplier,
      reason,
      session_end_height,
      unbonding_end_height,
      metadata
    } = event;
    
    const operatorAddress = supplier?.operator_address || supplier?.address;
    
    if (!operatorAddress) {
      return { success: false, error: 'Missing supplier operator address', event_type: 'EventSupplierUnbondingBegin' };
    }
    
    // Update supplier unbonding status
    await client.query(`
      UPDATE suppliers 
      SET 
        unstake_session_end_height = $1,
        status = 'unstake_requested',
        last_seen = $2
      WHERE 
        address = $3
    `, [
      unbonding_end_height,
      metadata.block_timestamp,
      operatorAddress
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
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      'supplier',
      operatorAddress,
      'unbonding_begin',
      reason,
      session_end_height,
      unbonding_end_height,
      supplier ? JSON.stringify(supplier) : null,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventSupplierUnbondingBegin' };
  } catch (error) {
    console.error('Error handling EventSupplierUnbondingBegin:', error);
    return { success: false, error: error.message, event_type: 'EventSupplierUnbondingBegin' };
  }
}

/**
 * Handle EventSupplierUnbondingEnd
 * Updates supplier unbonding completion, creates lifecycle event
 */
async function handleSupplierUnbondingEnd(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      supplier,
      reason,
      session_end_height,
      unbonding_end_height,
      metadata
    } = event;
    
    const operatorAddress = supplier?.operator_address || supplier?.address;
    
    if (!operatorAddress) {
      return { success: false, error: 'Missing supplier operator address', event_type: 'EventSupplierUnbondingEnd' };
    }
    
    // Update supplier - unbonding complete, set inactive
    await client.query(`
      UPDATE suppliers 
      SET 
        status = 'unstaked',
        last_seen = $1
      WHERE 
        address = $2
    `, [
      metadata.block_timestamp,
      operatorAddress
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
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      'supplier',
      operatorAddress,
      'unbonding_end',
      reason,
      session_end_height,
      unbonding_end_height,
      supplier ? JSON.stringify(supplier) : null,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventSupplierUnbondingEnd' };
  } catch (error) {
    console.error('Error handling EventSupplierUnbondingEnd:', error);
    return { success: false, error: error.message, event_type: 'EventSupplierUnbondingEnd' };
  }
}

/**
 * Handle EventSupplierUnbondingCanceled
 * Updates supplier unbonding cancellation, creates lifecycle event
 */
async function handleSupplierUnbondingCanceled(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      supplier,
      height,
      session_end_height,
      metadata
    } = event;
    
    const operatorAddress = supplier?.operator_address || supplier?.address;
    
    if (!operatorAddress) {
      return { success: false, error: 'Missing supplier operator address', event_type: 'EventSupplierUnbondingCanceled' };
    }
    
    // Update supplier - cancel unbonding, reactivate
    await client.query(`
      UPDATE suppliers 
      SET 
        unstake_session_end_height = NULL,
        status = 'staked',
        last_seen = $1
      WHERE 
        address = $2
    `, [
      metadata.block_timestamp,
      operatorAddress
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
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      'supplier',
      operatorAddress,
      'unbonding_canceled',
      session_end_height,
      supplier ? JSON.stringify(supplier) : null,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventSupplierUnbondingCanceled' };
  } catch (error) {
    console.error('Error handling EventSupplierUnbondingCanceled:', error);
    return { success: false, error: error.message, event_type: 'EventSupplierUnbondingCanceled' };
  }
}

/**
 * Handle EventSupplierServiceConfigActivated
 * Updates service config activation, creates service config event
 */
async function handleSupplierServiceConfigActivated(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      operator_address,
      service_id,
      activation_height,
      metadata
    } = event;
    
    if (!operator_address || !service_id) {
      return { success: false, error: 'Missing operator_address or service_id', event_type: 'EventSupplierServiceConfigActivated' };
    }
    
    // Create service config event
    await client.query(`
      INSERT INTO service_config_events (
        supplier_operator_address,
        service_id,
        activation_height,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      operator_address,
      service_id,
      activation_height,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    // Note: We may need to update supplier_service_configs table if it exists
    // This is a placeholder for that update
    
    return { success: true, event_type: 'EventSupplierServiceConfigActivated' };
  } catch (error) {
    console.error('Error handling EventSupplierServiceConfigActivated:', error);
    return { success: false, error: error.message, event_type: 'EventSupplierServiceConfigActivated' };
  }
}

module.exports = {
  handleSupplierStaked,
  handleSupplierUnbondingBegin,
  handleSupplierUnbondingEnd,
  handleSupplierUnbondingCanceled,
  handleSupplierServiceConfigActivated
};

