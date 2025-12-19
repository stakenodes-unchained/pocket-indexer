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
    this.blockResultsWorkers = new Map(); // Map<string, Worker[]> - array of workers per RPC
    this.blockResultsWorkerStats = new Map(); // Store stats from block results workers
    this.rpcEndpoints = getRpcEndpoints();
    this.concurrency = parseInt(process.env.WORKER_CONCURRENCY || '4', 10);
    this.batchSize = parseInt(process.env.HISTORICAL_BATCH_SIZE || '50', 10);
    this.blockResultsWorkerCount = parseInt(process.env.BLOCK_RESULTS_WORKER_COUNT || '2', 10); // Default: 1 for backward compatibility
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
            concurrency: this.concurrency,
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

        // Create block_results workers (only if blockResultsUrl is configured)
        if (rpc.blockResultsUrl) {
          const workers = [];
          
          for (let i = 0; i < this.blockResultsWorkerCount; i++) {
            const blockResultsWorker = new Worker(path.join(__dirname, 'blockResultsWorker.js'), {
              workerData: {
                rpcName: rpc.name,
                rpcUrl: rpc.url,
                blockResultsRpcUrl: rpc.blockResultsUrl,
                id: `${rpc.name}-block-results-${i}`
              }
            });

            blockResultsWorker.on('message', (message) => {
              if (message.type === 'log') {
                console.log(`[BlockResults Worker ${rpc.name}-${i}]`, message.data);
              } else if (message.type === 'error') {
                console.error(`[BlockResults Worker ${rpc.name}-${i}]`, message.data);
              } else if (message.type === 'stats') {
                // Store individual worker stats and aggregate
                const currentStats = this.blockResultsWorkerStats.get(rpc.name) || {
                  workers: [],
                  processedCount: 0,
                  failedCount: 0,
                  lastUpdate: Date.now()
                };
                
                // Ensure workers array exists and has enough slots
                if (!currentStats.workers) {
                  currentStats.workers = [];
                }
                while (currentStats.workers.length <= i) {
                  currentStats.workers.push(null);
                }
                
                // Store individual worker stats
                currentStats.workers[i] = {
                  ...message.data,
                  lastUpdate: Date.now()
                };
                
                // Aggregate totals across all workers
                currentStats.processedCount = currentStats.workers
                  .filter(w => w !== null)
                  .reduce((sum, w) => sum + (w.processedCount || 0), 0);
                currentStats.failedCount = currentStats.workers
                  .filter(w => w !== null)
                  .reduce((sum, w) => sum + (w.failedCount || 0), 0);
                
                // Calculate aggregated success rate
                const total = currentStats.processedCount + currentStats.failedCount;
                currentStats.successRate = total > 0
                  ? (currentStats.processedCount / total) * 100
                  : null;
                
                // Calculate weighted average processing time
                const workersWithTime = currentStats.workers
                  .filter(w => w !== null && w.avgProcessingTimeMs !== undefined && w.processedCount > 0);
                if (workersWithTime.length > 0) {
                  const totalProcessed = workersWithTime.reduce((sum, w) => sum + (w.processedCount || 0), 0);
                  currentStats.avgProcessingTimeMs = totalProcessed > 0
                    ? workersWithTime.reduce((sum, w) => {
                        const weight = (w.processedCount || 0) / totalProcessed;
                        return sum + (w.avgProcessingTimeMs || 0) * weight;
                      }, 0)
                    : null;
                } else {
                  currentStats.avgProcessingTimeMs = null;
                }
                
                // Get max block heights across all workers
                currentStats.currentBlockHeight = currentStats.workers
                  .filter(w => w !== null && w.currentBlockHeight !== undefined)
                  .map(w => w.currentBlockHeight)
                  .reduce((max, h) => h !== null && (max === null || h > max) ? h : max, null);
                
                currentStats.lastProcessedBlockHeight = currentStats.workers
                  .filter(w => w !== null && w.lastProcessedBlockHeight !== undefined)
                  .map(w => w.lastProcessedBlockHeight)
                  .reduce((max, h) => h !== null && (max === null || h > max) ? h : max, null);
                
                // Determine status: 'running' if any worker is running
                const runningWorkers = currentStats.workers
                  .filter(w => w !== null && w.status === 'running');
                currentStats.status = runningWorkers.length > 0 ? 'running' : 'stopped';
                
                currentStats.lastUpdate = Date.now();
                
                this.blockResultsWorkerStats.set(rpc.name, currentStats);
              }
            });

            blockResultsWorker.on('error', (err) => {
              console.error(`BlockResults worker ${rpc.name}-${i} encountered an error:`, err);
              this.restartBlockResultsWorker(rpc.name, rpc.blockResultsUrl, i);
            });

            blockResultsWorker.on('exit', (code) => {
              if (code !== 0) {
                console.error(`BlockResults worker ${rpc.name}-${i} exited with code ${code}`);
                this.restartBlockResultsWorker(rpc.name, rpc.blockResultsUrl, i);
              }
            });

            workers.push(blockResultsWorker);
          }

          this.blockResultsWorkers.set(rpc.name, workers);
          console.log(`Started ${this.blockResultsWorkerCount} block_results workers for RPC endpoint ${rpc.name} (${rpc.blockResultsUrl})`);
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
   * @param {string} rpcName - RPC endpoint name
   * @param {string} blockResultsRpcUrl - Block results RPC URL
   * @param {number} [workerIndex] - Optional worker index to restart. If not provided, restarts all workers.
   */
  async restartBlockResultsWorker(rpcName, blockResultsRpcUrl, workerIndex = null) {
    const workers = this.blockResultsWorkers.get(rpcName);
    
    if (workerIndex !== null && workerIndex !== undefined) {
      // Restart specific worker
      console.log(`Restarting block_results worker ${rpcName}-${workerIndex}...`);
      
      if (Array.isArray(workers) && workers[workerIndex]) {
        // Terminate old worker if it exists
        try {
          await workers[workerIndex].terminate();
        } catch (error) {
          // Worker may already be terminated
        }
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
            id: `${rpcName}-block-results-${workerIndex}`
          }
        });

        newWorker.on('message', (message) => {
          if (message.type === 'log') {
            console.log(`[BlockResults Worker ${rpcName}-${workerIndex}]`, message.data);
          } else if (message.type === 'error') {
            console.error(`[BlockResults Worker ${rpcName}-${workerIndex}]`, message.data);
          } else if (message.type === 'stats') {
            // Store individual worker stats and aggregate (same logic as in initialize)
            const currentStats = this.blockResultsWorkerStats.get(rpcName) || {
              workers: [],
              processedCount: 0,
              failedCount: 0,
              lastUpdate: Date.now()
            };
            
            if (!currentStats.workers) {
              currentStats.workers = [];
            }
            while (currentStats.workers.length <= workerIndex) {
              currentStats.workers.push(null);
            }
            
            currentStats.workers[workerIndex] = {
              ...message.data,
              lastUpdate: Date.now()
            };
            
            // Aggregate totals
            currentStats.processedCount = currentStats.workers
              .filter(w => w !== null)
              .reduce((sum, w) => sum + (w.processedCount || 0), 0);
            currentStats.failedCount = currentStats.workers
              .filter(w => w !== null)
              .reduce((sum, w) => sum + (w.failedCount || 0), 0);
            
            const total = currentStats.processedCount + currentStats.failedCount;
            currentStats.successRate = total > 0
              ? (currentStats.processedCount / total) * 100
              : null;
            
            const workersWithTime = currentStats.workers
              .filter(w => w !== null && w.avgProcessingTimeMs !== undefined && w.processedCount > 0);
            if (workersWithTime.length > 0) {
              const totalProcessed = workersWithTime.reduce((sum, w) => sum + (w.processedCount || 0), 0);
              currentStats.avgProcessingTimeMs = totalProcessed > 0
                ? workersWithTime.reduce((sum, w) => {
                    const weight = (w.processedCount || 0) / totalProcessed;
                    return sum + (w.avgProcessingTimeMs || 0) * weight;
                  }, 0)
                : null;
            } else {
              currentStats.avgProcessingTimeMs = null;
            }
            
            currentStats.currentBlockHeight = currentStats.workers
              .filter(w => w !== null && w.currentBlockHeight !== undefined)
              .map(w => w.currentBlockHeight)
              .reduce((max, h) => h !== null && (max === null || h > max) ? h : max, null);
            
            currentStats.lastProcessedBlockHeight = currentStats.workers
              .filter(w => w !== null && w.lastProcessedBlockHeight !== undefined)
              .map(w => w.lastProcessedBlockHeight)
              .reduce((max, h) => h !== null && (max === null || h > max) ? h : max, null);
            
            const runningWorkers = currentStats.workers
              .filter(w => w !== null && w.status === 'running');
            currentStats.status = runningWorkers.length > 0 ? 'running' : 'stopped';
            
            currentStats.lastUpdate = Date.now();
            
            this.blockResultsWorkerStats.set(rpcName, currentStats);
          }
        });

        newWorker.on('error', (err) => {
          console.error(`BlockResults worker ${rpcName}-${workerIndex} encountered an error:`, err);
          this.restartBlockResultsWorker(rpcName, blockResultsRpcUrl, workerIndex);
        });

        newWorker.on('exit', (code) => {
          if (code !== 0) {
            console.error(`BlockResults worker ${rpcName}-${workerIndex} exited with code ${code}`);
            this.restartBlockResultsWorker(rpcName, blockResultsRpcUrl, workerIndex);
          }
        });

        // Ensure workers array exists and has correct size
        if (!Array.isArray(workers)) {
          this.blockResultsWorkers.set(rpcName, []);
        }
        const workersArray = this.blockResultsWorkers.get(rpcName);
        while (workersArray.length <= workerIndex) {
          workersArray.push(null);
        }
        workersArray[workerIndex] = newWorker;
        
        console.log(`Restarted block_results worker ${rpcName}-${workerIndex}`);
      } catch (error) {
        console.error(`Failed to restart block_results worker ${rpcName}-${workerIndex}:`, error);
        setTimeout(() => this.restartBlockResultsWorker(rpcName, blockResultsRpcUrl, workerIndex), 10000);
      }
    } else {
      // Restart all workers (backward compatibility)
      console.log(`Restarting all block_results workers for RPC endpoint ${rpcName}...`);
      
      // Terminate all existing workers
      if (Array.isArray(workers)) {
        await Promise.all(workers.map((worker, index) => {
          if (worker) {
            return worker.terminate().catch(() => {});
          }
        }));
      }
      
      // Wait before restarting
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Recreate all workers
      const rpc = this.rpcEndpoints.find(e => e.name === rpcName);
      const newWorkers = [];
      
      for (let i = 0; i < this.blockResultsWorkerCount; i++) {
        try {
          const newWorker = new Worker(path.join(__dirname, 'blockResultsWorker.js'), {
            workerData: {
              rpcName,
              rpcUrl: rpc?.url,
              blockResultsRpcUrl,
              id: `${rpcName}-block-results-${i}`
            }
          });

          newWorker.on('message', (message) => {
            if (message.type === 'log') {
              console.log(`[BlockResults Worker ${rpcName}-${i}]`, message.data);
            } else if (message.type === 'error') {
              console.error(`[BlockResults Worker ${rpcName}-${i}]`, message.data);
            } else if (message.type === 'stats') {
              // Use same aggregation logic as initialize
              const currentStats = this.blockResultsWorkerStats.get(rpcName) || {
                workers: [],
                processedCount: 0,
                failedCount: 0,
                lastUpdate: Date.now()
              };
              
              if (!currentStats.workers) {
                currentStats.workers = [];
              }
              while (currentStats.workers.length <= i) {
                currentStats.workers.push(null);
              }
              
              currentStats.workers[i] = {
                ...message.data,
                lastUpdate: Date.now()
              };
              
              currentStats.processedCount = currentStats.workers
                .filter(w => w !== null)
                .reduce((sum, w) => sum + (w.processedCount || 0), 0);
              currentStats.failedCount = currentStats.workers
                .filter(w => w !== null)
                .reduce((sum, w) => sum + (w.failedCount || 0), 0);
              
              const total = currentStats.processedCount + currentStats.failedCount;
              currentStats.successRate = total > 0
                ? (currentStats.processedCount / total) * 100
                : null;
              
              const workersWithTime = currentStats.workers
                .filter(w => w !== null && w.avgProcessingTimeMs !== undefined && w.processedCount > 0);
              if (workersWithTime.length > 0) {
                const totalProcessed = workersWithTime.reduce((sum, w) => sum + (w.processedCount || 0), 0);
                currentStats.avgProcessingTimeMs = totalProcessed > 0
                  ? workersWithTime.reduce((sum, w) => {
                      const weight = (w.processedCount || 0) / totalProcessed;
                      return sum + (w.avgProcessingTimeMs || 0) * weight;
                    }, 0)
                  : null;
              } else {
                currentStats.avgProcessingTimeMs = null;
              }
              
              currentStats.currentBlockHeight = currentStats.workers
                .filter(w => w !== null && w.currentBlockHeight !== undefined)
                .map(w => w.currentBlockHeight)
                .reduce((max, h) => h !== null && (max === null || h > max) ? h : max, null);
              
              currentStats.lastProcessedBlockHeight = currentStats.workers
                .filter(w => w !== null && w.lastProcessedBlockHeight !== undefined)
                .map(w => w.lastProcessedBlockHeight)
                .reduce((max, h) => h !== null && (max === null || h > max) ? h : max, null);
              
              const runningWorkers = currentStats.workers
                .filter(w => w !== null && w.status === 'running');
              currentStats.status = runningWorkers.length > 0 ? 'running' : 'stopped';
              
              currentStats.lastUpdate = Date.now();
              
              this.blockResultsWorkerStats.set(rpcName, currentStats);
            }
          });

          newWorker.on('error', (err) => {
            console.error(`BlockResults worker ${rpcName}-${i} encountered an error:`, err);
            this.restartBlockResultsWorker(rpcName, blockResultsRpcUrl, i);
          });

          newWorker.on('exit', (code) => {
            if (code !== 0) {
              console.error(`BlockResults worker ${rpcName}-${i} exited with code ${code}`);
              this.restartBlockResultsWorker(rpcName, blockResultsRpcUrl, i);
            }
          });

          newWorkers.push(newWorker);
        } catch (error) {
          console.error(`Failed to create block_results worker ${rpcName}-${i}:`, error);
          newWorkers.push(null);
        }
      }
      
      this.blockResultsWorkers.set(rpcName, newWorkers);
      console.log(`Restarted ${newWorkers.filter(w => w !== null).length} block_results workers for RPC endpoint ${rpcName}`);
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
   * Start periodic health checks for Redis and memory monitoring
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
      
      // Log memory usage every 5 minutes
      const memUsage = process.memoryUsage();
      const heapSizeMB = parseInt(process.env.NODE_HEAP_SIZE_MB || '32768', 10);
      const rssMB = Math.round(memUsage.rss / 1024 / 1024);
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const externalMB = Math.round(memUsage.external / 1024 / 1024);
      const heapUsedPercent = heapSizeMB > 0 ? Math.round((heapUsedMB / heapSizeMB) * 100) : 0;
      
      const warningThresholdGB = parseInt(process.env.MEMORY_WARNING_THRESHOLD_GB || '12', 10);
      const warningThresholdMB = warningThresholdGB * 1024;
      
      console.log(`[Memory] RSS=${rssMB}MB, Heap=${heapUsedMB}MB/${heapSizeMB}MB (${heapUsedPercent}%), External=${externalMB}MB`);
      
      if (rssMB > warningThresholdMB) {
        console.warn(`[Memory Warning] RSS memory (${rssMB}MB) exceeds threshold (${warningThresholdMB}MB)`);
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
    for (const [name, workers] of this.blockResultsWorkers.entries()) {
      if (Array.isArray(workers)) {
        workers.forEach((worker, index) => {
          if (worker) {
            list.push({
              name: `${name}-block-results-${index}`,
              type: 'block-results',
              threadId: worker.threadId,
              isRunning: worker.threadId != null,
            });
          }
        });
      } else {
        // Backward compatibility: handle single worker (shouldn't happen with new code)
        list.push({
          name: `${name}-block-results`,
          type: 'block-results',
          threadId: workers.threadId,
          isRunning: workers.threadId != null,
        });
      }
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
      
      // Get aggregated worker stats (from worker messages)
      const workerStats = this.blockResultsWorkerStats.get(rpcName) || {};
      
      // Check if any workers are running
      const workers = this.blockResultsWorkers.get(rpcName);
      let isRunning = false;
      let workerCount = 0;
      
      if (Array.isArray(workers)) {
        workerCount = workers.filter(w => w !== null).length;
        isRunning = workers.some(w => w !== null && w.threadId != null);
      } else if (workers) {
        // Backward compatibility: handle single worker (shouldn't happen with new code)
        workerCount = 1;
        isRunning = workers.threadId != null;
      }
      
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
        worker_count: workerCount,
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
        worker_count: 0,
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
    for (const [name, workers] of this.blockResultsWorkers.entries()) {
      if (Array.isArray(workers)) {
        workers.forEach((worker, index) => {
          if (worker) {
            console.log(`Terminating block_results worker ${name}-${index}...`);
            promises.push(worker.terminate());
          }
        });
      } else if (workers) {
        // Backward compatibility: handle single worker (shouldn't happen with new code)
        console.log(`Terminating block_results worker for ${name}...`);
        promises.push(workers.terminate());
      }
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