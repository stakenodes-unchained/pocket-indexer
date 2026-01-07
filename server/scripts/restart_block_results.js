'use strict';

/**
 * Restart Block Results Processing Script
 * 
 * This script allows you to restart block results processing from a specific height by:
 * 1. Clearing processed tracking from database and Redis
 * 2. Clearing the queue and delayed items
 * 3. Optionally re-enqueueing blocks from restart height to current height
 * 
 * Usage:
 *   node server/scripts/restart_block_results.js --rpc-name=<name> --restart-height=<height> [options]
 * 
 * Options:
 *   --rpc-name=<name>        RPC endpoint name (required)
 *   --restart-height=<height> Height to restart from (required)
 *   --enqueue-to=<height>    Height to enqueue up to (default: current chain height)
 *   --skip-enqueue           Skip re-enqueueing blocks (just clear tracking)
 *   --dry-run                Show what would be done without making changes
 *   --confirm                Skip confirmation prompt (for automation)
 */

const dotenv = require('dotenv');
dotenv.config();

const readline = require('readline');
const { Pool } = require('pg');
const Redis = require('ioredis');
const { getRpcEndpoints } = require('../config/rpc');
const { fetchLatestBlock } = require('../services/indexer/rpc');
const {
  clearProcessedBlocks,
  clearQueue,
  enqueueBlockResults,
  getMaxProcessedHeight,
  getQueueSize,
  getDelayedItemsCount
} = require('../services/indexer/blockResultsQueue');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    rpcName: null,
    restartHeight: null,
    enqueueTo: null,
    skipEnqueue: false,
    dryRun: false,
    confirm: false
  };

  for (const arg of args) {
    if (arg.startsWith('--rpc-name=')) {
      options.rpcName = arg.split('=')[1];
    } else if (arg.startsWith('--restart-height=')) {
      options.restartHeight = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--enqueue-to=')) {
      options.enqueueTo = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--skip-enqueue') {
      options.skipEnqueue = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--confirm') {
      options.confirm = true;
    }
  }

  // Check environment variables as fallback
  if (!options.rpcName) {
    options.rpcName = process.env.BLOCK_RESULTS_RPC_NAME;
  }
  if (!options.restartHeight) {
    options.restartHeight = parseInt(process.env.BLOCK_RESULTS_RESTART_HEIGHT, 10);
  }

  return options;
}

// Ask for confirmation
function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

// Main function
async function main() {
  const options = parseArgs();

  // Validate inputs
  if (!options.rpcName) {
    console.error('Error: --rpc-name is required');
    console.error('Usage: node server/scripts/restart_block_results.js --rpc-name=<name> --restart-height=<height>');
    process.exit(1);
  }

  if (!options.restartHeight || isNaN(options.restartHeight) || options.restartHeight < 0) {
    console.error('Error: --restart-height is required and must be a positive integer');
    console.error('Usage: node server/scripts/restart_block_results.js --rpc-name=<name> --restart-height=<height>');
    process.exit(1);
  }

  // Check if RPC endpoint exists
  const rpcEndpoints = getRpcEndpoints();
  const rpcConfig = rpcEndpoints.find(e => e.name === options.rpcName);
  if (!rpcConfig) {
    console.error(`Error: RPC endpoint "${options.rpcName}" not found in configuration`);
    console.error(`Available endpoints: ${rpcEndpoints.map(e => e.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n=== Block Results Restart Script ===`);
  console.log(`RPC Name: ${options.rpcName}`);
  console.log(`Restart Height: ${options.restartHeight}`);
  console.log(`Dry Run: ${options.dryRun ? 'YES' : 'NO'}`);
  console.log(`\n`);

  // Connect to database and Redis
  const pgPool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
  });

  const redis = new Redis(process.env.REDIS_URL);

  try {
    // Test connections
    await pgPool.query('SELECT 1');
    await redis.ping();
    console.log('✓ Database and Redis connections established\n');
  } catch (error) {
    console.error('Error connecting to database or Redis:', error.message);
    process.exit(1);
  }

  try {
    // Get current status
    const maxProcessed = await getMaxProcessedHeight(options.rpcName);
    const queueSize = await getQueueSize(options.rpcName);
    const delayedItems = await getDelayedItemsCount(options.rpcName);

    console.log('Current Status:');
    console.log(`  Max Processed Height: ${maxProcessed || 'none'}`);
    console.log(`  Queue Size: ${queueSize}`);
    console.log(`  Delayed Items: ${delayedItems}`);
    console.log(`\n`);

    // Get current chain height if we need to enqueue
    let currentChainHeight = null;
    if (!options.skipEnqueue && !options.enqueueTo) {
      try {
        const latestBlock = await fetchLatestBlock(rpcConfig.url);
        currentChainHeight = parseInt(latestBlock.block.header.height, 10);
        console.log(`Current Chain Height: ${currentChainHeight}\n`);
      } catch (error) {
        console.error(`Warning: Could not fetch current chain height: ${error.message}`);
        console.error('You may need to specify --enqueue-to=<height> manually\n');
      }
    }

    const enqueueTo = options.enqueueTo || currentChainHeight;

    // Show what will be done
    console.log('Actions to be performed:');
    console.log(`  1. Delete processed records from database (height >= ${options.restartHeight})`);
    console.log(`  2. Remove processed heights from Redis (height >= ${options.restartHeight})`);
    console.log(`  3. Clear queue and delayed items`);
    if (!options.skipEnqueue && enqueueTo) {
      const blocksToEnqueue = enqueueTo - options.restartHeight + 1;
      console.log(`  4. Re-enqueue blocks from ${options.restartHeight} to ${enqueueTo} (${blocksToEnqueue} blocks)`);
    } else {
      console.log(`  4. Skip re-enqueueing (blocks will be enqueued automatically as main worker processes them)`);
    }
    console.log(`\n`);

    // Safety check
    if (options.restartHeight > 1000000) {
      console.warn('⚠️  WARNING: Restart height is very high. This will clear a large amount of data.');
      console.warn('   Make sure this is what you want to do.\n');
    }

    // Ask for confirmation
    if (!options.confirm && !options.dryRun) {
      const confirmed = await askConfirmation('Do you want to proceed? (yes/no): ');
      if (!confirmed) {
        console.log('Operation cancelled.');
        process.exit(0);
      }
      console.log('');
    }

    if (options.dryRun) {
      console.log('DRY RUN: No changes will be made.\n');
      console.log('Summary:');
      if (maxProcessed && maxProcessed >= options.restartHeight) {
        const blocksToClear = maxProcessed - options.restartHeight + 1;
        console.log(`  Would clear ~${blocksToClear} processed block records`);
      }
      console.log(`  Would clear queue (${queueSize} items) and delayed items (${delayedItems} items)`);
      if (!options.skipEnqueue && enqueueTo) {
        console.log(`  Would enqueue ${enqueueTo - options.restartHeight + 1} blocks`);
      }
      process.exit(0);
    }

    // Execute operations
    console.log('Executing operations...\n');

    // 1. Clear processed blocks from database and Redis
    console.log('1. Clearing processed blocks tracking...');
    const clearResult = await clearProcessedBlocks(options.rpcName, options.restartHeight);
    console.log(`   ✓ Deleted ${clearResult.dbDeleted} records from database`);
    console.log(`   ✓ Removed ${clearResult.redisRemoved} heights from Redis\n`);

    // 2. Clear queue
    console.log('2. Clearing queue and delayed items...');
    await clearQueue(options.rpcName);
    console.log(`   ✓ Cleared queue and delayed items\n`);

    // 3. Re-enqueue blocks if requested
    if (!options.skipEnqueue && enqueueTo) {
      const blocksToEnqueue = enqueueTo - options.restartHeight + 1;
      console.log(`3. Re-enqueueing ${blocksToEnqueue} blocks from ${options.restartHeight} to ${enqueueTo}...`);
      
      let enqueued = 0;
      const batchSize = 100;
      for (let height = options.restartHeight; height <= enqueueTo; height++) {
        await enqueueBlockResults(options.rpcName, height);
        enqueued++;
        
        if (enqueued % batchSize === 0) {
          console.log(`   Enqueued ${enqueued}/${blocksToEnqueue} blocks...`);
        }
      }
      console.log(`   ✓ Enqueued ${enqueued} blocks\n`);
    }

    console.log('✅ Restart completed successfully!\n');
    console.log('The block results workers will now process blocks starting from height', options.restartHeight);

  } catch (error) {
    console.error('\n❌ Error during restart:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pgPool.end();
    await redis.quit();
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

