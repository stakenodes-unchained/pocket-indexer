const redis = require('../config/redis');
const { getWritePool } = require('./dbRouter');

/**
 * System Configuration Service
 * Manages runtime system configuration with database storage and Redis caching
 * Only accessible by super-admin users
 */
class SystemConfigService {
  constructor() {
    // System config supports writes and transactional updates, so use primary/write pool.
    this.pgPool = getWritePool();

    // Redis cache key prefix
    this.CACHE_PREFIX = 'sys_config:';
    this.CACHE_TTL = 300; // 5 minutes cache TTL

    // In-memory cache for fast access (refreshed from Redis/DB)
    this.memoryCache = new Map();
    this.memoryCacheTimestamp = 0;
    this.MEMORY_CACHE_TTL = 60000; // 1 minute

    // Configuration categories
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
  }

  /**
   * Parse value based on type
   * @param {string} value - Raw string value
   * @param {string} valueType - Type (string, integer, float, boolean, json)
   * @returns {any} Parsed value
   */
  parseValue(value, valueType) {
    if (value === null || value === undefined) return null;

    switch (valueType) {
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
   * Validate value against constraints
   * @param {any} value - Value to validate
   * @param {object} config - Configuration object with constraints
   * @returns {object} { valid: boolean, error?: string }
   */
  validateValue(value, config) {
    const { value_type, min_value, max_value } = config;

    if (value_type === 'integer' || value_type === 'float') {
      const numValue = value_type === 'integer' ? parseInt(value, 10) : parseFloat(value);

      if (isNaN(numValue)) {
        return { valid: false, error: `Value must be a valid ${value_type}` };
      }

      if (min_value !== null && numValue < parseFloat(min_value)) {
        return { valid: false, error: `Value must be at least ${min_value}` };
      }

      if (max_value !== null && numValue > parseFloat(max_value)) {
        return { valid: false, error: `Value must be at most ${max_value}` };
      }
    }

    if (value_type === 'boolean') {
      const validBooleans = ['true', 'false', '1', '0', true, false];
      if (!validBooleans.includes(value)) {
        return { valid: false, error: 'Value must be a boolean (true/false)' };
      }
    }

    if (value_type === 'json') {
      try {
        JSON.parse(value);
      } catch {
        return { valid: false, error: 'Value must be valid JSON' };
      }
    }

    return { valid: true };
  }

  /**
   * Clear all configuration cache
   */
  async clearCache() {
    try {
      // Clear systemConfigService cache (sys_config:*)
      const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`SystemConfigService: Cleared ${keys.length} sys_config cache entries`);
      }

      // Also clear configLoader cache (config:*)
      const configLoaderKeys = await redis.keys('config:*');
      if (configLoaderKeys.length > 0) {
        await redis.del(...configLoaderKeys);
        console.log(`SystemConfigService: Cleared ${configLoaderKeys.length} configLoader cache entries`);
      }

      // Clear memory cache
      this.memoryCache.clear();
      this.memoryCacheTimestamp = 0;
    } catch (err) {
      console.error('SystemConfigService: Failed to clear cache:', err);
    }
  }

  /**
   * Clear cache for specific category
   * @param {string} category - Configuration category
   */
  async clearCategoryCache(category) {
    try {
      // Clear systemConfigService category cache
      const keys = await redis.keys(`${this.CACHE_PREFIX}${category}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      // Also clear the all-configs cache
      await redis.del(`${this.CACHE_PREFIX}all`);
      await redis.del(`${this.CACHE_PREFIX}all:true`);
      await redis.del(`${this.CACHE_PREFIX}all:false`);
      await redis.del(`${this.CACHE_PREFIX}category:${category}`);
      await redis.del(`${this.CACHE_PREFIX}category:${category}:true`);
      await redis.del(`${this.CACHE_PREFIX}category:${category}:false`);

      // Also clear configLoader cache for all keys in this category
      // configLoader uses 'config:' prefix with just the key name
      const configLoaderKeys = await redis.keys('config:*');
      if (configLoaderKeys.length > 0) {
        await redis.del(...configLoaderKeys);
        console.log(`SystemConfigService: Cleared ${configLoaderKeys.length} configLoader cache entries for category ${category}`);
      }

      // Clear memory cache
      this.memoryCache.clear();
      this.memoryCacheTimestamp = 0;
    } catch (err) {
      console.error('SystemConfigService: Failed to clear category cache:', err);
    }
  }

  /**
   * Get all configurations grouped by category
   * @param {boolean} includeSensitive - Include sensitive values
   * @returns {Promise<object>} Configurations grouped by category
   */
  async getAllConfigs(includeSensitive = false) {
    const client = await this.pgPool.connect();
    try {
      // Try cache first
      const cacheKey = `${this.CACHE_PREFIX}all:${includeSensitive}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await client.query(
        `SELECT
          id, category, key, value, value_type, description,
          default_value, min_value, max_value, is_sensitive,
          requires_restart, is_active, updated_at
        FROM system_config
        WHERE is_active = TRUE
        ORDER BY category, key`
      );

      // Group by category
      const configs = {};
      for (const row of result.rows) {
        if (!configs[row.category]) {
          configs[row.category] = [];
        }

        const config = {
          id: row.id,
          key: row.key,
          value: row.is_sensitive && !includeSensitive ? '********' : row.value,
          parsedValue: row.is_sensitive && !includeSensitive
            ? '********'
            : this.parseValue(row.value, row.value_type),
          valueType: row.value_type,
          description: row.description,
          defaultValue: row.default_value,
          minValue: row.min_value,
          maxValue: row.max_value,
          isSensitive: row.is_sensitive,
          requiresRestart: row.requires_restart,
          updatedAt: row.updated_at,
        };

        configs[row.category].push(config);
      }

      // Cache the result
      await redis.set(cacheKey, JSON.stringify(configs), 'EX', this.CACHE_TTL);

      return configs;
    } finally {
      client.release();
    }
  }

  /**
   * Get configurations for a specific category
   * @param {string} category - Configuration category
   * @param {boolean} includeSensitive - Include sensitive values
   * @returns {Promise<array>} Array of configurations
   */
  async getConfigsByCategory(category, includeSensitive = false) {
    if (!this.CATEGORIES.includes(category)) {
      throw new Error(`Invalid category: ${category}. Valid categories: ${this.CATEGORIES.join(', ')}`);
    }

    const client = await this.pgPool.connect();
    try {
      // Try cache first
      const cacheKey = `${this.CACHE_PREFIX}category:${category}:${includeSensitive}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      const result = await client.query(
        `SELECT
          id, category, key, value, value_type, description,
          default_value, min_value, max_value, is_sensitive,
          requires_restart, is_active, updated_at
        FROM system_config
        WHERE category = $1 AND is_active = TRUE
        ORDER BY key`,
        [category]
      );

      const configs = result.rows.map(row => ({
        id: row.id,
        key: row.key,
        value: row.is_sensitive && !includeSensitive ? '********' : row.value,
        parsedValue: row.is_sensitive && !includeSensitive
          ? '********'
          : this.parseValue(row.value, row.value_type),
        valueType: row.value_type,
        description: row.description,
        defaultValue: row.default_value,
        minValue: row.min_value,
        maxValue: row.max_value,
        isSensitive: row.is_sensitive,
        requiresRestart: row.requires_restart,
        updatedAt: row.updated_at,
      }));

      // Cache the result
      await redis.set(cacheKey, JSON.stringify(configs), 'EX', this.CACHE_TTL);

      return configs;
    } finally {
      client.release();
    }
  }

  /**
   * Get a single configuration value
   * @param {string} category - Configuration category
   * @param {string} key - Configuration key
   * @returns {Promise<any>} Parsed configuration value
   */
  async getConfigValue(category, key) {
    // Check memory cache first
    const memoryCacheKey = `${category}:${key}`;
    if (Date.now() - this.memoryCacheTimestamp < this.MEMORY_CACHE_TTL) {
      if (this.memoryCache.has(memoryCacheKey)) {
        return this.memoryCache.get(memoryCacheKey);
      }
    }

    const client = await this.pgPool.connect();
    try {
      // Try Redis cache
      const cacheKey = `${this.CACHE_PREFIX}${category}:${key}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsedCache = JSON.parse(cached);
        this.memoryCache.set(memoryCacheKey, parsedCache.value);
        return parsedCache.value;
      }

      const result = await client.query(
        `SELECT value, value_type FROM system_config
        WHERE category = $1 AND key = $2 AND is_active = TRUE`,
        [category, key]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const { value, value_type } = result.rows[0];
      const parsedValue = this.parseValue(value, value_type);

      // Cache in Redis
      await redis.set(cacheKey, JSON.stringify({ value: parsedValue }), 'EX', this.CACHE_TTL);

      // Cache in memory
      this.memoryCache.set(memoryCacheKey, parsedValue);
      this.memoryCacheTimestamp = Date.now();

      return parsedValue;
    } finally {
      client.release();
    }
  }

  /**
   * Get configuration by ID
   * @param {number} configId - Configuration ID
   * @returns {Promise<object|null>} Configuration object
   */
  async getConfigById(configId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT
          id, category, key, value, value_type, description,
          default_value, min_value, max_value, is_sensitive,
          requires_restart, is_active, updated_by, created_at, updated_at
        FROM system_config
        WHERE id = $1`,
        [configId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        category: row.category,
        key: row.key,
        value: row.value,
        parsedValue: this.parseValue(row.value, row.value_type),
        valueType: row.value_type,
        description: row.description,
        defaultValue: row.default_value,
        minValue: row.min_value,
        maxValue: row.max_value,
        isSensitive: row.is_sensitive,
        requiresRestart: row.requires_restart,
        isActive: row.is_active,
        updatedBy: row.updated_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update a configuration value
   * @param {number} configId - Configuration ID
   * @param {string} newValue - New value
   * @param {number} userId - User making the change
   * @param {object} requestInfo - Request info for audit (ip, userAgent)
   * @param {string} changeReason - Reason for the change
   * @returns {Promise<object>} Updated configuration
   */
  async updateConfig(configId, newValue, userId, requestInfo = {}, changeReason = null) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Get current config
      const currentResult = await client.query(
        `SELECT id, category, key, value, value_type, min_value, max_value, is_sensitive
        FROM system_config WHERE id = $1`,
        [configId]
      );

      if (currentResult.rows.length === 0) {
        throw new Error('Configuration not found');
      }

      const currentConfig = currentResult.rows[0];

      // Validate new value
      const validation = this.validateValue(newValue, currentConfig);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Convert value to string for storage
      const valueToStore = String(newValue);

      // Update config
      const updateResult = await client.query(
        `UPDATE system_config
        SET value = $1, updated_by = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, category, key, value, value_type, description,
                  default_value, min_value, max_value, is_sensitive,
                  requires_restart, is_active, updated_at`,
        [valueToStore, userId, configId]
      );

      // Create audit log entry
      await client.query(
        `INSERT INTO config_audit_log
        (config_id, category, key, old_value, new_value, changed_by, change_reason, ip_address, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          configId,
          currentConfig.category,
          currentConfig.key,
          currentConfig.is_sensitive ? '********' : currentConfig.value,
          currentConfig.is_sensitive ? '********' : valueToStore,
          userId,
          changeReason,
          requestInfo.ip || null,
          requestInfo.userAgent || null,
        ]
      );

      await client.query('COMMIT');

      // Clear cache for this category
      await this.clearCategoryCache(currentConfig.category);

      // Publish config change event to Redis for other services
      await this.publishConfigChange(currentConfig.category, currentConfig.key, valueToStore);

      const row = updateResult.rows[0];
      return {
        id: row.id,
        category: row.category,
        key: row.key,
        value: row.is_sensitive ? '********' : row.value,
        parsedValue: row.is_sensitive ? '********' : this.parseValue(row.value, row.value_type),
        valueType: row.value_type,
        description: row.description,
        defaultValue: row.default_value,
        minValue: row.min_value,
        maxValue: row.max_value,
        isSensitive: row.is_sensitive,
        requiresRestart: row.requires_restart,
        updatedAt: row.updated_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update multiple configurations at once
   * @param {array} updates - Array of { id, value } objects
   * @param {number} userId - User making the change
   * @param {object} requestInfo - Request info for audit
   * @param {string} changeReason - Reason for the change
   * @returns {Promise<array>} Updated configurations
   */
  async bulkUpdateConfigs(updates, userId, requestInfo = {}, changeReason = null) {
    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const result = await this.updateConfig(
          update.id,
          update.value,
          userId,
          requestInfo,
          changeReason
        );
        results.push(result);
      } catch (error) {
        errors.push({
          id: update.id,
          error: error.message,
        });
      }
    }

    return { results, errors };
  }

  /**
   * Reset configuration to default value
   * @param {number} configId - Configuration ID
   * @param {number} userId - User making the change
   * @param {object} requestInfo - Request info for audit
   * @returns {Promise<object>} Reset configuration
   */
  async resetToDefault(configId, userId, requestInfo = {}) {
    const client = await this.pgPool.connect();
    try {
      // Get current config with default value
      const result = await client.query(
        `SELECT default_value FROM system_config WHERE id = $1`,
        [configId]
      );

      if (result.rows.length === 0) {
        throw new Error('Configuration not found');
      }

      const { default_value } = result.rows[0];

      if (default_value === null) {
        throw new Error('No default value defined for this configuration');
      }

      return await this.updateConfig(
        configId,
        default_value,
        userId,
        requestInfo,
        'Reset to default value'
      );
    } finally {
      client.release();
    }
  }

  /**
   * Reset all configurations in a category to default values
   * @param {string} category - Configuration category
   * @param {number} userId - User making the change
   * @param {object} requestInfo - Request info for audit
   * @returns {Promise<object>} Reset results
   */
  async resetCategoryToDefaults(category, userId, requestInfo = {}) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT id, default_value FROM system_config
        WHERE category = $1 AND default_value IS NOT NULL AND is_active = TRUE`,
        [category]
      );

      const updates = result.rows.map(row => ({
        id: row.id,
        value: row.default_value,
      }));

      return await this.bulkUpdateConfigs(updates, userId, requestInfo, 'Reset category to defaults');
    } finally {
      client.release();
    }
  }

  /**
   * Get configuration audit log
   * @param {object} filters - { configId, category, changedBy, startDate, endDate, limit, offset }
   * @returns {Promise<object>} Audit log entries with pagination
   */
  async getAuditLog(filters = {}) {
    const client = await this.pgPool.connect();
    try {
      const { configId, category, changedBy, startDate, endDate, limit = 50, offset = 0 } = filters;

      let query = `
        SELECT
          cal.id, cal.config_id, cal.category, cal.key,
          cal.old_value, cal.new_value, cal.change_reason,
          cal.ip_address, cal.created_at,
          aa.email as changed_by_email, aa.name as changed_by_name
        FROM config_audit_log cal
        LEFT JOIN api_accounts aa ON cal.changed_by = aa.id
        WHERE 1=1
      `;

      const params = [];
      let paramCount = 1;

      if (configId) {
        query += ` AND cal.config_id = $${paramCount++}`;
        params.push(configId);
      }

      if (category) {
        query += ` AND cal.category = $${paramCount++}`;
        params.push(category);
      }

      if (changedBy) {
        query += ` AND cal.changed_by = $${paramCount++}`;
        params.push(changedBy);
      }

      if (startDate) {
        query += ` AND cal.created_at >= $${paramCount++}`;
        params.push(startDate);
      }

      if (endDate) {
        query += ` AND cal.created_at <= $${paramCount++}`;
        params.push(endDate);
      }

      query += ` ORDER BY cal.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
      params.push(limit, offset);

      const result = await client.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM config_audit_log cal WHERE 1=1`;
      const countParams = [];
      let countParamCount = 1;

      if (configId) {
        countQuery += ` AND cal.config_id = $${countParamCount++}`;
        countParams.push(configId);
      }

      if (category) {
        countQuery += ` AND cal.category = $${countParamCount++}`;
        countParams.push(category);
      }

      if (changedBy) {
        countQuery += ` AND cal.changed_by = $${countParamCount++}`;
        countParams.push(changedBy);
      }

      if (startDate) {
        countQuery += ` AND cal.created_at >= $${countParamCount++}`;
        countParams.push(startDate);
      }

      if (endDate) {
        countQuery += ` AND cal.created_at <= $${countParamCount++}`;
        countParams.push(endDate);
      }

      const countResult = await client.query(countQuery, countParams);

      return {
        logs: result.rows,
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Publish config change event to Redis pub/sub
   * @param {string} category - Configuration category
   * @param {string} key - Configuration key
   * @param {string} value - New value
   */
  async publishConfigChange(category, key, value) {
    try {
      // First, delete the specific key from configLoader's Redis cache
      // This ensures the old value is immediately invalidated
      const configLoaderKey = `config:${key}`;
      await redis.del(configLoaderKey);
      console.log(`SystemConfigService: Deleted configLoader cache key: ${configLoaderKey}`);

      // Publish the change event so all services can update their in-memory cache
      const message = JSON.stringify({
        type: 'CONFIG_CHANGE',
        category,
        key,
        value,
        timestamp: Date.now(),
      });

      await redis.publish('system:config:changes', message);
      console.log(`SystemConfigService: Published config change for ${category}.${key}`);
    } catch (err) {
      console.error('SystemConfigService: Failed to publish config change:', err);
    }
  }

  /**
   * Load all configurations into memory cache
   * Called on service startup to pre-warm cache
   */
  async loadAllConfigs() {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT category, key, value, value_type FROM system_config WHERE is_active = TRUE`
      );

      for (const row of result.rows) {
        const cacheKey = `${row.category}:${row.key}`;
        const parsedValue = this.parseValue(row.value, row.value_type);
        this.memoryCache.set(cacheKey, parsedValue);

        // Also cache in Redis
        const redisCacheKey = `${this.CACHE_PREFIX}${row.category}:${row.key}`;
        await redis.set(redisCacheKey, JSON.stringify({ value: parsedValue }), 'EX', this.CACHE_TTL);
      }

      this.memoryCacheTimestamp = Date.now();
      console.log(`SystemConfigService: Loaded ${result.rows.length} configurations into cache`);
    } finally {
      client.release();
    }
  }

  /**
   * Get available categories
   * @returns {array} List of valid categories
   */
  getCategories() {
    return [...this.CATEGORIES];
  }

  /**
   * Export all configurations (for backup)
   * @param {boolean} includeSensitive - Include sensitive values
   * @returns {Promise<object>} All configurations
   */
  async exportConfigs(includeSensitive = false) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT
          category, key, value, value_type, description,
          default_value, min_value, max_value, is_sensitive,
          requires_restart
        FROM system_config
        WHERE is_active = TRUE
        ORDER BY category, key`
      );

      return result.rows.map(row => ({
        category: row.category,
        key: row.key,
        value: row.is_sensitive && !includeSensitive ? null : row.value,
        valueType: row.value_type,
        description: row.description,
        defaultValue: row.default_value,
        minValue: row.min_value,
        maxValue: row.max_value,
        isSensitive: row.is_sensitive,
        requiresRestart: row.requires_restart,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Import configurations (for restore)
   * @param {array} configs - Array of configuration objects
   * @param {number} userId - User performing the import
   * @param {object} requestInfo - Request info for audit
   * @returns {Promise<object>} Import results
   */
  async importConfigs(configs, userId, requestInfo = {}) {
    const client = await this.pgPool.connect();
    const results = { updated: 0, skipped: 0, errors: [] };

    try {
      await client.query('BEGIN');

      for (const config of configs) {
        try {
          // Skip sensitive values that are null (not exported)
          if (config.isSensitive && config.value === null) {
            results.skipped++;
            continue;
          }

          // Find existing config
          const existing = await client.query(
            `SELECT id FROM system_config WHERE category = $1 AND key = $2`,
            [config.category, config.key]
          );

          if (existing.rows.length > 0) {
            await this.updateConfig(
              existing.rows[0].id,
              config.value,
              userId,
              requestInfo,
              'Configuration import'
            );
            results.updated++;
          } else {
            results.skipped++;
          }
        } catch (error) {
          results.errors.push({
            category: config.category,
            key: config.key,
            error: error.message,
          });
        }
      }

      await client.query('COMMIT');

      // Clear all cache after import
      await this.clearCache();

      return results;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new SystemConfigService();
