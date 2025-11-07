const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const cluster = require('cluster');
const os = require('os');
const transactionService = require('./services/transactionService');
const metricsCollector = require('./services/metricsCollector');
const performanceService = require('./services/performanceService');
const redis = require('./config/redis');

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3006;
const NUM_WORKERS = process.env.CLUSTER_WORKERS || os.cpus().length;

// Simple Redis cache middleware for GET requests
const cacheMiddleware = (ttl = 60) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Skip cache for endpoints that shouldn't be cached (like health checks)
    if (req.path.includes('/health') || req.path.includes('/jobs')) {
      return next();
    }
    
    try {
      // Create cache key from URL and query params
      const cacheKey = `api:${req.method}:${req.path}:${JSON.stringify(req.query)}`;
      
      // Try to get from cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }
      
      // Store original json method
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        // Cache the response
        redis.set(cacheKey, JSON.stringify(data), 'EX', ttl).catch(err => {
          console.error('Redis cache set error:', err);
        });
        res.set('X-Cache', 'MISS');
        return originalJson(data);
      };
      
      next();
    } catch (err) {
      // If Redis fails, continue without cache
      console.error('Cache middleware error:', err);
      next();
    }
  };
};

// Cluster mode: spawn worker processes
// Use isPrimary for newer Node.js versions, fallback to isMaster for older versions
if (cluster.isPrimary || cluster.isMaster) {
  console.log(`🚀 Primary process ${process.pid} starting ${NUM_WORKERS} workers...`);
  
  // Fork workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork();
  }
  
  // Handle worker exit
  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️  Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
  
  console.log(`✅ Primary process ready with ${NUM_WORKERS} workers`);
  return;
}

// Worker process - this is where the Express app runs
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Add caching middleware for GET requests (60 second TTL by default)
// Can be overridden per route if needed
app.use(cacheMiddleware(60));

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
// Network growth (apps, services, gateways, suppliers, relays, compute units)
app.get('/api/v1/network-growth', cacheMiddleware(300), async (req, res) => {
  try {
    const { chain, window } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    // Window in days (default 7)
    const windowDays = Math.max(1, Math.min(parseInt(window || '7', 10) || 7, 365));

    // Build daily series for the selected window, counting new entities first seen per day
    const entitiesSql = `
      WITH bounds AS (
        SELECT (NOW()::date) AS end_day,
               (NOW()::date - ($2::int - 1) * INTERVAL '1 day')::date AS start_day
      ),
      days AS (
        SELECT generate_series(b.start_day, b.end_day, INTERVAL '1 day')::date AS day
        FROM bounds b
      ),
      txw AS (
        SELECT timestamp, tx_data
        FROM transactions
        WHERE timestamp >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR chain = $1)
          AND (tx_data->'tx'->'body'->'messages') IS NOT NULL
      ),
      msgs AS (
        SELECT 
          t.timestamp,
          COALESCE(m->>'@type', m->>'type', m->>'type_url') AS type_url,
          COALESCE(
            m->>'address',
            m->>'app_address',
            m->>'gateway_address',
            m->>'operator_address',
            m->>'owner_address'
          ) AS addr,
          (m->'service'->>'id') AS service_id
        FROM txw t
        JOIN LATERAL jsonb_array_elements(t.tx_data->'tx'->'body'->'messages') AS m ON TRUE
      ),
      apps_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.application.MsgStakeApplication%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      sups_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.supplier.MsgStakeSupplier%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      gws_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.gateway.MsgStakeGateway%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      svcs_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.service.MsgAddService%'
          AND service_id IS NOT NULL
        GROUP BY service_id
      ),
      apps_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM apps_first GROUP BY first_day
      ),
      sups_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM sups_first GROUP BY first_day
      ),
      gws_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM gws_first GROUP BY first_day
      ),
      svcs_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM svcs_first GROUP BY first_day
      )
      SELECT d.day,
             COALESCE(a.cnt, 0) AS applications,
             COALESCE(s.cnt, 0) AS suppliers,
             COALESCE(g.cnt, 0) AS gateways,
             COALESCE(v.cnt, 0) AS services
      FROM days d
      LEFT JOIN apps_counts a USING(day)
      LEFT JOIN sups_counts s USING(day)
      LEFT JOIN gws_counts g USING(day)
      LEFT JOIN svcs_counts v USING(day)
      ORDER BY d.day ASC;
    `;

    const entitiesRes = await client.query(entitiesSql, [chain || null, windowDays]);
    const entitySeries = entitiesRes.rows || [];

    // Aggregate relays and compute units from proof_submissions (optimized by existing indexes)
    const perfSql = `
      WITH bounds AS (
        SELECT (NOW()::date) AS end_day,
               (NOW()::date - ($2::int - 1) * INTERVAL '1 day')::date AS start_day
      ),
      days AS (
        SELECT generate_series(b.start_day, b.end_day, INTERVAL '1 day')::date AS day
        FROM bounds b
      ),
      agg AS (
        SELECT DATE_TRUNC('day', timestamp)::date AS day,
               SUM(num_relays) AS relays,
               SUM(num_claimed_compute_units) AS compute_units
        FROM proof_submissions
        WHERE claim_proof_status_int = 0
          AND timestamp >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR chain = $1)
        GROUP BY 1
      )
      SELECT d.day,
             COALESCE(a.relays, 0) AS relays,
             COALESCE(a.compute_units, 0) AS compute_units
      FROM days d
      LEFT JOIN agg a USING(day)
      ORDER BY d.day ASC;
    `;

    const perfRes = await client.query(perfSql, [chain || null, windowDays]);
    const perfSeries = perfRes.rows || [];

    // Merge series on day
    const byDay = new Map();
    for (const row of entitySeries) {
      byDay.set(row.day, {
        day: row.day,
        applications: Number(row.applications || 0),
        suppliers: Number(row.suppliers || 0),
        gateways: Number(row.gateways || 0),
        services: Number(row.services || 0),
        relays: 0,
        compute_units: 0
      });
    }
    for (const row of perfSeries) {
      const existing = byDay.get(row.day) || {
        day: row.day,
        applications: 0,
        suppliers: 0,
        gateways: 0,
        services: 0,
        relays: 0,
        compute_units: 0
      };
      existing.relays = Number(row.relays || 0);
      existing.compute_units = Number(row.compute_units || 0);
      byDay.set(row.day, existing);
    }

    const timeline = Array.from(byDay.values()).sort((a, b) => new Date(a.day) - new Date(b.day));

    res.json({ data: { window_days: windowDays, timeline } });
  } catch (error) {
    console.error('Error fetching network growth:', error);
    res.status(500).json({ error: error.message });
  }
});

// Network growth summary (aggregate over window)
app.get('/api/v1/network-growth/summary', cacheMiddleware(300), async (req, res) => {
  try {
    const { chain, window } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const windowDays = Math.max(1, Math.min(parseInt(window || '7', 10) || 7, 365));

    const entitiesSql = `
      WITH bounds AS (
        SELECT (NOW()::date - ($2::int - 1) * INTERVAL '1 day')::date AS start_day
      ),
      txw AS (
        SELECT timestamp, tx_data
        FROM transactions
        WHERE timestamp >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR chain = $1)
          AND (tx_data->'tx'->'body'->'messages') IS NOT NULL
      ),
      msgs AS (
        SELECT 
          t.timestamp,
          COALESCE(m->>'@type', m->>'type', m->>'type_url') AS type_url,
          COALESCE(
            m->>'address',
            m->>'app_address',
            m->>'gateway_address',
            m->>'operator_address',
            m->>'owner_address'
          ) AS addr,
          (m->'service'->>'id') AS service_id
        FROM txw t
        JOIN LATERAL jsonb_array_elements(t.tx_data->'tx'->'body'->'messages') AS m ON TRUE
      ),
      apps AS (
        SELECT MIN(timestamp) AS first_seen
        FROM msgs
        WHERE type_url ILIKE '%pocket.application.MsgStakeApplication%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      sups AS (
        SELECT MIN(timestamp) AS first_seen
        FROM msgs
        WHERE type_url ILIKE '%pocket.supplier.MsgStakeSupplier%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      gws AS (
        SELECT MIN(timestamp) AS first_seen
        FROM msgs
        WHERE type_url ILIKE '%pocket.gateway.MsgStakeGateway%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      svcs AS (
        SELECT MIN(timestamp) AS first_seen
        FROM msgs
        WHERE type_url ILIKE '%pocket.service.MsgAddService%'
          AND service_id IS NOT NULL
        GROUP BY service_id
      )
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE first_seen >= NOW() - make_interval(days => $2::int)), 0) AS applications,
        COALESCE((SELECT COUNT(*) FROM sups WHERE first_seen >= NOW() - make_interval(days => $2::int)), 0) AS suppliers,
        COALESCE((SELECT COUNT(*) FROM gws  WHERE first_seen >= NOW() - make_interval(days => $2::int)), 0) AS gateways,
        COALESCE((SELECT COUNT(*) FROM svcs WHERE first_seen >= NOW() - make_interval(days => $2::int)), 0) AS services
      FROM apps;
    `;

    const entitiesRes = await client.query(entitiesSql, [chain || null, windowDays]);
    const entities = entitiesRes.rows[0] || {};

    const perfSql = `
      SELECT
        COALESCE(SUM(num_relays), 0) AS relays,
        COALESCE(SUM(num_claimed_compute_units), 0) AS compute_units
      FROM proof_submissions
      WHERE claim_proof_status_int = 0
        AND timestamp >= NOW() - make_interval(days => $2::int)
        AND ($1::text IS NULL OR chain = $1);
    `;

    const perfRes = await client.query(perfSql, [chain || null, windowDays]);
    const perf = perfRes.rows[0] || {};

    res.json({ data: {
      window_days: windowDays,
      applications: Number(entities.applications || 0),
      suppliers: Number(entities.suppliers || 0),
      gateways: Number(entities.gateways || 0),
      services: Number(entities.services || 0),
      relays: Number(perf.relays || 0),
      compute_units: Number(perf.compute_units || 0)
    }});
  } catch (error) {
    console.error('Error fetching network growth summary:', error);
    res.status(500).json({ error: error.message });
  }
});
/**
 * GET /api/v1/transactions
 * POST /api/v1/transactions
 * 
 * Retrieve transactions with comprehensive filtering, sorting, and pagination.
 * 
 * GET Query Parameters / POST Body Parameters:
 * - address or addresses (string|array): Single address, comma-separated addresses, or array of addresses to filter by
 * - type (string, optional): Filter by transaction type
 * - status (string, optional): Filter by transaction status (e.g., 'success', 'failed')
 * - chain (string, optional): Filter by chain identifier
 * - start_date (string, optional): ISO date string - filter transactions from this date onwards
 * - end_date (string, optional): ISO date string - filter transactions up to this date
 * - min_amount (number, optional): Minimum transaction amount filter
 * - max_amount (number, optional): Maximum transaction amount filter
 * - page (integer, default: 1): Page number for pagination
 * - limit (integer, default: 10, max: 1000): Number of results per page
 * - sort_by (string, default: 'timestamp'): Field to sort by (timestamp, amount, fee, block_height, type, status)
 * - sort_order (string, default: 'desc'): Sort order (asc, desc)
 * 
 * Note: POST method is recommended when filtering by many addresses to avoid URL length limits.
 * 
 * Returns:
 * - data: Array of transaction objects
 * - meta: Pagination metadata (total, page, limit, totalPages, has_more)
 *   - total: Total count of transactions matching filters
 *   - totalPages: Total number of pages
 *   - has_more: Boolean indicating if there are more results
 */
app.get('/api/v1/transactions', async (req, res) => {
  try {
    const filters = transactionService.extractTransactionFilters(req);
    const transactions = await transactionService.getTransactionsWithFilters(filters);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/transactions', async (req, res) => {
  try {
    const filters = transactionService.extractTransactionFilters(req);
    const transactions = await transactionService.getTransactionsWithFilters(filters);
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

/**
 * GET /api/v1/transactions/stats
 * POST /api/v1/transactions/stats
 * 
 * Get transaction statistics based on filters.
 * 
 * GET Query Parameters / POST Body Parameters (same as /api/v1/transactions, excluding pagination/sorting):
 * - address or addresses (string|array): Address filter(s)
 * - type (string, optional): Filter by transaction type
 * - status (string, optional): Filter by transaction status
 * - chain (string, optional): Filter by chain identifier
 * - start_date (string, optional): ISO date string - start date filter
 * - end_date (string, optional): ISO date string - end date filter
 * - min_amount (number, optional): Minimum transaction amount filter
 * - max_amount (number, optional): Maximum transaction amount filter
 * 
 * Note: POST method is recommended when filtering by many addresses to avoid URL length limits.
 * 
 * Returns:
 * - data: Statistics object containing:
 *   - total_count: Total number of transactions matching filters
 *   - total_amount: Sum of all transaction amounts
 *   - total_fees: Sum of all transaction fees
 *   - by_type: Object with transaction counts grouped by type
 *   - by_status: Object with transaction counts grouped by status
 *   - date_range: Object with min and max timestamps
 */
app.get('/api/v1/transactions/stats', async (req, res) => {
  try {
    const filters = transactionService.extractStatsFilters(req);
    const stats = await transactionService.getTransactionStats(filters);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching transaction stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/transactions/stats', async (req, res) => {
  try {
    const filters = transactionService.extractStatsFilters(req);
    const stats = await transactionService.getTransactionStats(filters);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching transaction stats:', error);
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

// ============================================================================
// BLOCKS ENDPOINTS
// ============================================================================

/**
 * GET /api/v1/blocks
 * 
 * Retrieve blocks with pagination and optional filters.
 * 
 * Query Parameters:
 * - chain (string, optional): Filter by chain identifier (e.g., "mainnet", "testnet")
 * - page (integer, default: 1): Page number for pagination
 * - limit (integer, default: 100): Number of results per page
 * - start_height (integer, optional): Filter blocks from this height onwards
 * - end_height (integer, optional): Filter blocks up to this height
 * - start_date (datetime, optional): Filter blocks from this timestamp onwards
 * - end_date (datetime, optional): Filter blocks up to this timestamp
 * 
 * Returns:
 * - data: Array of block objects
 * - meta: Pagination metadata (total, page, limit, totalPages)
 */
app.get('/api/v1/blocks', async (req, res) => {
  try {
    const { 
      chain, 
      page = 1, 
      limit = 100, 
      start_height, 
      end_height, 
      start_date, 
      end_date 
    } = req.query;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [];
    const values = [];
    let idx = 1;
    
    // Build conditions with table alias 'b' for blocks (needed for JOIN query)
    if (chain) {
      conditions.push(`b.chain = $${idx++}`);
      values.push(chain);
    }
    if (start_height) {
      conditions.push(`b.height >= $${idx++}`);
      values.push(parseInt(start_height, 10));
    }
    if (end_height) {
      conditions.push(`b.height <= $${idx++}`);
      values.push(parseInt(end_height, 10));
    }
    if (start_date) {
      conditions.push(`b.timestamp >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`b.timestamp <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 100, 1000); // Cap at 1000 for performance
    const offset = (pageNum - 1) * limitNum;
    
    // OPTIMIZATION: Make COUNT optional - can disable with ?skip_count=true for faster responses
    // COUNT(*) can be slow on large tables, skip if not needed for pagination
    const skipCount = req.query.skip_count === 'true';
    let total = 0;
    
    // OPTIMIZATION: Single query approach using CTE
    // First get the blocks with LIMIT, then join with transaction counts
    // This is more efficient than separate queries
    const countPromise = skipCount 
      ? Promise.resolve({ rows: [{ total: '0' }] })
      : client.query(`SELECT COUNT(*) AS total FROM blocks b ${where}`, values);
    
    // Single optimized query: Get blocks and their transaction counts in one go
    // CTE first gets the limited blocks, then we join with aggregated transaction counts
    const blocksWithTxSql = `
      WITH paginated_blocks AS (
        SELECT 
          id, height, hash, timestamp, proposer, chain
        FROM blocks b ${where}
        ORDER BY b.height DESC NULLS LAST
        LIMIT $${idx} OFFSET $${idx + 1}
      )
      SELECT 
        pb.id,
        pb.height,
        pb.hash,
        pb.timestamp,
        pb.proposer,
        pb.chain,
        COALESCE(COUNT(t.id), 0)::integer as transaction_count
      FROM paginated_blocks pb
      LEFT JOIN transactions t ON t.block_id = pb.id
      GROUP BY pb.id, pb.height, pb.hash, pb.timestamp, pb.proposer, pb.chain
      ORDER BY pb.height DESC NULLS LAST
    `;
    
    const blocksPromise = client.query(blocksWithTxSql, [...values, limitNum, offset]);
    
    // Wait for both queries
    const [countRes, blocksRes] = await Promise.all([countPromise, blocksPromise]);
    total = skipCount ? 0 : parseInt(countRes.rows[0].total, 10);
    
    if (blocksRes.rows.length === 0) {
      return res.json({ data: [], meta: { total, page: pageNum, limit: limitNum, totalPages: skipCount ? 0 : Math.ceil(total / limitNum) } });
    }
    
    res.json({
      data: blocksRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: skipCount ? 0 : Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching blocks:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/blocks/:block_id
 * 
 * Retrieve a specific block by ID or height.
 * 
 * Path Parameters:
 * - block_id: Block ID (hash) or height (integer)
 * 
 * Query Parameters:
 * - chain (string, optional): Filter by chain identifier (required if using height)
 * 
 * Returns:
 * - data: Block object with transactions count
 */
app.get('/api/v1/blocks/:block_id', async (req, res) => {
  try {
    const { block_id } = req.params;
    const { chain } = req.query;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    // Try to parse as integer (height) or use as ID (hash)
    const height = parseInt(block_id, 10);
    const isHeight = !isNaN(height) && height > 0;
    
    let block;
    if (isHeight && chain) {
      // Get by height and chain
      const result = await client.query(
        'SELECT * FROM blocks WHERE height = $1 AND chain = $2',
        [height, chain]
      );
      block = result.rows[0];
    } else {
      // Get by ID (hash)
      const result = await client.query(
        'SELECT * FROM blocks WHERE id = $1',
        [block_id]
      );
      block = result.rows[0];
    }
    
    if (!block) {
      return res.status(404).json({ error: 'Block not found' });
    }
    
    // Get transaction count for this block
    const txCountResult = await client.query(
      'SELECT COUNT(*) as count FROM transactions WHERE block_id = $1',
      [block.id]
    );
    const txCount = parseInt(txCountResult.rows[0].count, 10);
    
    res.json({
      data: {
        ...block,
        transaction_count: txCount
      }
    });
  } catch (error) {
    console.error('Error fetching block:', error);
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
// Shared function for proof submissions queries
async function getProofSubmissions(params, client) {
  const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = params;
  
  const conditions = [];
  const values = [];
  let idx = 1;
  
  if (chain) {
    conditions.push(`chain = $${idx}::text`);
    values.push(chain);
    idx++;
  }
  
  // Handle supplier_address - can be single string, comma-separated string, or array
  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    
    if (addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx}::text`);
      values.push(addresses[0]);
      idx++;
    } else if (addresses.length > 1) {
      const placeholders = addresses.map((_, i) => `$${idx + i}::text`).join(', ');
      conditions.push(`supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  if (application_address) {
    conditions.push(`application_address = $${idx}::text`);
    values.push(application_address);
    idx++;
  }
  if (service_id) {
    conditions.push(`service_id = $${idx}::text`);
    values.push(service_id);
    idx++;
  }
  if (start_date) {
    conditions.push(`timestamp >= $${idx}::timestamp`);
    values.push(start_date);
    idx++;
  }
  if (end_date) {
    conditions.push(`timestamp <= $${idx}::timestamp`);
    values.push(end_date);
    idx++;
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
    LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;
  
  const listRes = await client.query(listSql, [...values, limitNum, offset]);
  
  return {
    data: listRes.rows,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

app.get('/api/v1/proof-submissions', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getProofSubmissions({
      supplier_address,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching proof submissions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/proof-submissions', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getProofSubmissions({
      supplier_address,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      page,
      limit
    }, client);
    
    res.json(result);
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
// Shared function for proof submissions summary
async function getProofSubmissionsSummary(params, client) {
  const { start_date, end_date, supplier_address, application_address, service_id, chain } = params;
  
  const conditions = [];
  const values = [];
  let idx = 1;
  
  if (chain) {
    conditions.push(`chain = $${idx}::text`);
    values.push(chain);
    idx++;
  }
  if (start_date) {
    conditions.push(`timestamp >= $${idx}::timestamp`);
    values.push(start_date);
    idx++;
  }
  if (end_date) {
    conditions.push(`timestamp <= $${idx}::timestamp`);
    values.push(end_date);
    idx++;
  }
  // Default to last 24 hours if no explicit date range provided
  if (!start_date && !end_date) {
    conditions.push(`timestamp >= NOW() - INTERVAL '24 hours'`);
  }
  
  // Handle supplier_address - can be single string, comma-separated string, or array
  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    
    if (addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx}::text`);
      values.push(addresses[0]);
      idx++;
    } else if (addresses.length > 1) {
      const placeholders = addresses.map((_, i) => `$${idx + i}::text`).join(', ');
      conditions.push(`supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  if (application_address) {
    conditions.push(`application_address = $${idx}::text`);
    values.push(application_address);
    idx++;
  }
  if (service_id) {
    conditions.push(`service_id = $${idx}::text`);
    values.push(service_id);
    idx++;
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
  
  return { data: result.rows[0] };
}

app.get('/api/v1/proof-submissions/summary', async (req, res) => {
  try {
    const { start_date, end_date, supplier_address, application_address, service_id, chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getProofSubmissionsSummary({
      start_date,
      end_date,
      supplier_address,
      application_address,
      service_id,
      chain
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching proof submissions summary:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/proof-submissions/summary', async (req, res) => {
  try {
    const { start_date, end_date, supplier_address, application_address, service_id, chain } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getProofSubmissionsSummary({
      start_date,
      end_date,
      supplier_address,
      application_address,
      service_id,
      chain
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching proof submissions summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validator and Service Search endpoint
// GET /api/v1/validators/search
// Query: q (required), chain (optional), limit (optional, default 20)
app.get('/api/v1/validators/search', cacheMiddleware(300), async (req, res) => {
  try {
    const { q, chain, limit = 20 } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.searchValidatorsAndServices({ q, chain, limit }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error in validator search:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validators performance endpoints

// GET /api/v1/validators/performance
// Query: domain, owner_address, supplier_address (single or comma-separated), chain, service_id, start_date, end_date, group_by(day|hour|total), page, limit
// Supports backward compatibility: single supplier_address works as before
// New: comma-separated supplier_address (e.g., "addr1,addr2,addr3") aggregates results
app.get('/api/v1/validators/performance', async (req, res) => {
  try {
    const { domain, owner_address, supplier_address, chain, service_id, start_date, end_date, group_by = 'day', page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const result = await performanceService.getValidatorPerformance({
      domain,
      owner_address,
      supplier_address,
      chain,
      service_id,
      start_date,
      end_date,
      group_by,
      page,
      limit
    }, client);

    res.json(result);
  } catch (error) {
    console.error('Error fetching validator performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/v1/validators/performance
// Body: { domain, owner_address, supplier_address (string or array), chain, service_id, start_date, end_date, group_by, page, limit }
// Recommended for multiple supplier addresses to avoid URL length limits
// When supplier_address is an array with multiple addresses, results are aggregated
app.post('/api/v1/validators/performance', async (req, res) => {
  try {
    const { domain, owner_address, supplier_address, chain, service_id, start_date, end_date, group_by = 'day', page = 1, limit = 100 } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const result = await performanceService.getValidatorPerformance({
      domain,
      owner_address,
      supplier_address,
      chain,
      service_id,
      start_date,
      end_date,
      group_by,
      page,
      limit
    }, client);

    res.json(result);
  } catch (error) {
    console.error('Error fetching validator performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/validators/:operator_address/performance
app.get('/api/v1/validators/:operator_address/performance', async (req, res) => {
  try {
    const { operator_address } = req.params;
    const { chain, service_id, start_date, end_date, group_by = 'day', page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const conditions = ["ps.claim_proof_status_int = 0", `ps.supplier_operator_address = $1`];
    const values = [operator_address];
    let idx = 2;
    if (chain) { conditions.push(`ps.chain = $${idx++}`); values.push(chain); }
    if (service_id) { conditions.push(`ps.service_id = $${idx++}`); values.push(service_id); }
    if (start_date) { conditions.push(`ps.timestamp >= $${idx++}`); values.push(start_date); }
    if (end_date) { conditions.push(`ps.timestamp <= $${idx++}`); values.push(end_date); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    let bucketExpr = null;
    if (group_by === 'hour') bucketExpr = `DATE_TRUNC('hour', ps.timestamp) AS bucket`;
    else if (group_by === 'total') bucketExpr = `NULL::timestamp AS bucket`;
    else bucketExpr = `DATE_TRUNC('day', ps.timestamp) AS bucket`;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT ${bucketExpr.replace(' AS bucket', '')} AS bucket_key
        FROM proof_submissions ps
        ${where}
        GROUP BY bucket_key
      ) t`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

    const listSql = `
      SELECT 
        ${bucketExpr},
        ps.supplier_operator_address,
        COALESCE(COUNT(*)::BIGINT, 0) AS submissions,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent,
        ROUND(AVG(ps.reward_per_relay)::numeric, 2) AS avg_reward_per_relay,
        COUNT(DISTINCT ps.application_address) AS unique_applications,
        COUNT(DISTINCT ps.service_id) AS unique_services
      FROM proof_submissions ps
      ${where}
      GROUP BY bucket, ps.supplier_operator_address
      ORDER BY bucket DESC NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const listRes = await client.query(listSql, [...values, limitNum, offset]);

    // Fetch metadata - include chain filter if provided
    let metaSql = `SELECT operator_address, chain, moniker, website, website_domain, status, jailed, tokens FROM validators WHERE operator_address = $1`;
    const metaValues = [operator_address];
    if (chain) {
      metaSql += ` AND chain = $2`;
      metaValues.push(chain);
    }
    metaSql += ` LIMIT 1`; // If chain not provided, just get first match
    const metaRes = await client.query(metaSql, metaValues);

    res.json({
      data: listRes.rows,
      validator: metaRes.rows?.[0] || null,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching validator detail performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/validators/domains - leaderboard by domain
app.get('/api/v1/validators/domains', async (req, res) => {
  try {
    const { chain, service_id, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const conditions = ["ps.claim_proof_status_int = 0"]; // successful only
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`ps.chain = $${idx++}`); values.push(chain); }
    if (service_id) { conditions.push(`ps.service_id = $${idx++}`); values.push(service_id); }
    if (start_date) { conditions.push(`ps.timestamp >= $${idx++}`); values.push(start_date); }
    if (end_date) { conditions.push(`ps.timestamp <= $${idx++}`); values.push(end_date); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT v.website_domain AS domain
        FROM proof_submissions ps
        LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address
        LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
        ${where}
        GROUP BY v.website_domain
        HAVING v.website_domain IS NOT NULL AND v.website_domain <> ''
      ) t`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

    const listSql = `
      SELECT 
        v.website_domain AS domain,
        COUNT(DISTINCT ps.supplier_operator_address) AS validator_count,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent
      FROM proof_submissions ps
      LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address
      LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
      ${where}
      GROUP BY v.website_domain
      HAVING v.website_domain IS NOT NULL AND v.website_domain <> ''
      ORDER BY total_relays DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching validator domains leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/validators/owners - leaderboard by owner
app.get('/api/v1/validators/owners', async (req, res) => {
  try {
    const { chain, service_id, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const conditions = ["ps.claim_proof_status_int = 0"]; // successful only
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`ps.chain = $${idx++}`); values.push(chain); }
    if (service_id) { conditions.push(`ps.service_id = $${idx++}`); values.push(service_id); }
    if (start_date) { conditions.push(`ps.timestamp >= $${idx++}`); values.push(start_date); }
    if (end_date) { conditions.push(`ps.timestamp <= $${idx++}`); values.push(end_date); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT s.owner_address
        FROM proof_submissions ps
        LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address
        LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
        ${where}
        GROUP BY s.owner_address
      ) t`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

    const listSql = `
      SELECT 
        s.owner_address,
        COUNT(DISTINCT ps.supplier_operator_address) AS supplier_count,
        COUNT(DISTINCT v.operator_address) AS validator_count,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent
      FROM proof_submissions ps
      LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address
      LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
      ${where}
      GROUP BY s.owner_address
      ORDER BY total_relays DESC NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching validator owners leaderboard:', error);
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
 * - supplier_address: Optional supplier operator address filter (single or comma-separated)
 * - owner_address: Optional owner address filter (filters by supplier owner address)
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
 * GET /api/v1/services/top-by-compute-units?supplier_address=poktvaloper1abc...&days=30
 * GET /api/v1/services/top-by-compute-units?owner_address=pokt1xyz...&days=30
 */
app.get('/api/v1/services/top-by-compute-units', async (req, res) => {
  try {
    const { limit = '10', days = '30', chain, supplier_address, owner_address } = req.query;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.getTopServicesByComputeUnits({
      limit,
      days,
      chain,
      supplier_address,
      owner_address
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching top services by compute units:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/services/top-by-compute-units
 * 
 * Same as GET but accepts parameters in request body.
 * Recommended for multiple supplier addresses to avoid URL length limits.
 * 
 * Body: { limit, days, chain, supplier_address (string or array), owner_address }
 */
app.post('/api/v1/services/top-by-compute-units', async (req, res) => {
  try {
    const { limit = '10', days = '30', chain, supplier_address, owner_address } = req.body;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.getTopServicesByComputeUnits({
      limit,
      days,
      chain,
      supplier_address,
      owner_address
    }, client);
    
    res.json(result);
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
 * - supplier_address: Optional supplier operator address filter (single or comma-separated)
 * - owner_address: Optional owner address filter (filters by supplier owner address)
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
 * GET /api/v1/services/top-by-performance?supplier_address=poktvaloper1abc...&days=30
 * GET /api/v1/services/top-by-performance?owner_address=pokt1xyz...&days=30
 */
app.get('/api/v1/services/top-by-performance', async (req, res) => {
  try {
    const { chain, days = '30', supplier_address, owner_address } = req.query;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.getTopServicesByPerformance({
      chain,
      days,
      supplier_address,
      owner_address
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching top services by performance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/services/top-by-performance
 * 
 * Same as GET but accepts parameters in request body.
 * Recommended for multiple supplier addresses to avoid URL length limits.
 * 
 * Body: { chain, days, supplier_address (string or array), owner_address }
 */
app.post('/api/v1/services/top-by-performance', async (req, res) => {
  try {
    const { chain, days = '30', supplier_address, owner_address } = req.body;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.getTopServicesByPerformance({
      chain,
      days,
      supplier_address,
      owner_address
    }, client);
    
    res.json(result);
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
    console.log(`🚀 POCKET NETWORK API SERVER STARTING (Worker ${cluster.worker.id}/${NUM_WORKERS})`);
    console.log('='.repeat(80));
    console.log(`📅 Start Time: ${new Date().toISOString()}`);
    console.log(`🆔 Process ID: ${process.pid}`);
    console.log(`👷 Worker ID: ${cluster.worker.id}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔌 Port: ${PORT}`);
    console.log(`📊 Node Version: ${process.version}`);
    console.log(`💾 Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    console.log(`🔗 Database Pool: ${process.env.DB_POOL_SIZE || '20'} max connections`);
    console.log('='.repeat(80));
    
    // Start the HTTP server
    app.listen(PORT, () => {
      console.log(`🌐 Worker ${cluster.worker.id} API server running on http://localhost:${PORT}`);
    });
    
    console.log('='.repeat(80));
    console.log(`🎉 Worker ${cluster.worker.id} STARTED SUCCESSFULLY`);
    console.log('='.repeat(80));
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('='.repeat(80));
      console.log(`🛑 Worker ${cluster.worker.id} SHUTTING DOWN (SIGINT)`);
      console.log(`📅 Shutdown Time: ${new Date().toISOString()}`);
      console.log(`⏱️  Uptime: ${Math.round(process.uptime())} seconds`);
      console.log('='.repeat(80));
      // Close database pool gracefully
      await transactionService.pgPool.end();
      console.log('👋 Worker shutdown complete');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('='.repeat(80));
      console.log(`🛑 Worker ${cluster.worker.id} SHUTTING DOWN (SIGTERM)`);
      console.log(`📅 Shutdown Time: ${new Date().toISOString()}`);
      console.log(`⏱️  Uptime: ${Math.round(process.uptime())} seconds`);
      console.log('='.repeat(80));
      // Close database pool gracefully
      await transactionService.pgPool.end();
      console.log('👋 Worker shutdown complete');
      process.exit(0);
    });
  } catch (error) {
    console.log('='.repeat(80));
    console.log(`❌ Worker ${cluster.worker?.id || 'unknown'} STARTUP FAILED`);
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