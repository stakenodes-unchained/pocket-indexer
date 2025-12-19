/**
 * Proof Event Handlers
 * Handles all proof-related events (claim created/updated, proof submitted/updated, proof validation)
 */

const { connectClients, pgPool } = require('../db');

/**
 * Helper to create session ID
 */
function createSessionId(supplierAddress, applicationAddress, serviceId, sessionEndHeight) {
  return `${supplierAddress}:${applicationAddress}:${serviceId}:${sessionEndHeight}`;
}

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
 * Handle EventClaimCreated
 * Creates/updates claim record, creates proof event
 */
async function handleClaimCreated(event) {
  try {
    await connectClients();
    const client = pgPool;
    
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
      metadata
    } = event;
    
    // Note: Claims are typically created from messages, but we can update them from events
    // This ensures we have the compute units and relays from events
    
    // Create proof event
    const sessionId = createSessionId(
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    );
    
    await client.query(`
      INSERT INTO proof_events (
        session_id,
        supplier_operator_address,
        event_type,
        num_relays,
        num_claimed_compute_units,
        num_estimated_compute_units,
        claimed_upokt,
        service_id,
        application_address,
        session_end_block_height,
        claim_proof_status_int,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      sessionId,
      supplier_operator_address,
      'created',
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      parseUpokt(claimed_upokt),
      service_id,
      application_address,
      session_end_block_height,
      claim_proof_status_int,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    // Update claim if it exists
    await client.query(`
      UPDATE claims 
      SET 
        num_relays = COALESCE($1, num_relays),
        num_claimed_compute_units = COALESCE($2, num_claimed_compute_units),
        num_estimated_compute_units = COALESCE($3, num_estimated_compute_units),
        claimed_upokt = COALESCE($4, claimed_upokt),
        claim_proof_status_int = COALESCE($5, claim_proof_status_int)
      WHERE 
        supplier_operator_address = $6
        AND application_address = $7
        AND service_id = $8
        AND session_end_block_height = $9
    `, [
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
    
    return { success: true, event_type: 'EventClaimCreated' };
  } catch (error) {
    console.error('Error handling EventClaimCreated:', error);
    return { success: false, error: error.message, event_type: 'EventClaimCreated' };
  }
}

/**
 * Handle EventClaimUpdated
 * Updates claim record, creates proof event
 */
async function handleClaimUpdated(event) {
  try {
    await connectClients();
    const client = pgPool;
    
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
      metadata
    } = event;
    
    const sessionId = createSessionId(
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    );
    
    // Create proof event
    await client.query(`
      INSERT INTO proof_events (
        session_id,
        supplier_operator_address,
        event_type,
        num_relays,
        num_claimed_compute_units,
        num_estimated_compute_units,
        claimed_upokt,
        service_id,
        application_address,
        session_end_block_height,
        claim_proof_status_int,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      sessionId,
      supplier_operator_address,
      'updated',
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      parseUpokt(claimed_upokt),
      service_id,
      application_address,
      session_end_block_height,
      claim_proof_status_int,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    // Update claim
    await client.query(`
      UPDATE claims 
      SET 
        num_relays = COALESCE($1, num_relays),
        num_claimed_compute_units = COALESCE($2, num_claimed_compute_units),
        num_estimated_compute_units = COALESCE($3, num_estimated_compute_units),
        claimed_upokt = COALESCE($4, claimed_upokt),
        claim_proof_status_int = COALESCE($5, claim_proof_status_int)
      WHERE 
        supplier_operator_address = $6
        AND application_address = $7
        AND service_id = $8
        AND session_end_block_height = $9
    `, [
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
    
    return { success: true, event_type: 'EventClaimUpdated' };
  } catch (error) {
    console.error('Error handling EventClaimUpdated:', error);
    return { success: false, error: error.message, event_type: 'EventClaimUpdated' };
  }
}

/**
 * Handle EventProofSubmitted
 * Updates proof_submissions (already handled in existing code, but we can create proof event)
 */
async function handleProofSubmitted(event) {
  try {
    await connectClients();
    const client = pgPool;
    
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
      metadata
    } = event;
    
    const sessionId = createSessionId(
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    );
    
    // Create proof event
    await client.query(`
      INSERT INTO proof_events (
        session_id,
        supplier_operator_address,
        event_type,
        num_relays,
        num_claimed_compute_units,
        num_estimated_compute_units,
        claimed_upokt,
        service_id,
        application_address,
        session_end_block_height,
        claim_proof_status_int,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      sessionId,
      supplier_operator_address,
      'submitted',
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      parseUpokt(claimed_upokt),
      service_id,
      application_address,
      session_end_block_height,
      claim_proof_status_int,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventProofSubmitted' };
  } catch (error) {
    console.error('Error handling EventProofSubmitted:', error);
    return { success: false, error: error.message, event_type: 'EventProofSubmitted' };
  }
}

/**
 * Handle EventProofUpdated
 * Updates proof, creates proof event
 */
async function handleProofUpdated(event) {
  try {
    await connectClients();
    const client = pgPool;
    
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
      metadata
    } = event;
    
    const sessionId = createSessionId(
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    );
    
    // Create proof event
    await client.query(`
      INSERT INTO proof_events (
        session_id,
        supplier_operator_address,
        event_type,
        num_relays,
        num_claimed_compute_units,
        num_estimated_compute_units,
        claimed_upokt,
        service_id,
        application_address,
        session_end_block_height,
        claim_proof_status_int,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      sessionId,
      supplier_operator_address,
      'updated',
      num_relays,
      num_claimed_compute_units,
      num_estimated_compute_units,
      parseUpokt(claimed_upokt),
      service_id,
      application_address,
      session_end_block_height,
      claim_proof_status_int,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    return { success: true, event_type: 'EventProofUpdated' };
  } catch (error) {
    console.error('Error handling EventProofUpdated:', error);
    return { success: false, error: error.message, event_type: 'EventProofUpdated' };
  }
}

/**
 * Handle EventProofValidityChecked
 * Updates proof validation status, creates proof event
 */
async function handleProofValidityChecked(event) {
  try {
    await connectClients();
    const client = pgPool;
    
    let {
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height,
      claim_proof_status_int,
      failure_reason,
      metadata
    } = event;
    
    // If supplier_operator_address is missing, try to look it up from existing claims or proof_submissions
    if (!supplier_operator_address && application_address && service_id && session_end_block_height) {
      const lookupResult = await client.query(`
        SELECT supplier_operator_address 
        FROM claims 
        WHERE application_address = $1 
          AND service_id = $2 
          AND session_end_block_height = $3 
        LIMIT 1
      `, [application_address, service_id, session_end_block_height]);
      
      if (lookupResult.rows.length > 0 && lookupResult.rows[0].supplier_operator_address) {
        supplier_operator_address = lookupResult.rows[0].supplier_operator_address;
      } else {
        // Try proof_submissions table as fallback
        const proofLookup = await client.query(`
          SELECT supplier_operator_address 
          FROM proof_submissions 
          WHERE application_address = $1 
            AND service_id = $2 
            AND session_end_block_height = $3 
          LIMIT 1
        `, [application_address, service_id, session_end_block_height]);
        
        if (proofLookup.rows.length > 0 && proofLookup.rows[0].supplier_operator_address) {
          supplier_operator_address = proofLookup.rows[0].supplier_operator_address;
        }
      }
    }
    
    // Skip insert if supplier_operator_address is still missing (required field)
    if (!supplier_operator_address) {
      console.warn('EventProofValidityChecked: Missing supplier_operator_address, skipping proof_events insert', {
        application_address,
        service_id,
        session_end_block_height,
        block_height: metadata.block_height,
        event_attributes: event.attributes || 'N/A'
      });
      return { success: false, error: 'Missing supplier_operator_address', event_type: 'EventProofValidityChecked' };
    }
    
    // Also check if we have minimum required fields for session_id creation
    if (!application_address || !service_id || !session_end_block_height) {
      console.warn('EventProofValidityChecked: Missing required fields for session_id, skipping proof_events insert', {
        supplier_operator_address,
        application_address,
        service_id,
        session_end_block_height,
        block_height: metadata.block_height
      });
      return { success: false, error: 'Missing required fields for session_id', event_type: 'EventProofValidityChecked' };
    }
    
    const sessionId = createSessionId(
      supplier_operator_address,
      application_address,
      service_id,
      session_end_block_height
    );
    
    // Create proof event
    await client.query(`
      INSERT INTO proof_events (
        session_id,
        supplier_operator_address,
        event_type,
        service_id,
        application_address,
        session_end_block_height,
        claim_proof_status_int,
        failure_reason,
        block_height,
        transaction_hash,
        chain,
        created_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      sessionId,
      supplier_operator_address,
      'validated',
      service_id,
      application_address,
      session_end_block_height,
      claim_proof_status_int,
      failure_reason,
      metadata.block_height,
      metadata.transaction_hash,
      metadata.chain || null,
      metadata.created_timestamp
    ]);
    
    // Update claim status based on validation
    if (failure_reason) {
      // Proof is invalid
      await client.query(`
        UPDATE claims 
        SET 
          claim_proof_status_int = $1,
          status = 'proof_invalid'
        WHERE 
          supplier_operator_address = $2
          AND application_address = $3
          AND service_id = $4
          AND session_end_block_height = $5
      `, [
        claim_proof_status_int,
        supplier_operator_address,
        application_address,
        service_id,
        session_end_block_height
      ]);
    } else {
      // Proof is valid
      await client.query(`
        UPDATE claims 
        SET 
          claim_proof_status_int = $1,
          status = 'proof_validated'
        WHERE 
          supplier_operator_address = $2
          AND application_address = $3
          AND service_id = $4
          AND session_end_block_height = $5
      `, [
        claim_proof_status_int,
        supplier_operator_address,
        application_address,
        service_id,
        session_end_block_height
      ]);
    }
    
    return { success: true, event_type: 'EventProofValidityChecked' };
  } catch (error) {
    console.error('Error handling EventProofValidityChecked:', error);
    return { success: false, error: error.message, event_type: 'EventProofValidityChecked' };
  }
}

module.exports = {
  handleClaimCreated,
  handleClaimUpdated,
  handleProofSubmitted,
  handleProofUpdated,
  handleProofValidityChecked
};

