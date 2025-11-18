-- Migration 031: Add views for claims analytics (similar to proof_submissions views)

-- Drop and recreate views for claims rewards (hourly aggregated)
DROP VIEW IF EXISTS claim_rewards;
CREATE VIEW claim_rewards AS
SELECT 
  supplier_operator_address,
  application_address,
  service_id,
  chain,
  DATE_TRUNC('hour', timestamp) as hour_bucket,
  COUNT(*) as claim_count,
  SUM(claimed_upokt_amount) as total_rewards_upokt,
  SUM(num_relays) as total_relays,
  SUM(num_claimed_compute_units) as total_claimed_compute_units,
  SUM(num_estimated_compute_units) as total_estimated_compute_units,
  AVG(compute_unit_efficiency) as avg_efficiency_percent,
  AVG(reward_per_relay) as avg_reward_per_relay,
  MAX(claimed_upokt_amount) as max_reward_per_claim,
  MIN(claimed_upokt_amount) as min_reward_per_claim
FROM claims
WHERE claim_proof_status_int = 0  -- Only successful claims
GROUP BY supplier_operator_address, application_address, service_id, hour_bucket, chain
ORDER BY hour_bucket DESC, total_rewards_upokt DESC;

-- Drop and recreate supplier claim performance view (daily)
DROP VIEW IF EXISTS supplier_claim_performance;
CREATE VIEW supplier_claim_performance AS
SELECT 
  supplier_operator_address,
  chain,
  DATE_TRUNC('day', timestamp) as day_bucket,
  COUNT(DISTINCT application_address) as unique_applications,
  COUNT(DISTINCT service_id) as unique_services,
  COUNT(*) as total_claims,
  SUM(claimed_upokt_amount) as total_rewards_upokt,
  SUM(num_relays) as total_relays,
  AVG(compute_unit_efficiency) as avg_efficiency_percent,
  AVG(reward_per_relay) as avg_reward_per_relay,
  SUM(num_claimed_compute_units) as total_claimed_compute_units,
  SUM(num_estimated_compute_units) as total_estimated_compute_units
FROM claims
WHERE claim_proof_status_int = 0  -- Only successful claims
GROUP BY supplier_operator_address, chain, day_bucket
ORDER BY day_bucket DESC, total_rewards_upokt DESC;

-- Drop and recreate application claim usage view (daily)
DROP VIEW IF EXISTS application_claim_usage;
CREATE VIEW application_claim_usage AS
SELECT 
  application_address,
  chain,
  DATE_TRUNC('day', timestamp) as day_bucket,
  COUNT(DISTINCT supplier_operator_address) as unique_suppliers,
  COUNT(DISTINCT service_id) as unique_services,
  COUNT(*) as total_claims,
  SUM(claimed_upokt_amount) as total_rewards_upokt,
  SUM(num_relays) as total_relays,
  AVG(compute_unit_efficiency) as avg_efficiency_percent,
  AVG(reward_per_relay) as avg_reward_per_relay,
  SUM(num_claimed_compute_units) as total_claimed_compute_units,
  SUM(num_estimated_compute_units) as total_estimated_compute_units
FROM claims
WHERE claim_proof_status_int = 0  -- Only successful claims
GROUP BY application_address, chain, day_bucket
ORDER BY day_bucket DESC, total_rewards_upokt DESC;

-- Add comments for documentation
COMMENT ON VIEW claim_rewards IS 'Hourly aggregated reward and performance metrics for claims';
COMMENT ON VIEW supplier_claim_performance IS 'Daily performance metrics for suppliers based on claims including rewards and efficiency';
COMMENT ON VIEW application_claim_usage IS 'Daily usage metrics for applications based on claims including rewards and supplier relationships';

