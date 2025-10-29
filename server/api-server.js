const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const transactionService = require('./services/transactionService');
const metricsCollector = require('./services/metricsCollector');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3006;

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  
  // Log the incoming request
  console.log(`[${timestamp}] ${req.method} ${req.url} - ${req.ip}`);
  
  // Override res.end to log the response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
});

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
    // proxy to 3007 - indexer service
    const response = await fetch(`http://pocket_indexer_service:3007/api/v1/health/workers`);
    const data = await response.json();
    res.json({ data: data.data });
  } catch (error) {
    console.error('Error fetching workers health:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/rpc', async (req, res) => {
  try {
    // proxy to 3007 - indexer service
    const response = await fetch(`http://pocket_indexer_service:3007/api/v1/health/rpc`);
    const data = await response.json();
    res.json({ data: data.data });
  } catch (error) {
    console.error('Error fetching rpc health:', error);
    res.status(500).json({ error: error.message });
  }
});

// // Proof parser service health endpoints
// app.get('/api/v1/health/proof-parser', async (req, res) => {
//   try {
//     // proxy to proof parser service on port 3008
//     const response = await fetch(`http://pocket_proof_parser:3008/health`);
//     const data = await response.json();
//     res.json({ data });
//   } catch (error) {
//     console.error('Error fetching proof parser health:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get('/api/v1/health/proof-parser/:chain', async (req, res) => {
//   try {
//     const chain = req.params.chain;
//     // proxy to proof parser service on port 3008
//     const response = await fetch(`http://pocket_proof_parser:3008/health/${chain}`);
//     const data = await response.json();
//     res.json({ data });
//   } catch (error) {
//     console.error(`Error fetching proof parser health for chain ${req.params.chain}:`, error);
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get('/api/v1/health/proof-parser/stats', async (req, res) => {
//   try {
//     // proxy to proof parser service on port 3008
//     const response = await fetch(`http://pocket_proof_parser:3008/stats`);
//     const data = await response.json();
//     res.json({ data });
//   } catch (error) {
//     console.error('Error fetching proof parser stats:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// --- Health history helpers ---
function parseWindow(req) {
  const now = Date.now();
  const from = req.query.from ? new Date(req.query.from).getTime() : now - 60 * 60 * 1000;
  const to = req.query.to ? new Date(req.query.to).getTime() : now;
  const limit = parseInt(req.query.limit || '200', 10);
  const interval = req.query.interval || null; // future: apply bucketing
  return { from: new Date(from), to: new Date(to), limit, interval };
}

app.get('/api/v1/health/rpc/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const result = await client.query(
      `SELECT ts, status, active_workers FROM health_rpc
       WHERE ts >= $1 AND ts < $2
       ORDER BY ts ASC
       LIMIT $3`,
      [from, to, limit]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching rpc history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/workers/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const chain = req.query.chain || null;
    const sql = `SELECT ts, COALESCE(chain,'') AS chain, workers, heartbeats, avg_lag, p95_lag
                 FROM health_workers
                 WHERE ts >= $1 AND ts < $2
                 ${chain ? 'AND chain = $4' : ''}
                 ORDER BY ts ASC
                 LIMIT $3`;
    const params = chain ? [from, to, limit, chain] : [from, to, limit];
    const result = await client.query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching workers history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/process/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const result = await client.query(
      `SELECT ts, rss, heap_used, heap_total, external, array_buffers, cpu_user_ms, cpu_system_ms
       FROM health_process
       WHERE ts >= $1 AND ts < $2
       ORDER BY ts ASC
       LIMIT $3`,
      [from, to, limit]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching process history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/redis/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const result = await client.query(
      `SELECT ts, used_memory, maxmemory, instantaneous_ops_per_sec, mem_fragmentation_ratio
       FROM health_redis
       WHERE ts >= $1 AND ts < $2
       ORDER BY ts ASC
       LIMIT $3`,
      [from, to, limit]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching redis history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/redis/keyspace/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const db = req.query.db || 'db0';
    const result = await client.query(
      `SELECT ts, db, keys, expires, avg_ttl
       FROM health_redis_keyspace
       WHERE ts >= $1 AND ts < $2 AND db = $4
       ORDER BY ts ASC
       LIMIT $3`,
      [from, to, limit, db]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching redis keyspace history:', error);
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

// ============================================================================
// PROOF SUBMISSIONS ENDPOINTS
// ============================================================================

// Get proof submissions with filters
app.get('/api/v1/proof-submissions', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [];
    const values = [];
    let idx = 1;
    
    if (chain) {
      conditions.push(`chain = $${idx++}`);
      values.push(chain);
    }
    if (supplier_address) {
      conditions.push(`supplier_operator_address = $${idx++}`);
      values.push(supplier_address);
    }
    if (application_address) {
      conditions.push(`application_address = $${idx++}`);
      values.push(application_address);
    }
    if (service_id) {
      conditions.push(`service_id = $${idx++}`);
      values.push(service_id);
    }
    if (start_date) {
      conditions.push(`timestamp >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`timestamp <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count
    const countSql = `SELECT COUNT(*) AS total FROM proof_submissions ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    
    // Get paginated results
    const listSql = `SELECT 
      id, transaction_hash, block_height, timestamp, chain,
      supplier_operator_address, application_address, service_id, session_id,
      session_end_block_height, claim_proof_status_int, claimed_upokt,
      claimed_upokt_amount, num_claimed_compute_units, num_estimated_compute_units,
      num_relays, compute_unit_efficiency, reward_per_relay, msg_index, created_at
      FROM proof_submissions ${where}
      ORDER BY timestamp DESC, block_height DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    
    res.json({
      data: listRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching proof submissions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get reward analytics aggregated view (hourly)
app.get('/api/v1/proof-submissions/rewards', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [];
    const values = [];
    let idx = 1;
    
    if (chain) {
      conditions.push(`chain = $${idx++}`);
      values.push(chain);
    }
    if (supplier_address) {
      conditions.push(`supplier_operator_address = $${idx++}`);
      values.push(supplier_address);
    }
    if (application_address) {
      conditions.push(`application_address = $${idx++}`);
      values.push(application_address);
    }
    if (service_id) {
      conditions.push(`service_id = $${idx++}`);
      values.push(service_id);
    }
    if (start_date) {
      conditions.push(`hour_bucket >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`hour_bucket <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count
    const countSql = `SELECT COUNT(*) AS total FROM proof_submission_rewards ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    
    // Get paginated results
    const listSql = `SELECT * FROM proof_submission_rewards ${where}
      ORDER BY hour_bucket DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    
    res.json({
      data: listRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching reward analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get supplier performance analytics (daily)
app.get('/api/v1/suppliers/:address/performance', async (req, res) => {
  try {
    const { address } = req.params;
    const { start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [`supplier_operator_address = $1`];
    const values = [address];
    let idx = 2;
    
    if (start_date) {
      conditions.push(`day_bucket >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`day_bucket <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count
    const countSql = `SELECT COUNT(*) AS total FROM supplier_performance ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    
    // Get paginated results
    const listSql = `SELECT * FROM supplier_performance ${where}
      ORDER BY day_bucket DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    
    res.json({
      data: listRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching supplier performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get application usage analytics (daily)
app.get('/api/v1/applications/:address/usage', async (req, res) => {
  try {
    const { address } = req.params;
    const { start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [`application_address = $1`];
    const values = [address];
    let idx = 2;
    
    if (start_date) {
      conditions.push(`day_bucket >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`day_bucket <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count
    const countSql = `SELECT COUNT(*) AS total FROM application_usage ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    
    // Get paginated results
    const listSql = `SELECT * FROM application_usage ${where}
      ORDER BY day_bucket DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    
    res.json({
      data: listRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching application usage:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get summary statistics for proof submissions
app.get('/api/v1/proof-submissions/summary', async (req, res) => {
  try {
    const { start_date, end_date, supplier_address, application_address, service_id, chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [];
    const values = [];
    let idx = 1;
    
    if (chain) {
      conditions.push(`chain = $${idx++}`);
      values.push(chain);
    }
    if (start_date) {
      conditions.push(`timestamp >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`timestamp <= $${idx++}`);
      values.push(end_date);
    }
    if (supplier_address) {
      conditions.push(`supplier_operator_address = $${idx++}`);
      values.push(supplier_address);
    }
    if (application_address) {
      conditions.push(`application_address = $${idx++}`);
      values.push(application_address);
    }
    if (service_id) {
      conditions.push(`service_id = $${idx++}`);
      values.push(service_id);
    }
    
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const summarySql = `SELECT 
      COUNT(*) as total_submissions,
      COUNT(DISTINCT supplier_operator_address) as unique_suppliers,
      COUNT(DISTINCT application_address) as unique_applications,
      COUNT(DISTINCT service_id) as unique_services,
      SUM(claimed_upokt_amount) as total_rewards_upokt,
      SUM(num_relays) as total_relays,
      SUM(num_claimed_compute_units) as total_claimed_compute_units,
      SUM(num_estimated_compute_units) as total_estimated_compute_units,
      AVG(compute_unit_efficiency) as avg_efficiency_percent,
      AVG(reward_per_relay) as avg_reward_per_relay,
      MIN(timestamp) as first_submission,
      MAX(timestamp) as last_submission
      FROM proof_submissions ${where}`;
    
    const result = await client.query(summarySql, values);
    
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching proof submissions summary:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/services/top-by-compute-units
 * 
 * Returns top N services by total compute units for the specified time period.
 * Perfect for growth graphs showing service adoption over time.
 * 
 * Query Parameters:
 * - limit: Number of top services to return (5, 10, 25, or 50). Default: 10
 * - days: Time period in days (7, 15, or 30). Default: 30
 * - chain: Optional chain filter (e.g., "mainnet", "testnet")
 * 
 * Returns array of services with:
 * - service_id: The service identifier
 * - total_claimed_compute_units: Sum of all claimed compute units
 * - total_estimated_compute_units: Sum of all estimated compute units
 * - submission_count: Number of proof submissions
 * - avg_efficiency_percent: Average efficiency percentage
 * - period_start: Start timestamp of the period
 * - period_end: End timestamp of the period
 * 
 * Example:
 * GET /api/v1/services/top-by-compute-units?limit=25&days=7&chain=mainnet
 */
app.get('/api/v1/services/top-by-compute-units', async (req, res) => {
  try {
    const { limit = '10', days = '30', chain } = req.query;
    
    // Validate limit
    const validLimits = ['5', '10', '25', '50'];
    const limitValue = validLimits.includes(limit) ? parseInt(limit, 10) : 10;
    
    // Validate days
    const validDays = ['7', '15', '30'];
    const daysValue = validDays.includes(days) ? parseInt(days, 10) : 30;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    // Optimized query with index-friendly WHERE clause ordering
    // chain first (if provided), then claim_proof_status_int, then timestamp
    const conditions = [`claim_proof_status_int = 0`, `timestamp >= NOW() - INTERVAL '${daysValue} days'`];
    const values = [];
    let idx = 1;
    
    // Put chain first in WHERE clause for optimal index usage
    if (chain) {
      conditions.unshift(`chain = $${idx++}`);
      values.unshift(chain);
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;
    
    // Optimized query - uses covering index for fast aggregation
    // When chain is provided, we group only by service_id (faster)
    // When chain is not provided, we include it in GROUP BY
    const sql = chain
      ? `
        SELECT 
          service_id,
          $1::text as chain,
          SUM(num_claimed_compute_units) as total_claimed_compute_units,
          SUM(num_estimated_compute_units) as total_estimated_compute_units,
          COUNT(*) as submission_count,
          AVG(compute_unit_efficiency) as avg_efficiency_percent,
          MIN(timestamp) as period_start,
          MAX(timestamp) as period_end
        FROM proof_submissions
        ${where}
        GROUP BY service_id
        ORDER BY total_claimed_compute_units DESC
        LIMIT $${idx}
      `
      : `
        SELECT 
          service_id,
          chain,
          SUM(num_claimed_compute_units) as total_claimed_compute_units,
          SUM(num_estimated_compute_units) as total_estimated_compute_units,
          COUNT(*) as submission_count,
          AVG(compute_unit_efficiency) as avg_efficiency_percent,
          MIN(timestamp) as period_start,
          MAX(timestamp) as period_end
        FROM proof_submissions
        ${where}
        GROUP BY service_id, chain
        ORDER BY total_claimed_compute_units DESC
        LIMIT $${idx}
      `;
    
    values.push(limitValue);
    
    const result = await client.query(sql, values);
    
    res.json({
      data: result.rows,
      meta: {
        limit: limitValue,
        days: daysValue,
        chain: chain || 'all',
        period_start: result.rows[0]?.period_start || null,
        period_end: result.rows[0]?.period_end || null
      }
    });
  } catch (error) {
    console.error('Error fetching top services by compute units:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/services/top-by-performance
 * 
 * Returns top 10 services by compute units with percentage distribution.
 * Perfect for displaying a table showing network usage distribution.
 * 
 * Query Parameters:
 * - chain: Optional chain filter (e.g., "mainnet", "testnet")
 * - days: Optional time period in days (default: 30). Only accepts 7, 15, or 30
 * 
 * Returns array of top 10 services with:
 * - service_id: The service identifier
 * - total_claimed_compute_units: Sum of all claimed compute units
 * - total_estimated_compute_units: Sum of all estimated compute units
 * - submission_count: Number of proof submissions
 * - avg_efficiency_percent: Average efficiency percentage
 * - percentage_of_total: Percentage distribution (0-100)
 * - rank: Ranking position (1-10)
 * 
 * Also returns:
 * - total_compute_units: Grand total for percentage calculations
 * - meta: Period information
 * 
 * Example:
 * GET /api/v1/services/top-by-performance?chain=mainnet&days=15
 */
app.get('/api/v1/services/top-by-performance', async (req, res) => {
  try {
    const { chain, days = '30' } = req.query;
    
    // Validate days
    const validDays = ['7', '15', '30'];
    const daysValue = validDays.includes(days) ? parseInt(days, 10) : 30;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    // Optimized: Single query using CTE to avoid two round trips
    // Index-friendly WHERE clause ordering: chain first (if provided), then claim_proof_status_int, then timestamp
    const conditions = [`claim_proof_status_int = 0`, `timestamp >= NOW() - INTERVAL '${daysValue} days'`];
    const values = [];
    let idx = 1;
    
    // Put chain first in WHERE clause for optimal index usage
    if (chain) {
      conditions.unshift(`chain = $${idx++}`);
      values.unshift(chain);
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;
    
    // Single optimized query with CTE - faster than two separate queries
    // Uses covering index and calculates total in one pass
    const sql = chain
      ? `
        WITH service_totals AS (
          SELECT 
            service_id,
            $1::text as chain,
            SUM(num_claimed_compute_units) as total_claimed_compute_units,
            SUM(num_estimated_compute_units) as total_estimated_compute_units,
            COUNT(*) as submission_count,
            AVG(compute_unit_efficiency) as avg_efficiency_percent,
            MIN(timestamp) as period_start,
            MAX(timestamp) as period_end
          FROM proof_submissions
          ${where}
          GROUP BY service_id
        ),
        grand_total AS (
          SELECT SUM(total_claimed_compute_units) as total_compute_units
          FROM service_totals
        )
        SELECT 
          st.*,
          gt.total_compute_units
        FROM service_totals st
        CROSS JOIN grand_total gt
        ORDER BY st.total_claimed_compute_units DESC
        LIMIT 10
      `
      : `
        WITH service_totals AS (
          SELECT 
            service_id,
            chain,
            SUM(num_claimed_compute_units) as total_claimed_compute_units,
            SUM(num_estimated_compute_units) as total_estimated_compute_units,
            COUNT(*) as submission_count,
            AVG(compute_unit_efficiency) as avg_efficiency_percent,
            MIN(timestamp) as period_start,
            MAX(timestamp) as period_end
          FROM proof_submissions
          ${where}
          GROUP BY service_id, chain
        ),
        grand_total AS (
          SELECT SUM(total_claimed_compute_units) as total_compute_units
          FROM service_totals
        )
        SELECT 
          st.*,
          gt.total_compute_units
        FROM service_totals st
        CROSS JOIN grand_total gt
        ORDER BY st.total_claimed_compute_units DESC
        LIMIT 10
      `;
    
    const servicesResult = await client.query(sql, values);
    const totalComputeUnits = parseInt(servicesResult.rows[0]?.total_compute_units || '0', 10);
    
    // Calculate percentages and add rank
    const services = servicesResult.rows.map((service, index) => {
      const claimed = parseInt(service.total_claimed_compute_units || '0', 10);
      const percentage = totalComputeUnits > 0 
        ? parseFloat(((claimed / totalComputeUnits) * 100).toFixed(2))
        : 0;
      
      return {
        rank: index + 1,
        service_id: service.service_id,
        chain: service.chain,
        total_claimed_compute_units: claimed,
        total_estimated_compute_units: parseInt(service.total_estimated_compute_units || '0', 10),
        submission_count: parseInt(service.submission_count || '0', 10),
        avg_efficiency_percent: parseFloat(parseFloat(service.avg_efficiency_percent || '0').toFixed(2)),
        percentage_of_total: percentage,
        period_start: service.period_start,
        period_end: service.period_end
      };
    });
    
    res.json({
      data: services,
      total_compute_units: totalComputeUnits,
      meta: {
        days: daysValue,
        chain: chain || 'all',
        period_start: services[0]?.period_start || null,
        period_end: services[0]?.period_end || null
      }
    });
  } catch (error) {
    console.error('Error fetching top services by performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server and initialize the worker pool
const startServer = async () => {
  try {
    // Log startup banner
    console.log('='.repeat(80));
    console.log('🚀 POCKET NETWORK API SERVER STARTING');
    console.log('='.repeat(80));
    console.log(`📅 Start Time: ${new Date().toISOString()}`);
    console.log(`🆔 Process ID: ${process.pid}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔌 Port: ${PORT}`);
    console.log(`📊 Node Version: ${process.version}`);
    console.log(`💾 Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    console.log('='.repeat(80));
    
    // Start the HTTP server
    app.listen(PORT, () => {
      console.log(`🌐 API server running on http://localhost:${PORT}`);
    });
    
    console.log('='.repeat(80));
    console.log('🎉 API SERVER STARTED SUCCESSFULLY');
    console.log('='.repeat(80));
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('='.repeat(80));
      console.log('🛑 API SERVER SHUTTING DOWN (SIGINT)');
      console.log(`📅 Shutdown Time: ${new Date().toISOString()}`);
      console.log(`⏱️  Uptime: ${Math.round(process.uptime())} seconds`);
      console.log('='.repeat(80));
      console.log('👋 API SERVER SHUTDOWN COMPLETE');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('='.repeat(80));
      console.log('🛑 API SERVER SHUTTING DOWN (SIGTERM)');
      console.log(`📅 Shutdown Time: ${new Date().toISOString()}`);
      console.log(`⏱️  Uptime: ${Math.round(process.uptime())} seconds`);
      console.log('='.repeat(80));
      console.log('👋 API SERVER SHUTDOWN COMPLETE');
      process.exit(0);
    });
  } catch (error) {
    console.log('='.repeat(80));
    console.log('❌ API SERVER STARTUP FAILED');
    console.log(`📅 Failure Time: ${new Date().toISOString()}`);
    console.log(`🆔 Process ID: ${process.pid}`);
    console.log(`💥 Error: ${error.message}`);
    console.log(`📋 Stack Trace:`);
    console.error(error.stack);
    console.log('='.repeat(80));
    process.exit(1);
  }
};

// Start the server
startServer();