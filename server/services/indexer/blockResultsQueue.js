/**
 * Block Results Queue Service
 * Manages Redis queue for asynchronous block_results processing
 */

const redis = require('../../config/redis');
const { pgPool, connectClients } = require('./db');

const MAX_RETRIES = 5;
const PROCESSING_TIMEOUT_SEC = 300; // 5 minutes timeout for processing

/**
 * Enqueue a block height for block_results processing
 * @param {string} rpcName - RPC endpoint name
 * @param {number} height - Block height
 * @returns {Promise<boolean>} Success status
 */
async function enqueueBlockResults(rpcName, height, options = {}) {
  try {
    const queueKey = `block_results_queue:${rpcName}`;
    const queuedSetKey = `block_results_queued:${rpcName}`;
    const processingKey = (h) => `block_results_processing:${rpcName}:${h}`;
    
    // Check if already queued (using Redis Set for O(1) lookup)
    try {
      const isQueued = await redis.sismember(queuedSetKey, height.toString());
      if (isQueued) {
        // Already in queue, skip
        return false;
      }
    } catch (error) {
      // If Set check fails, log warning but continue (fail open)
      console.warn(`[BlockResultsQueue] Error checking queued set for block ${height}: ${error.message}, continuing...`);
    }
    
    // Check if currently being processed
    const isProcessing = await redis.exists(processingKey(height));
    if (isProcessing) {
      // Currently being processed, skip
      return false;
    }
    
    // Check if already processed
    const isProcessed = await isBlockProcessed(rpcName, height);
    if (isProcessed) {
      // Already processed, skip
      return false;
    }
    
    const pushSide = options.pushSide === 'right' ? 'right' : 'left';
    const item = JSON.stringify({
      height: height,
      timestamp: Date.now(),
      retries: 0
    });
    
    // Add to queue (left push for higher priority, right push for lower priority)
    if (pushSide === 'right') {
      await redis.rpush(queueKey, item);
    } else {
      await redis.lpush(queueKey, item);
    }
    
    // Add to queued Set to track this height
    await redis.sadd(queuedSetKey, height.toString());
    
    // Refresh expiration on queue and set (7 days) to prevent unbounded growth
    // Only set expiration if queue has items
    const queueSize = await redis.llen(queueKey);
    if (queueSize > 0) {
      await redis.expire(queueKey, 7 * 24 * 60 * 60);
      await redis.expire(queuedSetKey, 7 * 24 * 60 * 60);
    }
    
    return true;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error enqueueing block ${height} for ${rpcName}:`, error.message);
    return false;
  }
}

/**
 * Dequeue a block height from the queue
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<Object|null>} Block item or null if queue is empty
 */
async function dequeueBlockResults(rpcName) {
  try {
    const queueKey = `block_results_queue:${rpcName}`;
    const processingKey = (height) => `block_results_processing:${rpcName}:${height}`;
    
    // Get item from queue (right pop for FIFO)
    const itemStr = await redis.rpop(queueKey);
    
    if (!itemStr) {
      return null;
    }
    
    const item = JSON.parse(itemStr);
    
    // Check if already being processed (stale processing lock)
    const existingLock = await redis.get(processingKey(item.height));
    if (existingLock) {
      // Check if lock is stale (older than timeout)
      const lockTimestamp = parseInt(existingLock, 10);
      const now = Date.now();
      if (now - lockTimestamp < PROCESSING_TIMEOUT_SEC * 1000) {
        // Still being processed, put it back at the front
        await redis.lpush(queueKey, itemStr);
        return null;
      }
      // Lock is stale, remove it
      await redis.del(processingKey(item.height));
    }
    
    // Set processing lock
    await redis.setex(processingKey(item.height), PROCESSING_TIMEOUT_SEC, Date.now().toString());
    
    // Remove from queued Set since item is being processed
    const queuedSetKey = `block_results_queued:${rpcName}`;
    await redis.srem(queuedSetKey, item.height.toString());
    
    return item;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error dequeuing block for ${rpcName}:`, error.message);
    return null;
  }
}

/**
 * Lease-scan dequeue to pick an item within a role-specific height range.
 * Scans a small batch and requeues out-of-range items to the front.
 * @param {string} rpcName - RPC endpoint name
 * @param {Object} options - Role and range options
 * @param {'current'|'historical'} options.role - Worker role
 * @param {number|null} options.latestHeight - Latest chain height (null if unknown)
 * @param {number} options.windowBlocks - Current window size in blocks
 * @param {number} options.scanCount - Max items to scan per attempt
 * @returns {Promise<Object|null>} Block item or null if none found
 */
async function leaseScanDequeueBlockResults(rpcName, options = {}) {
  const {
    role = 'historical',
    latestHeight = null,
    windowBlocks = 50,
    scanCount = 8
  } = options;

  const queueKey = `block_results_queue:${rpcName}`;
  const processingKey = (height) => `block_results_processing:${rpcName}:${height}`;
  const popCommand = role === 'current' ? 'lpop' : 'rpop';

  const hasLatestHeight = Number.isFinite(latestHeight);
  const minCurrentHeight = hasLatestHeight
    ? Math.max(0, latestHeight - windowBlocks)
    : null;

  try {
    for (let i = 0; i < scanCount; i++) {
      const itemStr = await redis[popCommand](queueKey);
      if (!itemStr) {
        return null;
      }

      let item;
      try {
        item = JSON.parse(itemStr);
      } catch (error) {
        console.error(`[BlockResultsQueue] Invalid queue item JSON for ${rpcName}:`, error.message);
        // Requeue to avoid data loss
        await redis.lpush(queueKey, itemStr);
        continue;
      }

      const height = item?.height;
      if (!Number.isFinite(height)) {
        console.error(`[BlockResultsQueue] Invalid queue item height for ${rpcName}:`, item);
        await redis.lpush(queueKey, itemStr);
        continue;
      }

      // Check if already being processed (stale processing lock)
      const existingLock = await redis.get(processingKey(height));
      if (existingLock) {
        const lockTimestamp = parseInt(existingLock, 10);
        const now = Date.now();
        if (!Number.isNaN(lockTimestamp) && now - lockTimestamp < PROCESSING_TIMEOUT_SEC * 1000) {
          await redis.lpush(queueKey, itemStr);
          continue;
        }
        await redis.del(processingKey(height));
      }

      // Range check
      let inRange = true;
      if (hasLatestHeight) {
        inRange = role === 'current'
          ? height >= minCurrentHeight
          : height < minCurrentHeight;
      } else if (role === 'current') {
        inRange = false;
      }

      if (!inRange) {
        const requeueCommand = role === 'current' ? 'rpush' : 'lpush';
        await redis[requeueCommand](queueKey, itemStr);
        continue;
      }

      // Set processing lock and return item
      await redis.setex(processingKey(height), PROCESSING_TIMEOUT_SEC, Date.now().toString());
      
      // Remove from queued Set since item is being processed
      const queuedSetKey = `block_results_queued:${rpcName}`;
      await redis.srem(queuedSetKey, height.toString());
      
      return item;
    }

    return null;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error lease-scanning block for ${rpcName}:`, error.message);
    return null;
  }
}

/**
 * Mark a block as processed in Redis set (fast lookup)
 * @param {string} rpcName - RPC endpoint name
 * @param {number} height - Block height
 * @returns {Promise<void>}
 */
async function markBlockProcessedRedis(rpcName, height) {
  try {
    const processedKey = `block_results_processed:${rpcName}`;
    await redis.sadd(processedKey, height.toString());
    // Set expiration on the set (7 days)
    await redis.expire(processedKey, 7 * 24 * 60 * 60);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error marking block ${height} as processed in Redis:`, error.message);
  }
}

/**
 * Mark a block as processed in database (persistent)
 * @param {string} rpcName - RPC endpoint name
 * @param {number} height - Block height
 * @param {string} status - Processing status (processed, failed, skipped)
 * @param {string} errorMessage - Optional error message
 * @returns {Promise<void>}
 */
async function markBlockProcessedDB(rpcName, height, status = 'processed', errorMessage = null) {
  try {
    await connectClients();
    await pgPool.query(
      `INSERT INTO block_results_processed (chain, height, processed_at, status, error_message)
       VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)
       ON CONFLICT (chain, height) 
       DO UPDATE SET processed_at = CURRENT_TIMESTAMP, status = $3, error_message = $4`,
      [rpcName, height, status, errorMessage]
    );
  } catch (error) {
    console.error(`[BlockResultsQueue] Error marking block ${height} as processed in DB:`, error.message);
  }
}

/**
 * Mark a block as successfully processed (both Redis and DB)
 * @param {string} rpcName - RPC endpoint name
 * @param {number} height - Block height
 * @param {string} status - Processing status (default: 'processed')
 * @param {string} errorMessage - Optional error message
 * @returns {Promise<void>}
 */
async function markProcessed(rpcName, height, status = 'processed', errorMessage = null) {
  try {
    const processingKey = `block_results_processing:${rpcName}:${height}`;
    await redis.del(processingKey);
    
    // Remove from queued Set when marking as processed
    const queuedSetKey = `block_results_queued:${rpcName}`;
    await redis.srem(queuedSetKey, height.toString());
    
    // Mark in both Redis and DB
    await Promise.all([
      markBlockProcessedRedis(rpcName, height),
      markBlockProcessedDB(rpcName, height, status, errorMessage)
    ]);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error marking block ${height} as processed:`, error.message);
  }
}

/**
 * Check if a block has been processed
 * @param {string} rpcName - RPC endpoint name
 * @param {number} height - Block height
 * @returns {Promise<boolean>}
 */
async function isBlockProcessed(rpcName, height) {
  try {
    // Check Redis first (fast)
    const processedKey = `block_results_processed:${rpcName}`;
    const inRedis = await redis.sismember(processedKey, height.toString());
    if (inRedis) {
      return true;
    }
    
    // Fallback to DB if not in Redis
    await connectClients();
    const result = await pgPool.query(
      `SELECT 1 FROM block_results_processed WHERE chain = $1 AND height = $2 LIMIT 1`,
      [rpcName, height]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error checking if block ${height} is processed:`, error.message);
    return false;
  }
}

/**
 * Get processed blocks in a range
 * @param {string} rpcName - RPC endpoint name
 * @param {number} startHeight - Start height
 * @param {number} endHeight - End height
 * @returns {Promise<Array>} Array of processed heights
 */
async function getProcessedBlocks(rpcName, startHeight, endHeight) {
  try {
    await connectClients();
    const result = await pgPool.query(
      `SELECT height FROM block_results_processed 
       WHERE chain = $1 AND height >= $2 AND height <= $3 
       ORDER BY height`,
      [rpcName, startHeight, endHeight]
    );
    return result.rows.map(r => parseInt(r.height, 10));
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting processed blocks:`, error.message);
    return [];
  }
}

/**
 * Get unprocessed blocks (gaps) in a range
 * @param {string} rpcName - RPC endpoint name
 * @param {number} startHeight - Start height
 * @param {number} endHeight - End height
 * @returns {Promise<Array>} Array of unprocessed heights
 */
async function getUnprocessedBlocks(rpcName, startHeight, endHeight) {
  try {
    await connectClients();
    // Get all heights in range that are NOT in processed table
    const result = await pgPool.query(
      `WITH height_range AS (
         SELECT generate_series($2::bigint, $3::bigint) AS height
       )
       SELECT hr.height
       FROM height_range hr
       LEFT JOIN block_results_processed brp ON brp.chain = $1 AND brp.height = hr.height
       WHERE brp.height IS NULL
       ORDER BY hr.height`,
      [rpcName, startHeight, endHeight]
    );
    return result.rows.map(r => parseInt(r.height, 10));
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting unprocessed blocks:`, error.message);
    return [];
  }
}

/**
 * Get count of processed blocks in a range
 * @param {string} rpcName - RPC endpoint name
 * @param {number} startHeight - Start height
 * @param {number} endHeight - End height
 * @returns {Promise<number>} Count of processed blocks
 */
async function getProcessedBlocksCount(rpcName, startHeight, endHeight) {
  try {
    await connectClients();
    const result = await pgPool.query(
      `SELECT COUNT(*) as count FROM block_results_processed 
       WHERE chain = $1 AND height >= $2 AND height <= $3`,
      [rpcName, startHeight, endHeight]
    );
    return parseInt(result.rows[0]?.count || 0, 10);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting processed blocks count:`, error.message);
    return 0;
  }
}

/**
 * Mark a block as failed and requeue if retries not exceeded
 * @param {string} rpcName - RPC endpoint name
 * @param {number} height - Block height
 * @param {Object} item - Block item with retry count
 * @returns {Promise<boolean>} Whether item was requeued
 */
async function markFailed(rpcName, height, item) {
  try {
    const processingKey = `block_results_processing:${rpcName}:${height}`;
    await redis.del(processingKey);
    
    // Increment retry count
    item.retries = (item.retries || 0) + 1;
    item.timestamp = Date.now();
    
    if (item.retries < MAX_RETRIES) {
      // Requeue with exponential backoff delay
      const delaySeconds = Math.min(Math.pow(2, item.retries), 300); // Max 5 minutes
      const queueKey = `block_results_queue:${rpcName}`;
      
      // Use a delayed queue approach: add to a delay set
      const delayKey = `block_results_delay:${rpcName}`;
      const score = Date.now() + (delaySeconds * 1000);
      await redis.zadd(delayKey, score, JSON.stringify(item));
      await redis.expire(delayKey, 7 * 24 * 60 * 60);
      
      // Keep in queued Set since it's being requeued to delayed queue
      // (will be added back to main queue later via getReadyDelayedItems)
      
      return true;
    } else {
      // Max retries exceeded, log for manual review
      console.error(`[BlockResultsQueue] Block ${height} exceeded max retries (${MAX_RETRIES}), skipping`);
      
      // Remove from queued Set when max retries exceeded
      const queuedSetKey = `block_results_queued:${rpcName}`;
      await redis.srem(queuedSetKey, height.toString());
      
      return false;
    }
  } catch (error) {
    console.error(`[BlockResultsQueue] Error marking block ${height} as failed:`, error.message);
    return false;
  }
}

/**
 * Add an item to the delayed queue with a specific delay
 * @param {string} rpcName - RPC endpoint name
 * @param {Object} item - Block item
 * @param {number} delaySeconds - Delay in seconds
 * @returns {Promise<void>}
 */
async function addToDelayedQueue(rpcName, item, delaySeconds) {
  try {
    const delayKey = `block_results_delay:${rpcName}`;
    const score = Date.now() + (delaySeconds * 1000);
    await redis.zadd(delayKey, score, JSON.stringify({
      ...item,
      timestamp: Date.now()
    }));
    await redis.expire(delayKey, 7 * 24 * 60 * 60);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error adding item to delayed queue:`, error.message);
  }
}

/**
 * Get delayed items that are ready to be processed
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<Array>} Array of ready items
 */
async function getReadyDelayedItems(rpcName) {
  try {
    const delayKey = `block_results_delay:${rpcName}`;
    const now = Date.now();
    
    // Get items with score <= now (ready to process)
    const readyItems = await redis.zrangebyscore(delayKey, 0, now);
    
    if (readyItems.length > 0) {
      // Remove them from delay set and add to main queue
      const queueKey = `block_results_queue:${rpcName}`;
      const queuedSetKey = `block_results_queued:${rpcName}`;
      for (const itemStr of readyItems) {
        await redis.lpush(queueKey, itemStr);
        await redis.zrem(delayKey, itemStr);
        
        // Add to queued Set when moving from delayed to main queue
        try {
          const item = JSON.parse(itemStr);
          if (item && Number.isFinite(item.height)) {
            await redis.sadd(queuedSetKey, item.height.toString());
          }
        } catch (parseError) {
          // Skip if item can't be parsed
        }
      }
      
      // Refresh expiration on queued Set
      if (readyItems.length > 0) {
        await redis.expire(queuedSetKey, 7 * 24 * 60 * 60);
      }
    }
    
    return readyItems.map(item => JSON.parse(item));
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting ready delayed items:`, error.message);
    return [];
  }
}

/**
 * Get queue size
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<number>} Queue size
 */
async function getQueueSize(rpcName) {
  try {
    const queueKey = `block_results_queue:${rpcName}`;
    return await redis.llen(queueKey);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting queue size:`, error.message);
    return 0;
  }
}

/**
 * Get delayed items count
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<number>} Number of delayed items
 */
async function getDelayedItemsCount(rpcName) {
  try {
    const delayKey = `block_results_delay:${rpcName}`;
    return await redis.zcard(delayKey);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting delayed items count:`, error.message);
    return 0;
  }
}

/**
 * Get processing items count (items with active processing locks)
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<number>} Number of items being processed
 */
async function getProcessingItemsCount(rpcName) {
  try {
    const pattern = `block_results_processing:${rpcName}:*`;
    const keys = await redis.keys(pattern);
    // Filter out stale locks (older than timeout)
    const now = Date.now();
    let count = 0;
    for (const key of keys) {
      const lockTimestamp = await redis.get(key);
      if (lockTimestamp) {
        const timestamp = parseInt(lockTimestamp, 10);
        if (now - timestamp < PROCESSING_TIMEOUT_SEC * 1000) {
          count++;
        }
      }
    }
    return count;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting processing items count:`, error.message);
    return 0;
  }
}

/**
 * Recover items with stale processing locks (from crashed workers)
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<number>} Number of items recovered
 */
async function recoverStaleProcessingItems(rpcName) {
  try {
    const pattern = `block_results_processing:${rpcName}:*`;
    const keys = await redis.keys(pattern);
    const now = Date.now();
    const queueKey = `block_results_queue:${rpcName}`;
    let recoveredCount = 0;
    
    for (const key of keys) {
      try {
        const lockTimestamp = await redis.get(key);
        if (lockTimestamp) {
          const timestamp = parseInt(lockTimestamp, 10);
          // If lock is stale (older than timeout), recover the item
          if (now - timestamp >= PROCESSING_TIMEOUT_SEC * 1000) {
            // Extract height from key: block_results_processing:rpcName:height
            const height = parseInt(key.split(':').pop(), 10);
            if (!isNaN(height)) {
              // Recreate the item and requeue it
              const item = JSON.stringify({
                height: height,
                timestamp: Date.now(),
                retries: 0 // Reset retries on recovery
              });
              await redis.lpush(queueKey, item);
              await redis.del(key); // Remove stale lock
              
              // Add to queued Set when requeuing recovered items
              const queuedSetKey = `block_results_queued:${rpcName}`;
              await redis.sadd(queuedSetKey, height.toString());
              
              recoveredCount++;
            }
          }
        }
      } catch (error) {
        console.error(`[BlockResultsQueue] Error recovering item from key ${key}:`, error.message);
      }
    }
    
    // Refresh expiration on queue if items were recovered
    if (recoveredCount > 0) {
      const queueSize = await redis.llen(queueKey);
      if (queueSize > 0) {
        await redis.expire(queueKey, 7 * 24 * 60 * 60);
      }
    }
    
    return recoveredCount;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error recovering stale processing items for ${rpcName}:`, error.message);
    return 0;
  }
}

/**
 * Get processing lag (how many blocks behind current height)
 * @param {string} rpcName - RPC endpoint name
 * @param {number} currentChainHeight - Current chain height
 * @returns {Promise<number>} Lag in blocks (0 if up to date or ahead)
 */
async function getProcessingLag(rpcName, currentChainHeight) {
  try {
    await connectClients();
    const result = await pgPool.query(
      `SELECT MAX(height) as max_height FROM block_results_processed WHERE chain = $1`,
      [rpcName]
    );
    const maxProcessed = result.rows[0]?.max_height ? parseInt(result.rows[0].max_height, 10) : 0;
    return Math.max(0, currentChainHeight - maxProcessed);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting processing lag:`, error.message);
    return 0;
  }
}

/**
 * Get comprehensive queue health metrics
 * @param {string} rpcName - RPC endpoint name
 * @param {number} currentChainHeight - Current chain height (optional)
 * @returns {Promise<Object>} Queue health metrics
 */
async function getQueueHealth(rpcName, currentChainHeight = null) {
  try {
    const queueSize = await getQueueSize(rpcName);
    const delayedItems = await getDelayedItemsCount(rpcName);
    const processingItems = await getProcessingItemsCount(rpcName);
    
    let lag = null;
    let maxProcessedHeight = null;
    if (currentChainHeight !== null) {
      lag = await getProcessingLag(rpcName, currentChainHeight);
    }
    
    // Get max processed height
    try {
      await connectClients();
      const result = await pgPool.query(
        `SELECT MAX(height) as max_height FROM block_results_processed WHERE chain = $1`,
        [rpcName]
      );
      maxProcessedHeight = result.rows[0]?.max_height ? parseInt(result.rows[0].max_height, 10) : null;
    } catch (error) {
      // Ignore errors for optional metrics
    }
    
    return {
      queueSize,
      delayedItems,
      processingItems,
      lag,
      maxProcessedHeight,
      currentChainHeight
    };
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting queue health:`, error.message);
    return {
      queueSize: 0,
      delayedItems: 0,
      processingItems: 0,
      lag: null,
      maxProcessedHeight: null,
      currentChainHeight: null
    };
  }
}

/**
 * Clear processed blocks tracking for heights >= minHeight
 * @param {string} rpcName - RPC endpoint name
 * @param {number} minHeight - Minimum height to clear from
 * @returns {Promise<{dbDeleted: number, redisRemoved: number}>} Count of deleted records
 */
async function clearProcessedBlocks(rpcName, minHeight) {
  let dbDeleted = 0;
  let redisRemoved = 0;
  
  try {
    // Clear from database
    await connectClients();
    const dbResult = await pgPool.query(
      `DELETE FROM block_results_processed WHERE chain = $1 AND height >= $2`,
      [rpcName, minHeight]
    );
    dbDeleted = dbResult.rowCount || 0;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error clearing processed blocks from DB:`, error.message);
  }
  
  try {
    // Clear from Redis set
    const processedKey = `block_results_processed:${rpcName}`;
    const members = await redis.smembers(processedKey);
    const heightsToRemove = members.filter(h => {
      const height = parseInt(h, 10);
      return !isNaN(height) && height >= minHeight;
    });
    
    if (heightsToRemove.length > 0) {
      // Remove in batches if too many (Redis SREM has limits)
      const batchSize = 1000;
      for (let i = 0; i < heightsToRemove.length; i += batchSize) {
        const batch = heightsToRemove.slice(i, i + batchSize);
        await redis.srem(processedKey, ...batch);
      }
      redisRemoved = heightsToRemove.length;
    }
  } catch (error) {
    console.error(`[BlockResultsQueue] Error clearing processed blocks from Redis:`, error.message);
  }
  
  return { dbDeleted, redisRemoved };
}

/**
 * Get maximum processed height from database
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<number|null>} Maximum processed height or null if none
 */
async function getMaxProcessedHeight(rpcName) {
  try {
    await connectClients();
    const result = await pgPool.query(
      `SELECT MAX(height) as max_height FROM block_results_processed WHERE chain = $1`,
      [rpcName]
    );
    return result.rows[0]?.max_height ? parseInt(result.rows[0].max_height, 10) : null;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting max processed height:`, error.message);
    return null;
  }
}

/**
 * Calculate processing coverage percentage in a height range
 * @param {string} rpcName - RPC endpoint name
 * @param {number} startHeight - Start height
 * @param {number} endHeight - End height
 * @returns {Promise<{coverage: number, processed: number, total: number}>} Coverage metrics
 */
async function getProcessingCoverage(rpcName, startHeight, endHeight) {
  try {
    await connectClients();
    const total = endHeight - startHeight + 1;
    
    const result = await pgPool.query(
      `SELECT COUNT(*) as count FROM block_results_processed 
       WHERE chain = $1 AND height >= $2 AND height <= $3`,
      [rpcName, startHeight, endHeight]
    );
    
    const processed = parseInt(result.rows[0]?.count || 0, 10);
    const coverage = total > 0 ? (processed / total) * 100 : 0;
    
    return {
      coverage: parseFloat(coverage.toFixed(2)),
      processed,
      total
    };
  } catch (error) {
    console.error(`[BlockResultsQueue] Error getting processing coverage:`, error.message);
    return {
      coverage: 0,
      processed: 0,
      total: 0
    };
  }
}

/**
 * Clear queue (for testing/maintenance)
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<void>}
 */
async function clearQueue(rpcName) {
  try {
    const queueKey = `block_results_queue:${rpcName}`;
    const delayKey = `block_results_delay:${rpcName}`;
    const queuedSetKey = `block_results_queued:${rpcName}`;
    await redis.del(queueKey);
    await redis.del(delayKey);
    await redis.del(queuedSetKey);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error clearing queue:`, error.message);
  }
}

module.exports = {
  enqueueBlockResults,
  dequeueBlockResults,
  leaseScanDequeueBlockResults,
  markProcessed,
  markFailed,
  getReadyDelayedItems,
  addToDelayedQueue,
  getQueueSize,
  getDelayedItemsCount,
  getProcessingItemsCount,
  recoverStaleProcessingItems,
  clearQueue,
  // New tracking functions
  markBlockProcessedRedis,
  markBlockProcessedDB,
  isBlockProcessed,
  getProcessedBlocks,
  getUnprocessedBlocks,
  getProcessedBlocksCount,
  getProcessingLag,
  getQueueHealth,
  clearProcessedBlocks,
  getMaxProcessedHeight,
  getProcessingCoverage,
  MAX_RETRIES,
  PROCESSING_TIMEOUT_SEC
};

