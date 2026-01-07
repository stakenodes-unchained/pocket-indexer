-- Migration 045: Block Results Processed Tracking
-- Creates table for tracking which blocks have been processed by block_results workers

CREATE TABLE IF NOT EXISTS block_results_processed (
  chain VARCHAR(255) NOT NULL,
  height BIGINT NOT NULL,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) NOT NULL DEFAULT 'processed',
  error_message TEXT,
  PRIMARY KEY (chain, height)
);

CREATE INDEX IF NOT EXISTS idx_block_results_processed_chain_height ON block_results_processed(chain, height);
CREATE INDEX IF NOT EXISTS idx_block_results_processed_processed_at ON block_results_processed(processed_at);

COMMENT ON TABLE block_results_processed IS 'Tracks which blocks have been processed by block_results workers';
COMMENT ON COLUMN block_results_processed.chain IS 'RPC endpoint name / chain identifier';
COMMENT ON COLUMN block_results_processed.height IS 'Block height';
COMMENT ON COLUMN block_results_processed.processed_at IS 'Timestamp when block was processed';
COMMENT ON COLUMN block_results_processed.status IS 'Processing status: processed, failed, skipped';
COMMENT ON COLUMN block_results_processed.error_message IS 'Error message if processing failed';

