/**
 * Endpoint Access Configuration
 * Maps endpoint patterns to access categories: PUBLIC, TOKEN, INTERNAL
 * Based on ENDPOINT_CATEGORIZATION.md
 */

const ENDPOINT_ACCESS = {
  // PUBLIC endpoints - No authentication required
  PUBLIC: [
    { method: "GET", path: "/api/v1/transactions" },
    { method: "GET", path: "/api/v1/transactions/count" },
    { method: "GET", path: "/api/v1/blocks" },
    { method: "GET", path: "/api/v1/blocks/:block_id" },
    { method: "GET", path: "/api/v1/gateways" },
    { method: "GET", path: "/api/v1/services/top-by-compute-units" },
    { method: "GET", path: "/api/v1/services/top-by-performance" },
    { method: "POST", path: "/api/v1/auth/register" },
    { method: "POST", path: "/api/v1/auth/login" },
    { method: "POST", path: "/api/v1/auth/refresh" },
    { method: "POST", path: "/api/v1/auth/logout" },
    { method: "POST", path: "/api/v1/auth/verify-email" },
    { method: "POST", path: "/api/v1/auth/resend-verification" },
    { method: "POST", path: "/api/v1/auth/forgot-password" },
    { method: "POST", path: "/api/v1/auth/reset-password" },
  ],

  // JWT_AUTH endpoints - Require valid JWT access token (for user-facing features)
  JWT_AUTH: [
    { method: "GET", path: "/api/v1/auth/account" },
    { method: "GET", path: "/api/v1/auth/tokens" },
    { method: "POST", path: "/api/v1/auth/tokens" },
    { method: "DELETE", path: "/api/v1/auth/tokens/:token_id" },
    { method: "POST", path: "/api/v1/auth/tokens/:token_id/regenerate" },
    { method: "GET", path: "/api/v1/auth/verification-status" },
    { method: "PUT", path: "/api/v1/auth/password" },
    { method: "POST", path: "/api/v1/auth/logout-all" },
    // Admin endpoints - User Management (requires JWT + RBAC)
    { method: "GET", path: "/api/admin/users" },
    { method: "POST", path: "/api/admin/users" },
    { method: "GET", path: "/api/admin/users/:id" },
    { method: "PUT", path: "/api/admin/users/:id" },
    { method: "DELETE", path: "/api/admin/users/:id" },
    { method: "PATCH", path: "/api/admin/users/:id/status" },
    { method: "POST", path: "/api/admin/users/:id/reset-password" },
    { method: "GET", path: "/api/admin/users/:id/activity" },
    { method: "GET", path: "/api/admin/users/:id/analytics" },
    // Admin endpoints - Role Management
    { method: "GET", path: "/api/admin/roles" },
    { method: "POST", path: "/api/admin/roles" },
    { method: "GET", path: "/api/admin/roles/:id" },
    { method: "PUT", path: "/api/admin/roles/:id" },
    { method: "DELETE", path: "/api/admin/roles/:id" },
    { method: "POST", path: "/api/admin/roles/:id/modules" },
    { method: "DELETE", path: "/api/admin/roles/:id/modules/:moduleId" },
    { method: "PUT", path: "/api/admin/roles/:id/modules/:moduleId" },
    // Admin endpoints - Module Management
    { method: "GET", path: "/api/admin/modules" },
    { method: "POST", path: "/api/admin/modules" },
    { method: "GET", path: "/api/admin/modules/:id" },
    { method: "PUT", path: "/api/admin/modules/:id" },
    { method: "DELETE", path: "/api/admin/modules/:id" },
  ],

  // TOKEN endpoints - Require valid API token
  TOKEN: [
    // Network Growth endpoints (not categorized, defaulting to TOKEN for security)
    { method: "GET", path: "/api/v1/network-growth" },
    { method: "GET", path: "/api/v1/network-growth/performance" },
    { method: "GET", path: "/api/v1/network-growth/entities" },
    { method: "GET", path: "/api/v1/network-growth/summary" },
    // Transaction endpoints
    { method: "POST", path: "/api/v1/transactions" },
    { method: "GET", path: "/api/v1/transactions/stats" },
    { method: "POST", path: "/api/v1/transactions/stats" },
    { method: "GET", path: "/api/v1/transactions/:transaction_id" },
    { method: "GET", path: "/api/v1/applications" },
    { method: "GET", path: "/api/v1/applications/:address" },
    { method: "GET", path: "/api/v1/applications/:address/usage" },
    { method: "GET", path: "/api/v1/applications/:address/claims/usage" },
    { method: "GET", path: "/api/v1/suppliers" },
    { method: "GET", path: "/api/v1/suppliers/:address" },
    { method: "GET", path: "/api/v1/suppliers/:address/performance" },
    { method: "GET", path: "/api/v1/suppliers/:address/claims/performance" },
    { method: "GET", path: "/api/v1/gateways/:address" },
    { method: "GET", path: "/api/v1/delegations" },
    { method: "GET", path: "/api/v1/staking" },
    { method: "GET", path: "/api/v1/proof-submissions" },
    { method: "GET", path: "/api/v1/proof-submissions/rewards" },
    { method: "GET", path: "/api/v1/proof-submissions/summary" },
    { method: "GET", path: "/api/v1/claims" },
    { method: "POST", path: "/api/v1/claims" },
    { method: "GET", path: "/api/v1/claims/rewards" },
    { method: "POST", path: "/api/v1/claims/rewards" },
    { method: "GET", path: "/api/v1/claims/summary" },
    { method: "POST", path: "/api/v1/claims/summary" },
    { method: "GET", path: "/api/v1/validators/search" },
    { method: "GET", path: "/api/v1/validators/performance" },
    { method: "POST", path: "/api/v1/validators/performance" },
    { method: "GET", path: "/api/v1/validators/:operator_address/performance" },
    { method: "GET", path: "/api/v1/validators/domains" },
    { method: "GET", path: "/api/v1/validators/owners" },
    { method: "POST", path: "/api/v1/services/top-by-compute-units" },
    { method: "POST", path: "/api/v1/services/top-by-performance" },
    { method: "GET", path: "/api/v1/metrics/chains" },
  ],

  // INTERNAL endpoints - Require valid referrer domain
  INTERNAL: [
    { method: "GET", path: "/api/v1/chains" },
    { method: "GET", path: "/api/v1/chains/stats" },
    { method: "POST", path: "/api/v1/jobs" },
    { method: "GET", path: "/api/v1/jobs" },
    { method: "GET", path: "/api/v1/jobs/:id" },
    { method: "POST", path: "/api/v1/jobs/:id/cancel" },
    { method: "GET", path: "/api/v1/health/workers" },
    { method: "GET", path: "/api/v1/health/rpc" },
    { method: "GET", path: "/api/v1/health/block-results-workers" },
    { method: "GET", path: "/api/v1/health/rpc/history" },
    { method: "GET", path: "/api/v1/health/workers/history" },
    { method: "GET", path: "/api/v1/health/block-results-workers/history" },
    { method: "GET", path: "/api/v1/health/process/history" },
    { method: "GET", path: "/api/v1/health/redis/history" },
    { method: "GET", path: "/api/v1/health/redis/keyspace/history" },
    { method: "GET", path: "/api/v1/health/proof-parser" },
    { method: "GET", path: "/api/v1/health/proof-parser/:chain" },
    { method: "GET", path: "/api/v1/health/proof-parser/stats" },
    { method: "GET", path: "/api/v1/metrics/chains/:chain" },
    { method: "GET", path: "/api/v1/logs/containers" },
    { method: "GET", path: "/api/v1/logs/containers/:containerId" },
    { method: "GET", path: "/api/v1/logs/containers/:containerId/history" },
    { method: "POST", path: "/api/v1/proof-submissions" },
    { method: "POST", path: "/api/v1/proof-submissions/rewards" },
    { method: "GET", path: "/api/v1/proof-submissions/rewards/refresh/status" },
    { method: "POST", path: "/api/v1/proof-submissions/rewards/refresh" },
    { method: "POST", path: "/api/v1/proof-submissions/summary" },
    // WebSocket endpoint for logs
    { method: "WS", path: "/api/v1/logs/stream" },
  ],
};

// Allowed referrer domains for INTERNAL endpoints
const ALLOWED_REFERRER_DOMAINS = [
  'explorer.pocket.network',
  'pocket-indexer-dashboard.onrender.com',
  'localhost',
];

/**
 * Check if a path matches a pattern (supports :param placeholders)
 * @param {string} pattern - Pattern with :param placeholders
 * @param {string} path - Actual path
 * @returns {boolean}
 */
function matchesPattern(pattern, path) {
  // Convert pattern to regex
  const regexPattern = pattern
    .replace(/\//g, '\\/')
    .replace(/:[\w]+/g, '[^/]+');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(path);
}

/**
 * Get endpoint access category
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @returns {string|null} 'PUBLIC', 'JWT_AUTH', 'TOKEN', 'INTERNAL', or null if not found
 */
function getEndpointCategory(method, path) {
  // Check PUBLIC first
  for (const endpoint of ENDPOINT_ACCESS.PUBLIC) {
    if (endpoint.method === method && matchesPattern(endpoint.path, path)) {
      return 'PUBLIC';
    }
  }

  // Check JWT_AUTH
  for (const endpoint of ENDPOINT_ACCESS.JWT_AUTH) {
    if (endpoint.method === method && matchesPattern(endpoint.path, path)) {
      return 'JWT_AUTH';
    }
  }

  // Check TOKEN
  for (const endpoint of ENDPOINT_ACCESS.TOKEN) {
    if (endpoint.method === method && matchesPattern(endpoint.path, path)) {
      return 'TOKEN';
    }
  }

  // Check INTERNAL
  for (const endpoint of ENDPOINT_ACCESS.INTERNAL) {
    if (endpoint.method === method && matchesPattern(endpoint.path, path)) {
      return 'INTERNAL';
    }
  }

  // Default to TOKEN for unknown endpoints (secure by default)
  return 'TOKEN';
}

/**
 * Validate referrer domain
 * @param {string} referer - Referer or Origin header value
 * @returns {boolean}
 */
function isValidReferrer(referer) {
  if (!referer) return false;

  try {
    const url = new URL(referer);
    const hostname = url.hostname.toLowerCase();

    // Check for localhost (including 127.0.0.1 and ::1)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }

    // Check if hostname contains any allowed domain
    return ALLOWED_REFERRER_DOMAINS.some(domain => hostname.includes(domain));
  } catch (error) {
    // Invalid URL format
    return false;
  }
}

module.exports = {
  ENDPOINT_ACCESS,
  ALLOWED_REFERRER_DOMAINS,
  getEndpointCategory,
  isValidReferrer,
  matchesPattern,
};

