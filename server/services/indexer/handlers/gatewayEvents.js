/**
 * Gateway Event Handlers
 * Handles all gateway-related events (staking, unbonding)
 */

const { connectClients, pgPool } = require('../db');

/**
 * Handle EventGatewayStaked
 * Updates gateway state (is_active, stake), creates lifecycle event
 */
async function handleGatewayStaked(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const { gateway, session_end_height, metadata } = event;
    
    if (!gateway || !gateway.address) {
      return { success: false, error: 'Missing gateway data', event_type: 'EventGatewayStaked' };
    }
    
    const address = gateway.address;
    const stakedAmount = gateway.stake?.amount || '0';
    const stakeDenom = gateway.stake?.denom || 'upokt';
    
    // Update gateway state
    await client.query(`
      UPDATE gateways 
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
      'gateway',
      address,
      'staked',
      session_end_height,
      JSON.stringify(gateway),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventGatewayStaked' };
  } catch (error) {
    console.error('Error handling EventGatewayStaked:', error);
    return { success: false, error: error.message, event_type: 'EventGatewayStaked' };
  }
}

/**
 * Handle EventGatewayUnbondingBegin
 * Updates gateway unbonding status, creates lifecycle event
 */
async function handleGatewayUnbondingBegin(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      gateway,
      session_end_height,
      unbonding_end_height,
      metadata
    } = event;
    
    if (!gateway || !gateway.address) {
      return { success: false, error: 'Missing gateway data', event_type: 'EventGatewayUnbondingBegin' };
    }
    
    const address = gateway.address;
    
    // Update gateway unbonding status
    await client.query(`
      UPDATE gateways 
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
        session_end_height,
        unbonding_end_height,
        entity_data,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      'gateway',
      address,
      'unbonding_begin',
      session_end_height,
      unbonding_end_height,
      JSON.stringify(gateway),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventGatewayUnbondingBegin' };
  } catch (error) {
    console.error('Error handling EventGatewayUnbondingBegin:', error);
    return { success: false, error: error.message, event_type: 'EventGatewayUnbondingBegin' };
  }
}

/**
 * Handle EventGatewayUnbondingEnd
 * Updates gateway unbonding completion, creates lifecycle event
 */
async function handleGatewayUnbondingEnd(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      gateway,
      session_end_height,
      unbonding_end_height,
      metadata
    } = event;
    
    if (!gateway || !gateway.address) {
      return { success: false, error: 'Missing gateway data', event_type: 'EventGatewayUnbondingEnd' };
    }
    
    const address = gateway.address;
    
    // Update gateway - unbonding complete, set inactive
    await client.query(`
      UPDATE gateways 
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
        session_end_height,
        unbonding_end_height,
        entity_data,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      'gateway',
      address,
      'unbonding_end',
      session_end_height,
      unbonding_end_height,
      JSON.stringify(gateway),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventGatewayUnbondingEnd' };
  } catch (error) {
    console.error('Error handling EventGatewayUnbondingEnd:', error);
    return { success: false, error: error.message, event_type: 'EventGatewayUnbondingEnd' };
  }
}

/**
 * Handle EventGatewayUnbondingCanceled
 * Updates gateway unbonding cancellation, creates lifecycle event
 */
async function handleGatewayUnbondingCanceled(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      gateway,
      session_end_height,
      metadata
    } = event;
    
    if (!gateway || !gateway.address) {
      return { success: false, error: 'Missing gateway data', event_type: 'EventGatewayUnbondingCanceled' };
    }
    
    const address = gateway.address;
    
    // Update gateway - cancel unbonding, reactivate
    await client.query(`
      UPDATE gateways 
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
      'gateway',
      address,
      'unbonding_canceled',
      session_end_height,
      JSON.stringify(gateway),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventGatewayUnbondingCanceled' };
  } catch (error) {
    console.error('Error handling EventGatewayUnbondingCanceled:', error);
    return { success: false, error: error.message, event_type: 'EventGatewayUnbondingCanceled' };
  }
}

module.exports = {
  handleGatewayStaked,
  handleGatewayUnbondingBegin,
  handleGatewayUnbondingEnd,
  handleGatewayUnbondingCanceled
};

