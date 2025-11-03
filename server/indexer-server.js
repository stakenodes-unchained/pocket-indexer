const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const indexerPool = require('./services/indexer/pool');
const transactionService = require('./services/transactionService');
const metricsCollector = require('./services/metricsCollector');
const validatorService = require('./services/validatorService');
const supplierEnrichmentService = require('./services/supplierEnrichmentService');


// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.INDEXER_PORT || 3007;

// Middleware
app.use(bodyParser.json());
app.use(cors());

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
    
    // Get historical sync checkpoints
    const histRes = await client.query(`SELECT chain, last_height FROM historical_sync`);
    const historyMap = new Map(histRes.rows.map(r => [r.chain, parseInt(r.last_height || 0, 10)]));
    
    // Get latest processed heights from monitoring (highest block processed by monitor workers)
    const monitorRes = await client.query(`
      SELECT chain, MAX(height) as max_height 
      FROM blocks 
      WHERE chain IS NOT NULL 
      GROUP BY chain
    `);
    const monitorMap = new Map(monitorRes.rows.map(r => [r.chain, parseInt(r.max_height || 0, 10)]));
    
    // Get latest network heights from metrics snapshots
    const snapRes = await client.query(`SELECT DISTINCT ON (chain) chain, processed_height, latest_height FROM metrics_snapshots ORDER BY chain, ts DESC`);
    const snapMap = new Map(snapRes.rows.map(r => [r.chain, { processed: parseInt(r.processed_height || 0, 10), latest: parseInt(r.latest_height || 0, 10) }]));
    
    const chains = transactionService.getAvailableChains();
    const chainHealth = chains.map(chain => {
      const snap = snapMap.get(chain) || { processed: 0, latest: 0 };
      const historical_checkpoint = historyMap.get(chain) || 0;
      const monitoring_height = monitorMap.get(chain) || 0;
      const latest_height = snap.latest || 0;
      
      // Calculate different types of lag
      const monitor_lag = Math.max(latest_height - monitoring_height, 0); // How far behind monitoring is from network
      const historical_backlog = Math.max(monitoring_height - historical_checkpoint, 0); // Gap between historical sync and monitoring
      const total_backlog = Math.max(latest_height - historical_checkpoint, 0); // Total gap from network
      
      return {
        chain,
        historical_checkpoint,
        monitoring_height,
        latest_height,
        monitor_lag,
        historical_backlog,
        total_backlog,
        status: {
          monitoring: monitoring_height > 0 ? 'active' : 'inactive',
          historical: historical_backlog > 0 ? 'catching_up' : 'synced',
          overall: total_backlog === 0 ? 'synced' : total_backlog > 1000 ? 'critical' : 'lagging'
        }
      };
    });
    
    // Separate heartbeats by type
    const historicalHeartbeats = heartbeats.rows.filter(h => h.worker_id && h.worker_id.includes('-historical'));
    const monitorHeartbeats = heartbeats.rows.filter(h => h.worker_id && h.worker_id.includes('-monitor'));
    
    res.json({ 
      data: { 
        heartbeats: {
          historical: historicalHeartbeats,
          monitor: monitorHeartbeats,
          all: heartbeats.rows
        },
        workers, 
        process: processInfo, 
        redis, 
        chains: chainHealth 
      } 
    });
  } catch (error) {
    console.error('Error fetching workers health:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/rpc', async (req, res) => {
  try {
    const workers = indexerPool.getWorkersStatus();
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    // Get historical sync checkpoints
    const histRes = await client.query(`SELECT chain, last_height FROM historical_sync`);
    const historyMap = new Map(histRes.rows.map(r => [r.chain, parseInt(r.last_height || 0, 10)]));
    
    // Get latest processed heights from monitoring
    const monitorRes = await client.query(`
      SELECT chain, MAX(height) as max_height 
      FROM blocks 
      WHERE chain IS NOT NULL 
      GROUP BY chain
    `);
    const monitorMap = new Map(monitorRes.rows.map(r => [r.chain, parseInt(r.max_height || 0, 10)]));
    
    // Get latest network heights from metrics snapshots
    const snapRes = await client.query(`SELECT DISTINCT ON (chain) chain, processed_height, latest_height FROM metrics_snapshots ORDER BY chain, ts DESC`);
    const snapMap = new Map(snapRes.rows.map(r => [r.chain, { processed: parseInt(r.processed_height || 0, 10), latest: parseInt(r.latest_height || 0, 10) }]));
    
    const chains = transactionService.getAvailableChains();
    const chainStatus = chains.map(chain => {
      const snap = snapMap.get(chain) || { processed: 0, latest: 0 };
      const historical_checkpoint = historyMap.get(chain) || 0;
      const monitoring_height = monitorMap.get(chain) || 0;
      const latest_height = snap.latest || 0;
      
      return {
        chain,
        historical_checkpoint,
        monitoring_height,
        latest_height,
        monitor_lag: Math.max(latest_height - monitoring_height, 0),
        historical_backlog: Math.max(monitoring_height - historical_checkpoint, 0),
        total_backlog: Math.max(latest_height - historical_checkpoint, 0),
      };
    });
    
    res.json({ data: { status: 'ok', workers, chains: chainStatus } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Gap analysis endpoint
app.get('/api/v1/health/gaps', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const chains = transactionService.getAvailableChains();
    const gapAnalysis = [];
    
    for (const chain of chains) {
      // Get historical checkpoint
      const histRes = await client.query('SELECT last_height FROM historical_sync WHERE chain = $1', [chain]);
      const historical_checkpoint = histRes.rows[0]?.last_height ? parseInt(histRes.rows[0].last_height, 10) : 0;
      
      // Get monitoring height (highest processed block)
      const monitorRes = await client.query('SELECT MAX(height) as max_height FROM blocks WHERE chain = $1', [chain]);
      const monitoring_height = monitorRes.rows[0]?.max_height ? parseInt(monitorRes.rows[0].max_height, 10) : 0;
      
      // Get latest network height
      const snapRes = await client.query(`
        SELECT latest_height FROM metrics_snapshots 
        WHERE chain = $1 
        ORDER BY ts DESC 
        LIMIT 1
      `, [chain]);
      const latest_height = snapRes.rows[0]?.latest_height ? parseInt(snapRes.rows[0].latest_height, 10) : 0;
      
      // Find actual gaps in the database
      const gapsRes = await client.query(`
        WITH RECURSIVE height_sequence AS (
          SELECT $1 as height
          UNION ALL
          SELECT height + 1 FROM height_sequence WHERE height < $2
        ),
        existing_heights AS (
          SELECT height FROM blocks WHERE chain = $3 AND height BETWEEN $1 AND $2
        )
        SELECT hs.height as missing_height
        FROM height_sequence hs
        LEFT JOIN existing_heights eh ON hs.height = eh.height
        WHERE eh.height IS NULL
        ORDER BY hs.height
        LIMIT 100
      `, [historical_checkpoint + 1, monitoring_height, chain]);
      
      const gaps = gapsRes.rows.map(r => parseInt(r.missing_height, 10));
      const gap_count = gaps.length;
      
      gapAnalysis.push({
        chain,
        historical_checkpoint,
        monitoring_height,
        latest_height,
        gap_count,
        gaps: gaps.slice(0, 10), // Show first 10 gaps
        historical_backlog: Math.max(monitoring_height - historical_checkpoint, 0),
        monitor_lag: Math.max(latest_height - monitoring_height, 0),
        total_backlog: Math.max(latest_height - historical_checkpoint, 0),
        status: {
          has_gaps: gap_count > 0,
          critical: gap_count > 100 || Math.max(latest_height - historical_checkpoint, 0) > 1000
        }
      });
    }
    
    res.json({ data: { gap_analysis: gapAnalysis } });
  } catch (error) {
    console.error('Error analyzing gaps:', error);
    res.status(500).json({ error: error.message });
  }
});

// Admin endpoints for enrichment
// POST /api/v1/admin/suppliers/enrich
app.post('/api/v1/admin/suppliers/enrich', async (req, res) => {
  try {
    const { chain } = req.query;
    const { operator_addresses } = req.body || {};
    
    await transactionService.connectDB();
    
    // Set external pool for enrichment service
    supplierEnrichmentService.setExternalPool(transactionService.pgClient);
    
    const chains = chain ? [chain] : transactionService.getAvailableChains();
    const batchSize = parseInt(process.env.SUPPLIER_ENRICHMENT_BATCH || '200', 10);
    
    const results = {};
    
    for (const chainName of chains) {
      try {
        const result = await supplierEnrichmentService.enrichBatch(
          chainName,
          batchSize,
          operator_addresses
        );
        results[chainName] = result;
      } catch (error) {
        console.error(`[supplier-enrichment] Error enriching chain ${chainName}:`, error);
        results[chainName] = {
          processed: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          error: error.message
        };
      }
    }
    
    res.json({ chains: results });
  } catch (error) {
    console.error('Error in supplier enrichment endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/v1/admin/validators/refresh
app.post('/api/v1/admin/validators/refresh', async (req, res) => {
  try {
    const { chain } = req.query;
    
    await transactionService.connectDB();
    
    // Set external pool for validator service
    validatorService.setExternalPool(transactionService.pgClient);
    
    const chains = chain ? [chain] : transactionService.getAvailableChains();
    const results = {};
    
    for (const chainName of chains) {
      try {
        const count = await validatorService.fetchAndCacheValidators({ chain: chainName });
        results[chainName] = {
          status: 'ok',
          upserted: count
        };
      } catch (error) {
        console.error(`[validators] Error refreshing chain ${chainName}:`, error);
        results[chainName] = {
          status: 'error',
          error: error.message
        };
      }
    }
    
    res.json({ chains: results });
  } catch (error) {
    console.error('Error in validator refresh endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server and initialize the worker pool
const startServer = async () => {
  try {
    // Log startup banner
    console.log('='.repeat(80));
    console.log('🚀 POCKET NETWORK INDEXER SERVICE STARTING');
    console.log('='.repeat(80));
    console.log(`📅 Start Time: ${new Date().toISOString()}`);
    console.log(`🆔 Process ID: ${process.pid}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔌 Port: ${PORT}`);
    console.log(`📊 Node Version: ${process.version}`);
    console.log(`💾 Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    console.log('='.repeat(80));
    
    // Initialize worker pool
    console.log('🔄 Initializing worker pool...');
    await indexerPool.initialize();
    console.log('✅ Worker pool initialized successfully');
    
    // Start the HTTP server
    app.listen(PORT, () => {
      console.log(`🌐 HTTP server running on http://localhost:${PORT}`);
    });
    
    // Start metrics collector
    console.log('📈 Starting metrics collector...');
    metricsCollector.start();
    console.log('✅ Metrics collector started');
    
    // Initialize enrichment services with database pool
    validatorService.setExternalPool(transactionService.pgClient);
    supplierEnrichmentService.setExternalPool(transactionService.pgClient);
    
    // Start supplier enrichment periodic job
    if (process.env.ENABLE_SUPPLIER_ENRICHMENT === 'true') {
      const batchSize = parseInt(process.env.SUPPLIER_ENRICHMENT_BATCH || '200', 10);
      const interval = parseInt(process.env.SUPPLIER_ENRICHMENT_INTERVAL_MS || '3600000', 10);
      
      console.log(`🔄 Starting supplier enrichment job (interval: ${interval}ms, batch: ${batchSize})`);
      
      // Initial run
      (async () => {
        try {
          const chains = transactionService.getAvailableChains();
          console.log(`[supplier-enrichment] Initial enrichment start for chains: ${chains.join(', ')}`);
          for (const chain of chains) {
            const result = await supplierEnrichmentService.enrichBatch(chain, batchSize);
            console.log(`[supplier-enrichment] Chain ${chain}: processed=${result.processed}, updated=${result.updated}, skipped=${result.skipped}, failed=${result.failed}`);
          }
        } catch (error) {
          console.warn('[supplier-enrichment] Initial enrichment failed:', error.message);
        }
      })();
      
      // Periodic runs
      setInterval(async () => {
        try {
          const chains = transactionService.getAvailableChains();
          for (const chain of chains) {
            const result = await supplierEnrichmentService.enrichBatch(chain, batchSize);
            console.log(`[supplier-enrichment] Periodic enrichment ${chain}: processed=${result.processed}, updated=${result.updated}, skipped=${result.skipped}, failed=${result.failed}`);
          }
        } catch (error) {
          console.warn('[supplier-enrichment] Periodic enrichment failed:', error.message);
        }
      }, interval);
    }
    
    // Start validator refresh periodic job
    if (process.env.ENABLE_VALIDATOR_REFRESH === 'true') {
      const interval = parseInt(process.env.VALIDATOR_REFRESH_INTERVAL_MS || '21600000', 10);
      
      console.log(`🔄 Starting validator refresh job (interval: ${interval}ms)`);
      
      // Initial run
      (async () => {
        try {
          const chains = transactionService.getAvailableChains();
          console.log(`[validators] Initial refresh start for chains: ${chains.join(', ')}`);
          for (const chain of chains) {
            const count = await validatorService.fetchAndCacheValidators({ chain });
            console.log(`[validators] Chain ${chain}: upserted ${count} validators`);
          }
        } catch (error) {
          console.warn('[validators] Initial refresh failed:', error.message);
        }
      })();
      
      // Periodic runs
      setInterval(async () => {
        try {
          const chains = transactionService.getAvailableChains();
          for (const chain of chains) {
            const count = await validatorService.fetchAndCacheValidators({ chain });
            console.log(`[validators] Periodic refresh ${chain}: upserted ${count} validators`);
          }
        } catch (error) {
          console.warn('[validators] Periodic refresh failed:', error.message);
        }
      }, interval);
    }
    
    console.log('='.repeat(80));
    console.log('🎉 INDEXER SERVICE STARTED SUCCESSFULLY');
    console.log('='.repeat(80));
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('='.repeat(80));
      console.log('🛑 INDEXER SERVICE SHUTTING DOWN (SIGINT)');
      console.log(`📅 Shutdown Time: ${new Date().toISOString()}`);
      console.log(`⏱️  Uptime: ${Math.round(process.uptime())} seconds`);
      console.log('='.repeat(80));
      await indexerPool.shutdown();
      await metricsCollector.stop();
      console.log('👋 INDEXER SERVICE SHUTDOWN COMPLETE');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('='.repeat(80));
      console.log('🛑 INDEXER SERVICE SHUTTING DOWN (SIGTERM)');
      console.log(`📅 Shutdown Time: ${new Date().toISOString()}`);
      console.log(`⏱️  Uptime: ${Math.round(process.uptime())} seconds`);
      console.log('='.repeat(80));
      await indexerPool.shutdown();
      await metricsCollector.stop();
      console.log('👋 INDEXER SERVICE SHUTDOWN COMPLETE');
      process.exit(0);
    });
  } catch (error) {
    console.log('='.repeat(80));
    console.log('❌ INDEXER SERVICE STARTUP FAILED');
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