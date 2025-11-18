const { Client } = require('pg');

/**
 * Standalone database functions for proof-parser service
 * These functions do not require Redis connection
 */

let pgClient = null;

async function connectDB() {
  if (!pgClient) {
    pgClient = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    });
    await pgClient.connect();
    console.log('[ProofParserDB] Connected to database');
  }
}

async function bulkSaveProofSubmissions(submissions) {
  await connectDB();
  if (!Array.isArray(submissions) || submissions.length === 0) return;
  
  // Deduplicate by creating a map using the unique constraint keys
  const uniqueMap = new Map();
  for (const submission of submissions) {
    const key = `${submission.chain}_${submission.transaction_hash}_${submission.supplier_operator_address}_${submission.application_address}_${submission.service_id}_${submission.session_id}_${submission.msg_index}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, submission);
    }
  }
  const deduplicated = Array.from(uniqueMap.values());
  
  const chunkSize = 500;
  for (let i = 0; i < deduplicated.length; i += chunkSize) {
    const chunk = deduplicated.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    let p = 1;
    
    for (const s of chunk) {
      values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      params.push(
        s.transaction_hash,
        s.block_height,
        s.timestamp,
        s.chain,
        s.supplier_operator_address,
        s.application_address,
        s.service_id,
        s.session_id,
        s.session_end_block_height,
        s.claim_proof_status_int,
        s.claimed_upokt,
        s.num_claimed_compute_units,
        s.num_estimated_compute_units,
        s.num_relays,
        s.msg_index
      );
    }
    
    const sql = `INSERT INTO proof_submissions (
      transaction_hash, block_height, timestamp, chain, supplier_operator_address, 
      application_address, service_id, session_id, session_end_block_height,
      claim_proof_status_int, claimed_upokt, num_claimed_compute_units,
      num_estimated_compute_units, num_relays, msg_index
    )
    VALUES ${values.join(',')}
    ON CONFLICT (chain, transaction_hash, supplier_operator_address, application_address, service_id, session_id, msg_index) 
    DO UPDATE SET
      block_height=EXCLUDED.block_height,
      timestamp=EXCLUDED.timestamp,
      session_end_block_height=EXCLUDED.session_end_block_height,
      claim_proof_status_int=EXCLUDED.claim_proof_status_int,
      claimed_upokt=EXCLUDED.claimed_upokt,
      num_claimed_compute_units=EXCLUDED.num_claimed_compute_units,
      num_estimated_compute_units=EXCLUDED.num_estimated_compute_units,
      num_relays=EXCLUDED.num_relays`;
    
    await pgClient.query(sql, params);
  }
}

async function bulkSaveClaims(claims) {
  await connectDB();
  if (!Array.isArray(claims) || claims.length === 0) return;
  
  // Deduplicate by creating a map using the unique constraint keys
  const uniqueMap = new Map();
  for (const claim of claims) {
    const key = `${claim.supplier_operator_address}_${claim.session_id}_${claim.service_id}_${claim.application_address}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, claim);
    }
  }
  const deduplicated = Array.from(uniqueMap.values());
  
  const chunkSize = 500;
  for (let i = 0; i < deduplicated.length; i += chunkSize) {
    const chunk = deduplicated.slice(i, i + chunkSize);
    const values = [];
    const params = [];
    let p = 1;
    
    for (const c of chunk) {
      values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      params.push(
        c.supplier_operator_address,
        c.application_address,
        c.service_id,
        c.session_id,
        parseInt(c.session_start_block_height) || 0,
        parseInt(c.session_end_block_height) || 0,
        c.root_hash,
        c.proof || null,
        c.status || 'claimed',
        c.timestamp || new Date().toISOString(),
        c.chain || null,
        c.claim_proof_status_int !== undefined ? c.claim_proof_status_int : null,
        c.claimed_upokt || null,
        c.num_claimed_compute_units !== undefined ? c.num_claimed_compute_units : null,
        c.num_estimated_compute_units !== undefined ? c.num_estimated_compute_units : null,
        c.num_relays !== undefined ? c.num_relays : null
      );
    }
    
    const sql = `INSERT INTO claims (
      supplier_operator_address, application_address, service_id, session_id,
      session_start_block_height, session_end_block_height, root_hash, proof, status, timestamp, chain,
      claim_proof_status_int, claimed_upokt, num_claimed_compute_units, num_estimated_compute_units, num_relays
    )
    VALUES ${values.join(',')}
    ON CONFLICT (supplier_operator_address, session_id, service_id, application_address) DO UPDATE SET
      root_hash=EXCLUDED.root_hash,
      proof=EXCLUDED.proof,
      status=EXCLUDED.status,
      timestamp=EXCLUDED.timestamp,
      chain=EXCLUDED.chain,
      claim_proof_status_int=EXCLUDED.claim_proof_status_int,
      claimed_upokt=EXCLUDED.claimed_upokt,
      num_claimed_compute_units=EXCLUDED.num_claimed_compute_units,
      num_estimated_compute_units=EXCLUDED.num_estimated_compute_units,
      num_relays=EXCLUDED.num_relays`;
    
    await pgClient.query(sql, params);
  }
}

module.exports = {
  bulkSaveProofSubmissions,
  bulkSaveClaims,
};

