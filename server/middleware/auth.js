const authService = require('../services/authService');
const { getEndpointCategory, isValidReferrer } = require('../config/endpointAccess');

/**
 * Authentication middleware
 * Handles three types of endpoints:
 * - PUBLIC: No authentication required
 * - TOKEN: Requires valid API token
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
    
    if (!isValidReferrer(referer)) {
      // Return 404 to hide endpoint existence
      return res.status(404).json({ error: 'Not found' });
    }

    // Valid referrer - allow access
    return next();
  }

  // TOKEN endpoints - require authentication
  if (category === 'TOKEN') {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.substring(7).trim();

    // Validate token
    const tokenData = await authService.validateToken(token);
    
    if (!tokenData) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user info to request
    req.user = {
      accountId: tokenData.account_id,
      tokenId: tokenData.id,
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

  // Unknown category - default to requiring token (secure by default)
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
  };

  authService.updateTokenLastUsed(tokenData.id).catch(err => {
    console.error('Error updating token last_used_at:', err);
  });

  return next();
};

module.exports = authenticateToken;

