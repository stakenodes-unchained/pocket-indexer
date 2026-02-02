const { Pool } = require('pg');

const pgPool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  max: parseInt(process.env.DB_POOL_SIZE || '10', 10),
  min: parseInt(process.env.DB_POOL_MIN || '2', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 120000,
});

// Cache for role permissions (5 minutes TTL)
const permissionsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get user permissions from database with caching
 * @param {number} userId - User ID
 * @returns {Promise<Object>} User permissions
 */
async function getUserPermissions(userId) {
  const cacheKey = `user_${userId}`;
  const cached = permissionsCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const client = await pgPool.connect();
  try {
    // Get user with role and permissions
    const result = await client.query(
      `SELECT
        u.id, u.email, u.role_id, u.status,
        r.slug as role_slug, r.name as role_name,
        json_agg(
          json_build_object(
            'module_id', m.id,
            'module_slug', m.slug,
            'module_name', m.name,
            'endpoints', m.endpoints,
            'permissions', rma.permissions
          )
        ) FILTER (WHERE m.id IS NOT NULL) as modules
      FROM api_accounts u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN role_module_access rma ON r.id = rma.role_id
      LEFT JOIN modules m ON rma.module_id = m.id AND m.is_active = TRUE
      WHERE u.id = $1
      GROUP BY u.id, u.email, u.role_id, u.status, r.slug, r.name`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const userData = result.rows[0];

    // Store in cache
    permissionsCache.set(cacheKey, {
      data: userData,
      timestamp: Date.now(),
    });

    return userData;
  } finally {
    client.release();
  }
}

/**
 * Match endpoint path against module endpoints
 * @param {string} requestPath - Request path
 * @param {string} requestMethod - Request method
 * @param {Array} moduleEndpoints - Module endpoint patterns
 * @returns {boolean}
 */
function matchesEndpoint(requestPath, requestMethod, moduleEndpoints) {
  if (!moduleEndpoints || moduleEndpoints.length === 0) {
    return false;
  }

  for (const endpointPattern of moduleEndpoints) {
    // Parse pattern: "GET /api/v1/users/*"
    const parts = endpointPattern.trim().split(/\s+/);
    let patternMethod = 'GET';
    let patternPath = parts[0];

    if (parts.length === 2) {
      patternMethod = parts[0];
      patternPath = parts[1];
    }

    // Check method match
    if (patternMethod !== '*' && patternMethod !== requestMethod) {
      continue;
    }

    // Convert pattern to regex
    // Replace :param with [^/]+ and * with .*
    const regexPattern = patternPath
      .replace(/\//g, '\\/')
      .replace(/:\w+/g, '[^/]+')
      .replace(/\*/g, '.*');

    const regex = new RegExp(`^${regexPattern}$`);

    if (regex.test(requestPath)) {
      return true;
    }
  }

  return false;
}

/**
 * Get required permission based on HTTP method
 * @param {string} method - HTTP method
 * @returns {string} Required permission
 */
function getRequiredPermission(method) {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return 'read';
    case 'POST':
    case 'PUT':
    case 'PATCH':
      return 'write';
    case 'DELETE':
      return 'delete';
    default:
      return 'read';
  }
}

/**
 * RBAC Middleware - Check user permissions for endpoint access
 * This middleware should be used AFTER authentication middleware
 * It requires req.user to be set with at least { accountId }
 */
const checkPermissions = (options = {}) => {
  return async (req, res, next) => {
    try {
      // Skip if no user (handled by auth middleware)
      if (!req.user || !req.user.accountId) {
        return next();
      }

      const userId = req.user.accountId;
      // Use originalUrl to get the full path including the mount point
      const requestPath = req.originalUrl.split('?')[0]; // Remove query string
      const requestMethod = req.method;

      // Get user permissions
      const userData = await getUserPermissions(userId);

      if (!userData) {
        return res.status(403).json({
          success: false,
          error: 'Access denied - user not found',
        });
      }

      // Check user status
      if (userData.status !== 'active') {
        return res.status(403).json({
          success: false,
          error: 'Access denied - account is not active',
        });
      }

      // Super admin bypass (optional)
      if (userData.role_slug === 'super-admin') {
        req.user.role = userData.role_slug;
        req.user.permissions = { read: true, write: true, delete: true, admin: true };
        return next();
      }

      // Check if user has any modules
      if (!userData.modules || userData.modules.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'Access denied - no permissions assigned',
        });
      }

      // Find matching module
      let matchedModule = null;
      for (const module of userData.modules) {
        if (matchesEndpoint(requestPath, requestMethod, module.endpoints)) {
          matchedModule = module;
          break;
        }
      }

      if (!matchedModule) {
        return res.status(403).json({
          success: false,
          error: 'Access denied - endpoint not allowed for your role',
        });
      }

      // Check required permission
      const requiredPermission = options.permission || getRequiredPermission(requestMethod);
      const permissions = matchedModule.permissions || {};

      if (!permissions[requiredPermission]) {
        return res.status(403).json({
          success: false,
          error: `Access denied - insufficient permissions (${requiredPermission} required)`,
        });
      }

      // Attach role and permissions to request
      req.user.role = userData.role_slug;
      req.user.roleName = userData.role_name;
      req.user.permissions = permissions;
      req.user.module = matchedModule.module_slug;

      next();
    } catch (error) {
      console.error('RBAC middleware error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
      });
    }
  };
};

/**
 * Clear permissions cache for a user
 * @param {number} userId - User ID
 */
function clearUserCache(userId) {
  permissionsCache.delete(`user_${userId}`);
}

/**
 * Clear all permissions cache
 */
function clearAllCache() {
  permissionsCache.clear();
}

module.exports = {
  checkPermissions,
  clearUserCache,
  clearAllCache,
};
