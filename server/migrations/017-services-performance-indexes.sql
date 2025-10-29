-- Migration 017: Add indexes for fast service performance queries
-- These indexes optimize the top services by compute units endpoints for super-fast performance
-- Designed for endpoints: /api/v1/services/top-by-compute-units and /api/v1/services/top-by-performance

-- Primary index: Optimized for queries WITH chain filter (most common case)
-- Covers: WHERE chain = X AND claim_proof_status_int = 0 AND timestamp >= Y
-- GROUP BY service_id ORDER BY SUM(num_claimed_compute_units) DESC
-- Uses partial index (WHERE clause) to dramatically reduce index size (~99% reduction)
CREATE INDEX IF NOT EXISTS idx_proof_submissions_service_chain_perf 
ON proof_submissions(chain, claim_proof_status_int, timestamp DESC, service_id, num_claimed_compute_units DESC)
WHERE claim_proof_status_int = 0;

-- Composite index optimized for service aggregation queries with chain and time filtering
-- Covers: WHERE chain = X AND timestamp >= Y AND claim_proof_status_int = 0
-- GROUP BY service_id, chain
-- ORDER BY total_claimed_compute_units DESC
CREATE INDEX IF NOT EXISTS idx_proof_submissions_service_performance 
ON proof_submissions(chain, claim_proof_status_int, timestamp DESC, service_id)
INCLUDE (num_claimed_compute_units, num_estimated_compute_units, compute_unit_efficiency);

-- Migration 016: Add indexes for fast service performance queries
-- These indexes optimize the top services by compute units endpoints
-- If INCLUDE is not supported (PostgreSQL < 11), use this instead:
-- CREATE INDEX IF NOT EXISTS idx_proof_submissions_service_performance 
-- ON proof_submissions(chain, claim_proof_status_int, timestamp DESC, service_id, num_claimed_compute_units DESC);

-- Secondary index: For queries WITHOUT chain filter (all chains)
-- Covers: WHERE claim_proof_status_int = 0 AND timestamp >= Y
-- GROUP BY service_id, chain ORDER BY SUM(num_claimed_compute_units) DESC
CREATE INDEX IF NOT EXISTS idx_proof_submissions_service_perf 
ON proof_submissions(claim_proof_status_int, timestamp DESC, service_id, chain, num_claimed_compute_units DESC)
WHERE claim_proof_status_int = 0;
-- Alternative covering index without INCLUDE (works on all PostgreSQL versions)
CREATE INDEX IF NOT EXISTS idx_proof_submissions_service_covering 
ON proof_submissions(chain, claim_proof_status_int, service_id, timestamp DESC, num_claimed_compute_units DESC)

-- Additional index for estimated compute units aggregation (if needed)
CREATE INDEX IF NOT EXISTS idx_proof_submissions_service_estimated 
ON proof_submissions(chain, claim_proof_status_int, timestamp DESC, service_id, num_estimated_compute_units DESC)
WHERE claim_proof_status_int = 0;

-- Update statistics for query planner optimization
-- Ensures PostgreSQL query planner has up-to-date statistics for optimal index selection
ANALYZE proof_submissions;

