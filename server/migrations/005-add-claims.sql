-- Add claims table for tracking Pocket Network claims and proofs
CREATE TABLE IF NOT EXISTS claims (
  id SERIAL PRIMARY KEY,
  supplier_operator_address TEXT NOT NULL,
  application_address TEXT,
  service_id TEXT,
  session_id TEXT,
  session_start_block_height TEXT,
  session_end_block_height TEXT,
  root_hash TEXT,
  proof TEXT,
  status TEXT DEFAULT 'pending_validation',
  timestamp TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_claims_supplier ON claims(supplier_operator_address);
CREATE INDEX IF NOT EXISTS idx_claims_application ON claims(application_address);
CREATE INDEX IF NOT EXISTS idx_claims_service ON claims(service_id);
CREATE INDEX IF NOT EXISTS idx_claims_session ON claims(session_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_timestamp ON claims(timestamp);

-- Add unique constraint for claims to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_unique ON claims(supplier_operator_address, session_id, service_id, application_address); 