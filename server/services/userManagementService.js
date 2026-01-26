const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const redis = require('../config/redis');

class UserManagementService {
  constructor() {
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

    this.pgPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }

  /**
   * Clear all user-related cache entries
   * Called after any user mutation (create, update, delete, status change)
   */
  async clearUserCache() {
    try {
      // Clear all cached API responses for /api/admin/users endpoints
      const keys = await redis.keys('api:GET:/api/admin/users*');
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`Cleared ${keys.length} user cache entries`);
      }
    } catch (err) {
      console.error('Failed to clear user cache:', err);
      // Don't throw - cache clearing is not critical
    }
  }

  /**
   * Get all users with optional filters
   * @param {Object} filters - { role_id, status, search, limit, offset }
   * @returns {Promise<Array>}
   */
  async getAllUsers(filters = {}) {
    const client = await this.pgPool.connect();
    try {
      const { role_id, status, search, limit = 50, offset = 0 } = filters;

      let query = `
        SELECT
          u.id, u.email, u.name, u.organization,
          u.status, u.email_verified, u.role_id, u.account_type,
          u.created_at, u.last_login_at, u.email_verified_at,
          r.name as role_name, r.slug as role_slug
        FROM api_accounts u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE 1=1
      `;

      const params = [];
      let paramCount = 1;

      if (role_id) {
        query += ` AND u.role_id = $${paramCount++}`;
        params.push(role_id);
      }

      if (status) {
        query += ` AND u.status = $${paramCount++}`;
        params.push(status);
      }

      if (search) {
        query += ` AND (u.email ILIKE $${paramCount} OR u.name ILIKE $${paramCount} OR u.organization ILIKE $${paramCount})`;
        params.push(`%${search}%`);
        paramCount++;
      }

      query += ` ORDER BY u.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount}`;
      params.push(limit, offset);

      const result = await client.query(query, params);

      // Get total count
      let countQuery = `SELECT COUNT(*) FROM api_accounts u WHERE 1=1`;
      const countParams = [];
      let countParamCount = 1;

      if (role_id) {
        countQuery += ` AND u.role_id = $${countParamCount++}`;
        countParams.push(role_id);
      }

      if (status) {
        countQuery += ` AND u.status = $${countParamCount++}`;
        countParams.push(status);
      }

      if (search) {
        countQuery += ` AND (u.email ILIKE $${countParamCount} OR u.name ILIKE $${countParamCount} OR u.organization ILIKE $${countParamCount})`;
        countParams.push(`%${search}%`);
      }

      const countResult = await client.query(countQuery, countParams);
      const total = parseInt(countResult.rows[0].count);

      return {
        users: result.rows,
        total,
        limit,
        offset,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Get user by ID
   * @param {number} userId
   * @returns {Promise<Object>}
   */
  async getUserById(userId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT
          u.id, u.email, u.name, u.organization,
          u.status, u.email_verified, u.role_id, u.account_type,
          u.created_at, u.last_login_at, u.email_verified_at,
          r.name as role_name, r.slug as role_slug
        FROM api_accounts u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Create new user
   * @param {Object} userData - { email, password, name, role_id, organization }
   * @returns {Promise<Object>}
   */
  async createUser(userData) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      const { email, password, name, role_id, organization } = userData;

      // Check if email already exists
      const existingUser = await client.query(
        'SELECT id FROM api_accounts WHERE email = $1',
        [email]
      );

      if (existingUser.rows.length > 0) {
        throw new Error('Email already exists');
      }

      // Hash password if provided
      let password_hash = null;
      let account_type = 'api_only';
      if (password) {
        password_hash = await bcrypt.hash(password, 10);
        account_type = 'full';
      }

      // Create user
      const result = await client.query(
        `INSERT INTO api_accounts
        (email, password_hash, name, organization, role_id, status, account_type, email_verified)
        VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
        RETURNING id, email, name, organization, role_id, status, account_type, email_verified, created_at`,
        [
          email,
          password_hash,
          name,
          organization,
          role_id,
          account_type,
          account_type === 'api_only' // API-only accounts are auto-verified
        ]
      );

      await client.query('COMMIT');

      // Clear user cache after successful creation
      await this.clearUserCache();

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update user
   * @param {number} userId
   * @param {Object} userData - { name, organization, role_id }
   * @returns {Promise<Object>}
   */
  async updateUser(userId, userData) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      const { name, organization, role_id } = userData;

      // Build update query dynamically
      const updates = [];
      const params = [];
      let paramCount = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramCount++}`);
        params.push(name);
      }

      if (organization !== undefined) {
        updates.push(`organization = $${paramCount++}`);
        params.push(organization);
      }

      if (role_id !== undefined) {
        updates.push(`role_id = $${paramCount++}`);
        params.push(role_id);
      }

      if (updates.length === 0) {
        throw new Error('No fields to update');
      }

      params.push(userId);
      const query = `
        UPDATE api_accounts
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
        RETURNING id, email, name, organization, role_id, status, account_type, email_verified, created_at
      `;

      const result = await client.query(query, params);

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      await client.query('COMMIT');

      // Clear user cache after successful update
      await this.clearUserCache();

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete user
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  async deleteUser(userId) {
    const client = await this.pgPool.connect();
    try {
      // Begin transaction
      await client.query('BEGIN');

      const result = await client.query(
        'DELETE FROM api_accounts WHERE id = $1 RETURNING id',
        [userId]
      );

      // Commit transaction
      await client.query('COMMIT');

      // Clear user cache after successful deletion
      await this.clearUserCache();

      return result.rows.length > 0;
    } catch (error) {
      // Rollback on error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update user status
   * @param {number} userId
   * @param {string} status - 'active', 'inactive', 'suspended'
   * @returns {Promise<Object>}
   */
  async updateUserStatus(userId, status) {
    const client = await this.pgPool.connect();
    try {
      // Begin transaction
      await client.query('BEGIN');

      const result = await client.query(
        `UPDATE api_accounts
        SET status = $1
        WHERE id = $2
        RETURNING id, email, name, status`,
        [status, userId]
      );

      if (result.rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('User not found');
      }

      // Commit transaction
      await client.query('COMMIT');

      // Clear user cache after successful status update
      await this.clearUserCache();

      return result.rows[0];
    } catch (error) {
      // Rollback on error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get user activity logs
   * @param {number} userId
   * @param {Object} filters - { limit, offset }
   * @returns {Promise<Array>}
   */
  async getUserActivity(userId, filters = {}) {
    const client = await this.pgPool.connect();
    try {
      const { limit = 50, offset = 0 } = filters;

      const result = await client.query(
        `SELECT
          id, endpoint, method, status_code, response_time_ms,
          ip_address, user_agent, error_message, created_at
        FROM api_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );

      // Get total count
      const countResult = await client.query(
        'SELECT COUNT(*) FROM api_logs WHERE user_id = $1',
        [userId]
      );

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
   * Get user analytics
   * @param {number} userId
   * @param {Object} filters - { start_date, end_date }
   * @returns {Promise<Object>}
   */
  async getUserAnalytics(userId, filters = {}) {
    const client = await this.pgPool.connect();
    try {
      const { start_date, end_date } = filters;

      let query = `
        SELECT
          date, total_requests, successful_requests, failed_requests,
          total_data_transferred, avg_response_time, unique_endpoints_used,
          most_used_endpoint
        FROM user_usage_summary
        WHERE user_id = $1
      `;

      const params = [userId];
      let paramCount = 2;

      if (start_date) {
        query += ` AND date >= $${paramCount++}`;
        params.push(start_date);
      }

      if (end_date) {
        query += ` AND date <= $${paramCount++}`;
        params.push(end_date);
      }

      query += ' ORDER BY date DESC';

      const result = await client.query(query, params);

      // Calculate summary statistics
      const summary = {
        total_requests: 0,
        successful_requests: 0,
        failed_requests: 0,
        total_data_transferred: 0,
        avg_response_time: 0,
      };

      result.rows.forEach(row => {
        summary.total_requests += row.total_requests || 0;
        summary.successful_requests += row.successful_requests || 0;
        summary.failed_requests += row.failed_requests || 0;
        summary.total_data_transferred += parseInt(row.total_data_transferred || 0);
      });

      if (result.rows.length > 0) {
        const totalAvgTime = result.rows.reduce((sum, row) => sum + (row.avg_response_time || 0), 0);
        summary.avg_response_time = Math.round(totalAvgTime / result.rows.length);
      }

      return {
        summary,
        daily_stats: result.rows,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Reset user password (admin action)
   * @param {number} userId
   * @param {string} newPassword
   * @returns {Promise<boolean>}
   */
  async resetUserPassword(userId, newPassword) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      const passwordHash = await bcrypt.hash(newPassword, 10);

      const result = await client.query(
        `UPDATE api_accounts
        SET password_hash = $1, last_password_change = NOW()
        WHERE id = $2 AND account_type = 'full'
        RETURNING id`,
        [passwordHash, userId]
      );

      if (result.rows.length === 0) {
        throw new Error('User not found or does not have password');
      }

      // Revoke all JWT sessions for security
      await client.query(
        `UPDATE jwt_sessions
        SET revoked_at = NOW()
        WHERE account_id = $1 AND revoked_at IS NULL`,
        [userId]
      );

      await client.query('COMMIT');

      // Clear user cache after password reset
      await this.clearUserCache();

      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all roles
   * @returns {Promise<Array>}
   */
  async getAllRoles() {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT
          r.id, r.name, r.slug, r.description, r.is_system_role, r.created_at,
          COUNT(DISTINCT u.id) as user_count
        FROM roles r
        LEFT JOIN api_accounts u ON r.id = u.role_id
        GROUP BY r.id
        ORDER BY r.id`
      );

      return result.rows;
    } finally {
      client.release();
    }
  }

  /**
   * Get role by ID with modules
   * @param {number} roleId
   * @returns {Promise<Object>}
   */
  async getRoleById(roleId) {
    const client = await this.pgPool.connect();
    try {
      const roleResult = await client.query(
        `SELECT id, name, slug, description, is_system_role, created_at
        FROM roles WHERE id = $1`,
        [roleId]
      );

      if (roleResult.rows.length === 0) {
        return null;
      }

      const role = roleResult.rows[0];

      // Get modules with permissions
      const modulesResult = await client.query(
        `SELECT
          m.id, m.name, m.slug, m.description, m.endpoints,
          rma.permissions
        FROM role_module_access rma
        JOIN modules m ON rma.module_id = m.id
        WHERE rma.role_id = $1 AND m.is_active = TRUE`,
        [roleId]
      );

      role.modules = modulesResult.rows;

      return role;
    } finally {
      client.release();
    }
  }

  /**
   * Create new role
   * @param {Object} roleData - { name, slug, description }
   * @returns {Promise<Object>}
   */
  async createRole(roleData) {
    const client = await this.pgPool.connect();
    try {
      const { name, slug, description } = roleData;

      const result = await client.query(
        `INSERT INTO roles (name, slug, description, is_system_role)
        VALUES ($1, $2, $3, FALSE)
        RETURNING id, name, slug, description, is_system_role, created_at`,
        [name, slug, description]
      );

      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Update role
   * @param {number} roleId
   * @param {Object} roleData - { name, description }
   * @returns {Promise<Object>}
   */
  async updateRole(roleId, roleData) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Check if it's a system role
      const checkResult = await client.query(
        'SELECT is_system_role FROM roles WHERE id = $1',
        [roleId]
      );

      if (checkResult.rows.length === 0) {
        throw new Error('Role not found');
      }

      if (checkResult.rows[0].is_system_role) {
        throw new Error('Cannot update system role');
      }

      const { name, description } = roleData;

      const result = await client.query(
        `UPDATE roles
        SET name = COALESCE($1, name), description = COALESCE($2, description)
        WHERE id = $3
        RETURNING id, name, slug, description, is_system_role, created_at`,
        [name, description, roleId]
      );

      await client.query('COMMIT');

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete role
   * @param {number} roleId
   * @returns {Promise<boolean>}
   */
  async deleteRole(roleId) {
    const client = await this.pgPool.connect();
    try {
      await client.query('BEGIN');

      // Check if it's a system role
      const checkResult = await client.query(
        'SELECT is_system_role FROM roles WHERE id = $1',
        [roleId]
      );

      if (checkResult.rows.length === 0) {
        throw new Error('Role not found');
      }

      if (checkResult.rows[0].is_system_role) {
        throw new Error('Cannot delete system role');
      }

      // Check if any users have this role
      const usersResult = await client.query(
        'SELECT COUNT(*) FROM api_accounts WHERE role_id = $1',
        [roleId]
      );

      if (parseInt(usersResult.rows[0].count) > 0) {
        throw new Error('Cannot delete role with assigned users');
      }

      const result = await client.query(
        'DELETE FROM roles WHERE id = $1 RETURNING id',
        [roleId]
      );

      await client.query('COMMIT');

      return result.rows.length > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Assign module to role
   * @param {number} roleId
   * @param {number} moduleId
   * @param {Object} permissions - { read, write, delete, admin }
   * @returns {Promise<Object>}
   */
  async assignModuleToRole(roleId, moduleId, permissions) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `INSERT INTO role_module_access (role_id, module_id, permissions)
        VALUES ($1, $2, $3)
        ON CONFLICT (role_id, module_id)
        DO UPDATE SET permissions = $3
        RETURNING id, role_id, module_id, permissions`,
        [roleId, moduleId, JSON.stringify(permissions)]
      );

      return result.rows[0];
    } finally {
      client.release();
    }
  }

  /**
   * Remove module from role
   * @param {number} roleId
   * @param {number} moduleId
   * @returns {Promise<boolean>}
   */
  async removeModuleFromRole(roleId, moduleId) {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        'DELETE FROM role_module_access WHERE role_id = $1 AND module_id = $2 RETURNING id',
        [roleId, moduleId]
      );

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Get all modules
   * @returns {Promise<Array>}
   */
  async getAllModules() {
    const client = await this.pgPool.connect();
    try {
      const result = await client.query(
        `SELECT id, name, slug, description, endpoints, is_active, created_at
        FROM modules
        ORDER BY name`
      );

      return result.rows;
    } finally {
      client.release();
    }
  }
}

module.exports = new UserManagementService();
