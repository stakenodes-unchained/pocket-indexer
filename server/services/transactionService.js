const redis = require('../config/redis');
const { getRpcEndpoints } = require('../config/rpc');
const { Client } = require('pg');

/**
 * Transaction service that provides methods to interact with stored transaction data
 */
class TransactionService {
  constructor() {
    this.rpcEndpoints = getRpcEndpoints();
    
    // PostgreSQL client
    this.pgClient = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    });
    
    this.pgClient._connected = false;
  }

  /**
   * Connect to the database if not already connected
   */
  async connectDB() {
    if (!this.pgClient._connected) {
      await this.pgClient.connect();
      this.pgClient._connected = true;
    }
  }

  /**
   * Get all available chain names
   * @returns {Array<string>} Array of chain names
   */
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
      await this.connectDB();
      
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
      const transactionsResult = await this.pgClient.query(
        `SELECT t.id, t.hash, t.block_id, t.sender, t.recipient, t.amount, t.fee, t.memo, t.type, t.status, t.chain, t.timestamp, b.height as block_height FROM transactions as t
         JOIN blocks as b ON t.block_id = b.id
         WHERE t.chain = $1 
         ORDER BY timestamp DESC 
         LIMIT $2 OFFSET $3`,
        [chainName, limitNum, offset]
      );
      
      const transactions = transactionsResult.rows.map(tx => ({
        ...tx,
        chain: chainName,
        // Parse JSON fields if they exist
        tx_data: tx.tx_data ? (typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data) : null
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
      await this.connectDB();
      
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
      await this.connectDB();
      
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
          dailyCountsMap.set(row.date, parseInt(row.count, 10));
          console.log(`Database date: ${row.date}, count: ${row.count}`);
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
      await this.connectDB();
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
      await this.connectDB();
      
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
      const cacheTTL = parseInt(process.env.HISTORY_CACHE_TTL || 3600, 10); // Default 1 hour
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
      await this.connectDB();
      
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
}

module.exports = new TransactionService(); 