-- Migration 014: Proof submissions timeseries table for reward tracking and performance metrics

CREATE TABLE IF NOT EXISTS proof_submissions (
  id SERIAL PRIMARY KEY,
  transaction_hash TEXT NOT NULL,
  block_height BIGINT NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  
  -- Entity relationships
  supplier_operator_address TEXT NOT NULL,
  application_address TEXT NOT NULL,
  service_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  
  -- Session information
  session_end_block_height BIGINT NOT NULL,
  msg_index INTEGER NOT NULL,
  
  -- Reward tracking
  claimed_upokt TEXT NOT NULL,
  claimed_upokt_amount NUMERIC GENERATED ALWAYS AS (
    CASE 
      WHEN claimed_upokt ~ '^[0-9]+upokt$' THEN 
        CAST(REGEXP_REPLACE(claimed_upokt, 'upokt$', '') AS NUMERIC)
      ELSE 0
    END
  ) STORED,
  
  -- Performance metrics
  num_claimed_compute_units BIGINT NOT NULL,
  num_estimated_compute_units BIGINT NOT NULL,
  num_relays BIGINT NOT NULL,
  
  -- Efficiency metrics (computed columns for analysis)
  compute_unit_efficiency NUMERIC GENERATED ALWAYS AS (
    CASE 
      WHEN num_estimated_compute_units > 0 THEN 
        ROUND((num_claimed_compute_units::NUMERIC / num_estimated_compute_units::NUMERIC) * 100, 2)
      ELSE 0
    END
  ) STORED,
  
  -- Reward per relay (upokt per relay)
  reward_per_relay NUMERIC GENERATED ALWAYS AS (
    CASE 
      WHEN num_relays > 0 THEN 
        ROUND(
          (CASE 
            WHEN claimed_upokt ~ '^[0-9]+upokt$' THEN 
              CAST(REGEXP_REPLACE(claimed_upokt, 'upokt$', '') AS NUMERIC)
            ELSE 0
          END) / num_relays::NUMERIC, 2
        )
      ELSE 0
    END
  ) STORED,
  
  -- Status tracking
  claim_proof_status_int INTEGER NOT NULL,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_proof_submissions_timestamp ON proof_submissions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_proof_submissions_supplier ON proof_submissions(supplier_operator_address);
CREATE INDEX IF NOT EXISTS idx_proof_submissions_application ON proof_submissions(application_address);
CREATE INDEX IF NOT EXISTS idx_proof_submissions_service ON proof_submissions(service_id);
CREATE INDEX IF NOT EXISTS idx_proof_submissions_block_height ON proof_submissions(block_height);
CREATE INDEX IF NOT EXISTS idx_proof_submissions_transaction_hash ON proof_submissions(transaction_hash);

-- Composite indexes for reward and performance analysis
CREATE INDEX IF NOT EXISTS idx_proof_submissions_supplier_timestamp ON proof_submissions(supplier_operator_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_proof_submissions_service_timestamp ON proof_submissions(service_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_proof_submissions_application_timestamp ON proof_submissions(application_address, timestamp DESC);

-- Indexes for reward analysis
CREATE INDEX IF NOT EXISTS idx_proof_submissions_rewards ON proof_submissions(claimed_upokt_amount DESC, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_proof_submissions_performance ON proof_submissions(num_relays DESC, compute_unit_efficiency DESC);

-- Index for timeseries queries
CREATE INDEX IF NOT EXISTS idx_proof_submissions_timeseries ON proof_submissions(timestamp DESC, service_id, supplier_operator_address);

-- Add unique constraint to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_submissions_unique ON proof_submissions(
  transaction_hash, 
  supplier_operator_address, 
  application_address, 
  service_id, 
  session_id, 
  msg_index
);

-- Index on transaction hash for easy retrieval (no foreign key constraint)
-- Note: We rely on application logic to maintain referential integrity

-- Create a view for reward analytics
CREATE OR REPLACE VIEW proof_submission_rewards AS
SELECT 
  supplier_operator_address,
  application_address,
  service_id,
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
GROUP BY supplier_operator_address, application_address, service_id, hour_bucket
ORDER BY hour_bucket DESC, total_rewards_upokt DESC;

-- Create a view for supplier performance analytics
CREATE OR REPLACE VIEW supplier_performance AS
SELECT 
  supplier_operator_address,
  DATE_TRUNC('day', timestamp) as day_bucket,
  COUNT(DISTINCT application_address) as unique_applications,
  COUNT(DISTINCT service_id) as unique_services,
  COUNT(*) as total_submissions,
  SUM(claimed_upokt_amount) as total_rewards_upokt,
  SUM(num_relays) as total_relays,
  AVG(compute_unit_efficiency) as avg_efficiency_percent,
  AVG(reward_per_relay) as avg_reward_per_relay,
  SUM(num_claimed_compute_units) as total_claimed_compute_units,
  SUM(num_estimated_compute_units) as total_estimated_compute_units
FROM proof_submissions
WHERE claim_proof_status_int = 0  -- Only successful submissions
GROUP BY supplier_operator_address, day_bucket
ORDER BY day_bucket DESC, total_rewards_upokt DESC;

-- Create a view for application usage analytics
CREATE OR REPLACE VIEW application_usage AS
SELECT 
  application_address,
  DATE_TRUNC('day', timestamp) as day_bucket,
  COUNT(DISTINCT supplier_operator_address) as unique_suppliers,
  COUNT(DISTINCT service_id) as unique_services,
  COUNT(*) as total_submissions,
  SUM(claimed_upokt_amount) as total_rewards_upokt,
  SUM(num_relays) as total_relays,
  AVG(compute_unit_efficiency) as avg_efficiency_percent,
  AVG(reward_per_relay) as avg_reward_per_relay,
  SUM(num_claimed_compute_units) as total_claimed_compute_units,
  SUM(num_estimated_compute_units) as total_estimated_compute_units
FROM proof_submissions
WHERE claim_proof_status_int = 0  -- Only successful submissions
GROUP BY application_address, day_bucket
ORDER BY day_bucket DESC, total_rewards_upokt DESC;

-- Add comments for documentation
COMMENT ON TABLE proof_submissions IS 'Timeseries data for proof submission events from Pocket Network transactions with reward and performance tracking';
COMMENT ON COLUMN proof_submissions.claimed_upokt_amount IS 'Computed column that extracts numeric value from claimed_upokt string';
COMMENT ON COLUMN proof_submissions.compute_unit_efficiency IS 'Percentage efficiency of claimed vs estimated compute units';
COMMENT ON COLUMN proof_submissions.reward_per_relay IS 'Reward amount per relay in upokt';
COMMENT ON COLUMN proof_submissions.claim_proof_status_int IS 'Status of the claim proof (0 = success, other values indicate different states)';
COMMENT ON COLUMN proof_submissions.num_relays IS 'Number of relays processed in this proof submission';
COMMENT ON COLUMN proof_submissions.num_claimed_compute_units IS 'Number of compute units claimed';
COMMENT ON COLUMN proof_submissions.num_estimated_compute_units IS 'Number of compute units estimated';

COMMENT ON VIEW proof_submission_rewards IS 'Hourly aggregated reward and performance metrics for proof submissions';
COMMENT ON VIEW supplier_performance IS 'Daily performance metrics for suppliers including rewards and efficiency';
COMMENT ON VIEW application_usage IS 'Daily usage metrics for applications including rewards and supplier relationships';
