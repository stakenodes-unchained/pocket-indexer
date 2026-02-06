const authService = require('../services/authService');
const { getEndpointCategory, isValidReferrer, ALLOWED_REFERRER_DOMAINS } = require('../config/endpointAccess');

/**
 * Authentication middleware
 * Handles four types of endpoints:
 * - PUBLIC: No authentication required
 * - JWT_AUTH: Requires valid JWT access token (for user-facing features)
 * - TOKEN: Requires valid API token (for programmatic access)
 * - INTERNAL: Requires valid referrer domain
 */
const authenticateToken = async (req, res, next) => {
  // Handle WebSocket upgrade requests
  if (req.headers.upgrade === 'websocket') {
    const method = 'WS';
    const path = req.path;
    const category = getEndpointCategory(method, path);

    if (category === 'INTERNAL') {
      const referer = req.headers.referer || req.headers.origin || req.headers.referrer;
      if (!isValidReferrer(referer)) {
        return res.status(404).json({ error: 'Not found' });
      }
    }
    // Allow WebSocket upgrade to proceed
    return next();
  }

  const method = req.method;
  const path = req.path;

  
  // Get endpoint category
  const category = getEndpointCategory(method, path);

  // PUBLIC endpoints - skip authentication
  if (category === 'PUBLIC') {
    return next();
  }

  // INTERNAL endpoints - check referrer
  if (category === 'INTERNAL') {
    const referer = req.headers.referer || req.headers.origin || req.headers.referrer;

    // Allow same-host requests (direct browser navigation, server-to-server proxying)
    const host = req.headers.host || '';
    const isSameHost = ALLOWED_REFERRER_DOMAINS.some(domain => host.includes(domain));

    if (!isSameHost && !isValidReferrer(referer)) {
      // Return 404 to hide endpoint existence
      return res.status(404).json({ error: 'Not found' });
    }

    // Valid referrer or same-host - allow access
    return next();
  }

  // JWT_AUTH endpoints - require JWT access token
  if (category === 'JWT_AUTH') {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7).trim();

    // Verify JWT token
    const decoded = authService.verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user info to request (including role_id from JWT payload)
    req.user = {
      accountId: decoded.accountId,
      email: decoded.email,
      name: decoded.name,
      email_verified: decoded.email_verified,
      roleId: decoded.roleId,
    };

    return next();
  }

  // TOKEN endpoints - require API token
  if (category === 'TOKEN') {

    // Allow access to TOKEN endpoints if the request is from pocket.network
    if((req.headers.referer || req.headers.origin || req.headers.referrer).includes("pocket.network")){
      return next();
    }
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7).trim();

    // Validate API token
    const tokenData = await authService.validateToken(token);

    if (!tokenData) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user info to request (including role_id for rate limiting)
    req.user = {
      accountId: tokenData.account_id,
      tokenId: tokenData.id,
      roleId: tokenData.role_id,
      email: tokenData.email,
      name: tokenData.account_name,
    };

    // Update token last_used_at (async, don't wait)
    authService.updateTokenLastUsed(tokenData.id).catch(err => {
      console.error('Error updating token last_used_at:', err);
    });

    // Track usage (async, don't wait)
    const startTime = Date.now();
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      authService.trackTokenUsage(
        tokenData.id,
        path,
        method,
        res.statusCode,
        responseTime
      ).catch(err => {
        console.error('Error tracking token usage:', err);
      });
    });

    return next();
  }

  // Unknown category - default to requiring API token (secure by default)
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.substring(7).trim();
  const tokenData = await authService.validateToken(token);

  if (!tokenData) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = {
    accountId: tokenData.account_id,
    tokenId: tokenData.id,
    roleId: tokenData.role_id,
    email: tokenData.email,
    name: tokenData.account_name,
  };

  authService.updateTokenLastUsed(tokenData.id).catch(err => {
    console.error('Error updating token last_used_at:', err);
  });

  return next();
};

module.exports = authenticateToken;

