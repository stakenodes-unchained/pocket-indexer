-- Migration 013: Historical sync checkpoints per chain

CREATE TABLE IF NOT EXISTS historical_sync (
  chain TEXT PRIMARY KEY,
  last_height BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


