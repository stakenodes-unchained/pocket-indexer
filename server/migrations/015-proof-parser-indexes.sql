-- Migration 015: Add indexes for proof parser performance optimization
-- These indexes optimize queries for proof submission processing

-- Composite index for filtering by chain and type (for proof parser)
-- This optimizes: WHERE chain = $1 AND type IN ('MsgSubmitProof', 'MsgCreateClaim', 'unknown')
CREATE INDEX IF NOT EXISTS idx_transactions_chain_type ON transactions(chain, type);

-- Composite index for chain, type, and timestamp ordering
-- This optimizes: WHERE chain = $1 AND type IN (...) ORDER BY timestamp ASC
CREATE INDEX IF NOT EXISTS idx_transactions_chain_type_timestamp ON transactions(chain, type, timestamp);

-- Index on proof_submissions for the NOT EXISTS check
-- This optimizes: WHERE ps.transaction_hash = t.hash AND ps.chain = t.chain
CREATE INDEX IF NOT EXISTS idx_proof_submissions_hash_chain ON proof_submissions(transaction_hash, chain);

