-- Migration 012: Health history time-series tables

CREATE TABLE IF NOT EXISTS health_rpc (
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,
  active_workers INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ts)
);
CREATE INDEX IF NOT EXISTS idx_health_rpc_ts ON health_rpc(ts DESC);

CREATE TABLE IF NOT EXISTS health_workers (
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chain TEXT,
  workers INTEGER NOT NULL DEFAULT 0,
  heartbeats INTEGER NOT NULL DEFAULT 0,
  avg_lag NUMERIC,
  p95_lag NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_health_workers_ts ON health_workers(ts DESC);
CREATE INDEX IF NOT EXISTS idx_health_workers_chain_ts ON health_workers(chain, ts DESC);

CREATE TABLE IF NOT EXISTS health_process (
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rss BIGINT,
  heap_used BIGINT,
  heap_total BIGINT,
  external BIGINT,
  array_buffers BIGINT,
  cpu_user_ms BIGINT,
  cpu_system_ms BIGINT
);
CREATE INDEX IF NOT EXISTS idx_health_process_ts ON health_process(ts DESC);

CREATE TABLE IF NOT EXISTS health_redis (
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_memory BIGINT,
  maxmemory BIGINT,
  instantaneous_ops_per_sec INTEGER,
  mem_fragmentation_ratio NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_health_redis_ts ON health_redis(ts DESC);

CREATE TABLE IF NOT EXISTS health_redis_keyspace (
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  db TEXT NOT NULL DEFAULT 'db0',
  keys BIGINT,
  expires BIGINT,
  avg_ttl BIGINT
);
CREATE INDEX IF NOT EXISTS idx_health_redis_keyspace_db_ts ON health_redis_keyspace(db, ts DESC);


