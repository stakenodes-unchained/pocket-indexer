#!/usr/bin/env node
'use strict';

/**
 * Check what block heights are actually in the queue
 * This helps diagnose why workers can't dequeue items
 */

const dotenv = require('dotenv');
dotenv.config();

const redis = require('../config/redis');

async function checkQueueHeights(chain) {
  const queueKey = `block_results_queue:${chain}`;
  
  try {
    // Get queue length
    const queueLength = await redis.llen(queueKey);
    console.log(`\n=== ${chain} Queue ===`);
    console.log(`Total items: ${queueLength}`);
    
    if (queueLength === 0) {
      console.log('Queue is empty');
      return;
    }
    
    // Sample first 20 items from left (current workers would see these)
    console.log('\nFirst 20 items (from left - current workers see these):');
    const leftItems = await redis.lrange(queueKey, 0, 19);
    const leftHeights = leftItems.map(item => {
      try {
        const parsed = JSON.parse(item);
        return parsed.height;
      } catch (e) {
        return 'invalid';
      }
    }).filter(h => h !== 'invalid');
    
    if (leftHeights.length > 0) {
      console.log(`  Heights: ${leftHeights.join(', ')}`);
      console.log(`  Min: ${Math.min(...leftHeights)}`);
      console.log(`  Max: ${Math.max(...leftHeights)}`);
    }
    
    // Sample last 20 items from right (historical workers would see these)
    console.log('\nLast 20 items (from right - historical workers see these):');
    const rightItems = await redis.lrange(queueKey, -20, -1);
    const rightHeights = rightItems.map(item => {
      try {
        const parsed = JSON.parse(item);
        return parsed.height;
      } catch (e) {
        return 'invalid';
      }
    }).filter(h => h !== 'invalid');
    
    if (rightHeights.length > 0) {
      console.log(`  Heights: ${rightHeights.join(', ')}`);
      console.log(`  Min: ${Math.min(...rightHeights)}`);
      console.log(`  Max: ${Math.max(...rightHeights)}`);
    }
    
    // Check processing locks
    console.log('\nChecking for stale processing locks...');
    const allKeys = await redis.keys(`block_results_processing:${chain}:*`);
    console.log(`  Active processing locks: ${allKeys.length}`);
    
    if (allKeys.length > 0) {
      const sampleLocks = allKeys.slice(0, 10);
      for (const key of sampleLocks) {
        const timestamp = await redis.get(key);
        const height = key.split(':').pop();
        const age = timestamp ? Date.now() - parseInt(timestamp) : 0;
        const ageMinutes = Math.floor(age / 60000);
        if (ageMinutes > 5) {
          console.log(`  ⚠️  Stale lock: height ${height}, age: ${ageMinutes} minutes`);
        }
      }
    }
    
  } catch (error) {
    console.error(`Error checking queue for ${chain}:`, error.message);
  }
}

async function main() {
  const chains = process.argv.slice(2);
  
  if (chains.length === 0) {
    chains.push('pocket-testnet-beta', 'pocket-mainnet');
  }
  
  for (const chain of chains) {
    await checkQueueHeights(chain);
  }
  
  await redis.quit();
  process.exit(0);
}

main().catch(console.error);

