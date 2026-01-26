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

/**
 * API Logging Middleware
 * Logs all API requests to the database for analytics and audit purposes
 */
const apiLogger = () => {
  return async (req, res, next) => {
    // Skip logging for certain endpoints to avoid noise
    const skipPaths = [
      '/health',
      '/favicon.ico',
      '/robots.txt',
    ];

    const shouldSkip = skipPaths.some(path => req.path.includes(path));
    if (shouldSkip) {
      return next();
    }

    const startTime = Date.now();

    // Get request info
    const userId = req.user?.accountId || null;
    const endpoint = req.path;
    const method = req.method;
    const ipAddress = req.ip || req.connection.remoteAddress || null;
    const userAgent = req.headers['user-agent'] || null;

    // Calculate request body size
    let requestBodySize = 0;
    if (req.body) {
      try {
        requestBodySize = JSON.stringify(req.body).length;
      } catch (e) {
        requestBodySize = 0;
      }
    }

    // Store original methods
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalEnd = res.end.bind(res);

    let responseBody = null;
    let responseBodySize = 0;

    // Override res.json to capture response
    res.json = function(data) {
      responseBody = data;
      try {
        responseBodySize = JSON.stringify(data).length;
      } catch (e) {
        responseBodySize = 0;
      }
      return originalJson(data);
    };

    // Override res.send to capture response
    res.send = function(data) {
      if (data && typeof data !== 'string') {
        try {
          responseBodySize = JSON.stringify(data).length;
        } catch (e) {
          responseBodySize = typeof data === 'string' ? data.length : 0;
        }
      } else if (typeof data === 'string') {
        responseBodySize = data.length;
      }
      return originalSend(data);
    };

    // Log on response finish
    res.on('finish', async () => {
      try {
        const responseTime = Date.now() - startTime;
        const statusCode = res.statusCode;

        // Determine if it's an error response
        let errorMessage = null;
        if (statusCode >= 400) {
          if (responseBody && responseBody.error) {
            errorMessage = responseBody.error;
          } else if (responseBody && responseBody.message) {
            errorMessage = responseBody.message;
          } else {
            errorMessage = `HTTP ${statusCode}`;
          }
        }

        // Only log if user is authenticated (has userId) or if it's an auth endpoint
        const isAuthEndpoint = endpoint.includes('/auth/');
        if (userId || isAuthEndpoint) {
          // Insert log asynchronously (don't wait)
          insertLog({
            userId,
            endpoint,
            method,
            statusCode,
            responseTimeMs: responseTime,
            requestBodySize,
            responseBodySize,
            ipAddress,
            userAgent,
            errorMessage,
          }).catch(err => {
            console.error('Error inserting API log:', err.message);
          });
        }
      } catch (err) {
        console.error('Error in API logger:', err.message);
      }
    });

    next();
  };
};

/**
 * Insert log entry into database
 * @param {Object} logData - Log data
 */
async function insertLog(logData) {
  const client = await pgPool.connect();
  try {
    await client.query(
      `INSERT INTO api_logs (
        user_id, endpoint, method, status_code, response_time_ms,
        request_body_size, response_body_size, ip_address, user_agent, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        logData.userId,
        logData.endpoint,
        logData.method,
        logData.statusCode,
        logData.responseTimeMs,
        logData.requestBodySize,
        logData.responseBodySize,
        logData.ipAddress,
        logData.userAgent,
        logData.errorMessage,
      ]
    );
  } finally {
    client.release();
  }
}

/**
 * Get logs for a specific user
 * @param {number} userId - User ID
 * @param {Object} options - Options (limit, offset)
 * @returns {Promise<Object>}
 */
async function getUserLogs(userId, options = {}) {
  const { limit = 50, offset = 0 } = options;
  const client = await pgPool.connect();

  try {
    const result = await client.query(
      `SELECT
        id, endpoint, method, status_code, response_time_ms,
        request_body_size, response_body_size, ip_address, user_agent,
        error_message, created_at
      FROM api_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

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
 * Aggregate daily usage statistics
 * This should be run as a cron job daily
 */
async function aggregateDailyUsage(date = null) {
  const client = await pgPool.connect();

  try {
    await client.query('BEGIN');

    // Use yesterday's date if not specified
    const targetDate = date || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateStr = targetDate.toISOString().split('T')[0];

    console.log(`📊 Aggregating usage statistics for ${dateStr}...`);

    // Aggregate data for each user who had activity on the target date
    const result = await client.query(
      `INSERT INTO user_usage_summary (
        user_id, date, total_requests, successful_requests, failed_requests,
        total_data_transferred, avg_response_time, unique_endpoints_used, most_used_endpoint
      )
      SELECT
        user_id,
        DATE($1) as date,
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE status_code < 400) as successful_requests,
        COUNT(*) FILTER (WHERE status_code >= 400) as failed_requests,
        SUM(COALESCE(request_body_size, 0) + COALESCE(response_body_size, 0)) as total_data_transferred,
        AVG(response_time_ms)::INTEGER as avg_response_time,
        COUNT(DISTINCT endpoint) as unique_endpoints_used,
        (
          SELECT endpoint
          FROM api_logs l2
          WHERE l2.user_id = api_logs.user_id
            AND DATE(l2.created_at) = DATE($1)
          GROUP BY endpoint
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) as most_used_endpoint
      FROM api_logs
      WHERE DATE(created_at) = DATE($1)
        AND user_id IS NOT NULL
      GROUP BY user_id
      ON CONFLICT (user_id, date)
      DO UPDATE SET
        total_requests = EXCLUDED.total_requests,
        successful_requests = EXCLUDED.successful_requests,
        failed_requests = EXCLUDED.failed_requests,
        total_data_transferred = EXCLUDED.total_data_transferred,
        avg_response_time = EXCLUDED.avg_response_time,
        unique_endpoints_used = EXCLUDED.unique_endpoints_used,
        most_used_endpoint = EXCLUDED.most_used_endpoint,
        updated_at = NOW()
      RETURNING user_id`,
      [dateStr]
    );

    await client.query('COMMIT');

    console.log(`✅ Aggregated usage for ${result.rows.length} users on ${dateStr}`);

    return {
      date: dateStr,
      usersAggregated: result.rows.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error aggregating daily usage:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get analytics for a user
 * @param {number} userId - User ID
 * @param {Object} options - Options (start_date, end_date)
 * @returns {Promise<Object>}
 */
async function getUserAnalytics(userId, options = {}) {
  const { start_date, end_date } = options;
  const client = await pgPool.connect();

  try {
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

module.exports = {
  apiLogger,
  getUserLogs,
  aggregateDailyUsage,
  getUserAnalytics,
};
