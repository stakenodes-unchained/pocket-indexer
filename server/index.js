const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const indexerPool = require('./services/indexer/pool');
const transactionService = require('./services/transactionService');
const metricsCollector = require('./services/metricsCollector');
const { Client } = require('pg');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3006;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// API endpoints
app.get('/api/v1/transactions', async (req, res) => {
  try {
    const { page, limit, chain } = req.query;
    // console.log(page, limit, chain);
    const transactions = await transactionService.getTransactions({
      page,
      limit,
      chain
    });
    // console.log(transactions);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/transactions/count', async (req, res) => {
  try {
    const { chain } = req.query;
    const count = await transactionService.getTransactionCount(chain);
    res.json(count);
  } catch (error) {
    console.error('Error fetching transaction count:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/transactions/:transaction_id', async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const { chain } = req.query;
    const transaction = await transactionService.getTransactionById(transaction_id, chain);
    
    if (!transaction.data) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    res.json(transaction);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint to get chain statistics
app.get('/api/v1/chains/stats', async (req, res) => {
  try {
    const stats = await transactionService.getChainStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching chain statistics:', error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint to get available chains
app.get('/api/v1/chains', (req, res) => {
  try {
    const chains = transactionService.getAvailableChains();
    res.json({ data: chains });
  } catch (error) {
    console.error('Error fetching chains:', error);
    res.status(500).json({ error: error.message });
  }
});

// Entities APIs
// Applications list
app.get('/api/v1/applications', async (req, res) => {
  try {
    const { chain, status, address, page = 1, limit = 25 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (address) { conditions.push(`address = $${idx++}`); values.push(address); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10); const limitNum = parseInt(limit, 10); const offset = (pageNum - 1) * limitNum;
    const countSql = `SELECT COUNT(*) AS total FROM applications ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    const listSql = `SELECT address, chain, staked_amount, stake_denom, status, chains, delegated, gateway_address, delegatee_gateway_addresses, unstake_session_end_height, last_seen
                     FROM applications ${where}
                     ORDER BY last_seen DESC NULLS LAST
                     LIMIT $${idx} OFFSET $${idx + 1}`;
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Application detail (with service configs and delegations)
app.get('/api/v1/applications/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const base = await client.query(
      `SELECT address, chain, staked_amount, stake_denom, status, chains, delegated, gateway_address, delegatee_gateway_addresses, pending_undelegations, unstake_session_end_height, last_seen
       FROM applications WHERE address = $1 ${chain ? 'AND chain = $2' : ''} LIMIT 1`,
      chain ? [address, chain] : [address]
    );
    if (base.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = base.rows[0];
    const svc = await client.query(
      `SELECT service_id, endpoints, config_options, last_seen FROM application_service_configs WHERE application_address = $1 AND chain = $2 ORDER BY service_id`,
      [row.address, row.chain]
    );
    const dels = await client.query(
      `SELECT application_address, gateway_address, is_active, action, timestamp FROM delegations WHERE application_address = $1 AND chain = $2 ORDER BY timestamp DESC`,
      [row.address, row.chain]
    );
    res.json({ data: { ...row, service_configs: svc.rows, delegations: dels.rows } });
  } catch (error) {
    console.error('Error fetching application detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Suppliers list
app.get('/api/v1/suppliers', async (req, res) => {
  try {
    const { chain, status, address, page = 1, limit = 25 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (address) { conditions.push(`address = $${idx++}`); values.push(address); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10); const limitNum = parseInt(limit, 10); const offset = (pageNum - 1) * limitNum;
    const countSql = `SELECT COUNT(*) AS total FROM suppliers ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    const listSql = `SELECT address, chain, staked_amount, stake_denom, status, last_seen, unstake_session_end_height
                     FROM suppliers ${where}
                     ORDER BY last_seen DESC NULLS LAST
                     LIMIT $${idx} OFFSET $${idx + 1}`;
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Supplier detail (with service configs)
app.get('/api/v1/suppliers/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const base = await client.query(
      `SELECT address, chain, staked_amount, stake_denom, status, last_seen, unstake_session_end_height
       FROM suppliers WHERE address = $1 ${chain ? 'AND chain = $2' : ''} LIMIT 1`,
      chain ? [address, chain] : [address]
    );
    if (base.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = base.rows[0];
    const svc = await client.query(
      `SELECT service_id, endpoints, config_options, last_seen FROM supplier_service_configs WHERE supplier_address = $1 AND chain = $2 ORDER BY service_id`,
      [row.address, row.chain]
    );
    res.json({ data: { ...row, service_configs: svc.rows } });
  } catch (error) {
    console.error('Error fetching supplier detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gateways list
app.get('/api/v1/gateways', async (req, res) => {
  try {
    const { chain, status, address, page = 1, limit = 25 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (address) { conditions.push(`address = $${idx++}`); values.push(address); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10); const limitNum = parseInt(limit, 10); const offset = (pageNum - 1) * limitNum;
    const countSql = `SELECT COUNT(*) AS total FROM gateways ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    const listSql = `SELECT address, chain, staked_amount, stake_denom, status, last_seen, unstake_session_end_height
                     FROM gateways ${where}
                     ORDER BY last_seen DESC NULLS LAST
                     LIMIT $${idx} OFFSET $${idx + 1}`;
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching gateways:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gateway detail
app.get('/api/v1/gateways/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const base = await client.query(
      `SELECT address, chain, staked_amount, stake_denom, status, last_seen, unstake_session_end_height
       FROM gateways WHERE address = $1 ${chain ? 'AND chain = $2' : ''} LIMIT 1`,
      chain ? [address, chain] : [address]
    );
    if (base.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: base.rows[0] });
  } catch (error) {
    console.error('Error fetching gateway detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Application delegations list (filterable)
app.get('/api/v1/delegations', async (req, res) => {
  try {
    const { chain, application_address, gateway_address, active } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (application_address) { conditions.push(`application_address = $${idx++}`); values.push(application_address); }
    if (gateway_address) { conditions.push(`gateway_address = $${idx++}`); values.push(gateway_address); }
    if (typeof active !== 'undefined') { conditions.push(`is_active = $${idx++}`); values.push(active === 'true'); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT application_address, gateway_address, chain, is_active, action, timestamp FROM delegations ${where} ORDER BY timestamp DESC LIMIT 500`;
    const result = await client.query(sql, values);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching delegations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Metrics endpoints
app.get('/api/v1/metrics/chains', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    // Latest snapshot per chain
    const sql = `SELECT DISTINCT ON (chain) chain, ts, processed_height, latest_height, tx_rate, error_rate, applications, suppliers, gateways, services
                 FROM metrics_snapshots
                 ORDER BY chain, ts DESC`;
    const result = await client.query(sql);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching chain metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/metrics/chains/:chain', async (req, res) => {
  try {
    const { chain } = req.params;
    const { limit = 200 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const result = await client.query(
      `SELECT chain,
              ts,
              processed_height,
              latest_height,
              (COALESCE(latest_height,0) - COALESCE(processed_height,0)) AS lag,
              tx_rate,
              error_rate,
              applications,
              suppliers,
              gateways,
              services
       FROM metrics_snapshots
       WHERE chain = $1
       ORDER BY ts DESC
       LIMIT $2`,
      [chain, parseInt(limit, 10)]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching chain metrics detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Jobs endpoints (scaffold)
app.post('/api/v1/jobs', async (req, res) => {
  try {
    const { type, params, created_by } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const result = await client.query(
      `INSERT INTO jobs(type, params, status, created_by) VALUES ($1,$2,'queued',$3) RETURNING *`,
      [type, params || {}, created_by || null]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/jobs', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const result = await client.query(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200`);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error listing jobs:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const job = await client.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
    const runs = await client.query(`SELECT * FROM job_runs WHERE job_id = $1 ORDER BY started_at DESC`, [id]);
    if (job.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: { job: job.rows[0], runs: runs.rows } });
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/jobs/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const result = await client.query(
      `UPDATE jobs SET status = 'cancelled', finished_at = NOW() WHERE id = $1 AND status IN ('queued','running') RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'Job not found or not cancellable' });
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health endpoints
app.get('/api/v1/health/workers', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const heartbeats = await client.query(`SELECT * FROM worker_heartbeats ORDER BY last_seen DESC`);
    const workers = indexerPool.getWorkersStatus();
    const processInfo = {
      pid: process.pid,
      uptime_s: Math.round(process.uptime()),
      memory: process.memoryUsage(),
      cpu_usage: process.cpuUsage(),
      node: process.version,
      argv: process.argv,
      env: {
        WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
        HISTORICAL_BATCH_SIZE: process.env.HISTORICAL_BATCH_SIZE,
      }
    };
    const redis = await indexerPool.getRedisStats();
    res.json({ data: { heartbeats: heartbeats.rows, workers, process: processInfo, redis } });
  } catch (error) {
    console.error('Error fetching workers health:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/rpc', async (req, res) => {
  try {
    const workers = indexerPool.getWorkersStatus();
    res.json({ data: { status: 'ok', workers } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Staking events endpoint (list with filters)
app.get('/api/v1/staking', async (req, res) => {
  try {
    const { chain, type, event, address, page = 1, limit = 50 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (type) { conditions.push(`type = $${idx++}`); values.push(type); }
    if (event) { conditions.push(`event = $${idx++}`); values.push(event); }
    if (address) { conditions.push(`address = $${idx++}`); values.push(address); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10); const limitNum = parseInt(limit, 10); const offset = (pageNum - 1) * limitNum;
    const countSql = `SELECT COUNT(*) AS total FROM staking ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    const listSql = `SELECT address, chain, type, amount, event, timestamp
                     FROM staking ${where}
                     ORDER BY timestamp DESC
                     LIMIT $${idx} OFFSET $${idx + 1}`;
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching staking events:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server and initialize the worker pool
const startServer = async () => {
  try {
    // Initialize worker pool
    await indexerPool.initialize();
    
    // Start the HTTP server
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
    // Start metrics collector
    metricsCollector.start();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Shutting down server...');
      await indexerPool.shutdown();
      await metricsCollector.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('Shutting down server...');
      await indexerPool.shutdown();
      await metricsCollector.stop();
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();