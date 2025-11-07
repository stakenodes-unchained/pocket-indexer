-- Migration 026: Query optimizations for transaction API performance
-- Optimizes queries for 10M+ transaction datasets

-- ============================================================================
-- Covering Index for Common Query Pattern
-- ============================================================================
-- For the most common query: chain filter + timestamp sort
-- Include id in the index to enable index-only scans (covering index)
-- This allows PostgreSQL to satisfy the query entirely from the index
CREATE INDEX IF NOT EXISTS idx_transactions_chain_timestamp_desc_covering 
ON transactions(chain, timestamp DESC) 
INCLUDE (id, hash, sender, recipient, amount, fee, type, status);

-- ASC version for completeness
CREATE INDEX IF NOT EXISTS idx_transactions_chain_timestamp_asc_covering 
ON transactions(chain, timestamp ASC) 
INCLUDE (id, hash, sender, recipient, amount, fee, type, status);

-- ============================================================================
-- Optimize block_height extraction from JSONB
-- ============================================================================
-- Add a computed column for block_height to avoid expensive JSONB extraction
-- This will be much faster than extracting from JSONB on every query
ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS block_height BIGINT;

-- Create index on block_height for sorting
CREATE INDEX IF NOT EXISTS idx_transactions_block_height ON transactions(block_height);

-- Composite index for chain + block_height queries
CREATE INDEX IF NOT EXISTS idx_transactions_chain_block_height ON transactions(chain, block_height DESC);

-- ============================================================================
-- Optimize Address Filtering
-- ============================================================================
-- Composite indexes for common address filter patterns
CREATE INDEX IF NOT EXISTS idx_transactions_chain_sender_timestamp ON transactions(chain, sender, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_chain_recipient_timestamp ON transactions(chain, recipient, timestamp DESC);

-- ============================================================================
-- Optimize Type and Status Filtering with Timestamp
-- ============================================================================
-- These indexes help when filtering by type/status and sorting by timestamp
CREATE INDEX IF NOT EXISTS idx_transactions_chain_type_timestamp_desc ON transactions(chain, type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_chain_status_timestamp_desc ON transactions(chain, status, timestamp DESC);

-- ============================================================================
-- Update Statistics
-- ============================================================================
-- Update table statistics to help query planner make better decisions
ANALYZE transactions;

