-- Migration 033: Optimize reward analytics by converting view to materialized view
-- This migration converts proof_submission_rewards from a regular view to a materialized view
-- with indexes to achieve sub-second query performance

-- Drop the existing view
DROP VIEW IF EXISTS proof_submission_rewards;

-- Create materialized view with the same structure as the original view
CREATE MATERIALIZED VIEW proof_submission_rewards_mv AS
SELECT 
  supplier_operator_address,
  application_address,
  service_id,
  chain,
  DATE_TRUNC('hour', timestamp) as hour_bucket,
  COUNT(*) as submission_count,
  SUM(claimed_upokt_amount) as total_rewards_upokt,
  SUM(num_relays) as total_relays,
  SUM(num_claimed_compute_units) as total_claimed_compute_units,
  SUM(num_estimated_compute_units) as total_estimated_compute_units,
  AVG(compute_unit_efficiency) as avg_efficiency_percent,
  AVG(reward_per_relay) as avg_reward_per_relay,
  MAX(claimed_upokt_amount) as max_reward_per_submission,
  MIN(claimed_upokt_amount) as min_reward_per_submission
FROM proof_submissions
WHERE claim_proof_status_int = 0  -- Only successful submissions
GROUP BY supplier_operator_address, application_address, service_id, hour_bucket, chain;

-- Create indexes on the materialized view for optimal query performance
-- Primary index for ORDER BY hour_bucket DESC (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_hour_bucket 
ON proof_submission_rewards_mv(hour_bucket DESC);

-- Index for supplier filtering with hour_bucket ordering
CREATE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_supplier_hour 
ON proof_submission_rewards_mv(supplier_operator_address, hour_bucket DESC);

-- Index for chain filtering with hour_bucket ordering
CREATE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_chain_hour 
ON proof_submission_rewards_mv(chain, hour_bucket DESC);

-- Index for application filtering with hour_bucket ordering
CREATE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_application_hour 
ON proof_submission_rewards_mv(application_address, hour_bucket DESC);

-- Index for service filtering with hour_bucket ordering
CREATE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_service_hour 
ON proof_submission_rewards_mv(service_id, hour_bucket DESC);

-- Composite index for common filter combinations (chain + supplier + hour_bucket)
CREATE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_chain_supplier_hour 
ON proof_submission_rewards_mv(chain, supplier_operator_address, hour_bucket DESC);

-- Composite index for chain + application + hour_bucket
CREATE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_chain_application_hour 
ON proof_submission_rewards_mv(chain, application_address, hour_bucket DESC);

-- Composite index for chain + service + hour_bucket
CREATE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_chain_service_hour 
ON proof_submission_rewards_mv(chain, service_id, hour_bucket DESC);

-- Create unique index for CONCURRENT refresh (required for REFRESH MATERIALIZED VIEW CONCURRENTLY)
-- This index must include all columns that uniquely identify a row
CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_submission_rewards_mv_unique 
ON proof_submission_rewards_mv(supplier_operator_address, application_address, service_id, hour_bucket, chain);

-- Recreate the regular view pointing to the materialized view for backward compatibility
CREATE VIEW proof_submission_rewards AS
SELECT * FROM proof_submission_rewards_mv
ORDER BY hour_bucket DESC, total_rewards_upokt DESC;

-- Add comments for documentation
COMMENT ON MATERIALIZED VIEW proof_submission_rewards_mv IS 'Materialized view for hourly aggregated reward and performance metrics for proof submissions. Refreshed every 15 minutes for optimal performance.';
COMMENT ON VIEW proof_submission_rewards IS 'View pointing to materialized view for backward compatibility. Provides hourly aggregated reward and performance metrics for proof submissions.';

-- Perform initial refresh to populate the materialized view
-- Note: This may take some time depending on data volume
REFRESH MATERIALIZED VIEW proof_submission_rewards_mv;

