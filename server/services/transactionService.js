const redis = require('../config/redis');
const REDIS_CACHE_TX_DETAIL = (process.env.REDIS_CACHE_TX_DETAIL || 'false') === 'true';
const { getRpcEndpoints } = require('../config/rpc');
const { Pool } = require('pg');
const configLoader = require('./configLoader');

class TransactionService {
  constructor() {
    this.rpcEndpoints = getRpcEndpoints();
    
    // PostgreSQL connection pool for concurrent request handling
    this.pgPool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      // Connection pool settings for performance - reduced defaults to save memory
      max: parseInt(process.env.DB_POOL_SIZE || '10', 10), // Max connections in pool (reduced from 20 to 10)
      min: parseInt(process.env.DB_POOL_MIN || '2', 10),   // Min connections to maintain
      idleTimeoutMillis: 30000,  // Close idle clients after 30 seconds
      connectionTimeoutMillis: 10000, // 10 second connection timeout
      statement_timeout: 120000, // 120 second query timeout (increased for large datasets, but optimization is preferred)
    });
    
    // Handle pool errors
    this.pgPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err);
    });
  }

  /**
   * Get the shared connection pool. Does not open a new connection.
   * Use pgClient or this method when you need to run queries.
   */
  async connectDB() {
    return this.pgPool;
  }

  /** Shared pg Pool — reuse for all queries; pool manages connections. */
  get pgClient() {
    return this.pgPool;
  }

  getAvailableChains() {
    return this.rpcEndpoints.map(rpc => rpc.name);
  }

  /**
   * Get a paginated list of transactions for a specific chain
   * 
   * @param {Object} options Query options
   * @param {string} options.chain Chain name (defaults to first available chain)
   * @param {number} options.page Page number (1-based)
   * @param {number} options.limit Items per page
   * @returns {Promise<Object>} Transactions and pagination metadata
   */
  async getTransactions({ chain, page = 1, limit = 10 } = {}) {
    // Use the first available chain if none specified
    const chainName = chain || (this.rpcEndpoints.length > 0 ? this.rpcEndpoints[0].name : null);
    
    if (!chainName) {
      throw new Error('No chain name provided and no default chains available');
    }
    
    // Convert to numbers
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const offset = (pageNum - 1) * limitNum;
    
    try {
      // await this.connectDB();
      
      // Get total count for the chain
      const countResult = await this.pgClient.query(
        'SELECT COUNT(*) as total FROM transactions WHERE chain = $1',
        [chainName]
      );
      const totalCount = parseInt(countResult.rows[0].total, 10);
      
      if (totalCount === 0) {
        return {
          data: [],
          meta: {
            total: 0,
            page: pageNum,
            limit: limitNum,
            totalPages: 0,
          }
        };
      }
      
      // Get transactions for the page (ordered by timestamp descending)
      // Extract block_height from tx_data JSONB to avoid JOIN with blocks table
      const transactionsResult = await this.pgClient.query(
        `SELECT 
          t.id, 
          t.hash, 
          t.block_id, 
          t.sender, 
          t.recipient, 
          t.amount, 
          t.fee, 
          t.memo, 
          t.type, 
          t.status, 
          t.chain, 
          t.timestamp,
          (t.tx_data->'tx_response'->>'height')::bigint as block_height
        FROM transactions as t
        WHERE t.chain = $1 
        ORDER BY t.timestamp DESC 
        LIMIT $2 OFFSET $3`,
        [chainName, limitNum, offset]
      );
      
      const transactions = transactionsResult.rows.map(tx => ({
        ...tx,
        chain: chainName,
        // Parse JSON fields if they exist
        tx_data: tx.tx_data ? (typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data) : null,
        // block_height is already extracted from JSONB (may be null if not present)
        block_height: tx.block_height ? parseInt(tx.block_height, 10) : null
      }));
      
      return {
        data: transactions,
        meta: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalCount / limitNum),
        }
      };
    } catch (error) {
      console.error(`Error getting transactions for chain ${chainName}:`, error);
      throw new Error(`Failed to retrieve transactions: ${error.message}`);
    }
  }

  /**
   * Get a transaction by its hash for a specific chain
   * 
   * @param {string} transactionId Transaction hash
   * @param {string} chain Chain name (optional, will search all chains if not provided)
   * @returns {Promise<Object>} Transaction data
   */
  async getTransactionById(transactionId, chain) {
    try {
      // await this.connectDB();
      // Optional quick-hit from Redis hash (lightweight) if enabled
      if (REDIS_CACHE_TX_DETAIL) {
        const key = `tx:${chain || ''}:${transactionId}`;
        try {
          const h = await redis.hgetall(key);
          if (h && Object.keys(h).length) {
            return { data: h };
          }
        } catch (_) {}
      }
      
      if (chain) {
        // If chain is specified, look only in that chain
        const result = await this.pgClient.query(
          'SELECT * FROM transactions WHERE hash = $1 AND chain = $2',
          [transactionId, chain]
        );
        
        if (result.rows.length === 0) {
          return { data: null };
        }
        
        const tx = result.rows[0];
        return {
          data: {
            ...tx,
            tx_data: tx.tx_data ? (typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data) : null
          }
        };
      } else {
        // If no chain specified, search across all chains
        const result = await this.pgClient.query(
          'SELECT * FROM transactions WHERE hash = $1',
          [transactionId]
        );
        
        if (result.rows.length === 0) {
          return { data: null };
        }
        
        const tx = result.rows[0];
        return {
          data: {
            ...tx,
            tx_data: tx.tx_data ? (typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data) : null
          }
        };
      }
    } catch (error) {
      console.error(`Error getting transaction ${transactionId}:`, error);
      throw new Error(`Failed to retrieve transaction: ${error.message}`);
    }
  }

  /**
   * Get transaction count for a specific chain
   * 
   * @param {string} chain Chain name (optional)
   * @returns {Promise<Object>} Count data
   */
  async getTransactionCount(chain) {
    try {
      // await this.connectDB();
      
      if (chain) {
        // Get the current total count first
        const totalCountResult = await this.pgClient.query(
          'SELECT COUNT(*) as total FROM transactions WHERE chain = $1',
          [chain]
        );
        const totalCount = parseInt(totalCountResult.rows[0].total, 10);
        
        // Always show the last 30 days for consistent frontend graphing
        const now = new Date();
        const days = 30;
        const labels = [];
        const counts = [];
        
        // Generate the date labels for the last 30 days
        for (let i = days - 1; i >= 0; i--) {
          const date = new Date(now);
          date.setDate(date.getDate() - i);
          labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        }
        
        // Get daily counts for the last 30 days
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - days);
        
        console.log(`Querying from ${startDate.toISOString()} to ${now.toISOString()}`);
        
        const dailyCountsResult = await this.pgClient.query(
          `SELECT DATE(timestamp) as date, COUNT(*) as count 
           FROM transactions 
           WHERE chain = $1 AND timestamp >= $2 
           GROUP BY DATE(timestamp) 
           ORDER BY date`,
          [chain, startDate.toISOString()]
        );
        
        console.log(`Query returned ${dailyCountsResult.rows.length} rows`);
        
        // Create a map of date to count
        const dailyCountsMap = new Map();
        dailyCountsResult.rows.forEach(row => {
          // Convert database date to YYYY-MM-DD string format
          const dateStr = row.date.toISOString().split('T')[0];
          dailyCountsMap.set(dateStr, parseInt(row.count, 10));
          console.log(`Database date: ${row.date}, converted to: ${dateStr}, count: ${row.count}`);
        });
        
        console.log(`Map size: ${dailyCountsMap.size}`);
        console.log(`Map keys:`, Array.from(dailyCountsMap.keys()));
        
        // Fill in the counts array with actual data or 0 for missing dates
        for (let i = days - 1; i >= 0; i--) {
          // Create date in UTC to match database timezone
          const utcDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
          const dateKey = utcDate.toISOString().split('T')[0];
          const count = dailyCountsMap.get(dateKey) || 0;
          console.log(`Generated date: ${dateKey}, count: ${count}`);
          counts.push(count);
        }
        
        return { 
          data: {
            labels,
            counts,
            total: totalCount
          }
        };
      } else {
        // Get counts for all chains
        const chains = this.getAvailableChains();
        let totalCount = 0;
        
        for (const chainName of chains) {
          const countResult = await this.pgClient.query(
            'SELECT COUNT(*) as total FROM transactions WHERE chain = $1',
            [chainName]
          );
          totalCount += parseInt(countResult.rows[0].total, 10);
        }
        
        return { data: totalCount };
      }
    } catch (error) {
      console.error('Error getting transaction count:', error);
      throw new Error(`Failed to get transaction count: ${error.message}`);
    }
  }

  /**
   * Get statistics for all chains
   * 
   * @returns {Promise<Object>} Chain statistics
   */
  async getChainStats() {
    try {
      // await this.connectDB();
      const chains = this.getAvailableChains();
      const stats = {};
      
      for (const chainName of chains) {
        // Get transaction count
        const txCountResult = await this.pgClient.query(
          'SELECT COUNT(*) as total FROM transactions WHERE chain = $1',
          [chainName]
        );
        const txCount = parseInt(txCountResult.rows[0].total, 10);
        
        // Get latest block height from blocks table for this chain
        const latestHeightResult = await this.pgClient.query(
          'SELECT MAX(height) as max_height FROM blocks WHERE chain = $1',
          [chainName]
        );
        const latestHeight = latestHeightResult.rows[0].max_height || 0;
        
        // Get processed height (latest transaction timestamp converted to approximate height)
        const processedHeightResult = await this.pgClient.query(
          'SELECT MAX(b.height) as latest_height FROM transactions t JOIN blocks b ON t.block_id = b.id WHERE t.chain = $1 AND b.chain = $1',
          [chainName]
        );
        const processedHeight = processedHeightResult.rows[0].latest_height || 0;
        
        stats[chainName] = {
          txCount,
          latestHeight: parseInt(latestHeight, 10),
          processedHeight: parseInt(processedHeight, 10),
          progress: latestHeight > 0 
            ? ((parseInt(processedHeight, 10) / parseInt(latestHeight, 10)) * 100).toFixed(2) + '%'
            : '0%'
        };
      }
      
      return { data: stats };
    } catch (error) {
      console.error('Error getting chain stats:', error);
      throw new Error(`Failed to get chain statistics: ${error.message}`);
    }
  }

  /**
   * Get historical transaction counts by day for a specific chain
   * 
   * @param {Object} options Query options
   * @param {string} options.chain Chain name (defaults to first available chain)
   * @param {number} options.days Number of days to return data for (default: 30)
   * @returns {Promise<Object>} Historical transaction counts by day
   */
  async getHistoricalTransactionCounts({ chain, days = 30 } = {}) {
    // Use the first available chain if none specified
    const chainName = chain || (this.rpcEndpoints.length > 0 ? this.rpcEndpoints[0].name : null);
    
    if (!chainName) {
      throw new Error('No chain name provided and no default chains available');
    }
    
    // Convert to number
    const daysNum = parseInt(days, 10);
    
    try {
      // await this.connectDB();
      
      // Check if we have cached data first
      const cacheKey = `history:${chainName}:${daysNum}`;
      const cachedData = await redis.get(cacheKey);
      
      if (cachedData) {
        try {
          const parsedData = JSON.parse(cachedData);
          console.log(`Using cached historical data for ${chainName} (${daysNum} days)`);
          return parsedData;
        } catch (err) {
          console.error('Error parsing cached history data:', err);
          // Continue with regenerating the data
        }
      }
      
      // Get daily counts for the specified period
      const now = new Date();
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - daysNum);
      
      const dailyCountsResult = await this.pgClient.query(
        `SELECT DATE(timestamp) as date, COUNT(*) as count 
         FROM transactions 
         WHERE chain = $1 AND timestamp >= $2 
         GROUP BY DATE(timestamp) 
         ORDER BY date`,
        [chainName, startDate.toISOString()]
      );
      
      // Generate date labels for the period
      const labels = [];
      const counts = [];
      
      for (let i = daysNum - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        
        // Format date as "MMM D" (e.g., "Feb 3")
        labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        
        // Find count for this date
        const dayData = dailyCountsResult.rows.find(row => row.date === dateKey);
        counts.push(dayData ? parseInt(dayData.count, 10) : 0);
      }
      
      const result = {
        data: {
          labels,
          counts
        }
      };
      
      // Cache the result
      const cacheTTL = configLoader.get('HISTORY_CACHE_TTL', 3600); // Default 1 hour
      await redis.set(cacheKey, JSON.stringify(result), 'EX', cacheTTL);
      console.log(`Cached historical data for ${chainName} (${daysNum} days) with TTL of ${cacheTTL} seconds`);
      
      return result;
    } catch (error) {
      console.error(`Error getting historical transaction counts for chain ${chainName}:`, error);
      throw new Error(`Failed to retrieve historical transaction counts: ${error.message}`);
    }
  }

  /**
   * Get transaction statistics by type for a specific chain
   * 
   * @param {string} chain Chain name (optional, defaults to first available chain)
   * @returns {Promise<Object>} Transaction statistics by type
   */
  async getTransactionStatsByType(chain) {
    // Use the first available chain if none specified
    const chainName = chain || (this.rpcEndpoints.length > 0 ? this.rpcEndpoints[0].name : null);
    
    if (!chainName) {
      throw new Error('No chain name provided and no default chains available');
    }
    
    try {
      // await this.connectDB();
      
      // Get transaction counts by type
      const statsResult = await this.pgClient.query(
        `SELECT type, COUNT(*) as count 
         FROM transactions 
         WHERE chain = $1 
         GROUP BY type 
         ORDER BY count DESC`,
        [chainName]
      );
      
      const stats = {
        total: 0,
        byType: {}
      };
      
      statsResult.rows.forEach(row => {
        const count = parseInt(row.count, 10);
        stats.byType[row.type] = count;
        stats.total += count;
      });
      
      return { data: stats };
    } catch (error) {
      console.error(`Error getting transaction stats by type for chain ${chainName}:`, error);
      throw new Error(`Failed to retrieve transaction statistics: ${error.message}`);
    }
  }

  /**
   * Get transactions with comprehensive filtering and sorting
   * 
   * Optimized for large datasets (10M+ rows):
   * - Uses "has_more" approach: fetches limit+1 rows to determine next page
   * - Always returns pagination metadata including total count
   * 
   * @param {Object} options Query options
   * @param {string|Array<string>} options.address or options.addresses - Single address, comma-separated, or array of addresses
   * @param {string} options.type - Transaction type filter
   * @param {string} options.status - Transaction status filter
   * @param {string} options.chain - Chain filter
   * @param {string} options.start_date - Start date (ISO string)
   * @param {string} options.end_date - End date (ISO string)
   * @param {number} options.min_amount - Minimum amount filter
   * @param {number} options.max_amount - Maximum amount filter
   * @param {number} options.page - Page number (1-based, default: 1)
   * @param {number} options.limit - Items per page (default: 10)
   * @param {string} options.sort_by - Field to sort by (timestamp, amount, fee, block_height, type, status, default: timestamp)
   * @param {string} options.sort_order - Sort order (asc, desc, default: desc)
   * @returns {Promise<Object>} Transactions and pagination metadata with has_more flag
   */
  async getTransactionsWithFilters(options = {}) {
    const {
      address,
      addresses,
      type,
      status,
      chain,
      start_date,
      end_date,
      min_amount,
      max_amount,
      page = 1,
      limit = 10,
      sort_by = 'timestamp',
      sort_order = 'desc'
    } = options;

    // Convert to numbers
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = Math.min(parseInt(limit, 10) || 10, 1000); // Cap at 1000
    const offset = (pageNum - 1) * limitNum;

    // Validate sort_by
    const validSortFields = ['timestamp', 'amount', 'fee', 'block_height', 'type', 'status'];
    const sortField = validSortFields.includes(sort_by) ? sort_by : 'timestamp';
    const sortDirection = sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    try {
      // await this.connectDB();

      const conditions = [];
      const values = [];
      let idx = 1;

      // Chain filter
      if (chain) {
        conditions.push(`t.chain = $${idx}`);
        values.push(chain);
        idx++;
      }

      // Address filter - handle single address, comma-separated, or array
      const addressList = [];
      if (address) {
        if (typeof address === 'string' && address.includes(',')) {
          addressList.push(...address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0));
        } else {
          addressList.push(address);
        }
      }
      if (addresses) {
        if (Array.isArray(addresses)) {
          addressList.push(...addresses);
        } else if (typeof addresses === 'string' && addresses.includes(',')) {
          addressList.push(...addresses.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0));
        } else {
          addressList.push(addresses);
        }
      }

      if (addressList.length > 0) {
        // Remove duplicates
        const uniqueAddresses = [...new Set(addressList)];
        
        // Build address conditions: use addresses array column for fast queries
        // Fallback to sender/recipient columns for backward compatibility
        const addressConditions = [];
        
        
        
        // Primary: Also check sender and recipient columns for backward compatibility
        // This ensures we catch transactions that might not have addresses populated yet
        if (uniqueAddresses.length === 1) {
          addressConditions.push(`(t.sender = $${idx} OR t.recipient = $${idx})`);
          values.push(uniqueAddresses[0]);
          idx++;
        } else {
          const placeholders = uniqueAddresses.map((_, i) => `$${idx + i}`).join(', ');
          addressConditions.push(`(t.sender IN (${placeholders}) OR t.recipient IN (${placeholders}))`);
          values.push(...uniqueAddresses, ...uniqueAddresses);
          idx += uniqueAddresses.length * 2;
        }

        // Fallback: Use addresses array column with array overlap operator (&&)
        // This is much faster than JSONB searches and uses the GIN index
        // Handle NULL addresses with COALESCE to empty array
        if (uniqueAddresses.length === 1) {
          // Single address: use array containment operator (@>)
          addressConditions.push(`(COALESCE(t.addresses, ARRAY[]::TEXT[]) @> ARRAY[$${idx}])`);
          values.push(uniqueAddresses[0]);
          idx++;
        } else {
          // Multiple addresses: use array overlap operator (&&)
          const placeholders = uniqueAddresses.map((_, i) => `$${idx + i}`).join(', ');
          addressConditions.push(`(COALESCE(t.addresses, ARRAY[]::TEXT[]) && ARRAY[${placeholders}])`);
          values.push(...uniqueAddresses);
          idx += uniqueAddresses.length;
        }
        conditions.push(`(${addressConditions.join(' OR ')})`);
      }

      // Type filter
      if (type) {
        conditions.push(`t.type = $${idx}`);
        values.push(type);
        idx++;
      }

      // Status filter
      if (status) {
        conditions.push(`t.status = $${idx}`);
        values.push(status);
        idx++;
      }

      // Date range filters
      if (start_date) {
        conditions.push(`t.timestamp >= $${idx}::timestamp`);
        values.push(start_date);
        idx++;
      }
      if (end_date) {
        conditions.push(`t.timestamp <= $${idx}::timestamp`);
        values.push(end_date);
        idx++;
      }

      // Amount range filters
      if (min_amount !== undefined && min_amount !== null) {
        conditions.push(`t.amount >= $${idx}::numeric`);
        values.push(parseFloat(min_amount));
        idx++;
      }
      if (max_amount !== undefined && max_amount !== null) {
        conditions.push(`t.amount <= $${idx}::numeric`);
        values.push(parseFloat(max_amount));
        idx++;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      // Build ORDER BY clause - optimize for index usage
      // Use block_height column if available (much faster than JSONB extraction)
      let orderByClause;
      let blockHeightSelect;
      
      // CRITICAL OPTIMIZATION: Avoid expensive JSONB extraction when possible
      // Use CASE WHEN instead of COALESCE to avoid evaluating JSONB expression when block_height is NOT NULL
      // PostgreSQL's COALESCE may still evaluate both sides, but CASE WHEN guarantees short-circuit evaluation
      if (sortField === 'block_height') {
        // When sorting by block_height, we need to extract from JSONB for NULL values
        // Use CASE WHEN to avoid JSONB extraction when block_height column has a value
        orderByClause = `ORDER BY CASE WHEN t.block_height IS NOT NULL THEN t.block_height ELSE (t.tx_data->'tx_response'->>'height')::bigint END ${sortDirection}`;
        blockHeightSelect = `CASE WHEN t.block_height IS NOT NULL THEN t.block_height ELSE (t.tx_data->'tx_response'->>'height')::bigint END as block_height`;
      } else {
        // When NOT sorting by block_height, prefer column value and only extract from JSONB for NULL values
        // This avoids expensive JSONB operations for the majority of rows that have block_height populated
        orderByClause = `ORDER BY t.${sortField} ${sortDirection}`;
        // Only extract from JSONB when block_height is NULL - much faster for populated columns
        blockHeightSelect = `CASE WHEN t.block_height IS NOT NULL THEN t.block_height ELSE (t.tx_data->'tx_response'->>'height')::bigint END as block_height`;
      }

      // OPTIMIZATION: For large datasets (10M+ rows), run COUNT and SELECT in parallel
      // This reduces total response time significantly
      const fetchLimit = limitNum + 1; // Fetch one extra to check for next page
      
      // Build optimized query - use covering index when possible
      // The covering index (chain, timestamp DESC) INCLUDE (id, hash, ...) enables index-only scans
      // CRITICAL: Only select block_height if we actually need it - but we always need it for API response
      const listSql = `SELECT 
        t.id, 
        t.hash, 
        t.block_id, 
        t.sender, 
        t.recipient, 
        t.amount, 
        t.fee, 
        t.memo, 
        t.type, 
        t.status, 
        t.chain, 
        t.timestamp,
        ${blockHeightSelect}
      FROM transactions t
      ${where}
      ${orderByClause}
      LIMIT $${idx} OFFSET $${idx + 1}`;

      const listParams = [...values, fetchLimit, offset];

      // OPTIMIZATION: COUNT query can be slow on large filtered datasets
      // Consider using approximate count for very large result sets, but for now keep exact count
      // The WHERE clause is shared, so PostgreSQL can reuse query plan
      const countSql = `SELECT COUNT(*) AS total FROM transactions t ${where}`;
      
      // Count failed transactions in the last 24 hours (independent of current filters)
      const failedLast24hSql = `SELECT COUNT(*) AS failed_count 
                                FROM transactions t 
                                WHERE t.status = 'failed' 
                                AND t.timestamp >= NOW() - INTERVAL '24 hours'`;
      
      const queryPromises = [
        this.pgClient.query(listSql, listParams),
        this.pgClient.query(countSql, values).catch(err => {
          // If COUNT fails, return null to indicate it wasn't computed
          console.warn('COUNT query failed:', err.message);
          return { rows: [{ total: null }] };
        }),
        this.pgClient.query(failedLast24hSql, []).catch(err => {
          // If failed count query fails, return 0
          console.warn('Failed transactions count query failed:', err.message);
          return { rows: [{ failed_count: '0' }] };
        })
      ];
      
      // Execute all queries in parallel
      const [listRes, countRes, failedRes] = await Promise.all(queryPromises).catch(err => {
        console.error('Error executing queries:', err.message);
        throw new Error(`Failed to retrieve transactions: ${err.message}`);
      });
      
      // Determine if there's a next page by checking if we got more than requested
      const hasMore = listRes.rows.length > limitNum;
      const transactions = listRes.rows.slice(0, limitNum); // Return only requested amount
      
      // Get total count from parallel query result
      const total = countRes.rows[0].total !== null ? parseInt(countRes.rows[0].total, 10) : 0;
      const totalPages = Math.ceil(total / limitNum);
      
      // Get failed transactions count in last 24 hours
      const failedLast24h = parseInt(failedRes.rows[0]?.failed_count || '0', 10);
      
      // If no results and we're on page 1, return empty
      if (transactions.length === 0 && pageNum === 1) {
        return {
          data: [],
          meta: {
            total: 0,
            page: pageNum,
            limit: limitNum,
            totalPages: 0,
            has_more: false,
            failedLast24h: failedLast24h
          }
        };
      }

      const formattedTransactions = transactions.map(tx => ({
        ...tx,
        // Parse JSON fields if they exist
        tx_data: tx.tx_data ? (typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data) : null,
        // block_height is already computed (from column or JSONB extraction)
        block_height: tx.block_height ? (typeof tx.block_height === 'string' ? parseInt(tx.block_height, 10) : tx.block_height) : null
      }));

      return {
        data: formattedTransactions,
        meta: {
          total: total,
          page: pageNum,
          limit: limitNum,
          totalPages: totalPages,
          has_more: hasMore,
          failedLast24h: failedLast24h
        }
      };
    } catch (error) {
      console.error('Error getting transactions with filters:', error);
      throw new Error(`Failed to retrieve transactions: ${error.message}`);
    }
  }

  /**
   * Extract filter parameters from request (supports both GET query and POST body)
   * 
   * @param {Object} req Express request object
   * @returns {Object} Extracted filter parameters
   */
  extractTransactionFilters(req) {
    // For POST requests, use body; for GET requests, use query
    const source = req.method === 'POST' ? req.body : req.query;
    return {
      address: source.address,
      addresses: source.addresses,
      type: source.type,
      status: source.status,
      chain: source.chain,
      start_date: source.start_date,
      end_date: source.end_date,
      min_amount: source.min_amount,
      max_amount: source.max_amount,
      page: source.page,
      limit: source.limit,
      sort_by: source.sort_by,
      sort_order: source.sort_order
    };
  }

  /**
   * Extract stats filter parameters from request (supports both GET query and POST body)
   * 
   * @param {Object} req Express request object
   * @returns {Object} Extracted filter parameters (excluding pagination/sorting)
   */
  extractStatsFilters(req) {
    // For POST requests, use body; for GET requests, use query
    const source = req.method === 'POST' ? req.body : req.query;
    return {
      address: source.address,
      addresses: source.addresses,
      type: source.type,
      status: source.status,
      chain: source.chain,
      start_date: source.start_date,
      end_date: source.end_date,
      min_amount: source.min_amount,
      max_amount: source.max_amount
    };
  }

  /**
   * Get transaction statistics based on filters
   * 
   * @param {Object} filters Filter options (same as getTransactionsWithFilters)
   * @returns {Promise<Object>} Transaction statistics
   */
  async getTransactionStats(filters = {}) {
    const {
      address,
      addresses,
      type,
      status,
      chain,
      start_date,
      end_date,
      min_amount,
      max_amount
    } = filters;

    try {
      // await this.connectDB();

      const conditions = [];
      const values = [];
      let idx = 1;

      // Build same WHERE conditions as getTransactionsWithFilters
      if (chain) {
        conditions.push(`t.chain = $${idx}`);
        values.push(chain);
        idx++;
      }

      // Address filter - same logic as getTransactionsWithFilters
      const addressList = [];
      if (address) {
        if (typeof address === 'string' && address.includes(',')) {
          addressList.push(...address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0));
        } else {
          addressList.push(address);
        }
      }
      if (addresses) {
        if (Array.isArray(addresses)) {
          addressList.push(...addresses);
        } else if (typeof addresses === 'string' && addresses.includes(',')) {
          addressList.push(...addresses.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0));
        } else {
          addressList.push(addresses);
        }
      }

      if (addressList.length > 0) {
        const uniqueAddresses = [...new Set(addressList)];
        const addressConditions = [];
        
        // Primary: Use addresses array column for fast queries
        // Handle NULL addresses with COALESCE to empty array
        if (uniqueAddresses.length === 1) {
          addressConditions.push(`(COALESCE(t.addresses, ARRAY[]::TEXT[]) @> ARRAY[$${idx}])`);
          values.push(uniqueAddresses[0]);
          idx++;
        } else {
          const placeholders = uniqueAddresses.map((_, i) => `$${idx + i}`).join(', ');
          addressConditions.push(`(COALESCE(t.addresses, ARRAY[]::TEXT[]) && ARRAY[${placeholders}])`);
          values.push(...uniqueAddresses);
          idx += uniqueAddresses.length;
        }
        
        // Fallback: Also check sender and recipient columns for backward compatibility
        if (uniqueAddresses.length === 1) {
          addressConditions.push(`(t.sender = $${idx} OR t.recipient = $${idx})`);
          values.push(uniqueAddresses[0]);
          idx++;
        } else {
          const placeholders = uniqueAddresses.map((_, i) => `$${idx + i}`).join(', ');
          addressConditions.push(`(t.sender IN (${placeholders}) OR t.recipient IN (${placeholders}))`);
          values.push(...uniqueAddresses, ...uniqueAddresses);
          idx += uniqueAddresses.length * 2;
        }

        conditions.push(`(${addressConditions.join(' OR ')})`);
      }

      if (type) {
        conditions.push(`t.type = $${idx}`);
        values.push(type);
        idx++;
      }

      if (status) {
        conditions.push(`t.status = $${idx}`);
        values.push(status);
        idx++;
      }

      if (start_date) {
        conditions.push(`t.timestamp >= $${idx}::timestamp`);
        values.push(start_date);
        idx++;
      }
      if (end_date) {
        conditions.push(`t.timestamp <= $${idx}::timestamp`);
        values.push(end_date);
        idx++;
      }

      if (min_amount !== undefined && min_amount !== null) {
        conditions.push(`t.amount >= $${idx}::numeric`);
        values.push(parseFloat(min_amount));
        idx++;
      }
      if (max_amount !== undefined && max_amount !== null) {
        conditions.push(`t.amount <= $${idx}::numeric`);
        values.push(parseFloat(max_amount));
        idx++;
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get statistics in a single optimized query
      const statsSql = `
        SELECT 
          COUNT(*)::bigint as total_count,
          COALESCE(SUM(t.amount), 0)::numeric as total_amount,
          COALESCE(SUM(t.fee), 0)::numeric as total_fees,
          MIN(t.timestamp) as min_timestamp,
          MAX(t.timestamp) as max_timestamp
        FROM transactions t
        ${where}
      `;

      const statsRes = await this.pgClient.query(statsSql, values);

      // Get counts by type
      const byTypeSql = `
        SELECT 
          t.type,
          COUNT(*)::bigint as count
        FROM transactions t
        ${where}
        GROUP BY t.type
        ORDER BY count DESC
      `;

      const byTypeRes = await this.pgClient.query(byTypeSql, values);
      const byType = {};
      byTypeRes.rows.forEach(row => {
        byType[row.type || 'unknown'] = parseInt(row.count, 10);
      });

      // Get counts by status
      const byStatusSql = `
        SELECT 
          t.status,
          COUNT(*)::bigint as count
        FROM transactions t
        ${where}
        GROUP BY t.status
        ORDER BY count DESC
      `;

      const byStatusRes = await this.pgClient.query(byStatusSql, values);
      const byStatus = {};
      byStatusRes.rows.forEach(row => {
        byStatus[row.status || 'unknown'] = parseInt(row.count, 10);
      });

      const stats = statsRes.rows[0];

      return {
        data: {
          total_count: parseInt(stats.total_count, 10),
          total_amount: parseFloat(stats.total_amount) || 0,
          total_fees: parseFloat(stats.total_fees) || 0,
          by_type: byType,
          by_status: byStatus,
          date_range: {
            min: stats.min_timestamp ? new Date(stats.min_timestamp).toISOString() : null,
            max: stats.max_timestamp ? new Date(stats.max_timestamp).toISOString() : null
          }
        }
      };
    } catch (error) {
      console.error('Error getting transaction stats:', error);
      throw new Error(`Failed to retrieve transaction statistics: ${error.message}`);
    }
  }
}

module.exports = new TransactionService(); 