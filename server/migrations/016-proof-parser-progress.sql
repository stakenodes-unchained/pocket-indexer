-- Migration 016: Add proof parser progress tracking table
-- This table tracks the last processed transaction for each chain to enable efficient restarts

CREATE TABLE IF NOT EXISTS proof_parser_progress (
  id SERIAL PRIMARY KEY,
  chain TEXT NOT NULL,
  last_processed_transaction_id TEXT NOT NULL,
  last_processed_hash TEXT NOT NULL,
  last_processed_timestamp TIMESTAMP NOT NULL,
  processed_count BIGINT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(chain)
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_proof_parser_progress_chain ON proof_parser_progress(chain);

COMMENT ON TABLE proof_parser_progress IS 'Tracks proof parser processing progress for each chain to enable efficient restarts without losing progress';
COMMENT ON COLUMN proof_parser_progress.chain IS 'The chain identifier';
COMMENT ON COLUMN proof_parser_progress.last_processed_transaction_id IS 'Last transaction id that was processed';
COMMENT ON COLUMN proof_parser_progress.last_processed_hash IS 'Hash of the last processed transaction';
COMMENT ON COLUMN proof_parser_progress.last_processed_timestamp IS 'Timestamp of the last processed transaction';
COMMENT ON COLUMN proof_parser_progress.processed_count IS 'Total number of transactions processed for this chain';

