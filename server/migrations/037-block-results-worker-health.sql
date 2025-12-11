-- Migration 037: Block Results Worker Health Monitoring
-- Creates table for tracking block results worker health and performance metrics

CREATE TABLE IF NOT EXISTS health_block_results_worker (
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rpc_name TEXT NOT NULL,
  queue_size INTEGER NOT NULL DEFAULT 0,
  delayed_items INTEGER NOT NULL DEFAULT 0,
  processing_items INTEGER NOT NULL DEFAULT 0,
  processed_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  success_rate NUMERIC,
  avg_processing_time_ms NUMERIC,
  worker_status TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_health_block_results_worker_ts ON health_block_results_worker(ts DESC);
CREATE INDEX IF NOT EXISTS idx_health_block_results_worker_rpc_ts ON health_block_results_worker(rpc_name, ts DESC);

COMMENT ON TABLE health_block_results_worker IS 'Time-series health metrics for block results workers';
COMMENT ON COLUMN health_block_results_worker.ts IS 'Timestamp of the snapshot';
COMMENT ON COLUMN health_block_results_worker.rpc_name IS 'RPC endpoint name';
COMMENT ON COLUMN health_block_results_worker.queue_size IS 'Number of items in the main queue';
COMMENT ON COLUMN health_block_results_worker.delayed_items IS 'Number of items in the delayed retry queue';
COMMENT ON COLUMN health_block_results_worker.processing_items IS 'Number of items currently being processed';
COMMENT ON COLUMN health_block_results_worker.processed_count IS 'Total number of successfully processed items (cumulative)';
COMMENT ON COLUMN health_block_results_worker.failed_count IS 'Total number of failed items (cumulative)';
COMMENT ON COLUMN health_block_results_worker.success_rate IS 'Success rate percentage (processed / (processed + failed))';
COMMENT ON COLUMN health_block_results_worker.avg_processing_time_ms IS 'Average processing time per item in milliseconds';
COMMENT ON COLUMN health_block_results_worker.worker_status IS 'Worker status: running, stopped, error';

