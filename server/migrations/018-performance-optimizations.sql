-- Migration 018: Additional performance optimizations for API endpoints
-- Fixes slow query issues (15s+ responses)

-- ============================================================================
-- Ensure all critical indexes exist for blocks endpoint
-- ============================================================================

-- Index on blocks.chain (should exist but ensuring it)
CREATE INDEX IF NOT EXISTS idx_blocks_chain ON blocks(chain);

-- Composite index for optimal blocks listing with chain
-- This is critical for WHERE chain = X ORDER BY height DESC
CREATE INDEX IF NOT EXISTS idx_blocks_chain_height_desc 
ON blocks(chain, height DESC NULLS LAST);

-- Alternative index pattern (PostgreSQL may choose based on query)
CREATE INDEX IF NOT EXISTS idx_blocks_height_chain_desc 
ON blocks(height DESC NULLS LAST, chain);

-- ============================================================================
-- Critical index for transactions JOIN (for transaction_count)
-- ============================================================================

-- This index MUST exist for fast transaction counting
CREATE INDEX IF NOT EXISTS idx_transactions_block_id 
ON transactions(block_id);

-- If not exists, create it
-- Note: This should have been in 017, but ensuring it exists

-- ============================================================================
-- Additional indexes for proof_submissions (services endpoints)
-- ============================================================================

-- Ensure timestamp index exists for date filtering
CREATE INDEX IF NOT EXISTS idx_proof_submissions_timestamp 
ON proof_submissions(timestamp DESC);

-- Composite index for chain + timestamp (very common query pattern)
CREATE INDEX IF NOT EXISTS idx_proof_submissions_chain_timestamp 
ON proof_submissions(chain, timestamp DESC);

-- ============================================================================
-- Performance settings recommendations
-- ============================================================================

-- Update statistics - CRITICAL for query planner optimization
ANALYZE blocks;
ANALYZE transactions;
ANALYZE proof_submissions;

-- Check index usage (run this manually to verify):
-- SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch 
-- FROM pg_stat_user_indexes 
-- WHERE tablename IN ('blocks', 'transactions', 'proof_submissions')
-- ORDER BY idx_scan DESC;

-- ============================================================================
-- Query optimization notes
-- ============================================================================

-- If queries are still slow, consider:
-- 1. Materialized views for frequently queried aggregations
-- 2. Partitioning large tables by timestamp
-- 3. Increasing work_mem for aggregation queries
-- 4. Using pg_stat_statements to identify slow queries

