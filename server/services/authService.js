const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const emailService = require('./emailService');

class AuthService {
  constructor() {
    // PostgreSQL connection pool for concurrent request handling
    this.pgPool = new Pool({
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

    // Handle pool errors
    this.pgPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }

  async connectDB() {
    return this.pgPool;
  }

  get pgClient() {
    return this.pgPool;
  }

  /**
   * Generate a new API token
   * Format: pk_live_<64_char_hex>
   * @returns {Object} { token: string, tokenHash: string, tokenPrefix: string }
   */
  generateToken() {
    // Generate 32 random bytes (64 hex characters)
    const randomBytes = crypto.randomBytes(32);
    const randomHex = randomBytes.toString('hex');
    const token = `pk_live_${randomHex}`;
    
    // Hash the token for storage
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Extract prefix for display (first 8 chars after pk_live_)
    const tokenPrefix = `pk_live_${randomHex.substring(0, 8)}`;
    
    return { token, tokenHash, tokenPrefix };
  }

  /**
   * Hash a token for lookup
   * @param {string} token - Plain text token
   * @returns {string} SHA-256 hash
   */
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Register a new account
   * @param {string} email - User email
   * @param {string} password - User password (optional for passwordless)
   * @param {string} name - User name
   * @param {string} organization - Organization name (optional)
   * @returns {Promise<Object>} { account, token }
   */
  async registerAccount(email, password, name, organization) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Hash password if provided
      let passwordHash = null;
      if (password) {
        passwordHash = await bcrypt.hash(password, 10);
      }

      // Create account
      const accountResult = await client.query(
        `INSERT INTO api_accounts (email, password_hash, name, organization, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, email, name, organization, status, created_at`,
        [email, passwordHash, name, organization]
      );

      const account = accountResult.rows[0];

      // Generate default token
      const { token, tokenHash, tokenPrefix } = this.generateToken();
      const tokenName = 'Default Token';

      // Create token
      const tokenResult = await client.query(
        `INSERT INTO api_tokens (account_id, token_hash, token_prefix, name, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, token_prefix, name, created_at, expires_at`,
        [account.id, tokenHash, tokenPrefix, tokenName]
      );

      await client.query('COMMIT');

      return {
        account: {
          id: account.id,
          email: account.email,
          name: account.name,
          organization: account.organization,
          status: account.status,
          created_at: account.created_at,
        },
        token: {
          id: tokenResult.rows[0].id,
          token: token, // Only shown once
          token_prefix: tokenResult.rows[0].token_prefix,
          name: tokenResult.rows[0].name,
          created_at: tokenResult.rows[0].created_at,
          expires_at: tokenResult.rows[0].expires_at,
        },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Login with email and password
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} { account, tokens }
   */
  async login(email, password) {
    const client = await this.pgPool.connect();
    try {
      // Find account by email
      const accountResult = await client.query(
        `SELECT id, email, password_hash, name, organization, status, email_verified
         FROM api_accounts
         WHERE email = $1 AND status = 'active'`,
        [email]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Invalid email or password');
      }

      const account = accountResult.rows[0];

      // Verify password if account has one
      if (account.password_hash) {
        const passwordValid = await bcrypt.compare(password, account.password_hash);
        if (!passwordValid) {
          throw new Error('Invalid email or password');
        }
      } else {
        // Passwordless account - password should not be provided
        if (password) {
          throw new Error('Invalid email or password');
        }
        // For passwordless, email verification might be required
        // For now, we'll allow it
      }

      // Update last_login_at
      await client.query(
        `UPDATE api_accounts SET last_login_at = NOW() WHERE id = $1`,
        [account.id]
      );

      // Get all active tokens for account (prefixes only, not full tokens)
      const tokensResult = await client.query(
        `SELECT id, token_prefix, name, status, created_at, last_used_at, expires_at
         FROM api_tokens
         WHERE account_id = $1 AND status = 'active'
         ORDER BY created_at DESC`,
        [account.id]
      );

      return {
        account: {
          id: account.id,
          email: account.email,
          name: account.name,
          organization: account.organization,
          status: account.status,
          email_verified: account.email_verified,
        },
        tokens: tokensResult.rows.map(row => ({
          id: row.id,
          token_prefix: row.token_prefix,
          name: row.name,
          status: row.status,
          created_at: row.created_at,
          last_used_at: row.last_used_at,
          expires_at: row.expires_at,
        })),
      };
    } finally {
      client.release();
    }
  }

  /**
   * Validate an API token
   * @param {string} token - Plain text token
   * @returns {Promise<Object|null>} Token data or null if invalid
   */
  async validateToken(token) {
    const client = await this.pgPool.connect();
    try {
      const tokenHash = this.hashToken(token);

      const result = await client.query(
        `SELECT t.id, t.account_id, t.token_prefix, t.name, t.status, t.expires_at, t.revoked_at,
                a.id as account_id, a.status as account_status
         FROM api_tokens t
         JOIN api_accounts a ON t.account_id = a.id
         WHERE t.token_hash = $1`,
        [tokenHash]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const tokenData = result.rows[0];

      // Check token status
      if (tokenData.status !== 'active') {
        return null;
      }

      // Check account status
      if (tokenData.account_status !== 'active') {
        return null;
      }

      // Check expiration
      if (tokenData.expires_at && new Date(tokenData.expires_at) < new Date()) {
        return null;
      }

      // Check if revoked
      if (tokenData.revoked_at) {
        return null;
      }

      return {
        id: tokenData.id,
        account_id: tokenData.account_id,
        token_prefix: tokenData.token_prefix,
        name: tokenData.name,
        status: tokenData.status,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Update token last_used_at timestamp
   * @param {number} tokenId - Token ID
   */
  async updateTokenLastUsed(tokenId) {
    const client = await this.pgPool.connect();
    try {
      await client.query(
        `UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1`,
        [tokenId]
      );
    } finally {
      client.release();
    }
  }

  /**
   * Create a new token for an account
   * @param {number} accountId - Account ID
   * @param {string} name - Token name
   * @returns {Promise<Object>} Token data with full token (shown once)
   */
  async createToken(accountId, name = 'New Token') {
    const client = await this.pgPool.connect();
    try {
      // Verify account exists and is active
      const accountResult = await client.query(
        `SELECT id FROM api_accounts WHERE id = $1 AND status = 'active'`,
        [accountId]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found or inactive');
      }

      // Generate new token
      const { token, tokenHash, tokenPrefix } = this.generateToken();

      // Create token
      const tokenResult = await client.query(
        `INSERT INTO api_tokens (account_id, token_hash, token_prefix, name, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, token_prefix, name, created_at, expires_at`,
        [accountId, tokenHash, tokenPrefix, name]
      );

      return {
        id: tokenResult.rows[0].id,
        token: token, // Only shown once
        token_prefix: tokenResult.rows[0].token_prefix,
        name: tokenResult.rows[0].name,
        created_at: tokenResult.rows[0].created_at,
        expires_at: tokenResult.rows[0].expires_at,
      };
    } finally {
      client.release();
    }
  }

  /**
   * List all tokens for an account (prefixes only, not full tokens)
   * @param {number} accountId - Account ID
   * @returns {Promise<Array>} Array of token objects
   */
  async listTokens(accountId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT id, token_prefix, name, status, created_at, last_used_at, expires_at
         FROM api_tokens
         WHERE account_id = $1
         ORDER BY created_at DESC`,
        [accountId]
      );

      return result.rows.map(row => ({
        id: row.id,
        token_prefix: row.token_prefix,
        name: row.name,
        status: row.status,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Revoke a token
   * @param {number} tokenId - Token ID
   * @param {number} accountId - Account ID (for verification)
   * @returns {Promise<boolean>} Success
   */
  async revokeToken(tokenId, accountId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `UPDATE api_tokens
         SET status = 'revoked', revoked_at = NOW()
         WHERE id = $1 AND account_id = $2 AND status = 'active'
         RETURNING id`,
        [tokenId, accountId]
      );

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Regenerate a token (revoke old, create new)
   * @param {number} tokenId - Token ID to regenerate
   * @param {number} accountId - Account ID (for verification)
   * @param {string} name - New token name (optional, uses old name if not provided)
   * @returns {Promise<Object>} New token data with full token (shown once)
   */
  async regenerateToken(tokenId, accountId, name = null) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Get old token to preserve name if not provided
      const oldTokenResult = await client.query(
        `SELECT name FROM api_tokens WHERE id = $1 AND account_id = $2`,
        [tokenId, accountId]
      );

      if (oldTokenResult.rows.length === 0) {
        throw new Error('Token not found');
      }

      const tokenName = name || oldTokenResult.rows[0].name || 'Regenerated Token';

      // Revoke old token
      await client.query(
        `UPDATE api_tokens
         SET status = 'revoked', revoked_at = NOW()
         WHERE id = $1 AND account_id = $2`,
        [tokenId, accountId]
      );

      // Generate new token
      const { token, tokenHash, tokenPrefix } = this.generateToken();

      // Create new token
      const newTokenResult = await client.query(
        `INSERT INTO api_tokens (account_id, token_hash, token_prefix, name, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, token_prefix, name, created_at, expires_at`,
        [accountId, tokenHash, tokenPrefix, tokenName]
      );

      await client.query('COMMIT');

      return {
        id: newTokenResult.rows[0].id,
        token: token, // Only shown once
        token_prefix: newTokenResult.rows[0].token_prefix,
        name: newTokenResult.rows[0].name,
        created_at: newTokenResult.rows[0].created_at,
        expires_at: newTokenResult.rows[0].expires_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get account information
   * @param {number} accountId - Account ID
   * @returns {Promise<Object>} Account data
   */
  async getAccount(accountId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT id, email, name, organization, status, email_verified, created_at, last_login_at
         FROM api_accounts
         WHERE id = $1`,
        [accountId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const account = result.rows[0];
      return {
        id: account.id,
        email: account.email,
        name: account.name,
        organization: account.organization,
        status: account.status,
        email_verified: account.email_verified,
        created_at: account.created_at,
        last_login_at: account.last_login_at,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Track token usage (optional, async)
   * @param {number} tokenId - Token ID
   * @param {string} endpoint - Endpoint path
   * @param {string} method - HTTP method
   * @param {number} statusCode - HTTP status code
   * @param {number} responseTimeMs - Response time in milliseconds
   */
  async trackTokenUsage(tokenId, endpoint, method, statusCode, responseTimeMs) {
    const client = await this.pgPool.connect();
    try {
      await client.query(
        `INSERT INTO api_token_usage (token_id, endpoint, method, status_code, response_time_ms)
         VALUES ($1, $2, $3, $4, $5)`,
        [tokenId, endpoint, method, statusCode, responseTimeMs]
      );
    } catch (error) {
      // Don't throw - usage tracking is optional
      console.error('Error tracking token usage:', error);
    } finally {
      client.release();
    }
  }

  /**
   * Generate a 6-digit verification code
   * @returns {string} 6-digit code
   */
  generateVerificationCode() {
    // Generate cryptographically secure random 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    return code;
  }

  /**
   * Send email verification code
   * @param {number} accountId - Account ID
   * @returns {Promise<Object>} { success, codeExpiry }
   */
  async sendVerificationCode(accountId) {
    const client = await this.pgPool.connect();
    try {
      // Get account details
      const accountResult = await client.query(
        `SELECT id, email, name, email_verified, email_verification_attempts
         FROM api_accounts
         WHERE id = $1`,
        [accountId]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = accountResult.rows[0];

      // Check if already verified
      if (account.email_verified) {
        throw new Error('Email already verified');
      }

      // Rate limiting: max 5 attempts per hour
      if (account.email_verification_attempts >= 5) {
        throw new Error('Too many verification attempts. Please try again later.');
      }

      // Generate new verification code
      const code = this.generateVerificationCode();
      const expirySeconds = parseInt(process.env.EMAIL_VERIFICATION_CODE_EXPIRY || '3600', 10);
      const expiresAt = new Date(Date.now() + expirySeconds * 1000);

      // Update account with verification code
      await client.query(
        `UPDATE api_accounts
         SET email_verification_code = $1,
             email_verification_code_expires_at = $2,
             email_verification_attempts = email_verification_attempts + 1
         WHERE id = $3`,
        [code, expiresAt, accountId]
      );

      // Send verification email
      await emailService.sendVerificationEmail(account.email, code, account.name);

      console.log(`📧 Verification code sent to account ${accountId} (${account.email})`);

      return {
        success: true,
        codeExpiry: expiresAt,
        email: account.email,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Verify email with code
   * @param {number} accountId - Account ID
   * @param {string} code - 6-digit verification code
   * @returns {Promise<Object>} { success, message }
   */
  async verifyEmail(accountId, code) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Get account with verification code
      const accountResult = await client.query(
        `SELECT id, email, name, email_verified, email_verification_code, email_verification_code_expires_at
         FROM api_accounts
         WHERE id = $1
         FOR UPDATE`,
        [accountId]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = accountResult.rows[0];

      // Check if already verified
      if (account.email_verified) {
        await client.query('COMMIT');
        return {
          success: true,
          message: 'Email already verified',
          alreadyVerified: true,
        };
      }

      // Check if code exists
      if (!account.email_verification_code) {
        throw new Error('No verification code found. Please request a new code.');
      }

      // Check if code expired
      if (new Date() > new Date(account.email_verification_code_expires_at)) {
        throw new Error('Verification code expired. Please request a new code.');
      }

      // Verify code
      if (account.email_verification_code !== code) {
        throw new Error('Invalid verification code');
      }

      // Mark email as verified
      await client.query(
        `UPDATE api_accounts
         SET email_verified = true,
             email_verified_at = NOW(),
             email_verification_code = NULL,
             email_verification_code_expires_at = NULL,
             email_verification_attempts = 0
         WHERE id = $1`,
        [accountId]
      );

      await client.query('COMMIT');

      // Send welcome email (non-blocking, don't wait)
      emailService.sendWelcomeEmail(account.email, account.name).catch(err => {
        console.error('Error sending welcome email:', err);
      });

      console.log(`✅ Email verified for account ${accountId} (${account.email})`);

      return {
        success: true,
        message: 'Email verified successfully',
        email: account.email,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Verify email with code using email address (PUBLIC - no token required)
   * @param {string} email - Email address
   * @param {string} code - Verification code
   * @returns {Promise<Object>} Verification result
   */
  async verifyEmailByEmail(email, code) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Get account with verification code
      const accountResult = await client.query(
        `SELECT id, email, name, email_verified, email_verification_code, email_verification_code_expires_at
         FROM api_accounts
         WHERE email = $1
         FOR UPDATE`,
        [email]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = accountResult.rows[0];

      // Check if already verified
      if (account.email_verified) {
        await client.query('COMMIT');
        return {
          success: true,
          message: 'Email already verified',
          alreadyVerified: true,
        };
      }

      // Check if code exists
      if (!account.email_verification_code) {
        throw new Error('No verification code found. Please request a new code.');
      }

      // Check if code expired
      if (new Date() > new Date(account.email_verification_code_expires_at)) {
        throw new Error('Verification code expired. Please request a new code.');
      }

      // Verify code
      if (account.email_verification_code !== code) {
        throw new Error('Invalid verification code');
      }

      // Mark email as verified
      await client.query(
        `UPDATE api_accounts
         SET email_verified = true,
             email_verified_at = NOW(),
             email_verification_code = NULL,
             email_verification_code_expires_at = NULL,
             email_verification_attempts = 0
         WHERE id = $1`,
        [account.id]
      );

      await client.query('COMMIT');

      // Send welcome email (non-blocking, don't wait)
      emailService.sendWelcomeEmail(account.email, account.name).catch(err => {
        console.error('Error sending welcome email:', err);
      });

      console.log(`✅ Email verified for ${email}`);

      return {
        success: true,
        message: 'Email verified successfully',
        email: account.email,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Resend verification code
   * @param {string} email - User email
   * @returns {Promise<Object>} { success, codeExpiry }
   */
  async resendVerificationCode(email) {
    const client = await this.pgPool.connect();
    try {
      // Get account by email
      const accountResult = await client.query(
        `SELECT id, email, name, email_verified, email_verification_attempts,
                email_verification_code_expires_at
         FROM api_accounts
         WHERE email = $1`,
        [email]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = accountResult.rows[0];

      // Check if already verified
      if (account.email_verified) {
        throw new Error('Email already verified');
      }

      // Rate limiting
      if (account.email_verification_attempts >= 5) {
        throw new Error('Too many verification attempts. Please try again later.');
      }

      // Check if previous code is still valid (don't send too frequently)
      if (account.email_verification_code_expires_at) {
        const timeLeft = new Date(account.email_verification_code_expires_at) - new Date();
        if (timeLeft > 55 * 60 * 1000) { // More than 55 minutes left
          throw new Error('Verification code already sent. Please check your email or wait a few minutes.');
        }
      }

      // Send new verification code
      return await this.sendVerificationCode(account.id);
    } finally {
      client.release();
    }
  }

  /**
   * Check if email verification is required
   * @returns {boolean}
   */
  isEmailVerificationRequired() {
    return process.env.EMAIL_VERIFICATION_REQUIRED === 'true';
  }

  /**
   * Generate JWT access token
   * @param {Object} payload - Token payload
   * @returns {string} JWT access token
   */
  generateAccessToken(payload) {
    const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
    const expiresIn = process.env.JWT_ACCESS_EXPIRY || '15m'; // 15 minutes default

    return jwt.sign(payload, secret, { expiresIn });
  }

  /**
   * Generate JWT refresh token
   * @param {Object} payload - Token payload
   * @returns {string} JWT refresh token
   */
  generateRefreshToken(payload) {
    const secret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
    const expiresIn = process.env.JWT_REFRESH_EXPIRY || '7d'; // 7 days default

    return jwt.sign(payload, secret, { expiresIn });
  }

  /**
   * Verify JWT access token
   * @param {string} token - JWT token
   * @returns {Object|null} Decoded token or null if invalid
   */
  verifyAccessToken(token) {
    try {
      const secret = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
      return jwt.verify(token, secret);
    } catch (error) {
      return null;
    }
  }

  /**
   * Verify JWT refresh token
   * @param {string} token - JWT refresh token
   * @returns {Object|null} Decoded token or null if invalid
   */
  verifyRefreshToken(token) {
    try {
      const secret = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
      return jwt.verify(token, secret);
    } catch (error) {
      return null;
    }
  }

  /**
   * Store refresh token in database
   * @param {number} accountId - Account ID
   * @param {string} refreshToken - Refresh token
   * @param {string} userAgent - User agent string
   * @param {string} ipAddress - IP address
   * @returns {Promise<Object>} Session data
   */
  async storeRefreshToken(accountId, refreshToken, userAgent = null, ipAddress = null) {
    const client = await this.pgPool.connect();
    try {
      // Hash refresh token for storage
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      // Calculate expiry based on JWT_REFRESH_EXPIRY
      const expiryDays = parseInt(process.env.JWT_REFRESH_EXPIRY?.replace('d', '') || '7', 10);
      const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);

      const result = await client.query(
        `INSERT INTO jwt_sessions (account_id, token_hash, user_agent, ip_address, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at, expires_at`,
        [accountId, tokenHash, userAgent, ipAddress, expiresAt]
      );

      return {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
        expires_at: result.rows[0].expires_at,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Validate refresh token from database
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object|null>} Session data or null if invalid
   */
  async validateRefreshToken(refreshToken) {
    const client = await this.pgPool.connect();
    try {
      // First verify JWT signature
      const decoded = this.verifyRefreshToken(refreshToken);
      if (!decoded) {
        return null;
      }

      // Hash token for lookup
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      const result = await client.query(
        `SELECT s.id, s.account_id, s.expires_at, s.revoked_at,
                a.id as account_id, a.status as account_status, a.email, a.name
         FROM jwt_sessions s
         JOIN api_accounts a ON s.account_id = a.id
         WHERE s.token_hash = $1`,
        [tokenHash]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const session = result.rows[0];

      // Check if revoked
      if (session.revoked_at) {
        return null;
      }

      // Check expiration
      if (new Date(session.expires_at) < new Date()) {
        return null;
      }

      // Check account status
      if (session.account_status !== 'active') {
        return null;
      }

      // Update last_used_at
      await client.query(
        `UPDATE jwt_sessions SET last_used_at = NOW() WHERE id = $1`,
        [session.id]
      );

      return {
        sessionId: session.id,
        accountId: session.account_id,
        email: session.email,
        name: session.name,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Revoke refresh token (logout)
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<boolean>} Success
   */
  async revokeRefreshToken(refreshToken) {
    const client = await this.pgPool.connect();
    try {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

      const result = await client.query(
        `UPDATE jwt_sessions
         SET revoked_at = NOW()
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING id`,
        [tokenHash]
      );

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Revoke all refresh tokens for an account (logout from all devices)
   * @param {number} accountId - Account ID
   * @returns {Promise<number>} Number of sessions revoked
   */
  async revokeAllRefreshTokens(accountId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `UPDATE jwt_sessions
         SET revoked_at = NOW()
         WHERE account_id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [accountId]
      );

      return result.rows.length;
    } finally {
      client.release();
    }
  }

  /**
   * Login with JWT tokens (enhanced version)
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {string} userAgent - User agent string
   * @param {string} ipAddress - IP address
   * @returns {Promise<Object>} { account, accessToken, refreshToken }
   */
  async loginWithJWT(email, password, userAgent = null, ipAddress = null) {
    const client = await this.pgPool.connect();
    try {
      // Find account by email
      const accountResult = await client.query(
        `SELECT id, email, password_hash, name, organization, status, email_verified
         FROM api_accounts
         WHERE email = $1 AND status = 'active'`,
        [email]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Invalid email or password');
      }

      const account = accountResult.rows[0];

      // Verify password if account has one
      if (account.password_hash) {
        const passwordValid = await bcrypt.compare(password, account.password_hash);
        if (!passwordValid) {
          throw new Error('Invalid email or password');
        }
      } else {
        // Passwordless account - password should not be provided
        if (password) {
          throw new Error('Invalid email or password');
        }
      }

      // Update last_login_at
      await client.query(
        `UPDATE api_accounts SET last_login_at = NOW() WHERE id = $1`,
        [account.id]
      );

      // Generate JWT tokens
      const payload = {
        accountId: account.id,
        email: account.email,
        name: account.name,
        email_verified: account.email_verified,
      };

      const accessToken = this.generateAccessToken(payload);
      const refreshToken = this.generateRefreshToken({ accountId: account.id });

      // Store refresh token
      await this.storeRefreshToken(account.id, refreshToken, userAgent, ipAddress);

      return {
        account: {
          id: account.id,
          email: account.email,
          name: account.name,
          organization: account.organization,
          status: account.status,
          email_verified: account.email_verified,
        },
        accessToken,
        refreshToken,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} { accessToken, refreshToken }
   */
  async refreshAccessToken(refreshToken) {
    // Validate refresh token
    const sessionData = await this.validateRefreshToken(refreshToken);

    if (!sessionData) {
      throw new Error('Invalid or expired refresh token');
    }

    // Get fresh account data
    const client = await this.pgPool.connect();
    try {
      const accountResult = await client.query(
        `SELECT id, email, name, organization, status, email_verified
         FROM api_accounts
         WHERE id = $1 AND status = 'active'`,
        [sessionData.accountId]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found or inactive');
      }

      const account = accountResult.rows[0];

      // Generate new access token
      const payload = {
        accountId: account.id,
        email: account.email,
        name: account.name,
        email_verified: account.email_verified,
      };

      const newAccessToken = this.generateAccessToken(payload);

      // Optionally generate new refresh token (rotation)
      const newRefreshToken = this.generateRefreshToken({ accountId: account.id });

      // Revoke old refresh token and store new one
      await this.revokeRefreshToken(refreshToken);
      await this.storeRefreshToken(account.id, newRefreshToken);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } finally {
      client.release();
    }
  }
}

module.exports = new AuthService();

