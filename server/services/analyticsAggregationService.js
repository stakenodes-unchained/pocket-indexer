const { aggregateDailyUsage } = require('../middleware/apiLogger');

class AnalyticsAggregationService {
  constructor() {
    this.isRunning = false;
    this.intervalHandle = null;
  }

  /**
   * Start the aggregation service
   * Runs daily at midnight (or custom interval)
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️  Analytics aggregation service already running');
      return;
    }

    this.isRunning = true;

    // Run immediately on startup to catch any missed aggregations
    this.runAggregation().catch(err => {
      console.error('Error in initial analytics aggregation:', err);
    });

    // Schedule to run daily at midnight (24 hours)
    const DAILY_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    this.intervalHandle = setInterval(() => {
      this.runAggregation().catch(err => {
        console.error('Error in scheduled analytics aggregation:', err);
      });
    }, DAILY_INTERVAL);

    console.log('✅ Analytics aggregation service started (runs daily at midnight)');
  }

  /**
   * Stop the aggregation service
   */
  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.isRunning = false;
    console.log('🛑 Analytics aggregation service stopped');
  }

  /**
   * Run aggregation for yesterday's data
   */
  async runAggregation() {
    try {
      console.log('📊 Starting daily analytics aggregation...');

      // Aggregate yesterday's data
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const result = await aggregateDailyUsage(yesterday);

      console.log(`✅ Analytics aggregation complete: ${result.usersAggregated} users processed for ${result.date}`);

      return result;
    } catch (error) {
      console.error('❌ Error in analytics aggregation:', error);
      throw error;
    }
  }

  /**
   * Manually trigger aggregation for a specific date
   * @param {Date} date - Date to aggregate
   */
  async aggregateForDate(date) {
    try {
      console.log(`📊 Manual aggregation triggered for ${date.toISOString().split('T')[0]}...`);
      const result = await aggregateDailyUsage(date);
      console.log(`✅ Manual aggregation complete: ${result.usersAggregated} users processed`);
      return result;
    } catch (error) {
      console.error('❌ Error in manual aggregation:', error);
      throw error;
    }
  }

  /**
   * Backfill analytics for a date range
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   */
  async backfillAnalytics(startDate, endDate) {
    try {
      console.log(`📊 Backfilling analytics from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}...`);

      const results = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const result = await aggregateDailyUsage(new Date(currentDate));
        results.push(result);
        currentDate.setDate(currentDate.setDate() + 1);
      }

      const totalUsers = results.reduce((sum, r) => sum + r.usersAggregated, 0);
      console.log(`✅ Backfill complete: ${totalUsers} total user-days processed across ${results.length} days`);

      return results;
    } catch (error) {
      console.error('❌ Error in analytics backfill:', error);
      throw error;
    }
  }
}

module.exports = AnalyticsAggregationService;
