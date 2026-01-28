const { Pool } = require('pg');

/**
 * Service to refresh the proof_submission_rewards_mv materialized view
 * Refreshes every 15 minutes to keep data fresh while maintaining performance
 */
class RewardAnalyticsRefreshService {
  constructor(options = {}) {
    this.refreshIntervalMs = options.refreshIntervalMs || 15 * 60 * 1000; // 15 minutes default
    this.timer = null;
    this.isRefreshing = false;
    this.lastRefreshTime = null;
    this.lastRefreshDuration = null;
    this.refreshCount = 0;
    this.errorCount = 0;
    
    // Create a dedicated connection pool for refresh operations
    // This prevents blocking the main API connection pool
    this.pgPool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      max: 2, // Only need 1-2 connections for refresh
      min: 1,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 600000, // 10 minute timeout for refresh (may take time on large datasets)
    });
    
    // Handle pool errors
    this.pgPool.on('error', (err) => {
      console.error('RewardAnalyticsRefreshService: Unexpected error on idle PostgreSQL client', err);
    });
  }

  /**
   * Refresh the materialized view using CONCURRENT refresh to avoid blocking reads
   */
  async refresh() {
    // Prevent concurrent refresh attempts
    if (this.isRefreshing) {
      console.log('RewardAnalyticsRefreshService: Refresh already in progress, skipping...');
      return;
    }

    this.isRefreshing = true;
    const startTime = Date.now();
    
    try {
      console.log('RewardAnalyticsRefreshService: Starting materialized view refresh...');
      
      // Use CONCURRENT refresh to avoid blocking queries on the materialized view
      // This requires a unique index (which we created in the migration)
      const result = await this.pgPool.query(
        'REFRESH MATERIALIZED VIEW CONCURRENTLY proof_submission_rewards_mv'
      );
      
      const duration = Date.now() - startTime;
      this.lastRefreshTime = new Date();
      this.lastRefreshDuration = duration;
      this.refreshCount++;
      
      console.log(`RewardAnalyticsRefreshService: Refresh completed successfully in ${duration}ms`);
      console.log(`RewardAnalyticsRefreshService: Total refreshes: ${this.refreshCount}, Last refresh: ${this.lastRefreshTime.toISOString()}`);
      
      return { success: true, duration, timestamp: this.lastRefreshTime };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.errorCount++;
      
      console.error('RewardAnalyticsRefreshService: Refresh failed:', error.message);
      console.error('RewardAnalyticsRefreshService: Error stack:', error.stack);
      
      // If CONCURRENT refresh fails (e.g., unique index missing), try regular refresh
      if (error.message.includes('CONCURRENTLY') || error.message.includes('unique index')) {
        console.log('RewardAnalyticsRefreshService: Attempting non-concurrent refresh as fallback...');
        try {
          await this.pgPool.query('REFRESH MATERIALIZED VIEW proof_submission_rewards_mv');
          const fallbackDuration = Date.now() - startTime;
          this.lastRefreshTime = new Date();
          this.lastRefreshDuration = fallbackDuration;
          this.refreshCount++;
          console.log(`RewardAnalyticsRefreshService: Fallback refresh completed in ${fallbackDuration}ms`);
          return { success: true, duration: fallbackDuration, timestamp: this.lastRefreshTime, fallback: true };
        } catch (fallbackError) {
          console.error('RewardAnalyticsRefreshService: Fallback refresh also failed:', fallbackError.message);
          return { success: false, error: fallbackError.message, duration };
        }
      }
      
      return { success: false, error: error.message, duration };
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Start the scheduled refresh service
   */
  start() {

    return; 
    // TODO: Uncomment this when we have a way to refresh the materialized view
    if (this.timer) {
      console.log('RewardAnalyticsRefreshService: Already started');
      return;
    }

    console.log(`RewardAnalyticsRefreshService: Starting with ${this.refreshIntervalMs / 1000 / 60} minute refresh interval`);
    
    // Perform initial refresh immediately
    this.refresh().catch(err => {
      console.error('RewardAnalyticsRefreshService: Initial refresh failed:', err);
    });
    
    // Schedule periodic refreshes
    this.timer = setInterval(() => {
      this.refresh().catch(err => {
        console.error('RewardAnalyticsRefreshService: Scheduled refresh failed:', err);
      });
    }, this.refreshIntervalMs);
    
    console.log('RewardAnalyticsRefreshService: Service started');
  }

  /**
   * Stop the refresh service
   */
  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('RewardAnalyticsRefreshService: Timer stopped');
    }
    
    // Wait for any in-progress refresh to complete (with timeout)
    if (this.isRefreshing) {
      console.log('RewardAnalyticsRefreshService: Waiting for in-progress refresh to complete...');
      let waitCount = 0;
      while (this.isRefreshing && waitCount < 60) { // Wait up to 60 seconds
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitCount++;
      }
    }
    
    // Close database pool
    if (this.pgPool) {
      await this.pgPool.end();
      console.log('RewardAnalyticsRefreshService: Database pool closed');
    }
    
    console.log('RewardAnalyticsRefreshService: Service stopped');
  }

  /**
   * Get refresh status for health checks
   */
  getStatus() {
    return {
      isRunning: this.timer !== null,
      isRefreshing: this.isRefreshing,
      lastRefreshTime: this.lastRefreshTime,
      lastRefreshDuration: this.lastRefreshDuration,
      refreshCount: this.refreshCount,
      errorCount: this.errorCount,
      refreshIntervalMs: this.refreshIntervalMs,
      nextRefreshTime: this.lastRefreshTime 
        ? new Date(this.lastRefreshTime.getTime() + this.refreshIntervalMs)
        : null
    };
  }
}

module.exports = RewardAnalyticsRefreshService;

