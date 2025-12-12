const { Worker } = require('worker_threads');
const path = require('path');
const redis = require('../../config/redis');
const { getRpcEndpoints } = require('../../config/rpc');

// Worker pool for parallel processing
class TransactionWorkerPool {
  constructor() {
    this.workers = new Map();
    this.historicalWorkers = new Map();
    this.monitorWorkers = new Map();
    this.blockResultsWorkers = new Map();
    this.blockResultsWorkerStats = new Map(); // Store stats from block results workers
    this.rpcEndpoints = getRpcEndpoints();
    this.concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2', 2);
    this.batchSize = parseInt(process.env.HISTORICAL_BATCH_SIZE || '50', 10);
    this.healthCheckInterval = null;
  }

  /**
   * Initialize workers for all configured RPC endpoints
   */
  async initialize() {
    if (this.rpcEndpoints.length === 0) {
      console.error('No RPC endpoints configured, cannot start workers');
      return;
    }

    // First, check Redis connection
    try {
      await this.checkRedisHealth();
    } catch (error) {
      console.error('Redis health check failed during initialization:', error);
      throw new Error('Failed to connect to Redis. Please check Redis configuration and ensure it is running.');
    }

    for (const rpc of this.rpcEndpoints) {
      try {
        // Create historical sync worker
        const historicalWorker = new Worker(path.join(__dirname, 'worker.js'), {
          workerData: {
            rpcName: rpc.name,
            rpcUrl: rpc.url,
            blockResultsRpcUrl: rpc.blockResultsUrl,
            batchSize: this.batchSize,
            id: `${rpc.name}-historical`,
            processType: 'historical'
          }
        });

        historicalWorker.on('message', (message) => {
          if (message.type === 'log') {
            console.log(`[Historical Worker ${rpc.name}]`, message.data);
          } else if (message.type === 'error') {
            console.error(`[Historical Worker ${rpc.name}]`, message.data);
          } else if (message.type === 'status') {
            console.log(`[Historical Worker ${rpc.name}] Status:`, message.data);
          }
        });

        historicalWorker.on('error', (err) => {
          console.error(`Historical worker for ${rpc.name} encountered an error:`, err);
          this.restartHistoricalWorker(rpc.name, rpc.url);
        });

        historicalWorker.on('exit', (code) => {
          if (code !== 0) {
            console.error(`Historical worker for ${rpc.name} exited with code ${code}`);
            this.restartHistoricalWorker(rpc.name, rpc.url);
          }
        });

        this.historicalWorkers.set(rpc.name, historicalWorker);
        console.log(`Started historical worker for RPC endpoint ${rpc.name} (${rpc.url})`);

        // Create monitoring worker
        const monitorWorker = new Worker(path.join(__dirname, 'worker.js'), {
          workerData: {
            rpcName: rpc.name,
            rpcUrl: rpc.url,
            blockResultsRpcUrl: rpc.blockResultsUrl,
            batchSize: this.batchSize,
            id: `${rpc.name}-monitor`,
            processType: 'monitor'
          }
        });

        monitorWorker.on('message', (message) => {
          if (message.type === 'log') {
            console.log(`[Monitor Worker ${rpc.name}]`, message.data);
          } else if (message.type === 'error') {
            console.error(`[Monitor Worker ${rpc.name}]`, message.data);
          } else if (message.type === 'status') {
            console.log(`[Monitor Worker ${rpc.name}] Status:`, message.data);
          }
        });

        monitorWorker.on('error', (err) => {
          console.error(`Monitor worker for ${rpc.name} encountered an error:`, err);
          this.restartMonitorWorker(rpc.name, rpc.url);
        });

        monitorWorker.on('exit', (code) => {
          if (code !== 0) {
            console.error(`Monitor worker for ${rpc.name} exited with code ${code}`);
            this.restartMonitorWorker(rpc.name, rpc.url);
          }
        });

        this.monitorWorkers.set(rpc.name, monitorWorker);
        console.log(`Started monitor worker for RPC endpoint ${rpc.name} (${rpc.url})`);

        // Create block_results worker (only if blockResultsUrl is configured)
        if (rpc.blockResultsUrl) {
          const blockResultsWorker = new Worker(path.join(__dirname, 'blockResultsWorker.js'), {
            workerData: {
              rpcName: rpc.name,
              rpcUrl: rpc.url,
              blockResultsRpcUrl: rpc.blockResultsUrl,
              id: `${rpc.name}-block-results`
            }
          });

          blockResultsWorker.on('message', (message) => {
            if (message.type === 'log') {
              console.log(`[BlockResults Worker ${rpc.name}]`, message.data);
            } else if (message.type === 'error') {
              console.error(`[BlockResults Worker ${rpc.name}]`, message.data);
            } else if (message.type === 'stats') {
              // Store stats from worker
              this.blockResultsWorkerStats.set(rpc.name, {
                ...message.data,
                lastUpdate: Date.now()
              });
            }
          });

          blockResultsWorker.on('error', (err) => {
            console.error(`BlockResults worker for ${rpc.name} encountered an error:`, err);
            this.restartBlockResultsWorker(rpc.name, rpc.blockResultsUrl);
          });

          blockResultsWorker.on('exit', (code) => {
            if (code !== 0) {
              console.error(`BlockResults worker for ${rpc.name} exited with code ${code}`);
              this.restartBlockResultsWorker(rpc.name, rpc.blockResultsUrl);
            }
          });

          this.blockResultsWorkers.set(rpc.name, blockResultsWorker);
          console.log(`Started block_results worker for RPC endpoint ${rpc.name} (${rpc.blockResultsUrl})`);
        }
      } catch (error) {
        console.error(`Failed to start workers for RPC endpoint ${rpc.name}:`, error);
      }
    }

    // Start periodic health checks
    this.startHealthChecks();
  }

  /**
   * Restart a historical worker that has crashed or exited
   */
  async restartHistoricalWorker(rpcName, rpcUrl) {
    console.log(`Restarting historical worker for RPC endpoint ${rpcName}...`);
    
    // Remove the old worker reference
    if (this.historicalWorkers.has(rpcName)) {
      this.historicalWorkers.delete(rpcName);
    }
    
    // Wait before restarting to avoid rapid restart cycles
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      const rpc = this.rpcEndpoints.find(e => e.name === rpcName);
      const newWorker = new Worker(path.join(__dirname, 'worker.js'), {
        workerData: {
          rpcName,
          rpcUrl,
          blockResultsRpcUrl: rpc?.blockResultsUrl,
          batchSize: this.batchSize,
          id: `${rpcName}-historical`,
          processType: 'historical'
        }
      });

      newWorker.on('message', (message) => {
        if (message.type === 'log') {
          console.log(`[Historical Worker ${rpcName}]`, message.data);
        } else if (message.type === 'error') {
          console.error(`[Historical Worker ${rpcName}]`, message.data);
        }
      });

      newWorker.on('error', (err) => {
        console.error(`Historical worker for ${rpcName} encountered an error:`, err);
        this.restartHistoricalWorker(rpcName, rpcUrl);
      });

      newWorker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Historical worker for ${rpcName} exited with code ${code}`);
          this.restartHistoricalWorker(rpcName, rpcUrl);
        }
      });

      this.historicalWorkers.set(rpcName, newWorker);
      console.log(`Restarted historical worker for RPC endpoint ${rpcName}`);
    } catch (error) {
      console.error(`Failed to restart historical worker for RPC endpoint ${rpcName}:`, error);
      // Try again after a longer delay
      setTimeout(() => this.restartHistoricalWorker(rpcName, rpcUrl), 10000);
    }
  }

  /**
   * Restart a block_results worker that has crashed or exited
   */
  async restartBlockResultsWorker(rpcName, blockResultsRpcUrl) {
    console.log(`Restarting block_results worker for RPC endpoint ${rpcName}...`);
    
    // Remove the old worker reference
    if (this.blockResultsWorkers.has(rpcName)) {
      this.blockResultsWorkers.delete(rpcName);
    }
    
    // Wait before restarting to avoid rapid restart cycles
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      const rpc = this.rpcEndpoints.find(e => e.name === rpcName);
      const newWorker = new Worker(path.join(__dirname, 'blockResultsWorker.js'), {
        workerData: {
          rpcName,
          rpcUrl: rpc?.url,
          blockResultsRpcUrl,
          id: `${rpcName}-block-results`
        }
      });

          newWorker.on('message', (message) => {
            if (message.type === 'log') {
              console.log(`[BlockResults Worker ${rpcName}]`, message.data);
            } else if (message.type === 'error') {
              console.error(`[BlockResults Worker ${rpcName}]`, message.data);
            } else if (message.type === 'stats') {
              // Store stats from worker
              this.blockResultsWorkerStats.set(rpcName, {
                ...message.data,
                lastUpdate: Date.now()
              });
            }
          });

      newWorker.on('error', (err) => {
        console.error(`BlockResults worker for ${rpcName} encountered an error:`, err);
        this.restartBlockResultsWorker(rpcName, blockResultsRpcUrl);
      });

      newWorker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`BlockResults worker for ${rpcName} exited with code ${code}`);
          this.restartBlockResultsWorker(rpcName, blockResultsRpcUrl);
        }
      });

      this.blockResultsWorkers.set(rpcName, newWorker);
      console.log(`Restarted block_results worker for RPC endpoint ${rpcName}`);
    } catch (error) {
      console.error(`Failed to restart block_results worker for RPC endpoint ${rpcName}:`, error);
      // Try again after a longer delay
      setTimeout(() => this.restartBlockResultsWorker(rpcName, blockResultsRpcUrl), 10000);
    }
  }

  /**
   * Restart a monitor worker that has crashed or exited
   */
  async restartMonitorWorker(rpcName, rpcUrl) {
    console.log(`Restarting monitor worker for RPC endpoint ${rpcName}...`);
    
    // Remove the old worker reference
    if (this.monitorWorkers.has(rpcName)) {
      this.monitorWorkers.delete(rpcName);
    }
    
    // Wait before restarting to avoid rapid restart cycles
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      const rpc = this.rpcEndpoints.find(e => e.name === rpcName);
      const newWorker = new Worker(path.join(__dirname, 'worker.js'), {
        workerData: {
          rpcName,
          rpcUrl,
          blockResultsRpcUrl: rpc?.blockResultsUrl,
          batchSize: this.batchSize,
          id: `${rpcName}-monitor`,
          processType: 'monitor'
        }
      });

      newWorker.on('message', (message) => {
        if (message.type === 'log') {
          console.log(`[Monitor Worker ${rpcName}]`, message.data);
        } else if (message.type === 'error') {
          console.error(`[Monitor Worker ${rpcName}]`, message.data);
        }
      });

      newWorker.on('error', (err) => {
        console.error(`Monitor worker for ${rpcName} encountered an error:`, err);
        this.restartMonitorWorker(rpcName, rpcUrl);
      });

      newWorker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Monitor worker for ${rpcName} exited with code ${code}`);
          this.restartMonitorWorker(rpcName, rpcUrl);
        }
      });

      this.monitorWorkers.set(rpcName, newWorker);
      console.log(`Restarted monitor worker for RPC endpoint ${rpcName}`);
    } catch (error) {
      console.error(`Failed to restart monitor worker for RPC endpoint ${rpcName}:`, error);
      // Try again after a longer delay
      setTimeout(() => this.restartMonitorWorker(rpcName, rpcUrl), 10000);
    }
  }

  /**
   * Check Redis health and connection
   */
  async checkRedisHealth() {
    try {
      const ping = await redis.ping();
      if (ping !== 'PONG') {
        throw new Error('Redis ping did not return PONG');
      }
      
      // Check memory usage
      const info = await redis.info('memory');
      console.log('Redis memory info:', info);
      
      return true;
    } catch (error) {
      console.error('Redis health check failed:', error);
      return false;
    }
  }

  /**
   * Start periodic health checks for Redis
   */
  startHealthChecks() {
    // Clear any existing interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    // Run health check every 5 minutes
    this.healthCheckInterval = setInterval(async () => {
      console.log('Running Redis health check...');
      
      const isHealthy = await this.checkRedisHealth();
      if (!isHealthy) {
        console.error('Redis health check failed, attempting to recover...');
        // Try to flush some data if necessary
        try {
          // Check if we need to trim some data (optional)
          const txsSize = await redis.zcard('chain:*:txs');
          console.log(`Current transactions in Redis: ${txsSize}`);
          
          // Log the status but don't take action automatically
        } catch (error) {
          console.error('Failed to check Redis data size:', error);
        }
      }
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Summarize current workers
   */
  getWorkersStatus() {
    const list = [];
    
    // Add historical workers
    for (const [name, worker] of this.historicalWorkers.entries()) {
      list.push({
        name: `${name}-historical`,
        type: 'historical',
        threadId: worker.threadId,
        isRunning: worker.threadId != null,
      });
    }
    
    // Add monitor workers
    for (const [name, worker] of this.monitorWorkers.entries()) {
      list.push({
        name: `${name}-monitor`,
        type: 'monitor',
        threadId: worker.threadId,
        isRunning: worker.threadId != null,
      });
    }
    
    // Add block_results workers
    for (const [name, worker] of this.blockResultsWorkers.entries()) {
      list.push({
        name: `${name}-block-results`,
        type: 'block-results',
        threadId: worker.threadId,
        isRunning: worker.threadId != null,
      });
    }
    
    // Add legacy workers for backward compatibility
    for (const [name, worker] of this.workers.entries()) {
      list.push({
        name,
        type: 'legacy',
        threadId: worker.threadId,
        isRunning: worker.threadId != null,
      });
    }
    
    return list;
  }

  /**
   * Return Redis stats (memory, keyspace) for health endpoints
   */
  async getRedisStats() {
    try {
      const memory = await redis.info('memory');
      const stats = await redis.info('stats');
      const keyspace = await redis.info('keyspace');
      return { memory, stats, keyspace };
    } catch (e) {
      return { error: e.message };
    }
  }

  /**
   * Get block results worker stats for a specific RPC endpoint
   * @param {string} rpcName - RPC endpoint name
   * @returns {Promise<Object>} Stats object
   */
  async getBlockResultsWorkerStats(rpcName) {
    const {
      getQueueSize,
      getDelayedItemsCount,
      getProcessingItemsCount
    } = require('./blockResultsQueue');
    
    try {
      // Get queue stats from Redis
      const queueSize = await getQueueSize(rpcName);
      const delayedItems = await getDelayedItemsCount(rpcName);
      const processingItems = await getProcessingItemsCount(rpcName);
      
      // Get worker stats (from worker messages)
      const workerStats = this.blockResultsWorkerStats.get(rpcName) || {};
      
      // Check if worker is running
      const worker = this.blockResultsWorkers.get(rpcName);
      const isRunning = worker && worker.threadId != null;
      
      // Determine worker status
      let workerStatus = 'stopped';
      if (isRunning) {
        const lastUpdate = workerStats.lastUpdate || 0;
        const timeSinceUpdate = Date.now() - lastUpdate;
        // If no update in last 2 minutes, consider it stale
        if (timeSinceUpdate < 120000) {
          workerStatus = workerStats.status || 'running';
        } else {
          workerStatus = 'stale';
        }
      }
      
      return {
        rpc_name: rpcName,
        status: workerStatus,
        queue_size: queueSize,
        delayed_items: delayedItems,
        processing_items: processingItems,
        processed_count: workerStats.processedCount || 0,
        failed_count: workerStats.failedCount || 0,
        success_rate: workerStats.successRate !== undefined ? workerStats.successRate : null,
        avg_processing_time_ms: workerStats.avgProcessingTimeMs !== undefined ? workerStats.avgProcessingTimeMs : null,
        current_block_height: workerStats.currentBlockHeight !== undefined ? workerStats.currentBlockHeight : null,
        last_processed_block_height: workerStats.lastProcessedBlockHeight !== undefined ? workerStats.lastProcessedBlockHeight : null,
        last_update: workerStats.lastUpdate || null
      };
    } catch (error) {
      console.error(`[Pool] Error getting block results worker stats for ${rpcName}:`, error);
      return {
        rpc_name: rpcName,
        status: 'error',
        queue_size: 0,
        delayed_items: 0,
        processing_items: 0,
        processed_count: 0,
        failed_count: 0,
        success_rate: null,
        avg_processing_time_ms: null,
        current_block_height: null,
        last_processed_block_height: null,
        error: error.message
      };
    }
  }

  /**
   * Get block results worker stats for all RPC endpoints
   * @returns {Promise<Array>} Array of stats objects
   */
  async getAllBlockResultsWorkerStats() {
    const stats = [];
    
    // Get stats for all RPC endpoints that have blockResultsUrl configured
    for (const rpc of this.rpcEndpoints) {
      if (rpc.blockResultsUrl) {
        const rpcStats = await this.getBlockResultsWorkerStats(rpc.name);
        stats.push(rpcStats);
      }
    }
    
    return stats;
  }

  /**
   * Shutdown all workers
   */
  async shutdown() {
    console.log('Shutting down all transaction workers...');
    
    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    const promises = [];
    
    // Shutdown historical workers
    for (const [name, worker] of this.historicalWorkers.entries()) {
      console.log(`Terminating historical worker for ${name}...`);
      promises.push(worker.terminate());
    }
    
    // Shutdown monitor workers
    for (const [name, worker] of this.monitorWorkers.entries()) {
      console.log(`Terminating monitor worker for ${name}...`);
      promises.push(worker.terminate());
    }
    
    // Shutdown block_results workers
    for (const [name, worker] of this.blockResultsWorkers.entries()) {
      console.log(`Terminating block_results worker for ${name}...`);
      promises.push(worker.terminate());
    }
    
    // Shutdown legacy workers
    for (const [name, worker] of this.workers.entries()) {
      console.log(`Terminating legacy worker for ${name}...`);
      promises.push(worker.terminate());
    }
    
    await Promise.all(promises);
    this.historicalWorkers.clear();
    this.monitorWorkers.clear();
    this.blockResultsWorkers.clear();
    this.workers.clear();
    console.log('All transaction workers have been terminated');
  }
}

module.exports = new TransactionWorkerPool(); 