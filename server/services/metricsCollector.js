const { Client } = require('pg');
const { getRpcEndpoints } = require('../config/rpc');
const { fetchLatestBlock } = require('./indexer/rpc');

class MetricsCollector {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || 30000; // 30s default
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
      // processed height based on transactions joined to blocks (more accurate than raw blocks)
      const processedRes = await this.pg.query(
        `SELECT MAX(b.height) AS h
         FROM transactions t
         JOIN blocks b ON b.id = t.block_id AND b.chain = t.chain
         WHERE t.chain = $1`,
        [chain]
      );
      const processedHeight = parseInt(processedRes.rows?.[0]?.h || 0, 10);

      // latest height from RPC
      let latestHeight = processedHeight;
      try {
        const latest = await fetchLatestBlock(rpcUrl);
        latestHeight = parseInt(latest.block.header.height, 10);
      } catch (_) {}

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

      await this.pg.query(
        `INSERT INTO metrics_snapshots (chain, processed_height, latest_height, tx_rate, error_rate, applications, suppliers, gateways, services)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [chain, processedHeight, latestHeight, tx_rate || 0, isFinite(error_rate) ? error_rate : 0, applications, suppliers, gateways, services]
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
    }, this.intervalMs);
    // Kick immediately
    (async () => {
      for (const rpc of this.rpcs) {
        await this.snapshotChain(rpc.name, rpc.url);
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
}

module.exports = new MetricsCollector();


