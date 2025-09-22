-- Migration 011: Dashboard tables for jobs, runs, metrics, and heartbeats

CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL, -- sync_start, sync_stop, reprocess_range, rebuild_entities, backfill_delegations
  params JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued', -- queued, running, completed, failed, cancelled
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

CREATE TABLE IF NOT EXISTS job_runs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running', -- running, completed, failed, cancelled
  metrics JSONB DEFAULT '{}'::jsonb,
  logs_url TEXT,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status);

CREATE TABLE IF NOT EXISTS metrics_snapshots (
  id SERIAL PRIMARY KEY,
  chain TEXT NOT NULL,
  ts TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_height BIGINT,
  latest_height BIGINT,
  tx_rate NUMERIC,
  error_rate NUMERIC,
  applications BIGINT,
  suppliers BIGINT,
  gateways BIGINT,
  services BIGINT
);

CREATE INDEX IF NOT EXISTS idx_metrics_chain_ts ON metrics_snapshots(chain, ts DESC);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  last_seen TIMESTAMP NOT NULL,
  meta JSONB DEFAULT '{}'::jsonb
);


