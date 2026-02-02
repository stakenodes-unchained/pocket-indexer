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
   * Quick registration - Email only, no password, instant API access
   * @param {string} email - User email
   * @param {string} name - User name (optional)
   * @param {string} organization - Organization name (optional)
   * @returns {Promise<Object>} { account, token }
   */
  async registerQuick(email, name = null, organization = null) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Get API Consumer role ID
      const roleResult = await client.query(
        `SELECT id FROM roles WHERE slug = 'api-consumer' LIMIT 1`
      );
      const apiConsumerRoleId = roleResult.rows[0]?.id || 5;

      // Create account without password, mark as verified, set type to api_only, assign API Consumer role
      const accountResult = await client.query(
        `INSERT INTO api_accounts (email, password_hash, name, organization, role_id, status, account_type, email_verified, email_verified_at)
         VALUES ($1, NULL, $2, $3, $4, 'active', 'api_only', true, NOW())
         RETURNING id, email, name, organization, role_id, status, account_type, email_verified, created_at`,
        [email, name, organization, apiConsumerRoleId]
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

      console.log(`✅ Quick registration completed for ${email} (API-only account)`);

      return {
        account: {
          id: account.id,
          email: account.email,
          name: account.name,
          organization: account.organization,
          status: account.status,
          account_type: account.account_type,
          email_verified: account.email_verified,
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
   * Full registration - Email + password, requires email verification
   * @param {string} email - User email
   * @param {string} password - User password (required)
   * @param {string} name - User name
   * @param {string} organization - Organization name (optional)
   * @returns {Promise<Object>} { account } - Token will be provided after verification
   */
  async registerFull(email, password, name, organization = null) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Get API Consumer role ID
      const roleResult = await client.query(
        `SELECT id FROM roles WHERE slug = 'api-consumer' LIMIT 1`
      );
      const apiConsumerRoleId = roleResult.rows[0]?.id || 5;

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Create account with password, unverified, set type to full, assign API Consumer role
      // Do NOT generate token yet - token will be sent after email verification
      const accountResult = await client.query(
        `INSERT INTO api_accounts (email, password_hash, name, organization, role_id, status, account_type, email_verified)
         VALUES ($1, $2, $3, $4, $5, 'active', 'full', false)
         RETURNING id, email, name, organization, role_id, status, account_type, email_verified, created_at`,
        [email, passwordHash, name, organization, apiConsumerRoleId]
      );

      const account = accountResult.rows[0];

      await client.query('COMMIT');

      console.log(`✅ Full registration initiated for ${email} (requires email verification)`);

      return {
        account: {
          id: account.id,
          email: account.email,
          name: account.name,
          organization: account.organization,
          status: account.status,
          account_type: account.account_type,
          email_verified: account.email_verified,
          created_at: account.created_at,
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
   * Generate API token for verified account
   * @param {number} accountId - Account ID
   * @returns {Promise<Object>} { token }
   */
  async generateApiTokenForAccount(accountId) {
    const client = await this.pgPool.connect();
    try {
      // Generate default token
      const { token, tokenHash, tokenPrefix } = this.generateToken();
      const tokenName = 'Default Token';

      // Create token
      const tokenResult = await client.query(
        `INSERT INTO api_tokens (account_id, token_hash, token_prefix, name, status)
         VALUES ($1, $2, $3, $4, 'active')
         RETURNING id, token_prefix, name, created_at, expires_at`,
        [accountId, tokenHash, tokenPrefix, tokenName]
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
                a.id as account_id, a.status as account_status, a.role_id, a.email, a.name as account_name
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
        role_id: tokenData.role_id,
        email: tokenData.email,
        account_name: tokenData.account_name,
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
   * Generate a secure verification token
   * @returns {string} 64-character hex token
   */
  generateVerificationToken() {
    // Generate cryptographically secure random token (32 bytes = 64 hex chars)
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Send email verification link
   * @param {number} accountId - Account ID
   * @returns {Promise<Object>} { success, tokenExpiry, email }
   */
  async sendVerificationLink(accountId) {
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

      // Generate new verification token
      const token = this.generateVerificationToken();
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Token expires in 24 hours (configurable)
      const expirySeconds = parseInt(process.env.EMAIL_VERIFICATION_TOKEN_EXPIRY || '86400', 10);
      const expiresAt = new Date(Date.now() + expirySeconds * 1000);

      // Update account with verification token hash
      await client.query(
        `UPDATE api_accounts
         SET email_verification_token_hash = $1,
             email_verification_token_expires_at = $2,
             email_verification_attempts = email_verification_attempts + 1
         WHERE id = $3`,
        [tokenHash, expiresAt, accountId]
      );

      // Send verification email with link
      await emailService.sendVerificationEmail(account.email, token, account.name);

      console.log(`📧 Verification link sent to account ${accountId} (${account.email})`);

      return {
        success: true,
        tokenExpiry: expiresAt,
        email: account.email,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Verify email with token (PUBLIC - no authentication required)
   * @param {string} token - Verification token from email link
   * @returns {Promise<Object>} { success, message, email }
   */
  async verifyEmailWithToken(token) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Hash the token to match against database
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Get account with verification token
      const accountResult = await client.query(
        `SELECT id, email, name, account_type, email_verified, email_verification_token_hash, email_verification_token_expires_at
         FROM api_accounts
         WHERE email_verification_token_hash = $1
         FOR UPDATE`,
        [tokenHash]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Invalid verification token');
      }

      const account = accountResult.rows[0];

      // Check if already verified
      if (account.email_verified) {
        await client.query('COMMIT');
        return {
          success: true,
          message: 'Email already verified',
          email: account.email,
          alreadyVerified: true,
        };
      }

      // Check if token expired
      if (new Date() > new Date(account.email_verification_token_expires_at)) {
        throw new Error('Verification link expired. Please request a new verification email.');
      }

      // Mark email as verified
      await client.query(
        `UPDATE api_accounts
         SET email_verified = true,
             email_verified_at = NOW(),
             email_verification_token_hash = NULL,
             email_verification_token_expires_at = NULL,
             email_verification_attempts = 0
         WHERE id = $1`,
        [account.id]
      );

      // For full accounts, generate API token after verification
      let apiToken = null;
      if (account.account_type === 'full') {
        const { token, tokenHash: newTokenHash, tokenPrefix } = this.generateToken();
        const tokenName = 'Default Token';

        const tokenResult = await client.query(
          `INSERT INTO api_tokens (account_id, token_hash, token_prefix, name, status)
           VALUES ($1, $2, $3, $4, 'active')
           RETURNING id, token_prefix, name, created_at, expires_at`,
          [account.id, newTokenHash, tokenPrefix, tokenName]
        );

        apiToken = {
          id: tokenResult.rows[0].id,
          token: token,
          token_prefix: tokenResult.rows[0].token_prefix,
          name: tokenResult.rows[0].name,
          created_at: tokenResult.rows[0].created_at,
          expires_at: tokenResult.rows[0].expires_at,
        };

        console.log(`🔑 API token generated for account ${account.id} after verification`);
      }

      await client.query('COMMIT');

      // Send welcome email (non-blocking, don't wait)
      emailService.sendWelcomeEmail(account.email, account.name).catch(err => {
        console.error('Error sending welcome email:', err);
      });

      console.log(`✅ Email verified for account ${account.id} (${account.email})`);

      return {
        success: true,
        message: 'Email verified successfully',
        email: account.email,
        apiToken: apiToken, // Will be null for api_only accounts, populated for full accounts
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Resend verification link
   * @param {string} email - User email
   * @returns {Promise<Object>} { success, tokenExpiry, email }
   */
  async resendVerificationLink(email) {
    const client = await this.pgPool.connect();
    try {
      // Get account by email
      const accountResult = await client.query(
        `SELECT id, email, name, email_verified, email_verification_attempts,
                email_verification_token_expires_at
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

      // Check if previous link is still valid (don't send too frequently)
      if (account.email_verification_token_expires_at) {
        const timeLeft = new Date(account.email_verification_token_expires_at) - new Date();
        if (timeLeft > 23 * 60 * 60 * 1000) { // More than 23 hours left
          throw new Error('Verification link already sent. Please check your email or wait a while.');
        }
      }

      // Send new verification link
      return await this.sendVerificationLink(account.id);
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
      // Find account by email (including role_id for rate limiting)
      const accountResult = await client.query(
        `SELECT id, email, password_hash, name, organization, status, email_verified, role_id
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

      // Generate JWT tokens (include role_id for rate limiting)
      const payload = {
        accountId: account.id,
        email: account.email,
        name: account.name,
        email_verified: account.email_verified,
        roleId: account.role_id,
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
          role_id: account.role_id,
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

    // Get fresh account data (including role_id for rate limiting)
    const client = await this.pgPool.connect();
    try {
      const accountResult = await client.query(
        `SELECT id, email, name, organization, status, email_verified, role_id
         FROM api_accounts
         WHERE id = $1 AND status = 'active'`,
        [sessionData.accountId]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found or inactive');
      }

      const account = accountResult.rows[0];

      // Generate new access token (include role_id for rate limiting)
      const payload = {
        accountId: account.id,
        email: account.email,
        name: account.name,
        email_verified: account.email_verified,
        roleId: account.role_id,
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

  /**
   * Request password reset - Send reset link to email
   * @param {string} email - User email
   * @returns {Promise<Object>} { success, email, tokenExpiry }
   */
  async requestPasswordReset(email) {
    const client = await this.pgPool.connect();
    try {
      // Get account by email
      const accountResult = await client.query(
        `SELECT id, email, name, account_type, password_reset_attempts
         FROM api_accounts
         WHERE email = $1 AND status = 'active'`,
        [email]
      );

      // Don't reveal if email exists or not (security best practice)
      if (accountResult.rows.length === 0) {
        // Return success even if account doesn't exist
        return {
          success: true,
          message: 'If an account exists with this email, a password reset link has been sent.',
        };
      }

      const account = accountResult.rows[0];

      // Only full accounts (with passwords) can reset password
      if (account.account_type !== 'full') {
        return {
          success: true,
          message: 'If an account exists with this email, a password reset link has been sent.',
        };
      }

      // Rate limiting: max 5 reset requests per hour
      if (account.password_reset_attempts >= 5) {
        throw new Error('Too many password reset requests. Please try again later.');
      }

      // Generate reset token
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Token expires in 1 hour
      const expirySeconds = parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRY || '3600', 10);
      const expiresAt = new Date(Date.now() + expirySeconds * 1000);

      // Update account with reset token
      await client.query(
        `UPDATE api_accounts
         SET password_reset_token_hash = $1,
             password_reset_token_expires_at = $2,
             password_reset_attempts = password_reset_attempts + 1
         WHERE id = $3`,
        [tokenHash, expiresAt, account.id]
      );

      // Send password reset email
      const emailService = require('./emailService');
      await emailService.sendPasswordResetEmail(account.email, token, account.name);

      console.log(`🔑 Password reset link sent to account ${account.id} (${account.email})`);

      return {
        success: true,
        email: account.email,
        tokenExpiry: expiresAt,
        message: 'Password reset link sent to your email.',
      };
    } finally {
      client.release();
    }
  }

  /**
   * Reset password with token
   * @param {string} token - Reset token from email
   * @param {string} newPassword - New password
   * @returns {Promise<Object>} { success, message }
   */
  async resetPassword(token, newPassword) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Hash token to match against database
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Get account with reset token
      const accountResult = await client.query(
        `SELECT id, email, name, password_reset_token_hash, password_reset_token_expires_at
         FROM api_accounts
         WHERE password_reset_token_hash = $1
         FOR UPDATE`,
        [tokenHash]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Invalid or expired password reset token');
      }

      const account = accountResult.rows[0];

      // Check if token expired
      if (new Date() > new Date(account.password_reset_token_expires_at)) {
        throw new Error('Password reset token expired. Please request a new one.');
      }

      // Hash new password
      const passwordHash = await bcrypt.hash(newPassword, 10);

      // Update password and clear reset token
      await client.query(
        `UPDATE api_accounts
         SET password_hash = $1,
             password_reset_token_hash = NULL,
             password_reset_token_expires_at = NULL,
             password_reset_attempts = 0,
             last_password_change = NOW()
         WHERE id = $2`,
        [passwordHash, account.id]
      );

      // Revoke all JWT sessions for security
      await client.query(
        `UPDATE jwt_sessions
         SET revoked_at = NOW()
         WHERE account_id = $1 AND revoked_at IS NULL`,
        [account.id]
      );

      await client.query('COMMIT');

      console.log(`✅ Password reset successful for account ${account.id} (${account.email})`);

      return {
        success: true,
        message: 'Password reset successfully. Please login with your new password.',
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
   * Change password (requires current password)
   * @param {number} accountId - Account ID
   * @param {string} currentPassword - Current password
   * @param {string} newPassword - New password
   * @returns {Promise<Object>} { success, message }
   */
  async changePassword(accountId, currentPassword, newPassword) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Get account
      const accountResult = await client.query(
        `SELECT id, email, password_hash, account_type
         FROM api_accounts
         WHERE id = $1 AND status = 'active'
         FOR UPDATE`,
        [accountId]
      );

      if (accountResult.rows.length === 0) {
        throw new Error('Account not found');
      }

      const account = accountResult.rows[0];

      // Only full accounts can change password
      if (account.account_type !== 'full') {
        throw new Error('This account type does not support passwords');
      }

      // Verify current password
      const passwordValid = await bcrypt.compare(currentPassword, account.password_hash);
      if (!passwordValid) {
        throw new Error('Current password is incorrect');
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      // Update password
      await client.query(
        `UPDATE api_accounts
         SET password_hash = $1,
             last_password_change = NOW()
         WHERE id = $2`,
        [newPasswordHash, accountId]
      );

      // Revoke all JWT sessions except current one for security
      // (User stays logged in on current device but logged out everywhere else)
      await client.query(
        `UPDATE jwt_sessions
         SET revoked_at = NOW()
         WHERE account_id = $1 AND revoked_at IS NULL`,
        [accountId]
      );

      await client.query('COMMIT');

      console.log(`✅ Password changed for account ${accountId} (${account.email})`);

      return {
        success: true,
        message: 'Password changed successfully. You have been logged out of all other devices.',
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = new AuthService();

