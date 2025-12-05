#!/usr/bin/env node

/**
 * Event Backfilling CLI
 * Command-line tool to trigger event backfilling
 */

const { backfillEvents, resumeBackfill, getBackfillProgress } = require('../services/indexer/eventBackfiller');
require('dotenv').config();

const chain = process.env.CHAIN || 'pocket-mainnet';
const rpcUrl = process.env.RPC_URL || 'https://mainnet.rpc.pokt.network';
const batchSize = parseInt(process.env.EVENT_BACKFILL_BATCH_SIZE || '100', 10);

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'status') {
    // Show backfill status
    const progress = await getBackfillProgress(chain);
    if (progress) {
      console.log('Event Backfill Status:');
      console.log(`  Chain: ${chain}`);
      console.log(`  Status: ${progress.status}`);
      console.log(`  Start Height: ${progress.start_height}`);
      console.log(`  End Height: ${progress.end_height}`);
      console.log(`  Current Height: ${progress.current_height}`);
      console.log(`  Events Processed: ${progress.events_processed}`);
      if (progress.started_at) {
        console.log(`  Started At: ${progress.started_at}`);
      }
      if (progress.completed_at) {
        console.log(`  Completed At: ${progress.completed_at}`);
      }
      if (progress.error_message) {
        console.log(`  Error: ${progress.error_message}`);
      }
    } else {
      console.log('No backfill status found');
    }
  } else if (command === 'resume') {
    // Resume from last processed height
    const targetHeight = args[1] ? parseInt(args[1], 10) : null;
    
    if (!targetHeight) {
      console.error('Error: Target height required for resume command');
      console.log('Usage: node backfillEvents.js resume <target_height>');
      process.exit(1);
    }
    
    console.log(`Resuming event backfill for chain ${chain} to height ${targetHeight}`);
    const result = await resumeBackfill(chain, rpcUrl, targetHeight, batchSize);
    console.log('Backfill completed:', result);
  } else if (command === 'backfill') {
    // Backfill specific range
    const startHeight = args[1] ? parseInt(args[1], 10) : 0;
    const endHeight = args[2] ? parseInt(args[2], 10) : null;
    
    if (endHeight === null) {
      console.error('Error: End height required for backfill command');
      console.log('Usage: node backfillEvents.js backfill <start_height> <end_height>');
      process.exit(1);
    }
    
    console.log(`Starting event backfill for chain ${chain} from height ${startHeight} to ${endHeight}`);
    const result = await backfillEvents(chain, rpcUrl, startHeight, endHeight, batchSize);
    console.log('Backfill completed:', result);
  } else {
    console.log('Event Backfilling CLI');
    console.log('');
    console.log('Usage:');
    console.log('  node backfillEvents.js status                    - Show backfill status');
    console.log('  node backfillEvents.js resume <target_height>    - Resume from last processed height');
    console.log('  node backfillEvents.js backfill <start> <end>    - Backfill specific range');
    console.log('');
    console.log('Environment Variables:');
    console.log('  CHAIN - Chain identifier (default: pocket-mainnet)');
    console.log('  RPC_URL - RPC endpoint URL');
    console.log('  EVENT_BACKFILL_BATCH_SIZE - Batch size (default: 100)');
  }
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});

