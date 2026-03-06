#!/usr/bin/env node
'use strict';

/**
 * Script to requeue failed block results that failed due to string length errors
 * After implementing stream-json parser, these blocks should now process successfully
 * 
 * Usage:
 *   node requeue_failed_blocks.js --chain pocket-mainnet
 *   node requeue_failed_blocks.js --chain pocket-mainnet --dry-run
 *   node requeue_failed_blocks.js --chain pocket-mainnet --min-height 600000 --max-height 610000
 */

const dotenv = require('dotenv');
dotenv.config();

const { enqueueBlockResults } = require('../services/indexer/blockResultsQueue');
const { pgPool, connectClients } = require('../services/indexer/db');
const redis = require('../config/redis');

// Parse command-line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    chain: null,
    dryRun: false,
    minHeight: null,
    maxHeight: null,
    clearFailedStatus: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--chain') {
      config.chain = args[++i];
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (arg === '--min-height') {
      config.minHeight = parseInt(args[++i], 10);
      if (isNaN(config.minHeight)) {
        console.error('Error: --min-height must be a valid number');
        process.exit(1);
      }
    } else if (arg === '--max-height') {
      config.maxHeight = parseInt(args[++i], 10);
      if (isNaN(config.maxHeight)) {
        console.error('Error: --max-height must be a valid number');
        process.exit(1);
      }
    } else if (arg === '--clear-failed-status') {
      config.clearFailedStatus = true;
    } else if (arg === '--help') {
      console.log(`
Usage: node requeue_failed_blocks.js [options]

Options:
  --chain <name>              Chain name (required, e.g., "pocket-mainnet")
  --dry-run                   Show what would be requeued without actually requeuing
  --min-height <number>       Minimum block height to requeue (optional)
  --max-height <number>       Maximum block height to requeue (optional)
  --clear-failed-status       Clear the failed status from database after requeuing
  --help                      Show this help message

Examples:
  # Requeue all failed blocks for pocket-mainnet
  node requeue_failed_blocks.js --chain pocket-mainnet

  # Dry run to see what would be requeued
  node requeue_failed_blocks.js --chain pocket-mainnet --dry-run

  # Requeue blocks in a specific range
  node requeue_failed_blocks.js --chain pocket-mainnet --min-height 600000 --max-height 610000

  # Requeue and clear failed status
  node requeue_failed_blocks.js --chain pocket-mainnet --clear-failed-status
`);
      process.exit(0);
    }
  }

  if (!config.chain) {
    console.error('Error: --chain is required');
    console.error('Use --help for usage information');
    process.exit(1);
  }

  return config;
}

/**
 * Get failed blocks from database
 */
async function getFailedBlocks(chain, minHeight, maxHeight) {
  try {
    await connectClients();
    
    let query = `
      SELECT height, processed_at, error_message
      FROM block_results_processed
      WHERE chain = $1 
        AND status = 'failed'
    `;
    
    const params = [chain];
    
    if (minHeight !== null) {
      query += ` AND height >= $${params.length + 1}`;
      params.push(minHeight);
    }
    
    if (maxHeight !== null) {
      query += ` AND height <= $${params.length + 1}`;
      params.push(maxHeight);
    }
    
    query += ` ORDER BY height`;
    
    const result = await pgPool.query(query, params);
    return result.rows.map(row => ({
      height: parseInt(row.height, 10),
      processedAt: row.processed_at,
      errorMessage: row.error_message
    }));
  } catch (error) {
    console.error('Error fetching failed blocks:', error.message);
    throw error;
  }
}

/**
 * Clear failed status from database
 */
async function clearFailedStatus(chain, heights) {
  try {
    await connectClients();
    
    // Delete the failed entries so they can be reprocessed
    const result = await pgPool.query(
      `DELETE FROM block_results_processed 
       WHERE chain = $1 
         AND height = ANY($2::bigint[])
         AND status = 'failed'`,
      [chain, heights]
    );
    
    return result.rowCount;
  } catch (error) {
    console.error('Error clearing failed status:', error.message);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const config = parseArgs();
  
  console.log('='.repeat(80));
  console.log('Requeue Failed Block Results');
  console.log('='.repeat(80));
  console.log(`Chain: ${config.chain}`);
  console.log(`Dry run: ${config.dryRun ? 'YES' : 'NO'}`);
  if (config.minHeight !== null) {
    console.log(`Min height: ${config.minHeight}`);
  }
  if (config.maxHeight !== null) {
    console.log(`Max height: ${config.maxHeight}`);
  }
  console.log(`Clear failed status: ${config.clearFailedStatus ? 'YES' : 'NO'}`);
  console.log('');
  
  try {
    // Get failed blocks
    console.log('Fetching failed blocks from database...');
    const failedBlocks = await getFailedBlocks(config.chain, config.minHeight, config.maxHeight);
    
    if (failedBlocks.length === 0) {
      console.log('No failed blocks found matching the criteria.');
      return;
    }
    
    console.log(`Found ${failedBlocks.length} failed blocks`);
    console.log(`Height range: ${failedBlocks[0].height} to ${failedBlocks[failedBlocks.length - 1].height}`);
    console.log('');
    
    if (config.dryRun) {
      console.log('DRY RUN - Would requeue the following blocks:');
      console.log('');
      const sampleSize = Math.min(10, failedBlocks.length);
      for (let i = 0; i < sampleSize; i++) {
        const block = failedBlocks[i];
        console.log(`  Height ${block.height} (failed at ${block.processedAt})`);
      }
      if (failedBlocks.length > sampleSize) {
        console.log(`  ... and ${failedBlocks.length - sampleSize} more blocks`);
      }
      console.log('');
      console.log(`Total: ${failedBlocks.length} blocks would be requeued`);
      return;
    }
    
    // Requeue blocks
    console.log('Requeueing blocks...');
    let successCount = 0;
    let failCount = 0;
    const batchSize = 100;
    const successfullyRequeued = []; // Track which blocks were successfully requeued
    
    for (let i = 0; i < failedBlocks.length; i++) {
      const block = failedBlocks[i];
      
      try {
        const success = await enqueueBlockResults(config.chain, block.height, {
          pushSide: 'left' // Higher priority for failed blocks
        });
        
        if (success) {
          successCount++;
          successfullyRequeued.push(block.height);
        } else {
          failCount++;
          console.error(`Failed to enqueue block ${block.height}`);
        }
        
        // Progress update
        if ((i + 1) % batchSize === 0) {
          console.log(`  Progress: ${i + 1}/${failedBlocks.length} blocks requeued (${successCount} success, ${failCount} failed)`);
        }
      } catch (error) {
        failCount++;
        console.error(`Error enqueueing block ${block.height}: ${error.message}`);
      }
    }
    
    console.log('');
    console.log(`Requeue complete:`);
    console.log(`  Successfully requeued: ${successCount}`);
    console.log(`  Failed to requeue: ${failCount}`);
    console.log(`  Total: ${failedBlocks.length}`);
    
    // Clear failed status if requested
    if (config.clearFailedStatus && successfullyRequeued.length > 0) {
      console.log('');
      console.log('Clearing failed status from database...');
      
      // Clear in batches to avoid query size limits
      const clearBatchSize = 1000;
      let clearedCount = 0;
      
      for (let i = 0; i < successfullyRequeued.length; i += clearBatchSize) {
        const batch = successfullyRequeued.slice(i, i + clearBatchSize);
        const deleted = await clearFailedStatus(config.chain, batch);
        clearedCount += deleted;
      }
      
      console.log(`  Cleared failed status for ${clearedCount} blocks`);
    }
    
    console.log('');
    console.log('✅ Requeue completed successfully!');
    console.log('');
    console.log('The block results workers will now process these blocks with the new streaming parser.');
    
  } catch (error) {
    console.error('\n❌ Error during requeue:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pgPool.end();
    await redis.quit();
  }
  process.exit(0);
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

