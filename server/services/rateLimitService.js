const redis = require('../config/redis');
const { getWritePool } = require('./dbRouter');

/**
 * Rate Limit Service
 * Manages rate limiting rules and enforcement with Redis-backed storage
 * Only accessible by super-admin users
 */
class RateLimitService {
  constructor() {
    // Rate-limit rules and counters are mutable config/state -> primary/write pool only.
    this.pgPool = getWritePool();

    // Redis key prefixes
    this.CACHE_PREFIX = 'rate_limit:';
    this.COUNTER_PREFIX = 'rl:counter:';
    this.RULES_CACHE_KEY = 'rate_limit:rules:all';
    this.CACHE_TTL = 300; // 5 minutes

    // In-memory rules cache
    this.rulesCache = null;
    this.rulesCacheTimestamp = 0;
    this.RULES_CACHE_TTL = 60000; // 1 minute

    // Target types for rate limiting
    this.TARGET_TYPES = ['global', 'role', 'user', 'endpoint'];
  }

  /**
   * Clear all rate limit cache
   */
  async clearCache() {
    try {
      const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`RateLimitService: Cleared ${keys.length} cache entries`);
      }
      this.rulesCache = null;
      this.rulesCacheTimestamp = 0;
    } catch (err) {
      console.error('RateLimitService: Failed to clear cache:', err);
    }
  }

  /**
   * Get all rate limit rules
   * @param {object} filters - { targetType, enabled, limit, offset }
   * @returns {Promise<object>} Rules with pagination
   */
  async getAllRules(filters = {}) {
    const client = await this.pgPool.connect();
    try {
      const { targetType, enabled, limit = 50, offset = 0 } = filters;

      let query = `
        SELECT
          rl.id, rl.name, rl.target_type, rl.target_id,
          rl.endpoint_pattern, rl.requests_limit, rl.window_seconds,
          rl.enabled, rl.priority, rl.created_by, rl.created_at, rl.updated_at,
          r.name as role_name, r.slug as role_slug,
          u.email as user_email, u.name as user_name
        FROM rate_limit_rules rl
        LEFT JOIN roles r ON rl.target_type = 'role' AND rl.target_id = r.id
        LEFT JOIN api_accounts u ON rl.target_type = 'user' AND rl.target_id = u.id
        WHERE 1=1
      `;

      const params = [];
      let paramCount = 1;

      if (targetType) {
        query += ` AND rl.target_type = $${paramCount++}`;
        params.push(targetType);
      }

      if (enabled !== undefined) {
        query += ` AND rl.enabled = $${paramCount++}`;
        params.push(enabled);
      }

      query += ` ORDER BY rl.priority DESC, rl.id LIMIT $${paramCount++} OFFSET $${paramCount}`;
      params.push(limit, offset);

      const result = await client.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM rate_limit_rules rl WHERE 1=1`;
      const countParams = [];
      let countParamCount = 1;

      if (targetType) {
        countQuery += ` AND rl.target_type = $${countParamCount++}`;
        countParams.push(targetType);
      }

      if (enabled !== undefined) {
        countQuery += ` AND rl.enabled = $${countParamCount++}`;
        countParams.push(enabled);
      }

      const countResult = await client.query(countQuery, countParams);

      return {
        rules: result.rows.map(row => ({
          id: row.id,
          name: row.name,
          targetType: row.target_type,
          targetId: row.target_id,
          targetInfo: this.getTargetInfo(row),
          endpointPattern: row.endpoint_pattern,
          requestsLimit: row.requests_limit,
          windowSeconds: row.window_seconds,
          enabled: row.enabled,
          priority: row.priority,
          createdBy: row.created_by,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get target info for display
   */
  getTargetInfo(row) {
    switch (row.target_type) {
      case 'global':
        return { type: 'global', display: 'All Users' };
      case 'role':
        return {
          type: 'role',
          id: row.target_id,
          name: row.role_name,
          slug: row.role_slug,
          display: row.role_name || `Role #${row.target_id}`,
        };
      case 'user':
        return {
          type: 'user',
          id: row.target_id,
          email: row.user_email,
          name: row.user_name,
          display: row.user_email || `User #${row.target_id}`,
        };
      case 'endpoint':
        return {
          type: 'endpoint',
          pattern: row.endpoint_pattern,
          display: row.endpoint_pattern || 'All Endpoints',
        };
      default:
        return { type: 'unknown', display: 'Unknown' };
    }
  }

  /**
   * Get a specific rule by ID
   * @param {number} ruleId - Rule ID
   * @returns {Promise<object|null>} Rule object
   */
  async getRuleById(ruleId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT
          rl.id, rl.name, rl.target_type, rl.target_id,
          rl.endpoint_pattern, rl.requests_limit, rl.window_seconds,
          rl.enabled, rl.priority, rl.created_by, rl.created_at, rl.updated_at,
          r.name as role_name, r.slug as role_slug,
          u.email as user_email, u.name as user_name,
          cb.email as created_by_email
        FROM rate_limit_rules rl
        LEFT JOIN roles r ON rl.target_type = 'role' AND rl.target_id = r.id
        LEFT JOIN api_accounts u ON rl.target_type = 'user' AND rl.target_id = u.id
        LEFT JOIN api_accounts cb ON rl.created_by = cb.id
        WHERE rl.id = $1`,
        [ruleId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        targetType: row.target_type,
        targetId: row.target_id,
        targetInfo: this.getTargetInfo(row),
        endpointPattern: row.endpoint_pattern,
        requestsLimit: row.requests_limit,
        windowSeconds: row.window_seconds,
        enabled: row.enabled,
        priority: row.priority,
        createdBy: row.created_by,
        createdByEmail: row.created_by_email,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Create a new rate limit rule
   * @param {object} ruleData - Rule data
   * @param {number} userId - User creating the rule
   * @returns {Promise<object>} Created rule
   */
  async createRule(ruleData, userId) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      const {
        name,
        targetType,
        targetId,
        endpointPattern,
        requestsLimit,
        windowSeconds,
        enabled = true,
        priority = 0,
      } = ruleData;

      // Validate target type
      if (!this.TARGET_TYPES.includes(targetType)) {
        throw new Error(`Invalid target type. Must be one of: ${this.TARGET_TYPES.join(', ')}`);
      }

      // Validate target_id based on type
      if (targetType === 'role' && targetId) {
        const roleCheck = await client.query('SELECT id FROM roles WHERE id = $1', [targetId]);
        if (roleCheck.rows.length === 0) {
          throw new Error('Role not found');
        }
      }

      if (targetType === 'user' && targetId) {
        const userCheck = await client.query('SELECT id FROM api_accounts WHERE id = $1', [targetId]);
        if (userCheck.rows.length === 0) {
          throw new Error('User not found');
        }
      }

      const result = await client.query(
        `INSERT INTO rate_limit_rules
        (name, target_type, target_id, endpoint_pattern, requests_limit, window_seconds, enabled, priority, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, name, target_type, target_id, endpoint_pattern, requests_limit, window_seconds, enabled, priority, created_at`,
        [
          name,
          targetType,
          targetId || null,
          endpointPattern || null,
          requestsLimit,
          windowSeconds || 60,
          enabled,
          priority,
          userId,
        ]
      );

      await client.query('COMMIT');

      // Clear cache
      await this.clearCache();

      return {
        id: result.rows[0].id,
        name: result.rows[0].name,
        targetType: result.rows[0].target_type,
        targetId: result.rows[0].target_id,
        endpointPattern: result.rows[0].endpoint_pattern,
        requestsLimit: result.rows[0].requests_limit,
        windowSeconds: result.rows[0].window_seconds,
        enabled: result.rows[0].enabled,
        priority: result.rows[0].priority,
        createdAt: result.rows[0].created_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update a rate limit rule
   * @param {number} ruleId - Rule ID
   * @param {object} ruleData - Updated rule data
   * @returns {Promise<object>} Updated rule
   */
  async updateRule(ruleId, ruleData) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Check if rule exists
      const existingRule = await client.query(
        'SELECT id FROM rate_limit_rules WHERE id = $1',
        [ruleId]
      );

      if (existingRule.rows.length === 0) {
        throw new Error('Rule not found');
      }

      const {
        name,
        targetType,
        targetId,
        endpointPattern,
        requestsLimit,
        windowSeconds,
        enabled,
        priority,
      } = ruleData;

      // Build update query dynamically
      const updates = [];
      const params = [];
      let paramCount = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        params.push(name);
      }

      if (targetType !== undefined) {
        if (!this.TARGET_TYPES.includes(targetType)) {
          throw new Error(`Invalid target type. Must be one of: ${this.TARGET_TYPES.join(', ')}`);
        }
        updates.push(`target_type = $${paramCount++}`);
        params.push(targetType);
      }

      if (targetId !== undefined) {
        updates.push(`target_id = $${paramCount++}`);
        params.push(targetId);
      }

      if (endpointPattern !== undefined) {
        updates.push(`endpoint_pattern = $${paramCount++}`);
        params.push(endpointPattern);
      }

      if (requestsLimit !== undefined) {
        updates.push(`requests_limit = $${paramCount++}`);
        params.push(requestsLimit);
      }

      if (windowSeconds !== undefined) {
        updates.push(`window_seconds = $${paramCount++}`);
        params.push(windowSeconds);
      }

      if (enabled !== undefined) {
        updates.push(`enabled = $${paramCount++}`);
        params.push(enabled);
      }

      if (priority !== undefined) {
        updates.push(`priority = $${paramCount++}`);
        params.push(priority);
      }

      if (updates.length === 0) {
        throw new Error('No fields to update');
      }

      params.push(ruleId);
      const query = `
        UPDATE rate_limit_rules
        SET ${updates.join(', ')}, updated_at = NOW()
        WHERE id = $${paramCount}
        RETURNING id, name, target_type, target_id, endpoint_pattern, requests_limit, window_seconds, enabled, priority, updated_at
      `;

      const result = await client.query(query, params);

      await client.query('COMMIT');

      // Clear cache
      await this.clearCache();

      return {
        id: result.rows[0].id,
        name: result.rows[0].name,
        targetType: result.rows[0].target_type,
        targetId: result.rows[0].target_id,
        endpointPattern: result.rows[0].endpoint_pattern,
        requestsLimit: result.rows[0].requests_limit,
        windowSeconds: result.rows[0].window_seconds,
        enabled: result.rows[0].enabled,
        priority: result.rows[0].priority,
        updatedAt: result.rows[0].updated_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a rate limit rule
   * @param {number} ruleId - Rule ID
   * @returns {Promise<boolean>} Success status
   */
  async deleteRule(ruleId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        'DELETE FROM rate_limit_rules WHERE id = $1 RETURNING id',
        [ruleId]
      );

      if (result.rows.length > 0) {
        await this.clearCache();
      }

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Toggle rule enabled status
   * @param {number} ruleId - Rule ID
   * @param {boolean} enabled - New enabled status
   * @returns {Promise<object>} Updated rule
   */
  async toggleRule(ruleId, enabled) {
    return this.updateRule(ruleId, { enabled });
  }

  /**
   * Get active rules for a user (for rate limit checking)
   * @param {number} userId - User ID
   * @param {number} roleId - User's role ID
   * @param {string} endpoint - Request endpoint
   * @returns {Promise<array>} Applicable rules sorted by priority
   */
  async getApplicableRules(userId, roleId, endpoint) {
    // Check memory cache first
    if (this.rulesCache && Date.now() - this.rulesCacheTimestamp < this.RULES_CACHE_TTL) {
      return this.filterRules(this.rulesCache, userId, roleId, endpoint);
    }

    const client = await this.pgPool.connect();
    try {
      // Try Redis cache
      const cached = await redis.get(this.RULES_CACHE_KEY);
      if (cached) {
        this.rulesCache = JSON.parse(cached);
        this.rulesCacheTimestamp = Date.now();
        return this.filterRules(this.rulesCache, userId, roleId, endpoint);
      }

      const result = await client.query(
        `SELECT
          id, name, target_type, target_id, endpoint_pattern,
          requests_limit, window_seconds, priority
        FROM rate_limit_rules
        WHERE enabled = TRUE
        ORDER BY priority DESC`
      );

      const rules = result.rows;

      // Cache in Redis
      await redis.set(this.RULES_CACHE_KEY, JSON.stringify(rules), 'EX', this.CACHE_TTL);

      // Cache in memory
      this.rulesCache = rules;
      this.rulesCacheTimestamp = Date.now();

      return this.filterRules(rules, userId, roleId, endpoint);
    } finally {
      client.release();
    }
  }

  /**
   * Filter rules applicable to a specific request
   */
  filterRules(rules, userId, roleId, endpoint) {
    return rules.filter(rule => {
      switch (rule.target_type) {
        case 'global':
          return true;
        case 'role':
          return rule.target_id === roleId;
        case 'user':
          return rule.target_id === userId;
        case 'endpoint':
          if (!rule.endpoint_pattern) return true;
          return this.matchEndpoint(endpoint, rule.endpoint_pattern);
        default:
          return false;
      }
    });
  }

  /**
   * Match endpoint against pattern
   */
  matchEndpoint(endpoint, pattern) {
    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/\//g, '\\/')
      .replace(/\*/g, '.*')
      .replace(/:[\w]+/g, '[^/]+');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(endpoint);
  }

  /**
   * Check rate limit for a request
   * @param {number} userId - User ID
   * @param {number} roleId - User's role ID
   * @param {string} endpoint - Request endpoint
   * @returns {Promise<object>} { allowed: boolean, limit, remaining, resetAt, rule }
   */
  async checkRateLimit(userId, roleId, endpoint) {
    const rules = await this.getApplicableRules(userId, roleId, endpoint);

    if (rules.length === 0) {
      return { allowed: true, limit: null, remaining: null, resetAt: null, rule: null };
    }

    // Get the highest priority rule (first in sorted list)
    const rule = rules[0];

    // Generate rate limit key
    const key = this.generateRateLimitKey(rule, userId, endpoint);
    const windowMs = rule.window_seconds * 1000;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Use Redis sorted set for sliding window
      const pipeline = redis.pipeline();

      // Remove old entries
      pipeline.zremrangebyscore(key, 0, windowStart);

      // Count current requests
      pipeline.zcard(key);

      // Add current request
      pipeline.zadd(key, now, `${now}:${Math.random()}`);

      // Set expiry
      pipeline.expire(key, rule.window_seconds + 1);

      // Get oldest entry (to compute stable resetAt)
      pipeline.zrange(key, 0, 0, 'WITHSCORES');

      const results = await pipeline.exec();
      const currentCount = results[1][1] || 0;

      const allowed = currentCount < rule.requests_limit;
      const remaining = Math.max(0, rule.requests_limit - currentCount - 1);

      // resetAt = when the oldest entry in the window expires (stable, not moving)
      const oldestEntry = results[4][1];
      const oldestTimestamp = (oldestEntry && oldestEntry.length >= 2)
        ? parseFloat(oldestEntry[1])
        : now;
      const resetAt = new Date(oldestTimestamp + windowMs).toISOString();

      return {
        allowed,
        limit: rule.requests_limit,
        remaining: allowed ? remaining : 0,
        resetAt,
        rule: {
          id: rule.id,
          name: rule.name,
          targetType: rule.target_type,
          windowSeconds: rule.window_seconds,
        },
      };
    } catch (error) {
      console.error('RateLimitService: Error checking rate limit:', error);
      // Fail open - allow request if Redis fails
      return { allowed: true, limit: null, remaining: null, resetAt: null, rule: null };
    }
  }

  /**
   * Generate rate limit key for Redis
   */
  generateRateLimitKey(rule, userId, endpoint) {
    switch (rule.target_type) {
      case 'global':
        return `${this.COUNTER_PREFIX}global`;
      case 'role':
        return `${this.COUNTER_PREFIX}role:${rule.target_id}`;
      case 'user':
        return `${this.COUNTER_PREFIX}user:${userId}`;
      case 'endpoint':
        return `${this.COUNTER_PREFIX}endpoint:${endpoint}:user:${userId}`;
      default:
        return `${this.COUNTER_PREFIX}unknown:${userId}`;
    }
  }

  /**
   * Get rate limit statistics
   * @returns {Promise<object>} Statistics
   */
  async getStatistics() {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT
          target_type,
          COUNT(*) as rule_count,
          COUNT(*) FILTER (WHERE enabled = TRUE) as enabled_count,
          AVG(requests_limit) as avg_limit,
          AVG(window_seconds) as avg_window
        FROM rate_limit_rules
        GROUP BY target_type
        ORDER BY target_type`
      );

      const totalResult = await client.query(
        `SELECT
          COUNT(*) as total_rules,
          COUNT(*) FILTER (WHERE enabled = TRUE) as enabled_rules
        FROM rate_limit_rules`
      );

      // Get Redis counter stats
      const counterKeys = await redis.keys(`${this.COUNTER_PREFIX}*`);

      return {
        byTargetType: result.rows.map(row => ({
          targetType: row.target_type,
          ruleCount: parseInt(row.rule_count),
          enabledCount: parseInt(row.enabled_count),
          avgLimit: parseFloat(row.avg_limit).toFixed(0),
          avgWindowSeconds: parseFloat(row.avg_window).toFixed(0),
        })),
        summary: {
          totalRules: parseInt(totalResult.rows[0].total_rules),
          enabledRules: parseInt(totalResult.rows[0].enabled_rules),
          activeCounters: counterKeys.length,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * Reset rate limit counters for a user
   * @param {number} userId - User ID
   * @returns {Promise<number>} Number of counters cleared
   */
  async resetUserCounters(userId) {
    try {
      const pattern = `${this.COUNTER_PREFIX}*user:${userId}*`;
      const keys = await redis.keys(pattern);

      if (keys.length > 0) {
        await redis.del(...keys);
      }

      // Also check for direct user keys
      const directKey = `${this.COUNTER_PREFIX}user:${userId}`;
      await redis.del(directKey);

      return keys.length + 1;
    } catch (error) {
      console.error('RateLimitService: Error resetting user counters:', error);
      throw error;
    }
  }

  /**
   * Reset all rate limit counters
   * @returns {Promise<number>} Number of counters cleared
   */
  async resetAllCounters() {
    try {
      const keys = await redis.keys(`${this.COUNTER_PREFIX}*`);

      if (keys.length > 0) {
        await redis.del(...keys);
      }

      return keys.length;
    } catch (error) {
      console.error('RateLimitService: Error resetting all counters:', error);
      throw error;
    }
  }

  /**
   * Get target types
   * @returns {array} Valid target types
   */
  getTargetTypes() {
    return [...this.TARGET_TYPES];
  }
}

module.exports = new RateLimitService();
