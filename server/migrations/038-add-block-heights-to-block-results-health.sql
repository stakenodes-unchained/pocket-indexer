-- Migration 038: Add block height tracking to block results worker health table
-- Adds current_block_height and last_processed_block_height columns for monitoring worker progress

ALTER TABLE health_block_results_worker ADD COLUMN IF NOT EXISTS current_block_height BIGINT;
ALTER TABLE health_block_results_worker ADD COLUMN IF NOT EXISTS last_processed_block_height BIGINT;

CREATE INDEX IF NOT EXISTS idx_health_block_results_worker_current_height ON health_block_results_worker(rpc_name, current_block_height DESC);
CREATE INDEX IF NOT EXISTS idx_health_block_results_worker_last_processed_height ON health_block_results_worker(rpc_name, last_processed_block_height DESC);

COMMENT ON COLUMN health_block_results_worker.current_block_height IS 'Block height currently being processed (or highest queued block) at snapshot time';
COMMENT ON COLUMN health_block_results_worker.last_processed_block_height IS 'Last successfully processed block height at snapshot time';

