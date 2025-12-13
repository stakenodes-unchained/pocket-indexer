/**
 * Service Event Handlers
 * Handles service-related events (relay mining difficulty updates)
 */

const { connectClients, pgPool } = require('../db');

/**
 * Handle EventRelayMiningDifficultyUpdated
 * Updates services table, creates difficulty record
 */
async function handleRelayMiningDifficultyUpdated(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    const {
      service_id,
      prev_target_hash_hex_encoded,
      new_target_hash_hex_encoded,
      prev_num_relays_ema,
      new_num_relays_ema,
      metadata
    } = event;
    
    if (!service_id) {
      return { success: false, error: 'Missing service_id', event_type: 'EventRelayMiningDifficultyUpdated' };
    }
    
    // Create difficulty record
    await client.query(`
      INSERT INTO relay_mining_difficulty (
        service_id,
        prev_target_hash_hex_encoded,
        new_target_hash_hex_encoded,
        prev_num_relays_ema,
        new_num_relays_ema,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      service_id,
      prev_target_hash_hex_encoded || null,
      new_target_hash_hex_encoded,
      prev_num_relays_ema || null,
      new_num_relays_ema,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    // Note: Update services table if it has difficulty fields
    // This is a placeholder for that update
    
    return { success: true, event_type: 'EventRelayMiningDifficultyUpdated' };
  } catch (error) {
    console.error('Error handling EventRelayMiningDifficultyUpdated:', error);
    return { success: false, error: error.message, event_type: 'EventRelayMiningDifficultyUpdated' };
  }
}

module.exports = {
  handleRelayMiningDifficultyUpdated
};

