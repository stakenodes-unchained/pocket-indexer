const { Pool } = require('pg');
const redis = require('../config/redis');

/**
 * Configuration Loader Service
 * Loads configuration values from database (system_config table) with fallback to environment variables
 * Supports caching for performance and real-time updates via Redis pub/sub
 */
class ConfigLoader {
  constructor() {
    this.pgPool = null;
    this.initialized = false;

    // In-memory cache for fast access
    this.cache = new Map();
    this.cacheTimestamp = 0;
    this.CACHE_TTL = 60000; // 1 minute

    // Redis cache key prefix
    this.REDIS_PREFIX = 'config:';
    this.REDIS_TTL = 300; // 5 minutes

    // Configuration categories matching system_config table
    this.CATEGORIES = [
      'worker',
      'block_results',
      'monitoring',
      'memory',
      'performance',
      'proof_parser',
      'enrichment',
      'rate_limiting',
    ];

    // Mapping of config keys to their categories
    this.CONFIG_MAP = {
      // Worker settings
      WORKER_CONCURRENCY: { category: 'worker', type: 'integer', default: 2 },
      HISTORICAL_BATCH_SIZE: { category: 'worker', type: 'integer', default: 10 },
      CLUSTER_WORKERS: { category: 'worker', type: 'integer', default: 4 },
      PAGE_SIZE: { category: 'worker', type: 'integer', default: 50 },

      // Block results settings
      BLOCK_RESULTS_WORKER_COUNT: { category: 'block_results', type: 'integer', default: 2 },
      BLOCK_RESULTS_POLL_INTERVAL_MS: { category: 'block_results', type: 'integer', default: 500 },
      BLOCK_RESULTS_BATCH_SIZE: { category: 'block_results', type: 'integer', default: 8 },
      BLOCK_RESULTS_PARALLEL_LIMIT: { category: 'block_results', type: 'integer', default: 10 },
      BLOCK_RESULTS_RATE_LIMIT_MS: { category: 'block_results', type: 'integer', default: 100 },
      BLOCK_RESULTS_STATS_INTERVAL_MS: { category: 'block_results', type: 'integer', default: 30000 },
      BLOCK_RESULTS_ASYNC_EVENTS: { category: 'block_results', type: 'boolean', default: true },
      BLOCK_RESULTS_LAG_BLOCKS: { category: 'block_results', type: 'integer', default: 5 },
      BLOCK_RESULTS_CURRENT_WINDOW_BLOCKS: { category: 'block_results', type: 'integer', default: 50 },
      BLOCK_RESULTS_LEASE_SCAN_COUNT: { category: 'block_results', type: 'integer', default: 8 },
      BLOCK_RESULTS_HEARTBEAT_INTERVAL_MS: { category: 'block_results', type: 'integer', default: 60000 },
      BLOCK_RESULTS_EVENT_CONCURRENCY: { category: 'block_results', type: 'integer', default: 50 },
      BLOCK_RESULTS_TX_LOG_BATCH_SIZE: { category: 'block_results', type: 'integer', default: 50 },

      // Monitoring settings
      GAP_CHECK_INTERVAL_MS: { category: 'monitoring', type: 'integer', default: 30000 },
      MONITOR_INTERVAL_MS: { category: 'monitoring', type: 'integer', default: 30000 },
      HISTORICAL_HEARTBEAT_INTERVAL_MS: { category: 'monitoring', type: 'integer', default: 30000 },
      HISTORICAL_RESTART_INTERVAL_MS: { category: 'monitoring', type: 'integer', default: 300000 },
      EVENT_BACKFILL_BATCH_SIZE: { category: 'monitoring', type: 'integer', default: 100 },

      // Memory settings
      TX_EXPIRE_TIME: { category: 'memory', type: 'integer', default: 2592000 },
      HISTORY_CACHE_TTL: { category: 'memory', type: 'integer', default: 3600 },
      NODE_HEAP_SIZE_MB: { category: 'memory', type: 'integer', default: 32768 },
      MEMORY_WARNING_THRESHOLD_GB: { category: 'memory', type: 'integer', default: 12 },

      // Performance settings
      PROCESSING_DELAY: { category: 'performance', type: 'integer', default: 100 },
      REWARD_ANALYTICS_REFRESH_INTERVAL_MS: { category: 'performance', type: 'integer', default: 900000 },

      // Proof parser settings
      PROOF_PARSER_POLL_INTERVAL: { category: 'proof_parser', type: 'integer', default: 10000 },
      PROOF_PARSER_BATCH_SIZE: { category: 'proof_parser', type: 'integer', default: 100 },
      PROOF_PARSER_HEALTH_CHECK_INTERVAL: { category: 'proof_parser', type: 'integer', default: 5000 },

      // Enrichment settings
      ENABLE_SUPPLIER_ENRICHMENT: { category: 'enrichment', type: 'boolean', default: false },
      SUPPLIER_ENRICHMENT_BATCH: { category: 'enrichment', type: 'integer', default: 200 },
      SUPPLIER_ENRICHMENT_INTERVAL_MS: { category: 'enrichment', type: 'integer', default: 3600000 },
      ENABLE_VALIDATOR_REFRESH: { category: 'enrichment', type: 'boolean', default: true },
      VALIDATOR_REFRESH_INTERVAL_MS: { category: 'enrichment', type: 'integer', default: 21600000 },

      // Rate limiting settings
      RATE_LIMIT_ENABLED: { category: 'rate_limiting', type: 'boolean', default: true },
      RATE_LIMIT_WINDOW_MS: { category: 'rate_limiting', type: 'integer', default: 60000 },
      RATE_LIMIT_MAX_REQUESTS: { category: 'rate_limiting', type: 'integer', default: 1000 },
      RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS: { category: 'rate_limiting', type: 'boolean', default: false },
      RATE_LIMIT_SKIP_FAILED_REQUESTS: { category: 'rate_limiting', type: 'boolean', default: false },
      RATE_LIMIT_KEY_PREFIX: { category: 'rate_limiting', type: 'string', default: 'rl:' },
    };
  }

  /**
   * Initialize the configuration loader
   * Must be called before using get() method
   */
  async initialize() {
    if (this.initialized) return;

    try {
      this.pgPool = new Pool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        max: 5,
        min: 1,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      this.pgPool.on('error', (err) => {
        console.error('ConfigLoader: Database pool error:', err);
      });

      // Load all configs into cache
      await this.loadAllConfigs();

      // Subscribe to config changes
      await this.subscribeToConfigChanges();

      this.initialized = true;
      console.log('ConfigLoader: Initialized successfully');
    } catch (error) {
      console.error('ConfigLoader: Initialization failed:', error.message);
      // Continue without database - will use env vars as fallback
      this.initialized = true;
    }
  }

  /**
   * Parse value based on type
   */
  parseValue(value, type) {
    if (value === null || value === undefined) return null;

    switch (type) {
      case 'integer':
        return parseInt(value, 10);
      case 'float':
        return parseFloat(value);
      case 'boolean':
        return value === 'true' || value === '1' || value === true;
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  }

  /**
   * Load all configurations from database into cache
   */
  async loadAllConfigs() {
    if (!this.pgPool) return;

    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT category, key, value, value_type
         FROM system_config
         WHERE is_active = TRUE`
      );

      // Clear and rebuild cache
      this.cache.clear();

      for (const row of result.rows) {
        const cacheKey = row.key;
        const parsedValue = this.parseValue(row.value, row.value_type);
        this.cache.set(cacheKey, {
          value: parsedValue,
          category: row.category,
          type: row.value_type,
        });

        // Also cache in Redis
        const redisKey = `${this.REDIS_PREFIX}${row.key}`;
        await redis.set(redisKey, JSON.stringify({ value: parsedValue }), 'EX', this.REDIS_TTL).catch(() => {});
      }

      this.cacheTimestamp = Date.now();
      console.log(`ConfigLoader: Loaded ${result.rows.length} configurations from database`);
    } catch (error) {
      console.error('ConfigLoader: Error loading configs:', error.message);
    } finally {
      client.release();
    }
  }

  /**
   * Subscribe to Redis pub/sub for config changes
   */
  async subscribeToConfigChanges() {
    try {
      // Create a separate Redis connection for subscriptions
      const Redis = require('ioredis');
      const subscriber = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0,
      });

      subscriber.subscribe('system:config:changes', (err) => {
        if (err) {
          console.error('ConfigLoader: Failed to subscribe to config changes:', err);
          return;
        }
        console.log('ConfigLoader: Subscribed to config changes');
      });

      subscriber.on('message', async (channel, message) => {
        if (channel === 'system:config:changes') {
          try {
            const data = JSON.parse(message);
            if (data.type === 'CONFIG_CHANGE') {
              console.log(`ConfigLoader: Config changed - ${data.category}.${data.key}`);

              // Update cache
              const configInfo = this.CONFIG_MAP[data.key];
              const parsedValue = this.parseValue(data.value, configInfo?.type || 'string');

              this.cache.set(data.key, {
                value: parsedValue,
                category: data.category,
                type: configInfo?.type || 'string',
              });

              // Update Redis cache
              const redisKey = `${this.REDIS_PREFIX}${data.key}`;
              await redis.set(redisKey, JSON.stringify({ value: parsedValue }), 'EX', this.REDIS_TTL).catch(() => {});
            }
          } catch (error) {
            console.error('ConfigLoader: Error processing config change:', error);
          }
        }
      });
    } catch (error) {
      console.error('ConfigLoader: Failed to setup config change subscription:', error);
    }
  }

  /**
   * Get a configuration value
   * Priority: 1. Memory cache -> 2. Redis cache -> 3. Database -> 4. Environment variable -> 5. Default
   * @param {string} key - Configuration key (e.g., 'WORKER_CONCURRENCY')
   * @param {any} defaultValue - Default value if not found anywhere
   * @returns {any} Configuration value
   */
  get(key, defaultValue = null) {
    const configInfo = this.CONFIG_MAP[key];
    const finalDefault = defaultValue !== null ? defaultValue : (configInfo?.default ?? null);

    // 1. Check memory cache
    if (this.cache.has(key)) {
      const cached = this.cache.get(key);
      return cached.value;
    }

    // 2. Fall back to environment variable
    const envValue = process.env[key];
    if (envValue !== undefined) {
      const type = configInfo?.type || 'string';
      return this.parseValue(envValue, type);
    }

    // 3. Return default
    return finalDefault;
  }

  /**
   * Get a configuration value asynchronously (with database lookup)
   * Use this when you need the most up-to-date value
   * @param {string} key - Configuration key
   * @param {any} defaultValue - Default value if not found
   * @returns {Promise<any>} Configuration value
   */
  async getAsync(key, defaultValue = null) {
    const configInfo = this.CONFIG_MAP[key];
    const finalDefault = defaultValue !== null ? defaultValue : (configInfo?.default ?? null);

    // 1. Check memory cache (if fresh)
    if (this.cache.has(key) && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
      return this.cache.get(key).value;
    }

    // 2. Try Redis cache
    try {
      const redisKey = `${this.REDIS_PREFIX}${key}`;
      const cached = await redis.get(redisKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        // Update memory cache
        this.cache.set(key, {
          value: parsed.value,
          category: configInfo?.category,
          type: configInfo?.type,
        });
        return parsed.value;
      }
    } catch (error) {
      // Redis error - continue to database
    }

    // 3. Try database
    if (this.pgPool && configInfo) {
      const client = await this.pgPool.connect();
      try {
        const result = await client.query(
          `SELECT value, value_type FROM system_config
           WHERE category = $1 AND key = $2 AND is_active = TRUE`,
          [configInfo.category, key]
        );

        if (result.rows.length > 0) {
          const parsedValue = this.parseValue(result.rows[0].value, result.rows[0].value_type);

          // Update caches
          this.cache.set(key, {
            value: parsedValue,
            category: configInfo.category,
            type: result.rows[0].value_type,
          });

          const redisKey = `${this.REDIS_PREFIX}${key}`;
          await redis.set(redisKey, JSON.stringify({ value: parsedValue }), 'EX', this.REDIS_TTL).catch(() => {});

          return parsedValue;
        }
      } finally {
        client.release();
      }
    }

    // 4. Fall back to environment variable
    const envValue = process.env[key];
    if (envValue !== undefined) {
      const type = configInfo?.type || 'string';
      return this.parseValue(envValue, type);
    }

    // 5. Return default
    return finalDefault;
  }

  /**
   * Get all configurations for a category
   * @param {string} category - Configuration category
   * @returns {Object} All configurations in the category
   */
  getCategory(category) {
    const configs = {};

    for (const [key, info] of Object.entries(this.CONFIG_MAP)) {
      if (info.category === category) {
        configs[key] = this.get(key);
      }
    }

    return configs;
  }

  /**
   * Refresh cache from database
   */
  async refresh() {
    await this.loadAllConfigs();
  }

  /**
   * Clear all caches (memory and Redis)
   */
  async clearCache() {
    try {
      // Clear memory cache
      this.cache.clear();
      this.cacheTimestamp = 0;

      // Clear Redis cache
      const keys = await redis.keys(`${this.REDIS_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`ConfigLoader: Cleared ${keys.length} Redis cache entries`);
      }

      console.log('ConfigLoader: All caches cleared');
    } catch (error) {
      console.error('ConfigLoader: Error clearing cache:', error);
    }
  }

  /**
   * Clear cache for a specific key
   * @param {string} key - Configuration key
   */
  async clearKey(key) {
    try {
      // Clear from memory cache
      this.cache.delete(key);

      // Clear from Redis cache
      const redisKey = `${this.REDIS_PREFIX}${key}`;
      await redis.del(redisKey);

      console.log(`ConfigLoader: Cleared cache for key: ${key}`);
    } catch (error) {
      console.error(`ConfigLoader: Error clearing cache for key ${key}:`, error);
    }
  }

  /**
   * Check if a configuration key exists
   * @param {string} key - Configuration key
   * @returns {boolean}
   */
  has(key) {
    return this.cache.has(key) || this.CONFIG_MAP.hasOwnProperty(key) || process.env[key] !== undefined;
  }

  /**
   * Get all available configuration keys
   * @returns {string[]}
   */
  getKeys() {
    return Object.keys(this.CONFIG_MAP);
  }

  /**
   * Get configuration metadata
   * @param {string} key - Configuration key
   * @returns {Object|null}
   */
  getMetadata(key) {
    return this.CONFIG_MAP[key] || null;
  }
}

// Export singleton instance
const configLoader = new ConfigLoader();

// Auto-initialize on first require (async)
(async () => {
  try {
    await configLoader.initialize();
  } catch (error) {
    console.error('ConfigLoader: Auto-initialization failed:', error.message);
  }
})();

module.exports = configLoader;
