const { Client } = require('pg');
const { getRpcEndpoints } = require('../config/rpc');
const { fetchLatestBlock } = require('./indexer/rpc');

class MetricsCollector {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 5000; // 30s default
    this.timer = null;
    this.pg = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    });
    this.pg._connected = false;
    this.rpcs = getRpcEndpoints();
    this.includeHealth = true;
  }

  async connect() {
    if (!this.pg._connected) {
      await this.pg.connect();
      this.pg._connected = true;
    }
  }

  async snapshotChain(chain, rpcUrl) {
    try {
      await this.connect();
      // Determine processed heights for parallel streams
      // 1) monitor_processed_height from latest heartbeat
      const hbRes = await this.pg.query(
        `SELECT meta FROM worker_heartbeats WHERE worker_id = $1 ORDER BY last_seen DESC LIMIT 1`,
        [chain]
      );
      let monitorProcessed = 0;
      if (hbRes.rows?.[0]?.meta) {
        const meta = hbRes.rows[0].meta;
        const v = meta && (meta.lastProcessedHeight || meta.currentHeight);
        monitorProcessed = v ? parseInt(v, 10) : 0;
      }
      // Fallback: use max block height if heartbeat not present yet
      if (!monitorProcessed || monitorProcessed <= 0) {
        const processedRes = await this.pg.query(
          `SELECT MAX(height) AS h FROM blocks WHERE chain = $1`,
          [chain]
        );
        monitorProcessed = parseInt(processedRes.rows?.[0]?.h || 0, 10);
      }
      // 2) history_processed_height from historical_sync (for diagnostics/backlog)
      const histRes = await this.pg.query(
        `SELECT last_height FROM historical_sync WHERE chain = $1`,
        [chain]
      );
      const historyProcessed = histRes.rows?.[0]?.last_height ? parseInt(histRes.rows[0].last_height, 10) : 0;

      // latest height from RPC; fallback to DB max(blocks.height) if RPC fails
      let latestHeight = 0;
      try {
        const latest = await fetchLatestBlock(rpcUrl);
        latestHeight = parseInt(latest.block.header.height, 10);
      } catch (_) {}
      if (!latestHeight || latestHeight <= 0) {
        const dbMax = await this.pg.query(
          `SELECT MAX(height) AS h FROM blocks WHERE chain = $1`,
          [chain]
        );
        latestHeight = parseInt(dbMax.rows?.[0]?.h || 0, 10);
      }

      // entity counts
      const appsRes = await this.pg.query('SELECT COUNT(*) AS c FROM applications WHERE chain = $1', [chain]);
      const supsRes = await this.pg.query('SELECT COUNT(*) AS c FROM suppliers WHERE chain = $1', [chain]);
      const gwsRes = await this.pg.query('SELECT COUNT(*) AS c FROM gateways WHERE chain = $1', [chain]);
      // services table stores advertisements; for unique services use network_services (no chain)
      const svcsRes = await this.pg.query('SELECT COUNT(*) AS c FROM network_services');

      const applications = parseInt(appsRes.rows[0].c || 0, 10);
      const suppliers = parseInt(supsRes.rows[0].c || 0, 10);
      const gateways = parseInt(gwsRes.rows[0].c || 0, 10);
      const services = parseInt(svcsRes.rows[0].c || 0, 10);

      // rough tx rate: last 5 min window
      const txRateRes = await this.pg.query(
        `SELECT COUNT(*)::float / GREATEST(EXTRACT(EPOCH FROM (NOW() - MIN(timestamp))),1) AS r
         FROM transactions WHERE chain = $1 AND timestamp >= NOW() - INTERVAL '5 minutes'`,
        [chain]
      );
      const tx_rate = parseFloat(txRateRes.rows[0].r || 0);

      // error rate proxy: failed tx in last 5 min
      const errRateRes = await this.pg.query(
        `SELECT COUNT(*)::float / NULLIF((SELECT COUNT(*) FROM transactions WHERE chain=$1 AND timestamp>= NOW()-INTERVAL '5 minutes'),0) AS e
         FROM transactions WHERE chain=$1 AND timestamp>= NOW()-INTERVAL '5 minutes' AND status <> 'true'`,
        [chain]
      );
      const error_rate = parseFloat(errRateRes.rows[0].e || 0);

      // Store monitorProcessed as processed_height for lag calculations
      await this.pg.query(
        `INSERT INTO metrics_snapshots (chain, processed_height, latest_height, tx_rate, error_rate, applications, suppliers, gateways, services)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [chain, monitorProcessed, latestHeight, tx_rate || 0, isFinite(error_rate) ? error_rate : 0, applications, suppliers, gateways, services]
      );
    } catch (e) {
      console.warn('Metrics snapshot failed for', chain, e.message);
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(async () => {
      for (const rpc of this.rpcs) {
        await this.snapshotChain(rpc.name, rpc.url);
      }
      if (this.includeHealth) {
        await this.snapshotProcess();
        await this.snapshotRedis();
        await this.snapshotRpc();
        await this.snapshotWorkers();
        await this.snapshotBlockResultsWorkers();
      }
    }, this.intervalMs);
    // Kick immediately
    (async () => {
      for (const rpc of this.rpcs) {
        await this.snapshotChain(rpc.name, rpc.url);
      }
      if (this.includeHealth) {
        await this.snapshotProcess();
        await this.snapshotRedis();
        await this.snapshotRpc();
        await this.snapshotWorkers();
        await this.snapshotBlockResultsWorkers();
      }
    })();
    console.log(`MetricsCollector started (${this.intervalMs}ms)`);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.pg && this.pg._connected) {
      await this.pg.end();
      this.pg._connected = false;
    }
  }

  // --- Health snapshots ---
  async snapshotProcess() {
    try {
      await this.connect();
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage();
      await this.pg.query(
        `INSERT INTO health_process (rss, heap_used, heap_total, external, array_buffers, cpu_user_ms, cpu_system_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [mem.rss, mem.heapUsed, mem.heapTotal, mem.external, mem.arrayBuffers, cpu.user, cpu.system]
      );
    } catch (_) {}
  }

  async snapshotRedis() {
    try {
      await this.connect();
      const redis = require('../config/redis');
      const infoMem = await redis.info('memory');
      const infoStats = await redis.info('stats');
      const infoKeyspace = await redis.info('keyspace');
      const get = (section, key) => {
        const m = section.match(new RegExp(`${key}:(\\d+)`));
        return m ? parseInt(m[1], 10) : null;
      };
      const getFloat = (section, key) => {
        const m = section.match(new RegExp(`${key}:(\\d+(?:\\.\\d+)?)`));
        return m ? parseFloat(m[1]) : null;
      };
      const used_memory = get(infoMem, 'used_memory');
      const maxmemory = get(infoMem, 'maxmemory');
      const mem_fragmentation_ratio = getFloat(infoMem, 'mem_fragmentation_ratio');
      const instantaneous_ops_per_sec = get(infoStats, 'instantaneous_ops_per_sec');
      await this.pg.query(
        `INSERT INTO health_redis (used_memory, maxmemory, instantaneous_ops_per_sec, mem_fragmentation_ratio)
         VALUES ($1,$2,$3,$4)`,
        [used_memory, maxmemory, instantaneous_ops_per_sec, mem_fragmentation_ratio]
      );
      // keyspace db0 line like: db0:keys=10,expires=0,avg_ttl=0
      const line = (infoKeyspace.split('\n').find(l => l.startsWith('db0:')) || '').trim();
      if (line) {
        const keys = parseInt((line.match(/keys=(\d+)/) || [])[1] || 0, 10);
        const expires = parseInt((line.match(/expires=(\d+)/) || [])[1] || 0, 10);
        const avg_ttl = parseInt((line.match(/avg_ttl=(\d+)/) || [])[1] || 0, 10);
        await this.pg.query(
          `INSERT INTO health_redis_keyspace (db, keys, expires, avg_ttl) VALUES ($1,$2,$3,$4)`,
          ['db0', keys, expires, avg_ttl]
        );
      }
    } catch (_) {}
  }

  async snapshotRpc() {
    try {
      await this.connect();
      const indexerPool = require('./indexer/pool');
      const workers = indexerPool.getWorkersStatus();
      await this.pg.query(
        `INSERT INTO health_rpc (status, active_workers) VALUES ($1,$2)`,
        ['ok', workers.filter(w => w.isRunning).length]
      );
    } catch (_) {}
  }

  async snapshotWorkers() {
    try {
      await this.connect();
      // We don't have per-heartbeat table beyond last_seen; approximate using heartbeats table and metrics_snapshots
      const res = await this.pg.query(`SELECT COUNT(*) AS c FROM worker_heartbeats WHERE last_seen >= NOW() - INTERVAL '1 minute'`);
      const heartbeats = parseInt(res.rows[0].c || 0, 10);
      // Lag approximation: average over chains latest - processed from metrics_snapshots latest row per chain
      const lagRes = await this.pg.query(
        `WITH latest AS (
           SELECT DISTINCT ON (chain) chain, processed_height, latest_height
           FROM metrics_snapshots
           ORDER BY chain, ts DESC
         )
         SELECT AVG(GREATEST(latest_height - processed_height,0))::numeric AS avg_lag
         FROM latest`
      );
      const avg_lag = parseFloat(lagRes.rows[0].avg_lag || 0);
      await this.pg.query(
        `INSERT INTO health_workers (workers, heartbeats, avg_lag) VALUES ($1,$2,$3)`,
        [heartbeats, heartbeats, avg_lag]
      );
    } catch (_) {}
  }

  async snapshotBlockResultsWorkers() {
    try {
      await this.connect();
      const indexerPool = require('./indexer/pool');
      const allStats = await indexerPool.getAllBlockResultsWorkerStats();
      
      for (const stats of allStats) {
        await this.pg.query(
          `INSERT INTO health_block_results_worker (
            rpc_name, queue_size, delayed_items, processing_items,
            processed_count, failed_count, success_rate, avg_processing_time_ms, worker_status,
            current_block_height, last_processed_block_height
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            stats.rpc_name,
            stats.queue_size,
            stats.delayed_items,
            stats.processing_items,
            stats.processed_count,
            stats.failed_count,
            stats.success_rate,
            stats.avg_processing_time_ms,
            stats.status,
            stats.current_block_height || null,
            stats.last_processed_block_height || null
          ]
        );
      }
    } catch (error) {
      console.warn('Block results workers snapshot failed:', error.message);
    }
  }
}

module.exports = new MetricsCollector();


