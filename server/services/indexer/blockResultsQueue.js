/**
 * Block Results Queue Service
 * Manages Redis queue for asynchronous block_results processing
 */

const redis = require('../../config/redis');

const MAX_RETRIES = 5;
const PROCESSING_TIMEOUT_SEC = 300; // 5 minutes timeout for processing

/**
 * Enqueue a block height for block_results processing
 * @param {string} rpcName - RPC endpoint name
 * @param {number} height - Block height
 * @returns {Promise<boolean>} Success status
 */
async function enqueueBlockResults(rpcName, height) {
  try {
    const queueKey = `block_results_queue:${rpcName}`;
    const item = JSON.stringify({
      height: height,
      timestamp: Date.now(),
      retries: 0
    });
    
    // Add to queue (left push for FIFO)
    await redis.lpush(queueKey, item);
    
    // Refresh expiration on queue (7 days) to prevent unbounded growth
    // Only set expiration if queue has items
    const queueSize = await redis.llen(queueKey);
    if (queueSize > 0) {
      await redis.expire(queueKey, 7 * 24 * 60 * 60);
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
    
    return item;
  } catch (error) {
    console.error(`[BlockResultsQueue] Error dequeuing block for ${rpcName}:`, error.message);
    return null;
  }
}

/**
 * Mark a block as successfully processed
 * @param {string} rpcName - RPC endpoint name
 * @param {number} height - Block height
 * @returns {Promise<void>}
 */
async function markProcessed(rpcName, height) {
  try {
    const processingKey = `block_results_processing:${rpcName}:${height}`;
    await redis.del(processingKey);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error marking block ${height} as processed:`, error.message);
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
      
      return true;
    } else {
      // Max retries exceeded, log for manual review
      console.error(`[BlockResultsQueue] Block ${height} exceeded max retries (${MAX_RETRIES}), skipping`);
      return false;
    }
  } catch (error) {
    console.error(`[BlockResultsQueue] Error marking block ${height} as failed:`, error.message);
    return false;
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
      for (const itemStr of readyItems) {
        await redis.lpush(queueKey, itemStr);
        await redis.zrem(delayKey, itemStr);
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
 * Clear queue (for testing/maintenance)
 * @param {string} rpcName - RPC endpoint name
 * @returns {Promise<void>}
 */
async function clearQueue(rpcName) {
  try {
    const queueKey = `block_results_queue:${rpcName}`;
    const delayKey = `block_results_delay:${rpcName}`;
    await redis.del(queueKey);
    await redis.del(delayKey);
  } catch (error) {
    console.error(`[BlockResultsQueue] Error clearing queue:`, error.message);
  }
}

module.exports = {
  enqueueBlockResults,
  dequeueBlockResults,
  markProcessed,
  markFailed,
  getReadyDelayedItems,
  getQueueSize,
  getDelayedItemsCount,
  getProcessingItemsCount,
  recoverStaleProcessingItems,
  clearQueue,
  MAX_RETRIES,
  PROCESSING_TIMEOUT_SEC
};

