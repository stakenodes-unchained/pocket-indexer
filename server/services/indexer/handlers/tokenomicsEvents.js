/**
 * Tokenomics Event Handlers
 * Handles all tokenomics-related events (claim settlements, slashes, burns, etc.)
 */

const { connectClients, pgClient } = require('../db');

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
 * Helper to create session ID from claim data
 */
function createSessionId(supplierAddress, applicationAddress, serviceId, sessionEndHeight) {
  return `${supplierAddress}:${applicationAddress}:${serviceId}:${sessionEndHeight}`;
}

/**
 * Handle EventClaimSettled
 * Updates claim status, creates settlement record, creates reward distributions
 */
async function handleClaimSettled(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height,
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      claimed_upokt,
      claim_proof_status_int,
      reward_distribution,
      metadata
    } = event;
    
    const sessionId = createSessionId(
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    );
    
    // Update claim status
    await client.query(`
      UPDATE claims 
      SET 
        settlement_status = 'settled',
        settlement_block_height = $1,
        num_relays = COALESCE($2, num_relays),
        num_claimed_compute_units = COALESCE($3, num_claimed_compute_units),
        num_estimated_compute_units = COALESCE($4, num_estimated_compute_units),
        claimed_upokt = COALESCE($5, claimed_upokt),
        claim_proof_status_int = COALESCE($6, claim_proof_status_int)
      WHERE 
        supplier_operator_address = $7
        AND application_address = $8
        AND service_id = $9
        AND session_end_block_height = $10
    `, [
      metadata.block_height,
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      claimed_upokt,
      claim_proof_status_int,
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    ]);
    
    // Create claim settlement record
    const settlementResult = await client.query(`
      INSERT INTO claim_settlements (
        session_id,
        supplier_operator_address,
        application_address,
        service_id,
        session_end_block_height,
        settlement_type,
        proof_requirement_int,
        num_relays,
        num_claimed_compute_units,
        num_estimated_compute_units,
        claimed_upokt,
        claim_proof_status_int,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (session_id, supplier_operator_address) 
      DO UPDATE SET
        settlement_type = EXCLUDED.settlement_type,
        num_relays = EXCLUDED.num_relays,
        num_claimed_compute_units = EXCLUDED.num_claimed_compute_units,
        num_estimated_compute_units = EXCLUDED.num_estimated_compute_units,
        claimed_upokt = EXCLUDED.claimed_upokt,
        claim_proof_status_int = EXCLUDED.claim_proof_status_int,
        block_height = EXCLUDED.block_height,
        transaction_hash = EXCLUDED.transaction_hash
      RETURNING id
    `, [
      sessionId,
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height,
      'settled',
      event.proof_requirement_int || null,
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      parseUpokt(claimed_upokt),
      claim_proof_status_int,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    const settlementId = settlementResult.rows[0]?.id;
    
    // Create reward distribution records
    if (reward_distribution && typeof reward_distribution === 'object' && settlementId) {
      for (const [recipientAddress, amount] of Object.entries(reward_distribution)) {
        await client.query(`
          INSERT INTO reward_distributions (
            claim_settlement_id,
            recipient_address,
            amount,
            block_height,
            transaction_hash,
            created_timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `, [
          settlementId,
          recipientAddress,
          parseUpokt(amount),
          metadata.block_height,
          metadata.transaction_hash,
          metadata.created_timestamp
        ]);
      }
    }
    
    return { success: true, event_type: 'EventClaimSettled', settlement_id: settlementId };
  } catch (error) {
    console.error('Error handling EventClaimSettled:', error);
    return { success: false, error: error.message, event_type: 'EventClaimSettled' };
  }
}

/**
 * Handle EventClaimExpired
 * Updates claim status to expired
 */
async function handleClaimExpired(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height,
      expiration_reason,
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      claimed_upokt,
      claim_proof_status_int,
      metadata
    } = event;
    
    const sessionId = createSessionId(
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    );
    
    // Map expiration reason enum to string
    const expirationReasonMap = {
      0: 'EXPIRATION_REASON_UNSPECIFIED',
      1: 'PROOF_MISSING',
      2: 'PROOF_INVALID'
    };
    const expirationReasonStr = expirationReasonMap[expiration_reason] || 'EXPIRATION_REASON_UNSPECIFIED';
    
    // Update claim status
    await client.query(`
      UPDATE claims 
      SET 
        settlement_status = 'expired',
        settlement_block_height = $1,
        expiration_reason = $2,
        num_relays = COALESCE($3, num_relays),
        num_claimed_compute_units = COALESCE($4, num_claimed_compute_units),
        num_estimated_compute_units = COALESCE($5, num_estimated_compute_units),
        claimed_upokt = COALESCE($6, claimed_upokt),
        claim_proof_status_int = COALESCE($7, claim_proof_status_int)
      WHERE 
        supplier_operator_address = $8
        AND application_address = $9
        AND service_id = $10
        AND session_end_block_height = $11
    `, [
      metadata.block_height,
      expirationReasonStr,
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      claimed_upokt,
      claim_proof_status_int,
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    ]);
    
    // Create claim settlement record
    await client.query(`
      INSERT INTO claim_settlements (
        session_id,
        supplier_operator_address,
        application_address,
        service_id,
        session_end_block_height,
        settlement_type,
        expiration_reason,
        num_relays,
        num_claimed_compute_units,
        num_estimated_compute_units,
        claimed_upokt,
        claim_proof_status_int,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (session_id, supplier_operator_address) 
      DO UPDATE SET
        settlement_type = EXCLUDED.settlement_type,
        expiration_reason = EXCLUDED.expiration_reason,
        num_relays = EXCLUDED.num_relays,
        num_claimed_compute_units = EXCLUDED.num_claimed_compute_units,
        num_estimated_compute_units = EXCLUDED.num_estimated_compute_units,
        claimed_upokt = EXCLUDED.claimed_upokt,
        claim_proof_status_int = EXCLUDED.claim_proof_status_int,
        block_height = EXCLUDED.block_height,
        transaction_hash = EXCLUDED.transaction_hash
    `, [
      sessionId,
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height,
      'expired',
      expirationReasonStr,
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      parseUpokt(claimed_upokt),
      claim_proof_status_int,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventClaimExpired' };
  } catch (error) {
    console.error('Error handling EventClaimExpired:', error);
    return { success: false, error: error.message, event_type: 'EventClaimExpired' };
  }
}

/**
 * Handle EventSupplierSlashed
 * Creates slash record and updates supplier stake
 */
async function handleSupplierSlashed(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      supplier_operator_address,
      service_id,
      application_address,
      session_end_block_height,
      proof_missing_penalty,
      claim_proof_status_int,
      metadata
    } = event;
    
    // Create slash record
    await client.query(`
      INSERT INTO supplier_slashes (
        supplier_operator_address,
        service_id,
        application_address,
        session_end_block_height,
        proof_missing_penalty,
        claim_proof_status_int,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      supplier_operator_address,
      service_id,
      application_address,
      session_end_block_height,
      parseUpokt(proof_missing_penalty),
      claim_proof_status_int,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    // Update supplier stake (decrease by slash amount)
    await client.query(`
      UPDATE suppliers 
      SET 
        staked_amount = GREATEST(0, staked_amount - $1)
      WHERE 
        address = $2
    `, [
      parseUpokt(proof_missing_penalty),
      supplier_operator_address
    ]);
    
    return { success: true, event_type: 'EventSupplierSlashed' };
  } catch (error) {
    console.error('Error handling EventSupplierSlashed:', error);
    return { success: false, error: error.message, event_type: 'EventSupplierSlashed' };
  }
}

/**
 * Handle EventApplicationOverserviced
 * Creates overservicing record and updates application stake
 */
async function handleApplicationOverserviced(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      application_addr,
      supplier_operator_addr,
      expected_burn,
      effective_burn,
      metadata
    } = event;
    
    // Create overservicing record
    await client.query(`
      INSERT INTO application_overservicing (
        application_addr,
        supplier_operator_addr,
        expected_burn,
        effective_burn,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      application_addr,
      supplier_operator_addr,
      parseUpokt(expected_burn),
      parseUpokt(effective_burn),
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    // Update application stake (decrease by effective burn)
    await client.query(`
      UPDATE applications 
      SET 
        staked_amount = GREATEST(0, staked_amount - $1)
      WHERE 
        address = $2
    `, [
      parseUpokt(effective_burn),
      application_addr
    ]);
    
    return { success: true, event_type: 'EventApplicationOverserviced' };
  } catch (error) {
    console.error('Error handling EventApplicationOverserviced:', error);
    return { success: false, error: error.message, event_type: 'EventApplicationOverserviced' };
  }
}

/**
 * Handle EventClaimDiscarded
 * Updates claim status to discarded
 */
async function handleClaimDiscarded(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height,
      error: errorMessage,
      claim_proof_status_int,
      metadata
    } = event;
    
    const sessionId = createSessionId(
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    );
    
    // Update claim status
    await client.query(`
      UPDATE claims 
      SET 
        settlement_status = 'discarded',
        settlement_block_height = $1,
        settlement_error_message = $2,
        claim_proof_status_int = COALESCE($3, claim_proof_status_int)
      WHERE 
        supplier_operator_address = $4
        AND application_address = $5
        AND service_id = $6
        AND session_end_block_height = $7
    `, [
      metadata.block_height,
      errorMessage,
      claim_proof_status_int,
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    ]);
    
    // Create claim settlement record
    await client.query(`
      INSERT INTO claim_settlements (
        session_id,
        supplier_operator_address,
        application_address,
        service_id,
        session_end_block_height,
        settlement_type,
        error_message,
        claim_proof_status_int,
        block_height,
        transaction_hash,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (session_id, supplier_operator_address) 
      DO UPDATE SET
        settlement_type = EXCLUDED.settlement_type,
        error_message = EXCLUDED.error_message,
        claim_proof_status_int = EXCLUDED.claim_proof_status_int,
        block_height = EXCLUDED.block_height,
        transaction_hash = EXCLUDED.transaction_hash
    `, [
      sessionId,
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height,
      'discarded',
      errorMessage,
      claim_proof_status_int,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventClaimDiscarded' };
  } catch (error) {
    console.error('Error handling EventClaimDiscarded:', error);
    return { success: false, error: error.message, event_type: 'EventClaimDiscarded' };
  }
}

/**
 * Handle EventApplicationReimbursementRequest
 * Creates reimbursement request record
 */
async function handleApplicationReimbursementRequest(event) {
  try {
    await connectClients();
    const client = pgClient;
    
    const {
      application_addr,
      supplier_operator_addr,
      supplier_owner_addr,
      service_id,
      session_id,
      amount,
      metadata
    } = event;
    
    // Note: We don't have a dedicated reimbursement_requests table yet
    // For now, we can log this or create a table if needed
    // This is a placeholder implementation
    console.log('Reimbursement request:', {
      application_addr,
      supplier_operator_addr,
      supplier_owner_addr,
      service_id,
      session_id,
      amount,
      block_height: metadata.block_height
    });
    
    return { success: true, event_type: 'EventApplicationReimbursementRequest' };
  } catch (error) {
    console.error('Error handling EventApplicationReimbursementRequest:', error);
    return { success: false, error: error.message, event_type: 'EventApplicationReimbursementRequest' };
  }
}

module.exports = {
  handleClaimSettled,
  handleClaimExpired,
  handleSupplierSlashed,
  handleApplicationOverserviced,
  handleClaimDiscarded,
  handleApplicationReimbursementRequest
};

