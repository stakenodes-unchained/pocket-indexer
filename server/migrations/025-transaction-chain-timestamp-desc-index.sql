-- Migration 025: Add DESC index for chain + timestamp DESC queries
-- Optimizes the common query pattern: WHERE chain = ? ORDER BY timestamp DESC
-- This is the most common query pattern for transaction listings

-- Composite index for chain + timestamp DESC (most common sort order)
-- This enables fast sorting when filtering by chain and sorting by timestamp DESC
CREATE INDEX IF NOT EXISTS idx_transactions_chain_timestamp_desc ON transactions(chain, timestamp DESC);

-- Also add ASC version for completeness (though DESC is more common)
CREATE INDEX IF NOT EXISTS idx_transactions_chain_timestamp_asc ON transactions(chain, timestamp ASC);

