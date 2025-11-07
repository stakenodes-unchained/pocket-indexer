-- Migration 024: Add indexes for transaction address filtering and optimization
-- Optimizes transaction queries with address filters, amount ranges, and sorting

-- ============================================================================
-- Address Search Indexes
-- ============================================================================

-- Index on sender column for fast sender address lookups
CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender);

-- Index on recipient column for fast recipient address lookups
CREATE INDEX IF NOT EXISTS idx_transactions_recipient ON transactions(recipient);

-- Composite index for address searches (sender OR recipient)
CREATE INDEX IF NOT EXISTS idx_transactions_sender_recipient ON transactions(sender, recipient);

-- ============================================================================
-- Amount Range Indexes
-- ============================================================================

-- Index on amount column for range queries (min_amount, max_amount filters)
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(amount);

-- ============================================================================
-- JSONB Address Search Index
-- ============================================================================

-- GIN index on tx_data JSONB for efficient JSONB path queries
-- This enables fast searches for addresses within the JSONB structure
-- The existing idx_transactions_tx_data GIN index should help, but we ensure it exists
CREATE INDEX IF NOT EXISTS idx_transactions_tx_data ON transactions USING GIN (tx_data);

-- ============================================================================
-- Composite Indexes for Common Filter Combinations
-- ============================================================================

-- Composite index for chain + sender queries
CREATE INDEX IF NOT EXISTS idx_transactions_chain_sender ON transactions(chain, sender);

-- Composite index for chain + recipient queries
CREATE INDEX IF NOT EXISTS idx_transactions_chain_recipient ON transactions(chain, recipient);

-- Composite index for chain + type queries
CREATE INDEX IF NOT EXISTS idx_transactions_chain_type ON transactions(chain, type);

-- Composite index for chain + status queries
CREATE INDEX IF NOT EXISTS idx_transactions_chain_status ON transactions(chain, status);

-- Composite index for chain + amount queries (for range filters)
CREATE INDEX IF NOT EXISTS idx_transactions_chain_amount ON transactions(chain, amount);

-- Composite index for sorting by type
CREATE INDEX IF NOT EXISTS idx_transactions_type_timestamp ON transactions(type, timestamp DESC);

-- Composite index for sorting by status
CREATE INDEX IF NOT EXISTS idx_transactions_status_timestamp ON transactions(status, timestamp DESC);

