-- Add relays table for tracking relay proofs
CREATE TABLE IF NOT EXISTS relays (
  id SERIAL PRIMARY KEY,
  supplier_address TEXT,
  application_address TEXT,
  session_id TEXT,
  chain TEXT,
  proof TEXT,
  timestamp TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add governance table for tracking governance actions
CREATE TABLE IF NOT EXISTS governance (
  id SERIAL PRIMARY KEY,
  proposer TEXT,
  proposal_id INTEGER,
  proposal_type TEXT,
  status TEXT,
  timestamp TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_relays_supplier ON relays(supplier_address);
CREATE INDEX IF NOT EXISTS idx_relays_application ON relays(application_address);
CREATE INDEX IF NOT EXISTS idx_relays_chain ON relays(chain);
CREATE INDEX IF NOT EXISTS idx_relays_timestamp ON relays(timestamp);

CREATE INDEX IF NOT EXISTS idx_governance_proposer ON governance(proposer);
CREATE INDEX IF NOT EXISTS idx_governance_proposal_id ON governance(proposal_id);
CREATE INDEX IF NOT EXISTS idx_governance_status ON governance(status);
CREATE INDEX IF NOT EXISTS idx_governance_timestamp ON governance(timestamp);

-- Add unique constraint for relay proofs to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_relays_unique ON relays(supplier_address, application_address, session_id, chain, timestamp);

-- Add unique constraint for governance proposals
CREATE UNIQUE INDEX IF NOT EXISTS idx_governance_unique ON governance(proposal_id, proposer, timestamp); 