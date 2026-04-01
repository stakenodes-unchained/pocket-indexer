# API Node Setup (No Indexer, Replica + Primary Writes)

This node runs the same runtime services as your normal stack except indexer workers:
- `redis`
- `postgres-replica` (streaming standby from primary)
- `api`

The API container uses split DB routing:
- **Reads** can go to replica (`DB_READ_HOST`)
- **Writes** go to primary (`DB_WRITE_HOST`)

Fallback variables (`DB_HOST`/`DB_PORT`) still exist for services that are not yet read/write-split.

## Files

- `docker-compose.api-node.yml`
- `.env.api-replica.example`
- `scripts/replica-bootstrap.sh`
- `config/postgres/primary/postgresql.replication.conf`
- `config/postgres/primary/pg_hba.replication.conf`

## 1) Enable Replication on Primary Server

Apply settings from `config/postgres/primary/postgresql.replication.conf` into the primary `postgresql.conf`.

At minimum, set:
- `listen_addresses='*'`
- `wal_level=replica`
- `max_wal_senders=10`
- `max_replication_slots=10`
- `wal_keep_size='4GB'`

Add network rules from `config/postgres/primary/pg_hba.replication.conf` into primary `pg_hba.conf`, replacing `<replica-source-ip-or-cidr>`.
Use the source IP seen by primary in logs. For Docker Desktop on macOS, this is commonly `192.168.65.1/32`.

Create replication role on primary:

```sql
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'replace-me';
```

Restart primary PostgreSQL and verify:

```sql
SHOW wal_level;
SHOW max_wal_senders;
```

## 2) Configure API Node Environment

```bash
cp .env.api-replica.example .env.api-replica
```

Update at least:
- `PRIMARY_DB_HOST`
- `PRIMARY_DB_PORT`
- `PRIMARY_DB_REPL_USER`
- `PRIMARY_DB_REPL_PASSWORD`
- `PRIMARY_DB_SSLMODE` (`prefer`, `require`, or `disable` based on primary setup)
- `DB_USER` / `DB_PASS` / `DB_NAME`
- `DB_READ_HOST` / `DB_READ_PORT`
- `DB_WRITE_HOST` / `DB_WRITE_PORT`

## 3) Start API Node Stack

```bash
docker compose -f docker-compose.api-node.yml --env-file .env.api-replica up -d --build
```

## 4) Verify Replica and API

Replica should be read-only:

```bash
docker exec -it pocket_indexer_postgres_replica psql -U postgres -d pocket_indexer -c "SHOW transaction_read_only;"
```

Expected: `on`.

Check streaming status on primary:

```sql
SELECT client_addr, state, sync_state, application_name
FROM pg_stat_replication;
```

## Notes

- Write operations should succeed because write traffic is directed to primary DB.
- To force fresh re-clone: `docker compose -f docker-compose.api-node.yml down -v` then start again.

## Production Rollout Notes (Large Primary DB)

For large primaries (for example ~1TB) where primary and API node are on different servers:

- Initial sync (`pg_basebackup`) is the longest step and can take hours.
- Primary disk read and network usage will increase during initial clone.
- Replica lag can be high during bootstrap/catch-up, then should trend down.
- After catch-up, steady-state replication lag should usually be seconds or less.

### Pre-Production Checklist

1) Use a replication slot on primary (recommended)

```sql
SELECT * FROM pg_create_physical_replication_slot('pocket_api_node_slot');
```

Then set in `.env.api-replica`:

```bash
REPLICA_SLOT_NAME=pocket_api_node_slot
```

2) Ensure primary WAL settings are sufficient

- `wal_level=replica`
- `max_wal_senders` sized for all replicas
- `max_replication_slots` sized for all slots
- `wal_keep_size` large enough to survive temporary network/disk slowdowns

3) Validate network and disk throughput between hosts

- Stable throughput is more important than peak burst.
- Replica disk write IOPS must sustain basebackup + WAL replay.

4) Run initial clone during off-peak traffic window when possible.

### Monitor Sync Progress

On primary (connection + byte/time lag):

```sql
SELECT
  application_name,
  client_addr,
  state,
  sync_state,
  pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn)   AS sent_lag_bytes,
  pg_wal_lsn_diff(pg_current_wal_lsn(), write_lsn)  AS write_lag_bytes,
  pg_wal_lsn_diff(pg_current_wal_lsn(), flush_lsn)  AS flush_lag_bytes,
  pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes,
  write_lag,
  flush_lag,
  replay_lag
FROM pg_stat_replication;
```

On replica (recovery status + replay delay):

```sql
SELECT
  pg_is_in_recovery() AS in_recovery,
  pg_last_wal_receive_lsn() AS receive_lsn,
  pg_last_wal_replay_lsn()  AS replay_lsn,
  EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::int AS replay_delay_sec;
```

### Practical Thresholds

- Healthy: replay lag < 1-2s and byte lag stays low/flat.
- Warning: replay lag sustained above 30s.
- Critical: lag grows continuously for minutes (replica cannot keep up).

If lag grows continuously, check replica disk IOPS first, then network throughput, then primary write rate.
