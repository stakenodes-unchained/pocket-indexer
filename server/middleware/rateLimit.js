const rateLimitService = require('../services/rateLimitService');
const systemConfigService = require('../services/systemConfigService');

/**
 * Rate Limit Middleware
 * Enforces rate limits based on configured rules in the database
 * Uses Redis for distributed rate limiting with sliding window algorithm
 */
const rateLimitMiddleware = (options = {}) => {
  const {
    skip = () => false, // Function to skip rate limiting for certain requests
    keyGenerator = null, // Custom key generator
    onRateLimited = null, // Custom handler for rate limited requests
  } = options;

  return async (req, res, next) => {
    try {
      // Check if rate limiting is globally enabled
      const rateLimitEnabled = await systemConfigService.getConfigValue('rate_limiting', 'RATE_LIMIT_ENABLED');
      if (rateLimitEnabled === false) {
        return next();
      }

      // Skip for certain paths
      if (req.path.includes('/health') || req.path.includes('/favicon')) {
        return next();
      }

      // Allow custom skip logic
      if (skip(req)) {
        return next();
      }

      // Get user info from request (set by auth middleware)
      const userId = req.user?.accountId || 0;
      const roleId = req.user?.roleId || null;
      const endpoint = req.path;

      // Check rate limit
      const result = await rateLimitService.checkRateLimit(userId, roleId, endpoint);

      // Set rate limit headers
      if (result.limit !== null) {
        res.set('X-RateLimit-Limit', result.limit);
        res.set('X-RateLimit-Remaining', result.remaining);
        res.set('X-RateLimit-Reset', result.resetAt);
      }

      if (result.rule) {
        res.set('X-RateLimit-Policy', `${result.rule.name} (${result.rule.windowSeconds}s window)`);
      }

      // If not allowed, return 429 Too Many Requests
      if (!result.allowed) {
        if (onRateLimited) {
          return onRateLimited(req, res, result);
        }

        const retryAfterSeconds = result.resetAt
          ? Math.max(1, Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000))
          : (result.rule?.windowSeconds || 60);

        res.set('Retry-After', retryAfterSeconds);

        return res.status(429).json({
          success: false,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`,
          retryAfter: retryAfterSeconds,
          limit: result.limit,
          resetAt: result.resetAt,
        });
      }

      next();
    } catch (error) {
      // Fail open - if rate limiting fails, allow the request
      console.error('Rate limit middleware error:', error);
      next();
    }
  };
};

/**
 * Create a rate limiter for specific endpoints
 * @param {object} options - Configuration options
 * @returns {function} Express middleware
 */
const createRateLimiter = (options = {}) => {
  return rateLimitMiddleware(options);
};

/**
 * Strict rate limiter that fails closed (denies on error)
 * Use for sensitive endpoints that must have rate limiting
 */
const strictRateLimiter = (options = {}) => {
  return async (req, res, next) => {
    try {
      // Check if rate limiting is globally enabled
      const rateLimitEnabled = await systemConfigService.getConfigValue('rate_limiting', 'RATE_LIMIT_ENABLED');
      if (rateLimitEnabled === false) {
        return next();
      }

      const userId = req.user?.accountId || 0;
      const roleId = req.user?.roleId || null;
      const endpoint = req.path;

      const result = await rateLimitService.checkRateLimit(userId, roleId, endpoint);

      // Set headers
      if (result.limit !== null) {
        res.set('X-RateLimit-Limit', result.limit);
        res.set('X-RateLimit-Remaining', result.remaining);
        res.set('X-RateLimit-Reset', result.resetAt);
      }

      if (!result.allowed) {
        const retryAfterSeconds = result.resetAt
          ? Math.max(1, Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000))
          : (result.rule?.windowSeconds || 60);

        res.set('Retry-After', retryAfterSeconds);
        return res.status(429).json({
          success: false,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Please try again later.`,
          retryAfter: retryAfterSeconds,
          resetAt: result.resetAt,
        });
      }

      next();
    } catch (error) {
      // Fail closed - deny request on error
      console.error('Strict rate limit error:', error);
      return res.status(503).json({
        success: false,
        error: 'Service Temporarily Unavailable',
        message: 'Rate limiting service is temporarily unavailable.',
      });
    }
  };
};

/**
 * IP-based rate limiter (for unauthenticated requests)
 * Uses IP address instead of user ID for rate limiting
 */
const ipRateLimiter = (requestsPerWindow = 100, windowSeconds = 60) => {
  const redis = require('../config/redis');
  const COUNTER_PREFIX = 'rl:ip:';

  return async (req, res, next) => {
    try {
      // Check if rate limiting is globally enabled
      const rateLimitEnabled = await systemConfigService.getConfigValue('rate_limiting', 'RATE_LIMIT_ENABLED');
      if (rateLimitEnabled === false) {
        return next();
      }

      // Get client IP
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const key = `${COUNTER_PREFIX}${ip}`;
      const windowMs = windowSeconds * 1000;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use Redis sorted set for sliding window
      // Phase 1: remove old entries, count current, get oldest (read-only check)
      const readPipeline = redis.pipeline();
      readPipeline.zremrangebyscore(key, 0, windowStart);
      readPipeline.zcard(key);
      readPipeline.zrange(key, 0, 0, 'WITHSCORES');

      const readResults = await readPipeline.exec();
      const currentCount = readResults[1][1] || 0;

      const allowed = currentCount < requestsPerWindow;
      const remaining = Math.max(0, requestsPerWindow - currentCount - 1);

      // Phase 2: only record the request if it is allowed
      if (allowed) {
        const writePipeline = redis.pipeline();
        writePipeline.zadd(key, now, `${now}:${Math.random()}`);
        writePipeline.expire(key, windowSeconds + 1);
        await writePipeline.exec();
      }

      // Stable resetAt: when the oldest entry in the window expires
      const oldestEntry = readResults[2][1];
      const oldestTimestamp = (oldestEntry && oldestEntry.length >= 2)
        ? parseFloat(oldestEntry[1])
        : now;
      const resetAt = new Date(oldestTimestamp + windowMs).toISOString();
      const retryAfterSeconds = Math.max(1, Math.ceil((new Date(resetAt).getTime() - Date.now()) / 1000));

      // Set headers
      res.set('X-RateLimit-Limit', requestsPerWindow);
      res.set('X-RateLimit-Remaining', allowed ? remaining : 0);
      res.set('X-RateLimit-Reset', resetAt);

      if (!allowed) {
        res.set('Retry-After', retryAfterSeconds);
        return res.status(429).json({
          success: false,
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Please try again in ${retryAfterSeconds} seconds.`,
          retryAfter: retryAfterSeconds,
          resetAt,
        });
      }

      next();
    } catch (error) {
      // Fail open
      console.error('IP rate limit error:', error);
      next();
    }
  };
};

module.exports = {
  rateLimitMiddleware,
  createRateLimiter,
  strictRateLimiter,
  ipRateLimiter,
};
