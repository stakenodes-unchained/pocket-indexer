const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const dotenv = require('dotenv');
const cluster = require('cluster');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const transactionService = require('./services/transactionService');
const performanceService = require('./services/performanceService');
const RewardAnalyticsRefreshService = require('./services/rewardAnalyticsRefreshService');
const dockerService = require('./services/dockerService');
const redis = require('./config/redis');
const authService = require('./services/authService');
const authenticateToken = require('./middleware/auth');
const { apiLogger } = require('./middleware/apiLogger');
const AnalyticsAggregationService = require('./services/analyticsAggregationService');

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3006;
const NUM_WORKERS = Math.min(1, Math.min(parseInt(process.env.CLUSTER_WORKERS || os.cpus().length, 10), 8));

// Initialize reward analytics refresh service (only in first worker to avoid duplicate refreshes)
let rewardAnalyticsRefreshService = null;
let analyticsAggregationService = null;

// Simple Redis cache middleware for GET requests
const cacheMiddleware = (ttl = 60) => {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Skip cache for endpoints that shouldn't be cached (like health checks)
    if (req.path.includes('/health') || req.path.includes('/jobs')) {
      return next();
    }
    
    try {
      // Create cache key from URL, query params, AND authentication status
      // This ensures authenticated and unauthenticated requests don't share cache
      const accountId = req.user?.accountId || 'public';
      const cacheKey = `api:${req.method}:${req.path}:${JSON.stringify(req.query)}:user:${accountId}`;

      // Try to get from cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }
      
      // Store original json method
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        // Cache the response
        redis.set(cacheKey, JSON.stringify(data), 'EX', ttl).catch(err => {
          console.error('Redis cache set error:', err);
        });
        res.set('X-Cache', 'MISS');
        return originalJson(data);
      };
      
      next();
    } catch (err) {
      // If Redis fails, continue without cache
      console.error('Cache middleware error:', err);
      next();
    }
  };
};

// Cache middleware for POST requests (specifically for reward analytics)
const postCacheMiddleware = (ttl = 120) => {
  return async (req, res, next) => {
    // Only cache POST requests
    if (req.method !== 'POST') {
      return next();
    }
    
    // Only cache specific endpoints
    if (!req.path.includes('/api/v1/proof-submissions/rewards')) {
      return next();
    }
    
    try {
      // Create cache key from path, request body, AND authentication status
      const bodyKey = req.body ? JSON.stringify(req.body, Object.keys(req.body).sort()) : '{}';
      const accountId = req.user?.accountId || 'public';
      const cacheKey = `api:${req.method}:${req.path}:${bodyKey}:user:${accountId}`;

      // Try to get from cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }
      
      // Store original json method
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        // Cache the response
        redis.set(cacheKey, JSON.stringify(data), 'EX', ttl).catch(err => {
          console.error('Redis cache set error:', err);
        });
        res.set('X-Cache', 'MISS');
        return originalJson(data);
      };
      
      next();
    } catch (err) {
      // If Redis fails, continue without cache
      console.error('POST cache middleware error:', err);
      next();
    }
  };
};

// Cluster mode: spawn worker processes
// Use isPrimary for newer Node.js versions, fallback to isMaster for older versions
if (cluster.isPrimary || cluster.isMaster) {
  console.log(`🚀 Primary process ${process.pid} starting ${NUM_WORKERS} workers...`);
  
  // Fork workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    cluster.fork();
  }
  
  // Handle worker exit
  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️  Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
  
  console.log(`✅ Primary process ready with ${NUM_WORKERS} workers`);
  return;
}

// Worker process - this is where the Express app runs
const app = express();

// Middleware
// Increase body size limit to handle large arrays of supplier addresses (default is 100kb)
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors());

// Error handler for body-parser errors (e.g., payload too large)
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('Body parsing error:', err.message);
    return res.status(400).json({ error: 'Invalid JSON in request body', details: err.message });
  }
  next(err);
});

// Authentication middleware - applies to all routes based on endpoint categorization
// MUST come BEFORE caching to ensure auth is always checked
app.use(authenticateToken);

// API Logger middleware - logs all requests to database for analytics
// Comes AFTER auth so we can log user_id
app.use(apiLogger());

// Add caching middleware for GET requests (60 second TTL by default)
// Comes AFTER auth so cache keys include authentication context
// Skip cache for admin routes to ensure real-time data
app.use((req, res, next) => {
  // Skip cache for admin routes
  if (req.path.startsWith('/api/admin')) {
    return next();
  }
  // Apply cache middleware for other routes
  return cacheMiddleware(60)(req, res, next);
});

// Request logging middleware (console output)
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  
  // Log the incoming request
  console.log(`[${timestamp}] ${req.method} ${req.url} - ${req.ip}`);
  
  // Override res.end to log the response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - start;
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
});

// ============================================================================
// Authentication Endpoints
// ============================================================================

// POST /api/v1/auth/register - Unified registration endpoint (PUBLIC)
// Intelligently handles both quick (email-only) and full (with password) registration
app.post('/api/v1/auth/register', async (req, res) => {
  try {
    const { email, password, name, organization } = req.body;

    // Validate required fields
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Determine registration type based on password presence
    if (password) {
      // ===== FULL REGISTRATION (with password) =====
      // Requires: email, password, name
      // Flow: Create account → Send verification email → User verifies → Token generated

      // Validate password
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long' });
      }

      // Name is required for full registration
      if (!name) {
        return res.status(400).json({
          error: 'Name is required when registering with a password'
        });
      }

      const result = await authService.registerFull(email, password, name, organization);

      // Send verification email
      try {
        await authService.sendVerificationLink(result.account.id);

        return res.status(201).json({
          data: {
            account: result.account,
          },
          message: 'Account created successfully. A verification link has been sent to your email. Please verify your email to receive your API token.',
          requiresVerification: true,
          accountType: 'full',
        });
      } catch (emailError) {
        console.error('Failed to send verification email:', emailError);
        return res.status(201).json({
          data: {
            account: result.account,
          },
          message: 'Account created successfully but failed to send verification email. Please use the resend verification endpoint.',
          requiresVerification: true,
          emailSendFailed: true,
          accountType: 'full',
        });
      }
    } else {
      // ===== QUICK REGISTRATION (email-only) =====
      // Requires: email only (name/org optional)
      // Flow: Create account → Return token immediately → Send token via email

      const result = await authService.registerQuick(email, name, organization);

      // Send API token via email
      try {
        const emailService = require('./services/emailService');
        await emailService.sendApiTokenEmail(result.account.email, result.token.token, result.account.name);

        return res.status(201).json({
          data: {
            account: result.account,
            token: result.token,
          },
          message: 'Account created successfully. Your API token has been sent to your email. You can start using the API immediately.',
          requiresVerification: false,
          accountType: 'api_only',
          tokenSentViaEmail: true,
        });
      } catch (emailError) {
        console.error('Failed to send API token email:', emailError);
        // Still return success with the token even if email fails
        return res.status(201).json({
          data: {
            account: result.account,
            token: result.token,
          },
          message: 'Account created successfully. You can start using the API immediately with your token. Note: Failed to send token via email.',
          requiresVerification: false,
          accountType: 'api_only',
          emailSendFailed: true,
        });
      }
    }
  } catch (error) {
    console.error('Registration error:', error);

    if (error.message.includes('duplicate key') || error.code === '23505') {
      return res.status(409).json({
        error: 'An account with this email already exists'
      });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/login - Login with email and password (PUBLIC)
// Returns JWT tokens for user authentication
app.post('/api/v1/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user agent and IP for session tracking
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.socket?.remoteAddress;

    const result = await authService.loginWithJWT(email, password || '', userAgent, ipAddress);

    res.json({
      data: {
        account: result.account,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      message: 'Login successful',
    });
  } catch (error) {
    console.error('Login error:', error);

    // Don't reveal if email exists or password is wrong
    res.status(401).json({ error: 'Invalid email or password' });
  }
});

// POST /api/v1/auth/refresh - Refresh access token (PUBLIC)
// Uses refresh token to get new access token
app.post('/api/v1/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const result = await authService.refreshAccessToken(refreshToken);

    res.json({
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      message: 'Token refreshed successfully',
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// POST /api/v1/auth/logout - Logout and revoke refresh token (PUBLIC)
// Revokes the provided refresh token
app.post('/api/v1/auth/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const success = await authService.revokeRefreshToken(refreshToken);

    if (!success) {
      return res.status(404).json({ error: 'Token not found or already revoked' });
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/logout-all - Logout from all devices (JWT_AUTH)
// Revokes all refresh tokens for the authenticated user
app.post('/api/v1/auth/logout-all', async (req, res) => {
  try {
    const accountId = req.user?.accountId;

    if (!accountId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const count = await authService.revokeAllRefreshTokens(accountId);

    res.json({
      message: `Logged out from ${count} device(s) successfully`,
      devicesLoggedOut: count,
    });
  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/auth/account - Get account information (JWT_AUTH)
app.get('/api/v1/auth/account', async (req, res) => {
  try {
    const accountId = req.user?.accountId;
    
    if (!accountId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const account = await authService.getAccount(accountId);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json({ data: account });
  } catch (error) {
    console.error('Get account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/auth/tokens - List all tokens for account (TOKEN)
app.get('/api/v1/auth/tokens', async (req, res) => {
  try {
    const accountId = req.user?.accountId;

    if (!accountId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if email is verified
    const account = await authService.getAccount(accountId);
    if (!account.email_verified) {
      return res.status(403).json({
        error: 'Email not verified. Please verify your email address before managing tokens.'
      });
    }

    const tokens = await authService.listTokens(accountId);

    res.json({ data: tokens });
  } catch (error) {
    console.error('List tokens error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/tokens - Create new token (TOKEN)
app.post('/api/v1/auth/tokens', async (req, res) => {
  try {
    const accountId = req.user?.accountId;

    if (!accountId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if email is verified
    const account = await authService.getAccount(accountId);
    if (!account.email_verified) {
      return res.status(403).json({
        error: 'Email not verified. Please verify your email address before creating tokens.'
      });
    }

    const { name } = req.body;
    const tokenName = name || 'New Token';

    const token = await authService.createToken(accountId, tokenName);

    res.status(201).json({
      data: token,
      message: 'Token created successfully. Please save your API token - it will not be shown again.',
    });
  } catch (error) {
    console.error('Create token error:', error);

    if (error.message.includes('Account not found')) {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/v1/auth/tokens/:token_id - Revoke token (TOKEN)
app.delete('/api/v1/auth/tokens/:token_id', async (req, res) => {
  try {
    const accountId = req.user?.accountId;
    const tokenId = parseInt(req.params.token_id, 10);

    if (!accountId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if email is verified
    const account = await authService.getAccount(accountId);
    if (!account.email_verified) {
      return res.status(403).json({
        error: 'Email not verified. Please verify your email address before deleting tokens.'
      });
    }

    if (isNaN(tokenId)) {
      return res.status(400).json({ error: 'Invalid token ID' });
    }

    const success = await authService.revokeToken(tokenId, accountId);

    if (!success) {
      return res.status(404).json({ error: 'Token not found or already revoked' });
    }

    res.json({ message: 'Token revoked successfully' });
  } catch (error) {
    console.error('Revoke token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/tokens/:token_id/regenerate - Regenerate token (TOKEN)
app.post('/api/v1/auth/tokens/:token_id/regenerate', async (req, res) => {
  try {
    const accountId = req.user?.accountId;
    const tokenId = parseInt(req.params.token_id, 10);
    const { name } = req.body;

    if (!accountId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if email is verified
    const account = await authService.getAccount(accountId);
    if (!account.email_verified) {
      return res.status(403).json({
        error: 'Email not verified. Please verify your email address before regenerating tokens.'
      });
    }

    if (isNaN(tokenId)) {
      return res.status(400).json({ error: 'Invalid token ID' });
    }

    const token = await authService.regenerateToken(tokenId, accountId, name);

    res.json({
      data: token,
      message: 'Token regenerated successfully. Please save your new API token - it will not be shown again.',
    });
  } catch (error) {
    console.error('Regenerate token error:', error);

    if (error.message.includes('Token not found')) {
      return res.status(404).json({ error: error.message });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/verify-email - Verify email with token (PUBLIC)
app.post('/api/v1/auth/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }

    // Validate token format (64 hex characters)
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(400).json({ error: 'Invalid verification token format' });
    }

    const result = await authService.verifyEmailWithToken(token);

    // Include API token in response if it was generated (for full accounts)
    const response = {
      data: result,
      message: result.message,
    };

    // If API token was generated, highlight it in the message
    if (result.apiToken) {
      response.message = 'Email verified successfully! Your API token has been generated. Please save it - it will not be shown again.';
      response.data.token = result.apiToken;
    }

    res.json(response);
  } catch (error) {
    console.error('Email verification error:', error);

    if (error.message.includes('expired')) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message.includes('Invalid verification token')) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message.includes('already verified')) {
      return res.status(200).json({
        data: { success: true, alreadyVerified: true },
        message: error.message
      });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/resend-verification - Resend verification link (PUBLIC)
app.post('/api/v1/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const result = await authService.resendVerificationLink(email);

    res.json({
      data: {
        email: result.email,
        tokenExpiry: result.tokenExpiry,
      },
      message: 'Verification link sent successfully. Please check your email.',
    });
  } catch (error) {
    console.error('Resend verification error:', error);

    if (error.message.includes('Account not found')) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (error.message.includes('already verified')) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message.includes('Too many')) {
      return res.status(429).json({ error: error.message });
    }

    if (error.message.includes('already sent')) {
      return res.status(429).json({ error: error.message });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/auth/forgot-password - Request password reset link (PUBLIC)
app.post('/api/v1/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    await authService.requestPasswordReset(email);

    // Always return success even if email doesn't exist (security best practice)
    // Don't reveal whether the email is registered
    res.json({
      data: { email },
      message: 'If an account exists with this email, a password reset link has been sent. Please check your email.',
    });
  } catch (error) {
    console.error('Password reset request error:', error);

    // Handle rate limiting
    if (error.message.includes('Too many')) {
      return res.status(429).json({ error: error.message });
    }

    // Always return generic success to avoid email enumeration
    res.json({
      data: { email: req.body.email },
      message: 'If an account exists with this email, a password reset link has been sent. Please check your email.',
    });
  }
});

// POST /api/v1/auth/reset-password - Reset password with token (PUBLIC)
app.post('/api/v1/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' });
    }

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    // Validate token format (64 hex characters)
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(400).json({ error: 'Invalid reset token format' });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const result = await authService.resetPassword(token, newPassword);

    res.json({
      data: {
        success: true,
        email: result.email,
      },
      message: 'Password reset successfully. All active sessions have been logged out. Please login with your new password.',
    });
  } catch (error) {
    console.error('Password reset error:', error);

    if (error.message.includes('Invalid') || error.message.includes('expired')) {
      return res.status(400).json({ error: error.message });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/v1/auth/password - Change password (JWT_AUTH)
// Requires JWT authentication - user must be logged in
app.put('/api/v1/auth/password', async (req, res) => {
  try {
    const accountId = req.user?.accountId;

    if (!accountId) {
      return res.status(401).json({ error: 'Authentication required. Please login first.' });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required' });
    }

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long' });
    }

    // Check if new password is different from current
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    const result = await authService.changePassword(accountId, currentPassword, newPassword);

    res.json({
      data: {
        success: true,
        email: result.email,
        lastPasswordChange: result.lastPasswordChange,
      },
      message: 'Password changed successfully. All other sessions have been logged out for security.',
    });
  } catch (error) {
    console.error('Change password error:', error);

    if (error.message.includes('Current password is incorrect')) {
      return res.status(400).json({ error: error.message });
    }

    if (error.message.includes('Account not found')) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (error.message.includes('api_only')) {
      return res.status(400).json({ error: 'Cannot change password for API-only accounts. Please use password reset instead.' });
    }

    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/v1/auth/verification-status - Get email verification status (TOKEN)
app.get('/api/v1/auth/verification-status', async (req, res) => {
  try {
    const accountId = req.user?.accountId;

    if (!accountId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const account = await authService.getAccount(accountId);

    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json({
      data: {
        emailVerified: account.email_verified,
        emailVerifiedAt: account.email_verified_at,
        email: account.email,
        verificationRequired: authService.isEmailVerificationRequired(),
      },
    });
  } catch (error) {
    console.error('Verification status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// API Endpoints
// ============================================================================

// Combined daily time series for entities and performance metrics.
// Prefer `/network-growth/performance` + `/network-growth/entities` for new clients.
app.get('/api/v1/network-growth', cacheMiddleware(1800), async (req, res) => {
  try {
    const { chain, window } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const windowDays = Math.max(1, Math.min(parseInt(window || '7', 10) || 7, 365));

    const entitiesSql = `
      WITH bounds AS (
        SELECT (NOW()::date) AS end_day,
               (NOW()::date - ($2::int - 1) * INTERVAL '1 day')::date AS start_day
      ),
      days AS (
        SELECT generate_series(b.start_day, b.end_day, INTERVAL '1 day')::date AS day
        FROM bounds b
      ),
      txw AS (
        SELECT timestamp, tx_data
        FROM transactions
        WHERE timestamp >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR chain = $1)
          AND (tx_data->'tx'->'body'->'messages') IS NOT NULL
      ),
      msgs AS (
        SELECT 
          t.timestamp,
          COALESCE(m->>'@type', m->>'type', m->>'type_url') AS type_url,
          COALESCE(
            m->>'address',
            m->>'app_address',
            m->>'gateway_address',
            m->>'operator_address',
            m->>'owner_address'
          ) AS addr,
          (m->'service'->>'id') AS service_id
        FROM txw t
        JOIN LATERAL jsonb_array_elements(t.tx_data->'tx'->'body'->'messages') AS m ON TRUE
      ),
      apps_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.application.MsgStakeApplication%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      sups_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.supplier.MsgStakeSupplier%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      gws_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.gateway.MsgStakeGateway%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      svcs_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.service.MsgAddService%'
          AND service_id IS NOT NULL
        GROUP BY service_id
      ),
      apps_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM apps_first GROUP BY first_day
      ),
      sups_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM sups_first GROUP BY first_day
      ),
      gws_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM gws_first GROUP BY first_day
      ),
      svcs_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM svcs_first GROUP BY first_day
      )
      SELECT d.day,
             COALESCE(a.cnt, 0) AS applications,
             COALESCE(s.cnt, 0) AS suppliers,
             COALESCE(g.cnt, 0) AS gateways,
             COALESCE(v.cnt, 0) AS services
      FROM days d
      LEFT JOIN apps_counts a USING(day)
      LEFT JOIN sups_counts s USING(day)
      LEFT JOIN gws_counts g USING(day)
      LEFT JOIN svcs_counts v USING(day)
      ORDER BY d.day ASC;
    `;

    const entitiesRes = await client.query(entitiesSql, [chain || null, windowDays]);
    const entitySeries = entitiesRes.rows || [];

    const perfSql = `
      WITH bounds AS (
        SELECT ((NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date) AS end_day,
               ((NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date - ($2::int - 1) * INTERVAL '1 day')::date AS start_day
      ),
      days AS (
        SELECT generate_series(b.start_day, b.end_day, INTERVAL '1 day')::date AS day
        FROM bounds b
      ),
      agg AS (
        SELECT DATE_TRUNC('day', cs.created_timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date AS day,
               SUM(cs.num_relays) AS relays,
               SUM(cs.num_claimed_compute_units) AS compute_units
        FROM claim_settlements cs
        WHERE cs.created_timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR cs.chain = $1)
        GROUP BY 1
      )
      SELECT d.day,
             COALESCE(a.relays, 0) AS relays,
             COALESCE(a.compute_units, 0) AS compute_units
      FROM days d
      LEFT JOIN agg a USING(day)
      ORDER BY d.day ASC;
    `;

    const perfRes = await client.query(perfSql, [chain || null, windowDays]);
    const perfSeries = perfRes.rows || [];

    const byDay = new Map();
    for (const row of entitySeries) {
      byDay.set(row.day, {
        day: row.day,
        applications: Number(row.applications || 0),
        suppliers: Number(row.suppliers || 0),
        gateways: Number(row.gateways || 0),
        services: Number(row.services || 0),
        relays: 0,
        compute_units: 0
      });
    }
    for (const row of perfSeries) {
      const existing = byDay.get(row.day) || {
        day: row.day,
        applications: 0,
        suppliers: 0,
        gateways: 0,
        services: 0,
        relays: 0,
        compute_units: 0
      };
      existing.relays = Number(row.relays || 0);
      existing.compute_units = Number(row.compute_units || 0);
      byDay.set(row.day, existing);
    }

    const timeline = Array.from(byDay.values()).sort((a, b) => new Date(a.day) - new Date(b.day));

    res.json({ data: { window_days: windowDays, timeline } });
  } catch (error) {
    console.error('Error fetching network growth:', error);
    res.status(500).json({ error: error.message });
  }
});

// Daily performance metrics (relays and compute units) with proof/claims breakdown.
app.get('/api/v1/network-growth/performance', cacheMiddleware(1800), async (req, res) => {
  try {
    const { chain, window } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const windowDays = Math.max(1, Math.min(parseInt(window || '7', 10) || 7, 365));

    const perfSql = `
      WITH bounds AS (
        SELECT ((NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date) AS end_day,
               ((NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date - ($2::int - 1) * INTERVAL '1 day')::date AS start_day
      ),
      days AS (
        SELECT generate_series(b.start_day, b.end_day, INTERVAL '1 day')::date AS day
        FROM bounds b
      ),
      claim_settlements_agg AS (
        SELECT DATE_TRUNC('day', cs.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date AS day,
               SUM(cs.num_relays) AS relays,
               SUM(cs.num_claimed_compute_units) AS compute_units,
               SUM(cs.num_claimed_compute_units) AS settled_claims_computed_units,
               SUM(cs.num_estimated_compute_units) AS settled_claims_estimated_units
        FROM claims cs
        WHERE cs.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR cs.chain = $1)
        GROUP BY 1
      ),
      proof_submissions_agg AS (
        SELECT DATE_TRUNC('day', ps.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date AS day,
               SUM(ps.num_claimed_compute_units) AS proof_submissions_computed_units,
               SUM(ps.num_estimated_compute_units) AS proof_submissions_estimated_units
        FROM proof_submissions ps
        WHERE ps.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR ps.chain = $1)
        GROUP BY 1
      )
      SELECT d.day,
             COALESCE(c.relays, 0) AS relays,
             COALESCE(c.compute_units, 0) AS compute_units,
             COALESCE(p.proof_submissions_computed_units, 0) AS proof_submissions_computed_units,
             COALESCE(p.proof_submissions_estimated_units, 0) AS proof_submissions_estimated_units,
             COALESCE(c.settled_claims_computed_units, 0) AS settled_claims_computed_units,
             COALESCE(c.settled_claims_estimated_units, 0) AS settled_claims_estimated_units
      FROM days d
      LEFT JOIN claim_settlements_agg c USING(day)
      LEFT JOIN proof_submissions_agg p USING(day)
      ORDER BY d.day ASC;
    `;

    const perfRes = await client.query(perfSql, [chain || null, windowDays]);
    const timeline = (perfRes.rows || []).map(row => ({
      day: row.day,
      relays: Number(row.relays || 0),
      compute_units: Number(row.compute_units || 0),
      proof_submissions_computed_units: Number(row.proof_submissions_computed_units || 0),
      proof_submissions_estimated_units: Number(row.proof_submissions_estimated_units || 0),
      settled_claims_computed_units: Number(row.settled_claims_computed_units || 0),
      settled_claims_estimated_units: Number(row.settled_claims_estimated_units || 0)
    }));

    res.json({ data: { window_days: windowDays, timeline } });
  } catch (error) {
    console.error('Error fetching network growth performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Daily first-seen entity counts (applications, suppliers, gateways, services).
app.get('/api/v1/network-growth/entities', cacheMiddleware(1800), async (req, res) => {
  try {
    const { chain, window } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const windowDays = Math.max(1, Math.min(parseInt(window || '7', 10) || 7, 365));

    const entitiesSql = `
      WITH bounds AS (
        SELECT (NOW()::date) AS end_day,
               (NOW()::date - ($2::int - 1) * INTERVAL '1 day')::date AS start_day
      ),
      days AS (
        SELECT generate_series(b.start_day, b.end_day, INTERVAL '1 day')::date AS day
        FROM bounds b
      ),
      txw AS (
        SELECT timestamp, tx_data
        FROM transactions
        WHERE timestamp >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR chain = $1)
          AND (tx_data->'tx'->'body'->'messages') IS NOT NULL
      ),
      msgs AS (
        SELECT 
          t.timestamp,
          COALESCE(m->>'@type', m->>'type', m->>'type_url') AS type_url,
          COALESCE(
            m->>'address',
            m->>'app_address',
            m->>'gateway_address',
            m->>'operator_address',
            m->>'owner_address'
          ) AS addr,
          (m->'service'->>'id') AS service_id
        FROM txw t
        JOIN LATERAL jsonb_array_elements(t.tx_data->'tx'->'body'->'messages') AS m ON TRUE
      ),
      apps_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.application.MsgStakeApplication%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      sups_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.supplier.MsgStakeSupplier%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      gws_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.gateway.MsgStakeGateway%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      svcs_first AS (
        SELECT DATE_TRUNC('day', MIN(timestamp))::date AS first_day
        FROM msgs
        WHERE type_url ILIKE '%pocket.service.MsgAddService%'
          AND service_id IS NOT NULL
        GROUP BY service_id
      ),
      apps_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM apps_first GROUP BY first_day
      ),
      sups_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM sups_first GROUP BY first_day
      ),
      gws_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM gws_first GROUP BY first_day
      ),
      svcs_counts AS (
        SELECT first_day AS day, COUNT(*) AS cnt FROM svcs_first GROUP BY first_day
      )
      SELECT d.day,
             COALESCE(a.cnt, 0) AS applications,
             COALESCE(s.cnt, 0) AS suppliers,
             COALESCE(g.cnt, 0) AS gateways,
             COALESCE(v.cnt, 0) AS services
      FROM days d
      LEFT JOIN apps_counts a USING(day)
      LEFT JOIN sups_counts s USING(day)
      LEFT JOIN gws_counts g USING(day)
      LEFT JOIN svcs_counts v USING(day)
      ORDER BY d.day ASC;
    `;

    const entitiesRes = await client.query(entitiesSql, [chain || null, windowDays]);
    const timeline = (entitiesRes.rows || []).map(row => ({
      day: row.day,
      applications: Number(row.applications || 0),
      suppliers: Number(row.suppliers || 0),
      gateways: Number(row.gateways || 0),
      services: Number(row.services || 0)
    }));

    res.json({ data: { window_days: windowDays, timeline } });
  } catch (error) {
    console.error('Error fetching network growth entities:', error);
    res.status(500).json({ error: error.message });
  }
});

// Window summary for entity and performance metrics (no per-day breakdown).
app.get('/api/v1/network-growth/summary', cacheMiddleware(1800), async (req, res) => {
  try {
    const { chain, window } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const windowDays = Math.max(1, Math.min(parseInt(window || '7', 10) || 7, 365));

    const entitiesSql = `
      WITH bounds AS (
        SELECT (NOW()::date - ($2::int - 1) * INTERVAL '1 day')::date AS start_day
      ),
      txw AS (
        SELECT timestamp, tx_data
        FROM transactions
        WHERE timestamp >= (SELECT start_day FROM bounds)
          AND ($1::text IS NULL OR chain = $1)
          AND (tx_data->'tx'->'body'->'messages') IS NOT NULL
      ),
      msgs AS (
        SELECT 
          t.timestamp,
          COALESCE(m->>'@type', m->>'type', m->>'type_url') AS type_url,
          COALESCE(
            m->>'address',
            m->>'app_address',
            m->>'gateway_address',
            m->>'operator_address',
            m->>'owner_address'
          ) AS addr,
          (m->'service'->>'id') AS service_id
        FROM txw t
        JOIN LATERAL jsonb_array_elements(t.tx_data->'tx'->'body'->'messages') AS m ON TRUE
      ),
      apps AS (
        SELECT MIN(timestamp) AS first_seen
        FROM msgs
        WHERE type_url ILIKE '%pocket.application.MsgStakeApplication%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      sups AS (
        SELECT MIN(timestamp) AS first_seen
        FROM msgs
        WHERE type_url ILIKE '%pocket.supplier.MsgStakeSupplier%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      gws AS (
        SELECT MIN(timestamp) AS first_seen
        FROM msgs
        WHERE type_url ILIKE '%pocket.gateway.MsgStakeGateway%'
          AND addr IS NOT NULL
        GROUP BY addr
      ),
      svcs AS (
        SELECT MIN(timestamp) AS first_seen
        FROM msgs
        WHERE type_url ILIKE '%pocket.service.MsgAddService%'
          AND service_id IS NOT NULL
        GROUP BY service_id
      )
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE first_seen >= NOW() - make_interval(days => $2::int)), 0) AS applications,
        COALESCE((SELECT COUNT(*) FROM sups WHERE first_seen >= NOW() - make_interval(days => $2::int)), 0) AS suppliers,
        COALESCE((SELECT COUNT(*) FROM gws  WHERE first_seen >= NOW() - make_interval(days => $2::int)), 0) AS gateways,
        COALESCE((SELECT COUNT(*) FROM svcs WHERE first_seen >= NOW() - make_interval(days => $2::int)), 0) AS services
      FROM apps;
    `;

    const entitiesRes = await client.query(entitiesSql, [chain || null, windowDays]);
    const entities = entitiesRes.rows[0] || {};

    const perfSql = `
      SELECT
        COALESCE(SUM(cs.num_relays), 0) AS relays,
        COALESCE(SUM(cs.num_claimed_compute_units), 0) AS compute_units
      FROM claim_settlements cs
      LEFT JOIN transactions t ON cs.transaction_hash = t.hash
      WHERE cs.created_timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' >= 
            ((NOW() AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York')::date - make_interval(days => $2::int))
        AND ($1::text IS NULL OR t.chain = $1);
    `;

    const perfRes = await client.query(perfSql, [chain || null, windowDays]);
    const perf = perfRes.rows[0] || {};

    res.json({ data: {
      window_days: windowDays,
      applications: Number(entities.applications || 0),
      suppliers: Number(entities.suppliers || 0),
      gateways: Number(entities.gateways || 0),
      services: Number(entities.services || 0),
      relays: Number(perf.relays || 0),
      compute_units: Number(perf.compute_units || 0)
    }});
  } catch (error) {
    console.error('Error fetching network growth summary:', error);
    res.status(500).json({ error: error.message });
  }
});
/**
 * GET /api/v1/transactions
 * POST /api/v1/transactions
 * 
 * Retrieve transactions with comprehensive filtering, sorting, and pagination.
 * 
 * GET Query Parameters / POST Body Parameters:
 * - address or addresses (string|array): Single address, comma-separated addresses, or array of addresses to filter by
 * - type (string, optional): Filter by transaction type
 * - status (string, optional): Filter by transaction status (e.g., 'success', 'failed')
 * - chain (string, optional): Filter by chain identifier
 * - start_date (string, optional): ISO date string - filter transactions from this date onwards
 * - end_date (string, optional): ISO date string - filter transactions up to this date
 * - min_amount (number, optional): Minimum transaction amount filter
 * - max_amount (number, optional): Maximum transaction amount filter
 * - page (integer, default: 1): Page number for pagination
 * - limit (integer, default: 10, max: 1000): Number of results per page
 * - sort_by (string, default: 'timestamp'): Field to sort by (timestamp, amount, fee, block_height, type, status)
 * - sort_order (string, default: 'desc'): Sort order (asc, desc)
 * 
 * Note: POST method is recommended when filtering by many addresses to avoid URL length limits.
 * 
 * Returns:
 * - data: Array of transaction objects
 * - meta: Pagination metadata (total, page, limit, totalPages, has_more, failedLast24h)
 *   - total: Total count of transactions matching filters
 *   - totalPages: Total number of pages
 *   - has_more: Boolean indicating if there are more results
 *   - failedLast24h: Number of failed transactions in the last 24 hours (independent of current filters)
 */
app.get('/api/v1/transactions', async (req, res) => {
  try {
    const filters = transactionService.extractTransactionFilters(req);
    const transactions = await transactionService.getTransactionsWithFilters(filters);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/transactions', async (req, res) => {
  try {
    const filters = transactionService.extractTransactionFilters(req);
    const transactions = await transactionService.getTransactionsWithFilters(filters);
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/transactions/count', async (req, res) => {
  try {
    const { chain } = req.query;
    const count = await transactionService.getTransactionCount(chain);
    res.json(count);
  } catch (error) {
    console.error('Error fetching transaction count:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/transactions/stats
 * POST /api/v1/transactions/stats
 * 
 * Get transaction statistics based on filters.
 * 
 * GET Query Parameters / POST Body Parameters (same as /api/v1/transactions, excluding pagination/sorting):
 * - address or addresses (string|array): Address filter(s)
 * - type (string, optional): Filter by transaction type
 * - status (string, optional): Filter by transaction status
 * - chain (string, optional): Filter by chain identifier
 * - start_date (string, optional): ISO date string - start date filter
 * - end_date (string, optional): ISO date string - end date filter
 * - min_amount (number, optional): Minimum transaction amount filter
 * - max_amount (number, optional): Maximum transaction amount filter
 * 
 * Note: POST method is recommended when filtering by many addresses to avoid URL length limits.
 * 
 * Returns:
 * - data: Statistics object containing:
 *   - total_count: Total number of transactions matching filters
 *   - total_amount: Sum of all transaction amounts
 *   - total_fees: Sum of all transaction fees
 *   - by_type: Object with transaction counts grouped by type
 *   - by_status: Object with transaction counts grouped by status
 *   - date_range: Object with min and max timestamps
 */
app.get('/api/v1/transactions/stats', async (req, res) => {
  try {
    const filters = transactionService.extractStatsFilters(req);
    const stats = await transactionService.getTransactionStats(filters);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching transaction stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/transactions/stats', async (req, res) => {
  try {
    const filters = transactionService.extractStatsFilters(req);
    const stats = await transactionService.getTransactionStats(filters);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching transaction stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/transactions/:transaction_id', async (req, res) => {
  try {
    const { transaction_id } = req.params;
    const { chain } = req.query;
    const transaction = await transactionService.getTransactionById(transaction_id, chain);
    
    if (!transaction.data) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    
    res.json(transaction);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// BLOCKS ENDPOINTS
// ============================================================================

/**
 * GET /api/v1/blocks
 * 
 * Retrieve blocks with pagination and optional filters.
 * 
 * Query Parameters:
 * - chain (string, optional): Filter by chain identifier (e.g., "mainnet", "testnet")
 * - page (integer, default: 1): Page number for pagination
 * - limit (integer, default: 100): Number of results per page
 * - start_height (integer, optional): Filter blocks from this height onwards
 * - end_height (integer, optional): Filter blocks up to this height
 * - start_date (datetime, optional): Filter blocks from this timestamp onwards
 * - end_date (datetime, optional): Filter blocks up to this timestamp
 * 
 * Returns:
 * - data: Array of block objects
 * - meta: Pagination metadata (total, page, limit, totalPages)
 *   - avgBlockProductionTime (number, optional): Average block production time in seconds for the chain (only included if chain parameter is provided)
 *   - avgBlockSize (integer, optional): Average block size in bytes for the chain (only included if chain parameter is provided)
 */
app.get('/api/v1/blocks', async (req, res) => {
  try {
    const { 
      chain, 
      page = 1, 
      limit = 100, 
      start_height, 
      end_height, 
      start_date, 
      end_date 
    } = req.query;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [];
    const values = [];
    let idx = 1;
    
    // Build conditions with table alias 'b' for blocks (needed for JOIN query)
    if (chain) {
      conditions.push(`b.chain = $${idx++}`);
      values.push(chain);
    }
    if (start_height) {
      conditions.push(`b.height >= $${idx++}`);
      values.push(parseInt(start_height, 10));
    }
    if (end_height) {
      conditions.push(`b.height <= $${idx++}`);
      values.push(parseInt(end_height, 10));
    }
    if (start_date) {
      conditions.push(`b.timestamp >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`b.timestamp <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 100, 1000); // Cap at 1000 for performance
    const offset = (pageNum - 1) * limitNum;
    
    // OPTIMIZATION: Make COUNT optional - can disable with ?skip_count=true for faster responses
    // COUNT(*) can be slow on large tables, skip if not needed for pagination
    const skipCount = req.query.skip_count === 'true';
    let total = 0;
    
    // OPTIMIZATION: Single query approach using CTE
    // First get the blocks with LIMIT, then join with transaction counts
    // This is more efficient than separate queries
    const countPromise = skipCount 
      ? Promise.resolve({ rows: [{ total: '0' }] })
      : client.query(`SELECT COUNT(*) AS total FROM blocks b ${where}`, values);
    
    // Single optimized query: Get blocks and their transaction counts in one go
    // CTE first gets the limited blocks, then we join with aggregated transaction counts
    const blocksWithTxSql = `
      WITH paginated_blocks AS (
        SELECT 
          id, height, hash, timestamp, proposer, chain, raw_block_size, block_production_time
        FROM blocks b ${where}
        ORDER BY b.height DESC NULLS LAST
        LIMIT $${idx} OFFSET $${idx + 1}
      )
      SELECT 
        pb.id,
        pb.height,
        pb.hash,
        pb.timestamp,
        pb.proposer,
        pb.chain,
        pb.raw_block_size,
        pb.block_production_time,
        COALESCE(COUNT(t.id), 0)::integer as transaction_count
      FROM paginated_blocks pb
      LEFT JOIN transactions t ON t.block_id = pb.id
      GROUP BY pb.id, pb.height, pb.hash, pb.timestamp, pb.proposer, pb.chain, pb.raw_block_size, pb.block_production_time
      ORDER BY pb.height DESC NULLS LAST
    `;
    
    const blocksPromise = client.query(blocksWithTxSql, [...values, limitNum, offset]);
    
    // Calculate average block production time and average block size for the chain (if chain is provided)
    // Run this query in parallel with the other queries for better performance
    const avgStatsPromise = chain ? (async () => {
      const avgStatsSql = `
        SELECT 
          AVG(block_production_time)::numeric(10, 3) as avg_production_time,
          AVG(raw_block_size)::bigint as avg_block_size
        FROM blocks
        WHERE chain = $1
          AND block_production_time IS NOT NULL
          AND raw_block_size IS NOT NULL
      `;
      const avgStatsRes = await client.query(avgStatsSql, [chain]);
      if (avgStatsRes.rows.length > 0 && avgStatsRes.rows[0].avg_production_time !== null) {
        return {
          avgBlockProductionTime: parseFloat(avgStatsRes.rows[0].avg_production_time),
          avgBlockSize: avgStatsRes.rows[0].avg_block_size ? parseInt(avgStatsRes.rows[0].avg_block_size, 10) : null
        };
      }
      return { avgBlockProductionTime: null, avgBlockSize: null };
    })() : Promise.resolve({ avgBlockProductionTime: null, avgBlockSize: null });
    
    // Wait for all queries in parallel
    const [countRes, blocksRes, avgStats] = await Promise.all([countPromise, blocksPromise, avgStatsPromise]);
    const { avgBlockProductionTime, avgBlockSize } = avgStats;
    total = skipCount ? 0 : parseInt(countRes.rows[0].total, 10);
    
    if (blocksRes.rows.length === 0) {
      return res.json({ 
        data: [], 
        meta: { 
          total, 
          page: pageNum, 
          limit: limitNum, 
          totalPages: skipCount ? 0 : Math.ceil(total / limitNum),
          ...(chain && { avgBlockProductionTime, avgBlockSize })
        } 
      });
    }
    
    res.json({
      data: blocksRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: skipCount ? 0 : Math.ceil(total / limitNum),
        ...(chain && { avgBlockProductionTime, avgBlockSize })
      }
    });
  } catch (error) {
    console.error('Error fetching blocks:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/blocks/:block_id
 * 
 * Retrieve a specific block by ID or height.
 * 
 * Path Parameters:
 * - block_id: Block ID (hash) or height (integer)
 * 
 * Query Parameters:
 * - chain (string, optional): Filter by chain identifier (required if using height)
 * 
 * Returns:
 * - data: Block object with transactions count
 */
app.get('/api/v1/blocks/:block_id', async (req, res) => {
  try {
    const { block_id } = req.params;
    const { chain } = req.query;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    // Try to parse as integer (height) or use as ID (hash)
    const height = parseInt(block_id, 10);
    const isHeight = !isNaN(height) && height > 0;
    
    let block;
    if (isHeight && chain) {
      // Get by height and chain
      const result = await client.query(
        'SELECT * FROM blocks WHERE height = $1 AND chain = $2',
        [height, chain]
      );
      block = result.rows[0];
    } else {
      // Get by ID (hash)
      const result = await client.query(
        'SELECT * FROM blocks WHERE id = $1',
        [block_id]
      );
      block = result.rows[0];
    }
    
    if (!block) {
      return res.status(404).json({ error: 'Block not found' });
    }
    
    // Get transaction count for this block
    const txCountResult = await client.query(
      'SELECT COUNT(*) as count FROM transactions WHERE block_id = $1',
      [block.id]
    );
    const txCount = parseInt(txCountResult.rows[0].count, 10);
    
    res.json({
      data: {
        ...block,
        transaction_count: txCount
      }
    });
  } catch (error) {
    console.error('Error fetching block:', error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint to get chain statistics
app.get('/api/v1/chains/stats', async (req, res) => {
  try {
    const stats = await transactionService.getChainStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching chain statistics:', error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint to get available chains
app.get('/api/v1/chains', (req, res) => {
  try {
    const chains = transactionService.getAvailableChains();
    res.json({ data: chains });
  } catch (error) {
    console.error('Error fetching chains:', error);
    res.status(500).json({ error: error.message });
  }
});

// Entities APIs
/**
 * GET /api/v1/applications
 * 
 * Retrieve applications with pagination and optional filters.
 * 
 * Query Parameters:
 * - chain (string, optional): Filter by chain identifier
 * - status (string, optional): Filter by application status
 * - address (string, optional): Filter by application address
 * - page (integer, default: 1): Page number for pagination
 * - limit (integer, default: 25): Number of results per page
 * 
 * Returns:
 * - data: Array of application objects
 * - meta: Pagination metadata and aggregate statistics
 *   - total: Total number of applications
 *   - page: Current page number
 *   - limit: Results per page
 *   - totalPages: Total number of pages
 *   - totalStakedAmount: Total staked amount for all applications (excluding unstaking ones)
 *   - unstakingCount: Number of applications currently unstaking
 *   - totalUnstakingTokens: Total amount of tokens being unstaked
 */
app.get('/api/v1/applications', async (req, res) => {
  try {
    const { chain, status, address, page = 1, limit = 25 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (address) { conditions.push(`address = $${idx++}`); values.push(address); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10); const limitNum = parseInt(limit, 10); const offset = (pageNum - 1) * limitNum;
    
    // Build aggregate queries for statistics
    const countSql = `SELECT COUNT(*) AS total FROM applications ${where}`;
    const unstakingCondition = where ? 'AND' : 'WHERE';
    const totalStakedSql = `SELECT COALESCE(SUM(staked_amount), 0) AS total_staked_amount 
                            FROM applications ${where} ${unstakingCondition} unstake_session_end_height IS NULL`;
    const unstakingCountSql = `SELECT COUNT(*) AS unstaking_count 
                               FROM applications ${where} ${unstakingCondition} unstake_session_end_height IS NOT NULL`;
    const totalUnstakingSql = `SELECT COALESCE(SUM(staked_amount), 0) AS total_unstaking_tokens 
                               FROM applications ${where} ${unstakingCondition} unstake_session_end_height IS NOT NULL`;
    
    // Execute all queries in parallel for better performance
    const [countRes, totalStakedRes, unstakingCountRes, totalUnstakingRes] = await Promise.all([
      client.query(countSql, values),
      client.query(totalStakedSql, values),
      client.query(unstakingCountSql, values),
      client.query(totalUnstakingSql, values)
    ]);
    
    const total = parseInt(countRes.rows[0].total, 10);
    const totalStakedAmount = parseFloat(totalStakedRes.rows[0].total_staked_amount || '0');
    const unstakingCount = parseInt(unstakingCountRes.rows[0].unstaking_count || '0', 10);
    const totalUnstakingTokens = parseFloat(totalUnstakingRes.rows[0].total_unstaking_tokens || '0');
    
    const listSql = `SELECT address, chain, staked_amount, stake_denom, status, chains, delegated, gateway_address, delegatee_gateway_addresses, unstake_session_end_height, last_seen
                     FROM applications ${where}
                     ORDER BY last_seen DESC NULLS LAST
                     LIMIT $${idx} OFFSET $${idx + 1}`;
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ 
      data: listRes.rows, 
      meta: { 
        total, 
        page: pageNum, 
        limit: limitNum, 
        totalPages: Math.ceil(total / limitNum),
        totalStakedAmount,
        unstakingCount,
        totalUnstakingTokens
      } 
    });
  } catch (error) {
    console.error('Error fetching applications:', error);
    res.status(500).json({ error: error.message });
  }
});

// Application detail (with service configs and delegations)
app.get('/api/v1/applications/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const base = await client.query(
      `SELECT address, chain, staked_amount, stake_denom, status, chains, delegated, gateway_address, delegatee_gateway_addresses, pending_undelegations, unstake_session_end_height, last_seen
       FROM applications WHERE address = $1 ${chain ? 'AND chain = $2' : ''} LIMIT 1`,
      chain ? [address, chain] : [address]
    );
    if (base.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = base.rows[0];
    const svc = await client.query(
      `SELECT service_id, endpoints, config_options, last_seen FROM application_service_configs WHERE application_address = $1 AND chain = $2 ORDER BY service_id`,
      [row.address, row.chain]
    );
    const dels = await client.query(
      `SELECT application_address, gateway_address, is_active, action, timestamp FROM delegations WHERE application_address = $1 AND chain = $2 ORDER BY timestamp DESC`,
      [row.address, row.chain]
    );
    res.json({ data: { ...row, service_configs: svc.rows, delegations: dels.rows } });
  } catch (error) {
    console.error('Error fetching application detail:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/suppliers
 * 
 * Retrieve suppliers with pagination and optional filters.
 * 
 * Query Parameters:
 * - chain (string, optional): Filter by chain identifier
 * - status (string, optional): Filter by supplier status
 * - address (string, optional): Filter by supplier address
 * - page (integer, default: 1): Page number for pagination
 * - limit (integer, default: 25): Number of results per page
 * 
 * Returns:
 * - data: Array of supplier objects
 * - meta: Pagination metadata and aggregate statistics
 *   - total: Total number of suppliers
 *   - page: Current page number
 *   - limit: Results per page
 *   - totalPages: Total number of pages
 *   - totalStakedTokens: Total staked tokens for all suppliers (excluding unstaking ones)
 *   - unstakingCount: Number of suppliers currently unstaking
 *   - totalUnstakingTokens: Total amount of tokens being unstaked
 */
app.get('/api/v1/suppliers', async (req, res) => {
  try {
    const { chain, status, address, page = 1, limit = 25 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (address) { conditions.push(`address = $${idx++}`); values.push(address); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10); const limitNum = parseInt(limit, 10); const offset = (pageNum - 1) * limitNum;
    
    // Build aggregate queries for statistics
    const countSql = `SELECT COUNT(*) AS total FROM suppliers ${where}`;
    const unstakingCondition = where ? 'AND' : 'WHERE';
    const totalStakedSql = `SELECT COALESCE(SUM(staked_amount), 0) AS total_staked_tokens 
                            FROM suppliers ${where} ${unstakingCondition} unstake_session_end_height IS NULL`;
    const unstakingCountSql = `SELECT COUNT(*) AS unstaking_count 
                               FROM suppliers ${where} ${unstakingCondition} unstake_session_end_height IS NOT NULL`;
    const totalUnstakingSql = `SELECT COALESCE(SUM(staked_amount), 0) AS total_unstaking_tokens 
                               FROM suppliers ${where} ${unstakingCondition} unstake_session_end_height IS NOT NULL`;
    
    // Execute all queries in parallel for better performance
    const [countRes, totalStakedRes, unstakingCountRes, totalUnstakingRes] = await Promise.all([
      client.query(countSql, values),
      client.query(totalStakedSql, values),
      client.query(unstakingCountSql, values),
      client.query(totalUnstakingSql, values)
    ]);
    
    const total = parseInt(countRes.rows[0].total, 10);
    const totalStakedTokens = parseFloat(totalStakedRes.rows[0].total_staked_tokens || '0');
    const unstakingCount = parseInt(unstakingCountRes.rows[0].unstaking_count || '0', 10);
    const totalUnstakingTokens = parseFloat(totalUnstakingRes.rows[0].total_unstaking_tokens || '0');
    
    const listSql = `SELECT address, chain, staked_amount, stake_denom, status, last_seen, unstake_session_end_height
                     FROM suppliers ${where}
                     ORDER BY last_seen DESC NULLS LAST
                     LIMIT $${idx} OFFSET $${idx + 1}`;
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ 
      data: listRes.rows, 
      meta: { 
        total, 
        page: pageNum, 
        limit: limitNum, 
        totalPages: Math.ceil(total / limitNum),
        totalStakedTokens,
        unstakingCount,
        totalUnstakingTokens
      } 
    });
  } catch (error) {
    console.error('Error fetching suppliers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Supplier detail (with service configs)
app.get('/api/v1/suppliers/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const base = await client.query(
      `SELECT address, chain, staked_amount, stake_denom, status, last_seen, unstake_session_end_height
       FROM suppliers WHERE address = $1 ${chain ? 'AND chain = $2' : ''} LIMIT 1`,
      chain ? [address, chain] : [address]
    );
    if (base.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const row = base.rows[0];
    const svc = await client.query(
      `SELECT service_id, endpoints, config_options, last_seen FROM supplier_service_configs WHERE supplier_address = $1 AND chain = $2 ORDER BY service_id`,
      [row.address, row.chain]
    );
    res.json({ data: { ...row, service_configs: svc.rows } });
  } catch (error) {
    console.error('Error fetching supplier detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gateways list
app.get('/api/v1/gateways', async (req, res) => {
  try {
    const { chain, status, address, page = 1, limit = 25 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (status) { conditions.push(`status = $${idx++}`); values.push(status); }
    if (address) { conditions.push(`address = $${idx++}`); values.push(address); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10); const limitNum = parseInt(limit, 10); const offset = (pageNum - 1) * limitNum;
    const countSql = `SELECT COUNT(*) AS total FROM gateways ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    const listSql = `SELECT address, chain, staked_amount, stake_denom, status, last_seen, unstake_session_end_height
                     FROM gateways ${where}
                     ORDER BY last_seen DESC NULLS LAST
                     LIMIT $${idx} OFFSET $${idx + 1}`;
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching gateways:', error);
    res.status(500).json({ error: error.message });
  }
});

// Gateway detail
app.get('/api/v1/gateways/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const { chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const base = await client.query(
      `SELECT address, chain, staked_amount, stake_denom, status, last_seen, unstake_session_end_height
       FROM gateways WHERE address = $1 ${chain ? 'AND chain = $2' : ''} LIMIT 1`,
      chain ? [address, chain] : [address]
    );
    if (base.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: base.rows[0] });
  } catch (error) {
    console.error('Error fetching gateway detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Application delegations list (filterable)
app.get('/api/v1/delegations', async (req, res) => {
  try {
    const { chain, application_address, gateway_address, active } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (application_address) { conditions.push(`application_address = $${idx++}`); values.push(application_address); }
    if (gateway_address) { conditions.push(`gateway_address = $${idx++}`); values.push(gateway_address); }
    if (typeof active !== 'undefined') { conditions.push(`is_active = $${idx++}`); values.push(active === 'true'); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT application_address, gateway_address, chain, is_active, action, timestamp FROM delegations ${where} ORDER BY timestamp DESC LIMIT 500`;
    const result = await client.query(sql, values);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching delegations:', error);
    res.status(500).json({ error: error.message });
  }
});

// Metrics endpoints
app.get('/api/v1/metrics/chains', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    // Latest snapshot per chain
    const sql = `SELECT DISTINCT ON (chain) chain, ts, processed_height, latest_height, tx_rate, error_rate, applications, suppliers, gateways, services
                 FROM metrics_snapshots
                 ORDER BY chain, ts DESC`;
    const result = await client.query(sql);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching chain metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/metrics/chains/:chain', async (req, res) => {
  try {
    const { chain } = req.params;
    const { limit = 200 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const result = await client.query(
      `SELECT chain,
              ts,
              processed_height,
              latest_height,
              (COALESCE(latest_height,0) - COALESCE(processed_height,0)) AS lag,
              tx_rate,
              error_rate,
              applications,
              suppliers,
              gateways,
              services
       FROM metrics_snapshots
       WHERE chain = $1
       ORDER BY ts DESC
       LIMIT $2`,
      [chain, parseInt(limit, 10)]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching chain metrics detail:', error);
    res.status(500).json({ error: error.message });
  }
});

// Jobs endpoints (scaffold)
app.post('/api/v1/jobs', async (req, res) => {
  try {
    const { type, params, created_by } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type is required' });
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const result = await client.query(
      `INSERT INTO jobs(type, params, status, created_by) VALUES ($1,$2,'queued',$3) RETURNING *`,
      [type, params || {}, created_by || null]
    );
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/jobs', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const result = await client.query(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT 200`);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error listing jobs:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const job = await client.query(`SELECT * FROM jobs WHERE id = $1`, [id]);
    const runs = await client.query(`SELECT * FROM job_runs WHERE job_id = $1 ORDER BY started_at DESC`, [id]);
    if (job.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ data: { job: job.rows[0], runs: runs.rows } });
  } catch (error) {
    console.error('Error fetching job:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/jobs/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const result = await client.query(
      `UPDATE jobs SET status = 'cancelled', finished_at = NOW() WHERE id = $1 AND status IN ('queued','running') RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(400).json({ error: 'Job not found or not cancellable' });
    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health endpoints
app.get('/api/v1/health/workers', async (req, res) => {
  try {
    // proxy to 3007 - indexer service
    const response = await fetch(`http://pocket_indexer_service:3007/api/v1/health/workers`);
    const data = await response.json();
    res.json({ data: data.data });
  } catch (error) {
    console.error('Error fetching workers health:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/rpc', async (req, res) => {
  try {
    // proxy to 3007 - indexer service
    const response = await fetch(`http://pocket_indexer_service:3007/api/v1/health/rpc`);
    const data = await response.json();
    res.json({ data: data.data });
  } catch (error) {
    console.error('Error fetching rpc health:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/block-results-workers', async (req, res) => {
  try {
    // proxy to 3007 - indexer service
    const response = await fetch(`http://pocket_indexer_service:3007/api/v1/health/block-results-workers`);
    const data = await response.json();
    res.json({ data: data.data });
  } catch (error) {
    console.error('Error fetching block results workers health:', error);
    res.status(500).json({ error: error.message });
  }
});

// // Proof parser service health endpoints
// app.get('/api/v1/health/proof-parser', async (req, res) => {
//   try {
//     // proxy to proof parser service on port 3008
//     const response = await fetch(`http://pocket_proof_parser:3008/health`);
//     const data = await response.json();
//     res.json({ data });
//   } catch (error) {
//     console.error('Error fetching proof parser health:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get('/api/v1/health/proof-parser/:chain', async (req, res) => {
//   try {
//     const chain = req.params.chain;
//     // proxy to proof parser service on port 3008
//     const response = await fetch(`http://pocket_proof_parser:3008/health/${chain}`);
//     const data = await response.json();
//     res.json({ data });
//   } catch (error) {
//     console.error(`Error fetching proof parser health for chain ${req.params.chain}:`, error);
//     res.status(500).json({ error: error.message });
//   }
// });

// app.get('/api/v1/health/proof-parser/stats', async (req, res) => {
//   try {
//     // proxy to proof parser service on port 3008
//     const response = await fetch(`http://pocket_proof_parser:3008/stats`);
//     const data = await response.json();
//     res.json({ data });
//   } catch (error) {
//     console.error('Error fetching proof parser stats:', error);
//     res.status(500).json({ error: error.message });
//   }
// });

// --- Health history helpers ---
function parseWindow(req) {
  const now = Date.now();
  const from = req.query.from ? new Date(req.query.from).getTime() : now - 60 * 60 * 1000;
  const to = req.query.to ? new Date(req.query.to).getTime() : now;
  const limit = parseInt(req.query.limit || '200', 10);
  const interval = req.query.interval || null; // future: apply bucketing
  return { from: new Date(from), to: new Date(to), limit, interval };
}

app.get('/api/v1/health/rpc/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const result = await client.query(
      `SELECT ts, status, active_workers FROM health_rpc
       WHERE ts >= $1 AND ts < $2
       ORDER BY ts ASC
       LIMIT $3`,
      [from, to, limit]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching rpc history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/workers/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const chain = req.query.chain || null;
    const sql = `SELECT ts, COALESCE(chain,'') AS chain, workers, heartbeats, avg_lag, p95_lag
                 FROM health_workers
                 WHERE ts >= $1 AND ts < $2
                 ${chain ? 'AND chain = $4' : ''}
                 ORDER BY ts ASC
                 LIMIT $3`;
    const params = chain ? [from, to, limit, chain] : [from, to, limit];
    const result = await client.query(sql, params);
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching workers history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/block-results-workers/history', async (req, res) => {
  try {
    // proxy to 3007 - indexer service, pass through query parameters
    const queryParams = new URLSearchParams();
    if (req.query.from) queryParams.append('from', req.query.from);
    if (req.query.to) queryParams.append('to', req.query.to);
    if (req.query.limit) queryParams.append('limit', req.query.limit);
    if (req.query.rpc_name) queryParams.append('rpc_name', req.query.rpc_name);
    
    const url = `http://pocket_indexer_service:3007/api/v1/health/block-results-workers/history${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    const response = await fetch(url);
    const data = await response.json();
    res.json({ data: data.data });
  } catch (error) {
    console.error('Error fetching block results workers history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/process/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const result = await client.query(
      `SELECT ts, rss, heap_used, heap_total, external, array_buffers, cpu_user_ms, cpu_system_ms
       FROM health_process
       WHERE ts >= $1 AND ts < $2
       ORDER BY ts ASC
       LIMIT $3`,
      [from, to, limit]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching process history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/redis/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const result = await client.query(
      `SELECT ts, used_memory, maxmemory, instantaneous_ops_per_sec, mem_fragmentation_ratio
       FROM health_redis
       WHERE ts >= $1 AND ts < $2
       ORDER BY ts ASC
       LIMIT $3`,
      [from, to, limit]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching redis history:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/v1/health/redis/keyspace/history', async (req, res) => {
  try {
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const { from, to, limit } = parseWindow(req);
    const db = req.query.db || 'db0';
    const result = await client.query(
      `SELECT ts, db, keys, expires, avg_ttl
       FROM health_redis_keyspace
       WHERE ts >= $1 AND ts < $2 AND db = $4
       ORDER BY ts ASC
       LIMIT $3`,
      [from, to, limit, db]
    );
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching redis keyspace history:', error);
    res.status(500).json({ error: error.message });
  }
});

// Staking events endpoint (list with filters)
app.get('/api/v1/staking', async (req, res) => {
  try {
    const { chain, type, event, address, page = 1, limit = 50 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    const conditions = [];
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`chain = $${idx++}`); values.push(chain); }
    if (type) { conditions.push(`type = $${idx++}`); values.push(type); }
    if (event) { conditions.push(`event = $${idx++}`); values.push(event); }
    if (address) { conditions.push(`address = $${idx++}`); values.push(address); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = parseInt(page, 10); const limitNum = parseInt(limit, 10); const offset = (pageNum - 1) * limitNum;
    const countSql = `SELECT COUNT(*) AS total FROM staking ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    const listSql = `SELECT address, chain, type, amount, event, timestamp
                     FROM staking ${where}
                     ORDER BY timestamp DESC
                     LIMIT $${idx} OFFSET $${idx + 1}`;
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching staking events:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// PROOF SUBMISSIONS ENDPOINTS
// ============================================================================

// Get proof submissions with filters
// Shared function for proof submissions queries
async function getProofSubmissions(params, client) {
  const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = params;
  
  const conditions = [];
  const values = [];
  let idx = 1;
  
  if (chain) {
    conditions.push(`chain = $${idx}::text`);
    values.push(chain);
    idx++;
  }
  
  // Handle supplier_address - can be single string, comma-separated string, or array
  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    
    if (addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx}::text`);
      values.push(addresses[0]);
      idx++;
    } else if (addresses.length > 1) {
      const placeholders = addresses.map((_, i) => `$${idx + i}::text`).join(', ');
      conditions.push(`supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  if (application_address) {
    conditions.push(`application_address = $${idx}::text`);
    values.push(application_address);
    idx++;
  }
  if (service_id) {
    conditions.push(`service_id = $${idx}::text`);
    values.push(service_id);
    idx++;
  }
  if (start_date) {
    conditions.push(`timestamp >= $${idx}::timestamp`);
    values.push(start_date);
    idx++;
  }
  if (end_date) {
    conditions.push(`timestamp <= $${idx}::timestamp`);
    values.push(end_date);
    idx++;
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;
  
  // Get total count
  const countSql = `SELECT COUNT(*) AS total FROM proof_submissions ${where}`;
  const countRes = await client.query(countSql, values);
  const total = parseInt(countRes.rows[0].total, 10);
  
  // Get paginated results
  const listSql = `SELECT 
    id, transaction_hash, block_height, timestamp, chain,
    supplier_operator_address, application_address, service_id, session_id,
    session_end_block_height, claim_proof_status_int, claimed_upokt,
    claimed_upokt_amount, num_claimed_compute_units, num_estimated_compute_units,
    num_relays, compute_unit_efficiency, reward_per_relay, msg_index, created_at
    FROM proof_submissions ${where}
    ORDER BY timestamp DESC, block_height DESC
    LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;
  
  const listRes = await client.query(listSql, [...values, limitNum, offset]);
  
  return {
    data: listRes.rows,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

app.get('/api/v1/proof-submissions', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getProofSubmissions({
      supplier_address,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching proof submissions:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/proof-submissions', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getProofSubmissions({
      supplier_address,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching proof submissions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Shared function for reward analytics queries
// Aggregates rewards by service across the time period (not by hour or supplier)
async function getRewardAnalytics(params, client) {
  const { supplier_address, supplier_addresses, application_address, service_id, chain, start_date, end_date, days, page = 1, limit = 100 } = params;
  
  const conditions = [];
  const values = [];
  let idx = 1;
  
  // Handle time range: either use days parameter or start_date/end_date
  if (days) {
    const daysNum = parseInt(days, 10);
    if (daysNum > 0) {
      // Use parameterized query for safety
      conditions.push(`hour_bucket >= NOW() - INTERVAL '1 day' * $${idx++}::integer`);
      values.push(daysNum);
    }
  } else {
    if (start_date) {
      conditions.push(`hour_bucket >= $${idx++}::timestamp`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`hour_bucket <= $${idx++}::timestamp`);
      values.push(end_date);
    }
  }
  
  if (chain) {
    conditions.push(`chain = $${idx++}`);
    values.push(chain);
  }
  
  // Handle single supplier_address or array of supplier_addresses
  // These are used for filtering but we still aggregate by service
  if (supplier_addresses && Array.isArray(supplier_addresses) && supplier_addresses.length > 0) {
    if (supplier_addresses.length === 1) {
      // Single address - use equality for better index usage
      conditions.push(`supplier_operator_address = $${idx++}`);
      values.push(supplier_addresses[0]);
    } else {
      // Multiple addresses - use ANY(array) which is more efficient for large arrays
      conditions.push(`supplier_operator_address = ANY($${idx++}::text[])`);
      values.push(supplier_addresses);
    }
  } else if (supplier_address) {
    conditions.push(`supplier_operator_address = $${idx++}`);
    values.push(supplier_address);
  }
  
  if (application_address) {
    conditions.push(`application_address = $${idx++}`);
    values.push(application_address);
  }
  if (service_id) {
    conditions.push(`service_id = $${idx++}`);
    values.push(service_id);
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;
  
  // Aggregate by service_id and chain, summing across all hours in the time period
  // This gives us total rewards per service, not per hour or per supplier
  const aggregationSql = `
    SELECT 
      service_id,
      chain,
      SUM(submission_count) as total_submissions,
      SUM(total_rewards_upokt) as total_rewards_upokt,
      SUM(total_relays) as total_relays,
      SUM(total_claimed_compute_units) as total_claimed_compute_units,
      SUM(total_estimated_compute_units) as total_estimated_compute_units,
      -- Calculate weighted average efficiency: total_claimed / total_estimated * 100
      CASE 
        WHEN SUM(total_estimated_compute_units) > 0 THEN
          ROUND((SUM(total_claimed_compute_units)::NUMERIC / SUM(total_estimated_compute_units)::NUMERIC) * 100, 2)
        ELSE 0
      END as avg_efficiency_percent,
      -- Calculate average reward per relay: total_rewards / total_relays
      CASE 
        WHEN SUM(total_relays) > 0 THEN
          ROUND(SUM(total_rewards_upokt)::NUMERIC / SUM(total_relays)::NUMERIC, 2)
        ELSE 0
      END as avg_reward_per_relay,
      MAX(max_reward_per_submission) as max_reward_per_submission,
      MIN(min_reward_per_submission) as min_reward_per_submission
    FROM proof_submission_rewards_mv
    ${where}
    GROUP BY service_id, chain
  `;
  
  // Get total count of unique services
  const countSql = `
    SELECT COUNT(DISTINCT (service_id, chain)) AS total 
    FROM proof_submission_rewards_mv
    ${where}
  `;
  
  let countRes;
  try {
    countRes = await client.query(countSql, values);
  } catch (error) {
    console.error('Error in count query:', error);
    console.error('Count SQL:', countSql);
    console.error('Count values:', values);
    throw error;
  }
  
  const total = parseInt(countRes.rows[0]?.total || 0, 10);
  
  // Get paginated results - aggregated by service, sorted by total rewards
  const listSql = `
    ${aggregationSql}
    ORDER BY total_rewards_upokt DESC
    LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
  `;
  
  let listRes;
  try {
    listRes = await client.query(listSql, [...values, limitNum, offset]);
  } catch (error) {
    console.error('Error in list query:', error);
    console.error('List SQL:', listSql);
    console.error('List values:', [...values, limitNum, offset]);
    throw error;
  }
  
  const result = {
    data: listRes.rows || [],
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
  
  return result;
}

// Get reward analytics aggregated by service (across time period)
app.get('/api/v1/proof-submissions/rewards', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, days, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getRewardAnalytics({
      supplier_address,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      days,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching reward analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST endpoint for reward analytics with support for multiple supplier addresses
// Apply POST cache middleware with 2 minute TTL (data refreshes every 15 minutes)
app.post('/api/v1/proof-submissions/rewards', postCacheMiddleware(120), async (req, res) => {
  try {
    console.log('POST /api/v1/proof-submissions/rewards - Request received');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    const { supplier_address, supplier_addresses, application_address, service_id, chain, start_date, end_date, days, page = 1, limit = 100 } = req.body;
    
    // Validate input
    if (supplier_addresses && !Array.isArray(supplier_addresses)) {
      console.error('Invalid supplier_addresses - not an array');
      return res.status(400).json({ error: 'supplier_addresses must be an array' });
    }
    
    console.log(`Processing request with ${supplier_addresses?.length || 0} supplier addresses`);
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    if (!client) {
      console.error('Database client is null');
      return res.status(500).json({ error: 'Database connection failed' });
    }
    
    const result = await getRewardAnalytics({
      supplier_address,
      supplier_addresses,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      days,
      page,
      limit
    }, client);
    
    console.log(`Query completed. Total: ${result.meta.total}, Data rows: ${result.data.length}`);
    
    // Ensure we always return a valid response structure
    const response = result || { data: [], meta: { total: 0, page: 1, limit: parseInt(limit, 10) || 100, totalPages: 0 } };
    
    console.log('Sending response:', JSON.stringify({ ...response, data: `[${response.data.length} items]` }));
    res.json(response);
  } catch (error) {
    console.error('Error fetching reward analytics:', error);
    console.error('Error stack:', error.stack);
    
    // Make sure we send an error response
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
});

// Get reward analytics refresh service status
app.get('/api/v1/proof-submissions/rewards/refresh/status', async (req, res) => {
  try {
    if (!rewardAnalyticsRefreshService) {
      return res.status(503).json({ 
        error: 'Refresh service not initialized',
        message: 'The reward analytics refresh service is not running on this worker'
      });
    }
    
    const status = rewardAnalyticsRefreshService.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error fetching refresh status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual refresh endpoint for admin use
app.post('/api/v1/proof-submissions/rewards/refresh', async (req, res) => {
  try {
    if (!rewardAnalyticsRefreshService) {
      return res.status(503).json({ 
        error: 'Refresh service not initialized',
        message: 'The reward analytics refresh service is not running on this worker'
      });
    }
    
    console.log('Manual refresh requested for proof_submission_rewards_mv');
    const result = await rewardAnalyticsRefreshService.refresh();
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Materialized view refreshed successfully',
        duration: result.duration,
        timestamp: result.timestamp,
        fallback: result.fallback || false
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: 'Refresh failed',
        duration: result.duration
      });
    }
  } catch (error) {
    console.error('Error during manual refresh:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get supplier performance analytics (daily)
app.get('/api/v1/suppliers/:address/performance', async (req, res) => {
  try {
    const { address } = req.params;
    const { start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [`supplier_operator_address = $1`];
    const values = [address];
    let idx = 2;
    
    if (start_date) {
      conditions.push(`day_bucket >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`day_bucket <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count
    const countSql = `SELECT COUNT(*) AS total FROM supplier_performance ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    
    // Get paginated results
    const listSql = `SELECT * FROM supplier_performance ${where}
      ORDER BY day_bucket DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    
    res.json({
      data: listRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching supplier performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get application usage analytics (daily)
app.get('/api/v1/applications/:address/usage', async (req, res) => {
  try {
    const { address } = req.params;
    const { start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [`application_address = $1`];
    const values = [address];
    let idx = 2;
    
    if (start_date) {
      conditions.push(`day_bucket >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`day_bucket <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count
    const countSql = `SELECT COUNT(*) AS total FROM application_usage ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    
    // Get paginated results
    const listSql = `SELECT * FROM application_usage ${where}
      ORDER BY day_bucket DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    
    res.json({
      data: listRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching application usage:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get summary statistics for proof submissions
// Shared function for proof submissions summary
async function getProofSubmissionsSummary(params, client) {
  const { start_date, end_date, supplier_address, supplier_addresses, application_address, service_id, chain } = params;
  
  const conditions = [];
  const values = [];
  let idx = 1;
  
  if (chain) {
    conditions.push(`chain = $${idx}::text`);
    values.push(chain);
    idx++;
  }
  if (start_date) {
    conditions.push(`timestamp >= $${idx}::timestamp`);
    values.push(start_date);
    idx++;
  }
  if (end_date) {
    conditions.push(`timestamp <= $${idx}::timestamp`);
    values.push(end_date);
    idx++;
  }
  // Default to last 24 hours if no explicit date range provided
  if (!start_date && !end_date) {
    conditions.push(`timestamp >= NOW() - INTERVAL '24 hours'`);
  }
  
  // Handle supplier_address or supplier_addresses
  // Priority: supplier_addresses (array) > supplier_address (single or comma-separated)
  if (supplier_addresses && Array.isArray(supplier_addresses) && supplier_addresses.length > 0) {
    // Use supplier_addresses array directly
    if (supplier_addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx}::text`);
      values.push(supplier_addresses[0]);
      idx++;
    } else {
      const placeholders = supplier_addresses.map((_, i) => `$${idx + i}::text`).join(', ');
      conditions.push(`supplier_operator_address IN (${placeholders})`);
      values.push(...supplier_addresses);
      idx += supplier_addresses.length;
    }
  } else if (supplier_address) {
    // Handle supplier_address - can be single string, comma-separated string, or array
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    
    if (addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx}::text`);
      values.push(addresses[0]);
      idx++;
    } else if (addresses.length > 1) {
      const placeholders = addresses.map((_, i) => `$${idx + i}::text`).join(', ');
      conditions.push(`supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  if (application_address) {
    conditions.push(`application_address = $${idx}::text`);
    values.push(application_address);
    idx++;
  }
  if (service_id) {
    conditions.push(`service_id = $${idx}::text`);
    values.push(service_id);
    idx++;
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const summarySql = `SELECT 
    COUNT(*) as total_submissions,
    COUNT(DISTINCT supplier_operator_address) as unique_suppliers,
    COUNT(DISTINCT application_address) as unique_applications,
    COUNT(DISTINCT service_id) as unique_services,
    SUM(claimed_upokt_amount) as total_rewards_upokt,
    SUM(num_relays) as total_relays,
    SUM(num_claimed_compute_units) as total_claimed_compute_units,
    SUM(num_estimated_compute_units) as total_estimated_compute_units,
    AVG(compute_unit_efficiency) as avg_efficiency_percent,
    AVG(reward_per_relay) as avg_reward_per_relay,
    MIN(timestamp) as first_submission,
    MAX(timestamp) as last_submission
    FROM proof_submissions ${where}`;
  
  const result = await client.query(summarySql, values);
  
  return { data: result.rows[0] };
}

app.get('/api/v1/proof-submissions/summary', async (req, res) => {
  try {
    const { start_date, end_date, supplier_address, application_address, service_id, chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getProofSubmissionsSummary({
      start_date,
      end_date,
      supplier_address,
      application_address,
      service_id,
      chain
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching proof submissions summary:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/proof-submissions/summary', async (req, res) => {
  try {
    const { start_date, end_date, supplier_address, supplier_addresses, application_address, service_id, chain } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getProofSubmissionsSummary({
      start_date,
      end_date,
      supplier_address,
      supplier_addresses,
      application_address,
      service_id,
      chain
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching proof submissions summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// CLAIMS ENDPOINTS

// Shared function for claims queries
async function getClaims(params, client) {
  const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = params;
  
  const conditions = [];
  const values = [];
  let idx = 1;
  
  if (chain) {
    conditions.push(`chain = $${idx}::text`);
    values.push(chain);
    idx++;
  }
  
  // Handle supplier_address - can be single string, comma-separated string, or array
  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    
    if (addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx}::text`);
      values.push(addresses[0]);
      idx++;
    } else if (addresses.length > 1) {
      const placeholders = addresses.map((_, i) => `$${idx + i}::text`).join(', ');
      conditions.push(`supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  if (application_address) {
    conditions.push(`application_address = $${idx}::text`);
    values.push(application_address);
    idx++;
  }
  if (service_id) {
    conditions.push(`service_id = $${idx}::text`);
    values.push(service_id);
    idx++;
  }
  if (start_date) {
    conditions.push(`timestamp >= $${idx}::timestamp`);
    values.push(start_date);
    idx++;
  }
  if (end_date) {
    conditions.push(`timestamp <= $${idx}::timestamp`);
    values.push(end_date);
    idx++;
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;
  
  // Get total count
  const countSql = `SELECT COUNT(*) AS total FROM claims ${where}`;
  const countRes = await client.query(countSql, values);
  const total = parseInt(countRes.rows[0].total, 10);
  
  // Get paginated results
  const listSql = `SELECT 
    id, supplier_operator_address, application_address, service_id, session_id,
    session_start_block_height, session_end_block_height, root_hash, proof, status,
    timestamp, chain, claim_proof_status_int, claimed_upokt, claimed_upokt_amount,
    num_claimed_compute_units, num_estimated_compute_units, num_relays,
    compute_unit_efficiency, reward_per_relay, created_at
    FROM claims ${where}
    ORDER BY timestamp DESC
    LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;
  
  const listRes = await client.query(listSql, [...values, limitNum, offset]);
  
  return {
    data: listRes.rows,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

app.get('/api/v1/claims', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getClaims({
      supplier_address,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/claims', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getClaims({
      supplier_address,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching claims:', error);
    res.status(500).json({ error: error.message });
  }
});

// Shared function for claim reward analytics queries
async function getClaimRewardAnalytics(params, client) {
  const { supplier_address, supplier_addresses, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = params;
  
  const conditions = [];
  const values = [];
  let idx = 1;
  
  if (chain) {
    conditions.push(`chain = $${idx++}`);
    values.push(chain);
  }
  
  // Handle single supplier_address or array of supplier_addresses
  if (supplier_addresses && Array.isArray(supplier_addresses) && supplier_addresses.length > 0) {
    if (supplier_addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx++}`);
      values.push(supplier_addresses[0]);
    } else {
      conditions.push(`supplier_operator_address = ANY($${idx++}::text[])`);
      values.push(supplier_addresses);
    }
  } else if (supplier_address) {
    conditions.push(`supplier_operator_address = $${idx++}`);
    values.push(supplier_address);
  }
  
  if (application_address) {
    conditions.push(`application_address = $${idx++}`);
    values.push(application_address);
  }
  if (service_id) {
    conditions.push(`service_id = $${idx++}`);
    values.push(service_id);
  }
  if (start_date) {
    conditions.push(`hour_bucket >= $${idx++}::timestamp`);
    values.push(start_date);
  }
  if (end_date) {
    conditions.push(`hour_bucket <= $${idx++}::timestamp`);
    values.push(end_date);
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;
  
  // Get total count
  const countSql = `SELECT COUNT(*) AS total FROM claim_rewards ${where}`;
  const countRes = await client.query(countSql, values);
  const total = parseInt(countRes.rows[0]?.total || 0, 10);
  
  // Get paginated results
  const listSql = `SELECT * FROM claim_rewards ${where}
    ORDER BY hour_bucket DESC
    LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;
  
  const listRes = await client.query(listSql, [...values, limitNum, offset]);
  
  return {
    data: listRes.rows || [],
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

// Get claim reward analytics aggregated view (hourly)
app.get('/api/v1/claims/rewards', async (req, res) => {
  try {
    const { supplier_address, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getClaimRewardAnalytics({
      supplier_address,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching claim rewards:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/claims/rewards', async (req, res) => {
  try {
    const { supplier_address, supplier_addresses, application_address, service_id, chain, start_date, end_date, page = 1, limit = 100 } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getClaimRewardAnalytics({
      supplier_address,
      supplier_addresses,
      application_address,
      service_id,
      chain,
      start_date,
      end_date,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching claim rewards:', error);
    res.status(500).json({ error: error.message });
  }
});

// Shared function for claims summary queries
async function getClaimsSummary(params, client) {
  const { start_date, end_date, supplier_address, supplier_addresses, application_address, service_id, chain } = params;
  
  const conditions = [];
  const values = [];
  let idx = 1;
  
  if (chain) {
    conditions.push(`chain = $${idx}::text`);
    values.push(chain);
    idx++;
  }
  
  if (start_date) {
    conditions.push(`timestamp >= $${idx}::timestamp`);
    values.push(start_date);
    idx++;
  }
  if (end_date) {
    conditions.push(`timestamp <= $${idx}::timestamp`);
    values.push(end_date);
    idx++;
  }
  // Default to last 24 hours if no explicit date range provided
  if (!start_date && !end_date) {
    conditions.push(`timestamp >= NOW() - INTERVAL '24 hours'`);
  }
  
  // Handle supplier_address or supplier_addresses
  if (supplier_addresses && Array.isArray(supplier_addresses) && supplier_addresses.length > 0) {
    if (supplier_addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx}::text`);
      values.push(supplier_addresses[0]);
      idx++;
    } else {
      const placeholders = supplier_addresses.map((_, i) => `$${idx + i}::text`).join(', ');
      conditions.push(`supplier_operator_address IN (${placeholders})`);
      values.push(...supplier_addresses);
      idx += supplier_addresses.length;
    }
  } else if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    
    if (addresses.length === 1) {
      conditions.push(`supplier_operator_address = $${idx}::text`);
      values.push(addresses[0]);
      idx++;
    } else if (addresses.length > 1) {
      const placeholders = addresses.map((_, i) => `$${idx + i}::text`).join(', ');
      conditions.push(`supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  if (application_address) {
    conditions.push(`application_address = $${idx}::text`);
    values.push(application_address);
    idx++;
  }
  if (service_id) {
    conditions.push(`service_id = $${idx}::text`);
    values.push(service_id);
    idx++;
  }
  
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const summarySql = `SELECT 
    COUNT(*) as total_claims,
    COUNT(DISTINCT supplier_operator_address) as unique_suppliers,
    COUNT(DISTINCT application_address) as unique_applications,
    COUNT(DISTINCT service_id) as unique_services,
    SUM(claimed_upokt_amount) as total_rewards_upokt,
    SUM(num_relays) as total_relays,
    SUM(num_claimed_compute_units) as total_claimed_compute_units,
    SUM(num_estimated_compute_units) as total_estimated_compute_units,
    AVG(compute_unit_efficiency) as avg_efficiency_percent,
    AVG(reward_per_relay) as avg_reward_per_relay,
    MIN(timestamp) as first_claim,
    MAX(timestamp) as last_claim
    FROM claims ${where}`;
  
  const result = await client.query(summarySql, values);
  
  return { data: result.rows[0] };
}

app.get('/api/v1/claims/summary', async (req, res) => {
  try {
    const { start_date, end_date, supplier_address, application_address, service_id, chain } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getClaimsSummary({
      start_date,
      end_date,
      supplier_address,
      application_address,
      service_id,
      chain
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching claims summary:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/v1/claims/summary', async (req, res) => {
  try {
    const { start_date, end_date, supplier_address, supplier_addresses, application_address, service_id, chain } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await getClaimsSummary({
      start_date,
      end_date,
      supplier_address,
      supplier_addresses,
      application_address,
      service_id,
      chain
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching claims summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get supplier claim performance analytics (daily)
app.get('/api/v1/suppliers/:address/claims/performance', async (req, res) => {
  try {
    const { address } = req.params;
    const { chain, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [`supplier_operator_address = $1`];
    const values = [address];
    let idx = 2;
    
    if (chain) {
      conditions.push(`chain = $${idx++}`);
      values.push(chain);
    }
    
    if (start_date) {
      conditions.push(`day_bucket >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`day_bucket <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count
    const countSql = `SELECT COUNT(*) AS total FROM supplier_claim_performance ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    
    // Get paginated results
    const listSql = `SELECT * FROM supplier_claim_performance ${where}
      ORDER BY day_bucket DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    
    res.json({
      data: listRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching supplier claim performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get application claim usage analytics (daily)
app.get('/api/v1/applications/:address/claims/usage', async (req, res) => {
  try {
    const { address } = req.params;
    const { chain, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const conditions = [`application_address = $1`];
    const values = [address];
    let idx = 2;
    
    if (chain) {
      conditions.push(`chain = $${idx++}`);
      values.push(chain);
    }
    
    if (start_date) {
      conditions.push(`day_bucket >= $${idx++}`);
      values.push(start_date);
    }
    if (end_date) {
      conditions.push(`day_bucket <= $${idx++}`);
      values.push(end_date);
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    // Get total count
    const countSql = `SELECT COUNT(*) AS total FROM application_claim_usage ${where}`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows[0].total, 10);
    
    // Get paginated results
    const listSql = `SELECT * FROM application_claim_usage ${where}
      ORDER BY day_bucket DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
    
    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    
    res.json({
      data: listRes.rows,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching application claim usage:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validator and Service Search endpoint
// GET /api/v1/validators/search
// Query: q (required), chain (optional), limit (optional, default 20)
app.get('/api/v1/validators/search', cacheMiddleware(300), async (req, res) => {
  try {
    const { q, chain, limit = 20 } = req.query;
    
    if (!q || q.trim().length === 0) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.searchValidatorsAndServices({ q, chain, limit }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error in validator search:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validators performance endpoints

// GET /api/v1/validators/performance
// Query: domain, owner_address, supplier_address (single or comma-separated), chain, service_id, start_date, end_date, group_by(day|hour|total), page, limit
// Supports backward compatibility: single supplier_address works as before
// New: comma-separated supplier_address (e.g., "addr1,addr2,addr3") aggregates results
app.get('/api/v1/validators/performance', async (req, res) => {
  try {
    const { domain, owner_address, supplier_address, chain, service_id, start_date, end_date, group_by = 'day', page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const result = await performanceService.getValidatorPerformance({
      domain,
      owner_address,
      supplier_address,
      chain,
      service_id,
      start_date,
      end_date,
      group_by,
      page,
      limit
    }, client);

    res.json(result);
  } catch (error) {
    console.error('Error fetching validator performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/v1/validators/performance
// Body: { domain, owner_address, supplier_address (string or array), chain, service_id, start_date, end_date, group_by, page, limit }
// Recommended for multiple supplier addresses to avoid URL length limits
// When supplier_address is an array with multiple addresses, results are aggregated
app.post('/api/v1/validators/performance', async (req, res) => {
  try {
    const { domain, owner_address, supplier_address, chain, service_id, start_date, end_date, group_by = 'day', page = 1, limit = 100 } = req.body;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const result = await performanceService.getValidatorPerformance({
      domain,
      owner_address,
      supplier_address,
      chain,
      service_id,
      start_date,
      end_date,
      group_by,
      page,
      limit
    }, client);

    res.json(result);
  } catch (error) {
    console.error('Error fetching validator performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/validators/:operator_address/performance
app.get('/api/v1/validators/:operator_address/performance', async (req, res) => {
  try {
    const { operator_address } = req.params;
    const { chain, service_id, start_date, end_date, group_by = 'day', page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const conditions = ["ps.claim_proof_status_int = 0", `ps.supplier_operator_address = $1`];
    const values = [operator_address];
    let idx = 2;
    if (chain) { conditions.push(`ps.chain = $${idx++}`); values.push(chain); }
    if (service_id) { conditions.push(`ps.service_id = $${idx++}`); values.push(service_id); }
    if (start_date) { conditions.push(`ps.timestamp >= $${idx++}`); values.push(start_date); }
    if (end_date) { conditions.push(`ps.timestamp <= $${idx++}`); values.push(end_date); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    let bucketExpr = null;
    if (group_by === 'hour') bucketExpr = `DATE_TRUNC('hour', ps.timestamp) AS bucket`;
    else if (group_by === 'total') bucketExpr = `NULL::timestamp AS bucket`;
    else bucketExpr = `DATE_TRUNC('day', ps.timestamp) AS bucket`;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT ${bucketExpr.replace(' AS bucket', '')} AS bucket_key
        FROM proof_submissions ps
        ${where}
        GROUP BY bucket_key
      ) t`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

    const listSql = `
      SELECT 
        ${bucketExpr},
        ps.supplier_operator_address,
        COALESCE(COUNT(*)::BIGINT, 0) AS submissions,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent,
        ROUND(AVG(ps.reward_per_relay)::numeric, 2) AS avg_reward_per_relay,
        COUNT(DISTINCT ps.application_address) AS unique_applications,
        COUNT(DISTINCT ps.service_id) AS unique_services
      FROM proof_submissions ps
      ${where}
      GROUP BY bucket, ps.supplier_operator_address
      ORDER BY bucket DESC NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const listRes = await client.query(listSql, [...values, limitNum, offset]);

    // Fetch metadata - include chain filter if provided
    let metaSql = `SELECT operator_address, chain, moniker, website, website_domain, status, jailed, tokens FROM validators WHERE operator_address = $1`;
    const metaValues = [operator_address];
    if (chain) {
      metaSql += ` AND chain = $2`;
      metaValues.push(chain);
    }
    metaSql += ` LIMIT 1`; // If chain not provided, just get first match
    const metaRes = await client.query(metaSql, metaValues);

    res.json({
      data: listRes.rows,
      validator: metaRes.rows?.[0] || null,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching validator detail performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/v1/validators/performance - support for multiple operator addresses
app.post('/api/v1/validators/performance', async (req, res) => {
  try {
    const { operator_addresses, chain, service_id, start_date, end_date, group_by = 'day', page = 1, limit = 100 } = req.body;
    
    // Validate input
    if (!operator_addresses || !Array.isArray(operator_addresses) || operator_addresses.length === 0) {
      return res.status(400).json({ error: 'operator_addresses must be a non-empty array' });
    }
    
    console.log(`POST /api/v1/validators/performance - Processing request with ${operator_addresses.length} operator addresses`);
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    if (!client) {
      console.error('Database client is null');
      return res.status(500).json({ error: 'Database connection failed' });
    }

    const conditions = ["ps.claim_proof_status_int = 0"];
    const values = [];
    let idx = 1;
    
    // Handle operator addresses - use ANY(array) for multiple, equality for single
    if (operator_addresses.length === 1) {
      conditions.push(`ps.supplier_operator_address = $${idx++}`);
      values.push(operator_addresses[0]);
    } else {
      conditions.push(`ps.supplier_operator_address = ANY($${idx++}::text[])`);
      values.push(operator_addresses);
    }
    
    if (chain) { 
      conditions.push(`ps.chain = $${idx++}`); 
      values.push(chain); 
    }
    if (service_id) { 
      conditions.push(`ps.service_id = $${idx++}`); 
      values.push(service_id); 
    }
    if (start_date) { 
      conditions.push(`ps.timestamp >= $${idx++}::timestamp`); 
      values.push(start_date); 
    }
    if (end_date) { 
      conditions.push(`ps.timestamp <= $${idx++}::timestamp`); 
      values.push(end_date); 
    }
    
    const where = `WHERE ${conditions.join(' AND ')}`;

    let bucketExpr = null;
    if (group_by === 'hour') bucketExpr = `DATE_TRUNC('hour', ps.timestamp) AS bucket`;
    else if (group_by === 'total') bucketExpr = `NULL::timestamp AS bucket`;
    else bucketExpr = `DATE_TRUNC('day', ps.timestamp) AS bucket`;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT ${bucketExpr.replace(' AS bucket', '')} AS bucket_key
        FROM proof_submissions ps
        ${where}
        GROUP BY bucket_key, ps.supplier_operator_address
      ) t`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

    const listSql = `
      SELECT 
        ${bucketExpr},
        ps.supplier_operator_address,
        COALESCE(COUNT(*)::BIGINT, 0) AS submissions,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent,
        ROUND(AVG(ps.reward_per_relay)::numeric, 2) AS avg_reward_per_relay,
        COUNT(DISTINCT ps.application_address) AS unique_applications,
        COUNT(DISTINCT ps.service_id) AS unique_services
      FROM proof_submissions ps
      ${where}
      GROUP BY bucket, ps.supplier_operator_address
      ORDER BY bucket DESC NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const listRes = await client.query(listSql, [...values, limitNum, offset]);

    // Create a Set of requested addresses for fast lookup (case-insensitive, trimmed)
    const requestedAddressesSet = new Set(
      operator_addresses.map(addr => (addr || '').toLowerCase().trim())
    );
    
    // Filter results to only include supplier_operator_addresses that were explicitly requested
    // This ensures we don't return data for suppliers that weren't in the request
    // This handles edge cases like case sensitivity, whitespace, or data inconsistencies
    const filteredRows = listRes.rows.filter(row => {
      const supplierAddr = (row.supplier_operator_address || '').toLowerCase().trim();
      return requestedAddressesSet.has(supplierAddr);
    });
    
    // Log if we filtered out any rows (indicates data inconsistency or query issue)
    if (listRes.rows.length !== filteredRows.length) {
      const filteredOut = listRes.rows.length - filteredRows.length;
      const uniqueFilteredOut = new Set(
        listRes.rows
          .filter(row => !requestedAddressesSet.has((row.supplier_operator_address || '').toLowerCase().trim()))
          .map(row => row.supplier_operator_address)
      );
      console.warn(
        `POST /api/v1/validators/performance - Filtered out ${filteredOut} rows ` +
        `(${uniqueFilteredOut.size} unique supplier addresses not in request):`,
        Array.from(uniqueFilteredOut).slice(0, 10) // Log first 10 for debugging
      );
    }
    
    // Recalculate total based on filtered results
    // Count only the unique combinations (bucket, supplier) that match our requested addresses
    // Use the same WHERE conditions but add HAVING to ensure we only count requested addresses
    const countFilteredSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT ${bucketExpr.replace(' AS bucket', '')} AS bucket_key, ps.supplier_operator_address
        FROM proof_submissions ps
        ${where}
        GROUP BY bucket_key, ps.supplier_operator_address
        HAVING LOWER(TRIM(ps.supplier_operator_address)) = ANY($${values.length + 1}::text[])
      ) t`;
    const countFilteredValues = [
      ...values,
      operator_addresses.map(addr => (addr || '').toLowerCase().trim())
    ];
    const countFilteredRes = await client.query(countFilteredSql, countFilteredValues);
    const filteredTotal = parseInt(countFilteredRes.rows?.[0]?.total || '0', 10);

    // Fetch metadata for all specified validators
    let metaSql = `SELECT operator_address, chain, moniker, website, website_domain, status, jailed, tokens FROM validators WHERE operator_address = ANY($1::text[])`;
    const metaValues = [operator_addresses];
    if (chain) {
      metaSql += ` AND chain = $2`;
      metaValues.push(chain);
    }
    const metaRes = await client.query(metaSql, metaValues);
    
    // Create a map of operator_address -> validator metadata for easy lookup
    const validatorsMap = {};
    metaRes.rows.forEach(row => {
      validatorsMap[row.operator_address] = row;
    });
    
    // Return validators as an array, maintaining order from request
    const validators = operator_addresses.map(addr => validatorsMap[addr] || null).filter(v => v !== null);

    res.json({
      data: filteredRows,
      validators: validators,
      meta: {
        total: filteredTotal,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(filteredTotal / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching validator performance (POST):', error);
    console.error('Error stack:', error.stack);
    
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  }
});

// GET /api/v1/validators/domains - leaderboard by domain
app.get('/api/v1/validators/domains', async (req, res) => {
  try {
    const { chain, service_id, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const conditions = ["ps.claim_proof_status_int = 0"]; // successful only
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`ps.chain = $${idx++}`); values.push(chain); }
    if (service_id) { conditions.push(`ps.service_id = $${idx++}`); values.push(service_id); }
    if (start_date) { conditions.push(`ps.timestamp >= $${idx++}`); values.push(start_date); }
    if (end_date) { conditions.push(`ps.timestamp <= $${idx++}`); values.push(end_date); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT v.website_domain AS domain
        FROM proof_submissions ps
        LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address
        LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
        ${where}
        GROUP BY v.website_domain
        HAVING v.website_domain IS NOT NULL AND v.website_domain <> ''
      ) t`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

    const listSql = `
      SELECT 
        v.website_domain AS domain,
        COUNT(DISTINCT ps.supplier_operator_address) AS validator_count,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent
      FROM proof_submissions ps
      LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address
      LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
      ${where}
      GROUP BY v.website_domain
      HAVING v.website_domain IS NOT NULL AND v.website_domain <> ''
      ORDER BY total_relays DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching validator domains leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/v1/validators/owners - leaderboard by owner
app.get('/api/v1/validators/owners', async (req, res) => {
  try {
    const { chain, service_id, start_date, end_date, page = 1, limit = 100 } = req.query;
    await transactionService.connectDB();
    const client = transactionService.pgClient;

    const conditions = ["ps.claim_proof_status_int = 0"]; // successful only
    const values = [];
    let idx = 1;
    if (chain) { conditions.push(`ps.chain = $${idx++}`); values.push(chain); }
    if (service_id) { conditions.push(`ps.service_id = $${idx++}`); values.push(service_id); }
    if (start_date) { conditions.push(`ps.timestamp >= $${idx++}`); values.push(start_date); }
    if (end_date) { conditions.push(`ps.timestamp <= $${idx++}`); values.push(end_date); }
    const where = `WHERE ${conditions.join(' AND ')}`;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;

    const countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT s.owner_address
        FROM proof_submissions ps
        LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address
        LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
        ${where}
        GROUP BY s.owner_address
      ) t`;
    const countRes = await client.query(countSql, values);
    const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

    const listSql = `
      SELECT 
        s.owner_address,
        COUNT(DISTINCT ps.supplier_operator_address) AS supplier_count,
        COUNT(DISTINCT v.operator_address) AS validator_count,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent
      FROM proof_submissions ps
      LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address
      LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
      ${where}
      GROUP BY s.owner_address
      ORDER BY total_relays DESC NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}`;

    const listRes = await client.query(listSql, [...values, limitNum, offset]);
    res.json({ data: listRes.rows, meta: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error('Error fetching validator owners leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/services/top-by-compute-units
 * 
 * Returns services by total compute units for the specified time period with pagination.
 * Perfect for growth graphs showing service adoption over time.
 * 
 * Query Parameters:
 * - days: Time period in days (7, 15, or 30). Default: 30
 * - chain: Optional chain filter (e.g., "mainnet", "testnet")
 * - supplier_address: Optional supplier operator address filter (single or comma-separated)
 * - owner_address: Optional owner address filter (filters by supplier owner address)
 * - page: Optional page number for pagination (default: 1)
 * - limit: Optional number of results per page (default: 10, max: 1000)
 * 
 * Returns array of services with:
 * - service_id: The service identifier
 * - total_claimed_compute_units: Sum of all claimed compute units
 * - total_estimated_compute_units: Sum of all estimated compute units
 * - submission_count: Number of proof submissions
 * - avg_efficiency_percent: Average efficiency percentage
 * - period_start: Start timestamp of the period
 * - period_end: End timestamp of the period
 * 
 * Also returns:
 * - meta: Pagination and period information (total, page, limit, totalPages, days, chain, period_start, period_end)
 * 
 * Example:
 * GET /api/v1/services/top-by-compute-units?page=1&limit=25&days=7&chain=mainnet
 * GET /api/v1/services/top-by-compute-units?supplier_address=poktvaloper1abc...&days=30&page=2&limit=10
 * GET /api/v1/services/top-by-compute-units?owner_address=pokt1xyz...&days=30
 */
app.get('/api/v1/services/top-by-compute-units', async (req, res) => {
  try {
    const { days = '30', chain, supplier_address, owner_address, page, limit } = req.query;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.getTopServicesByComputeUnits({
      days,
      chain,
      supplier_address,
      owner_address,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching top services by compute units:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/services/top-by-compute-units
 * 
 * Same as GET but accepts parameters in request body.
 * Recommended for multiple supplier addresses to avoid URL length limits.
 * 
 * Body: { days, chain, supplier_address (string or array), owner_address, page, limit }
 */
app.post('/api/v1/services/top-by-compute-units', async (req, res) => {
  try {
    const { days = '30', chain, supplier_address, owner_address, page, limit } = req.body;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.getTopServicesByComputeUnits({
      days,
      chain,
      supplier_address,
      owner_address,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching top services by compute units:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/services/top-by-performance
 * 
 * Returns services by compute units with percentage distribution and pagination.
 * Perfect for displaying a table showing network usage distribution.
 * 
 * Query Parameters:
 * - chain: Optional chain filter (e.g., "mainnet", "testnet")
 * - days: Optional time period in days (default: 30). Only accepts 7, 15, or 30
 * - supplier_address: Optional supplier operator address filter (single or comma-separated)
 * - owner_address: Optional owner address filter (filters by supplier owner address)
 * - page: Optional page number for pagination (default: 1)
 * - limit: Optional number of results per page (default: 10, max: 1000)
 * 
 * Returns array of services with:
 * - service_id: The service identifier
 * - total_claimed_compute_units: Sum of all claimed compute units
 * - total_estimated_compute_units: Sum of all estimated compute units
 * - submission_count: Number of proof submissions
 * - avg_efficiency_percent: Average efficiency percentage
 * - percentage_of_total: Percentage distribution (0-100)
 * - rank: Ranking position (global, not page-based)
 * 
 * Also returns:
 * - total_compute_units: Grand total for percentage calculations
 * - meta: Pagination and period information (total, page, limit, totalPages, days, chain, period_start, period_end)
 * 
 * Example:
 * GET /api/v1/services/top-by-performance?chain=mainnet&days=15&page=1&limit=20
 * GET /api/v1/services/top-by-performance?supplier_address=poktvaloper1abc...&days=30&page=2&limit=10
 * GET /api/v1/services/top-by-performance?owner_address=pokt1xyz...&days=30
 */
app.get('/api/v1/services/top-by-performance', async (req, res) => {
  try {
    const { chain, days = '30', supplier_address, owner_address, page, limit } = req.query;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.getTopServicesByPerformance({
      chain,
      days,
      supplier_address,
      owner_address,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching top services by performance:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/services/top-by-performance
 * 
 * Same as GET but accepts parameters in request body.
 * Recommended for multiple supplier addresses to avoid URL length limits.
 * 
 * Body: { chain, days, supplier_address (string or array), owner_address, page, limit }
 */
app.post('/api/v1/services/top-by-performance', async (req, res) => {
  try {
    const { chain, days = '30', supplier_address, owner_address, page, limit } = req.body;
    
    await transactionService.connectDB();
    const client = transactionService.pgClient;
    
    const result = await performanceService.getTopServicesByPerformance({
      chain,
      days,
      supplier_address,
      owner_address,
      page,
      limit
    }, client);
    
    res.json(result);
  } catch (error) {
    console.error('Error fetching top services by performance:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// LOG VIEWER API - REST Endpoints
// ============================================================================

// List all containers
app.get('/api/v1/logs/containers', async (req, res) => {
  try {
    if (!dockerService.isAvailable()) {
      return res.status(503).json({ 
        error: 'Docker service is not available',
        message: 'Make sure Docker is running and the socket is accessible'
      });
    }

    const all = req.query.all === 'true' || req.query.all === '1';
    const containers = await dockerService.listContainers(all);
    
    res.json({
      data: containers,
      total: containers.length
    });
  } catch (error) {
    console.error('Error listing containers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get container metadata
app.get('/api/v1/logs/containers/:containerId', async (req, res) => {
  try {
    if (!dockerService.isAvailable()) {
      return res.status(503).json({ 
        error: 'Docker service is not available',
        message: 'Make sure Docker is running and the socket is accessible'
      });
    }

    const { containerId } = req.params;
    const info = await dockerService.getContainerInfo(containerId);
    
    res.json({ data: info });
  } catch (error) {
    console.error('Error getting container info:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Get historical logs
app.get('/api/v1/logs/containers/:containerId/history', async (req, res) => {
  try {
    if (!dockerService.isAvailable()) {
      return res.status(503).json({ 
        error: 'Docker service is not available',
        message: 'Make sure Docker is running and the socket is accessible'
      });
    }

    const { containerId } = req.params;
    const { 
      tail = 100, 
      since, 
      until,
      logLevel,
      filter,
      search,
      page = 1,
      limit = 100
    } = req.query;

    const options = {
      tail: parseInt(tail, 10),
      since: since || undefined,
      until: until || undefined
    };

    let logs = await dockerService.getLogs(containerId, options);

    // Apply filters
    const filters = {};
    if (logLevel) filters.logLevel = logLevel;
    if (filter) filters.filter = filter;
    if (search) filters.search = search;
    if (since) filters.since = since;
    if (until) filters.until = until;

    if (Object.keys(filters).length > 0) {
      logs = dockerService.filterLogs(logs, filters);
    }

    // Pagination
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    const total = logs.length;
    const paginatedLogs = logs.slice(offset, offset + limitNum);

    res.json({
      data: paginatedLogs,
      meta: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error getting container logs:', error);
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// ============================================================================
// ADMIN API - User Management System
// ============================================================================

const adminRoutes = require('./routes/admin');
const { checkPermissions } = require('./middleware/rbac');

// Mount admin routes with RBAC middleware
// Admin routes require JWT authentication (handled by authenticateToken middleware)
// AND role-based permissions (handled by checkPermissions middleware)
app.use('/api/admin', checkPermissions(), adminRoutes);

// Start the server and initialize the worker pool
const startServer = async () => {
  try {
    // Log startup banner
    console.log('='.repeat(80));
    console.log(`🚀 POCKET NETWORK API SERVER STARTING (Worker ${cluster.worker.id}/${NUM_WORKERS})`);
    console.log('='.repeat(80));
    console.log(`📅 Start Time: ${new Date().toISOString()}`);
    console.log(`🆔 Process ID: ${process.pid}`);
    console.log(`👷 Worker ID: ${cluster.worker.id}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔌 Port: ${PORT}`);
    console.log(`📊 Node Version: ${process.version}`);
    console.log(`💾 Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
    console.log(`🔗 Database Pool: ${process.env.DB_POOL_SIZE || '20'} max connections`);
    console.log('='.repeat(80));
    
    // Initialize reward analytics refresh service (only in first worker to avoid duplicate refreshes)
    // In cluster mode, only worker 1 should run the refresh service
    if ((!cluster.worker || cluster.worker.id === 1) && !rewardAnalyticsRefreshService) {
      rewardAnalyticsRefreshService = new RewardAnalyticsRefreshService({
        refreshIntervalMs: parseInt(process.env.REWARD_ANALYTICS_REFRESH_INTERVAL_MS || '900000', 10) // 15 minutes default
      });
      rewardAnalyticsRefreshService.start();
      console.log('✅ Reward analytics refresh service started');
    } else if (cluster.worker && cluster.worker.id !== 1) {
      console.log('⏭️  Skipping reward analytics refresh service (running on worker 1 only)');
    }

    // Initialize analytics aggregation service (only in first worker)
    if ((!cluster.worker || cluster.worker.id === 1) && !analyticsAggregationService) {
      analyticsAggregationService = new AnalyticsAggregationService();
      analyticsAggregationService.start();
      console.log('✅ Analytics aggregation service started');
    } else if (cluster.worker && cluster.worker.id !== 1) {
      console.log('⏭️  Skipping analytics aggregation service (running on worker 1 only)');
    }
    
    // Create HTTP server (needed for WebSocket upgrade)
    const server = http.createServer(app);
    
    // Create WebSocket server
    const wss = new WebSocket.Server({ 
      server,
      path: '/api/v1/logs/stream'
    });

    // Store active log streams
    const activeStreams = new Map();

    // WebSocket connection handler
    wss.on('connection', (ws, req) => {
      const connectionId = crypto.randomUUID();
      console.log(`📡 WebSocket connection established: ${connectionId}`);

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message.toString());
          
          if (data.action === 'start') {
            const { containerId, options = {} } = data;
            
            if (!containerId) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'containerId is required'
              }));
              return;
            }

            if (!dockerService.isAvailable()) {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Docker service is not available'
              }));
              return;
            }

            const streamId = crypto.randomUUID();
            
            try {
              // Apply filters for real-time streaming
              const filters = {};
              if (options.logLevel) filters.logLevel = options.logLevel;
              if (options.filter) filters.filter = options.filter;
              if (options.search) filters.search = options.search;
              if (options.since) filters.since = options.since;
              if (options.until) filters.until = options.until;

              const streamOptions = {
                tail: options.tail || 0,
                follow: options.follow !== false,
                since: options.since,
                until: options.until,
                timestamps: true
              };

              const stream = await dockerService.streamLogs(
                containerId,
                streamOptions,
                (logEntry) => {
                  // Apply filters to each log entry
                  if (Object.keys(filters).length > 0) {
                    const filtered = dockerService.filterLogs([logEntry], filters);
                    if (filtered.length === 0) return; // Skip if filtered out
                  }

                  // Send log entry to client
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      type: 'log',
                      streamId,
                      containerId,
                      timestamp: logEntry.timestamp,
                      level: logEntry.level,
                      stream: logEntry.stream,
                      message: logEntry.message
                    }));
                  }
                },
                (error) => {
                  console.error(`Error in log stream ${streamId}:`, error);
                  if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                      type: 'error',
                      streamId,
                      message: error.message
                    }));
                  }
                }
              );

              activeStreams.set(streamId, {
                stream,
                containerId,
                connectionId
              });

              // Send confirmation
              ws.send(JSON.stringify({
                type: 'stream_started',
                streamId,
                containerId
              }));

            } catch (error) {
              console.error(`Error starting log stream for ${containerId}:`, error);
              ws.send(JSON.stringify({
                type: 'error',
                message: error.message
              }));
            }

          } else if (data.action === 'stop') {
            const { streamId } = data;
            
            if (streamId && activeStreams.has(streamId)) {
              const streamInfo = activeStreams.get(streamId);
              streamInfo.stream.stop();
              activeStreams.delete(streamId);
              
              ws.send(JSON.stringify({
                type: 'stream_stopped',
                streamId
              }));
            } else {
              ws.send(JSON.stringify({
                type: 'error',
                message: 'Stream not found'
              }));
            }
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Invalid action. Use "start" or "stop"'
            }));
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Invalid message format'
            }));
          }
        }
      });

      ws.on('close', () => {
        console.log(`📡 WebSocket connection closed: ${connectionId}`);
        // Clean up all streams for this connection
        for (const [streamId, streamInfo] of activeStreams.entries()) {
          if (streamInfo.connectionId === connectionId) {
            streamInfo.stream.stop();
            activeStreams.delete(streamId);
          }
        }
      });

      ws.on('error', (error) => {
        console.error(`WebSocket error for connection ${connectionId}:`, error);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        connectionId,
        message: 'WebSocket log viewer connected'
      }));
    });

    // Start the HTTP server
    server.listen(PORT, () => {
      console.log(`🌐 Worker ${cluster.worker.id} API server running on http://localhost:${PORT}`);
      console.log(`🔌 WebSocket server available at ws://localhost:${PORT}/api/v1/logs/stream`);
    });
    
    console.log('='.repeat(80));
    console.log(`🎉 Worker ${cluster.worker.id} STARTED SUCCESSFULLY`);
    console.log('='.repeat(80));
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('='.repeat(80));
      console.log(`🛑 Worker ${cluster.worker.id} SHUTTING DOWN (SIGINT)`);
      console.log(`📅 Shutdown Time: ${new Date().toISOString()}`);
      console.log(`⏱️  Uptime: ${Math.round(process.uptime())} seconds`);
      console.log('='.repeat(80));
      // Stop refresh service gracefully
      if (rewardAnalyticsRefreshService) {
        await rewardAnalyticsRefreshService.stop();
      }
      // Stop analytics aggregation service gracefully
      if (analyticsAggregationService) {
        analyticsAggregationService.stop();
      }
      // Close database pool gracefully
      await transactionService.pgPool.end();
      console.log('👋 Worker shutdown complete');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('='.repeat(80));
      console.log(`🛑 Worker ${cluster.worker.id} SHUTTING DOWN (SIGTERM)`);
      console.log(`📅 Shutdown Time: ${new Date().toISOString()}`);
      console.log(`⏱️  Uptime: ${Math.round(process.uptime())} seconds`);
      console.log('='.repeat(80));
      // Stop refresh service gracefully
      if (rewardAnalyticsRefreshService) {
        await rewardAnalyticsRefreshService.stop();
      }
      // Stop analytics aggregation service gracefully
      if (analyticsAggregationService) {
        analyticsAggregationService.stop();
      }
      // Close database pool gracefully
      await transactionService.pgPool.end();
      console.log('👋 Worker shutdown complete');
      process.exit(0);
    });
  } catch (error) {
    console.log('='.repeat(80));
    console.log(`❌ Worker ${cluster.worker?.id || 'unknown'} STARTUP FAILED`);
    console.log(`📅 Failure Time: ${new Date().toISOString()}`);
    console.log(`🆔 Process ID: ${process.pid}`);
    console.log(`💥 Error: ${error.message}`);
    console.log(`📋 Stack Trace:`);
    console.error(error.stack);
    console.log('='.repeat(80));
    process.exit(1);
  }
};

// Start the server
startServer();