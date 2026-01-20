#!/usr/bin/env node
'use strict';

/**
 * Script to clear block results queue for a specific chain
 * 
 * Usage:
 *   node clear_block_results_queue.js --chain pocket-testnet-beta
 *   node clear_block_results_queue.js --chain pocket-testnet-beta --dry-run
 */

const dotenv = require('dotenv');
dotenv.config();

const { clearQueue, getQueueSize, getDelayedItemsCount } = require('../services/indexer/blockResultsQueue');
const redis = require('../config/redis');

// Parse command-line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    chain: null,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--chain') {
      config.chain = args[++i];
    } else if (arg === '--dry-run') {
      config.dryRun = true;
    } else if (arg === '--help') {
      console.log(`
Usage: node clear_block_results_queue.js [options]

Options:
  --chain <name>    Chain name (required, e.g., "pocket-testnet-beta")
  --dry-run         Show what would be cleared without actually clearing
  --help            Show this help message

Examples:
  # Clear queue for pocket-testnet-beta
  node clear_block_results_queue.js --chain pocket-testnet-beta

  # Dry run to see queue size
  node clear_block_results_queue.js --chain pocket-testnet-beta --dry-run
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
 * Main function
 */
async function main() {
  const config = parseArgs();
  
  console.log('='.repeat(80));
  console.log('Clear Block Results Queue');
  console.log('='.repeat(80));
  console.log(`Chain: ${config.chain}`);
  console.log(`Dry run: ${config.dryRun ? 'YES' : 'NO'}`);
  console.log('');
  
  try {
    // Get current queue status
    const queueSize = await getQueueSize(config.chain);
    const delayedItems = await getDelayedItemsCount(config.chain);
    
    console.log('Current Queue Status:');
    console.log(`  Queue size: ${queueSize} blocks`);
    console.log(`  Delayed items: ${delayedItems} blocks`);
    console.log(`  Total: ${queueSize + delayedItems} blocks`);
    console.log('');
    
    if (config.dryRun) {
      console.log('DRY RUN: Would clear the following:');
      console.log(`  - ${queueSize} items from main queue`);
      console.log(`  - ${delayedItems} items from delayed queue`);
      console.log('');
      console.log('Run without --dry-run to actually clear the queue.');
      return;
    }
    
    if (queueSize === 0 && delayedItems === 0) {
      console.log('Queue is already empty. Nothing to clear.');
      return;
    }
    
    // Clear the queue
    console.log('Clearing queue...');
    await clearQueue(config.chain);
    
    // Verify it's cleared
    const newQueueSize = await getQueueSize(config.chain);
    const newDelayedItems = await getDelayedItemsCount(config.chain);
    
    console.log('');
    console.log('✅ Queue cleared successfully!');
    console.log(`  Cleared ${queueSize} items from main queue`);
    console.log(`  Cleared ${delayedItems} items from delayed queue`);
    console.log(`  Remaining: ${newQueueSize} in queue, ${newDelayedItems} delayed`);
    
  } catch (error) {
    console.error('\n❌ Error clearing queue:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

// Run the script
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

