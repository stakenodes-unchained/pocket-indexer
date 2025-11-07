#!/usr/bin/env node

/**
 * Backfill script to populate addresses column for existing transactions
 * 
 * Usage: node server/scripts/backfill_transaction_addresses.js [options]
 * 
 * Options:
 *   --chain <chain>     Process only transactions for specific chain
 *   --batch-size <n>    Number of transactions to process per batch (default: 1000)
 *   --limit <n>         Maximum number of transactions to process (default: unlimited)
 *   --dry-run           Show what would be done without making changes
 */

const { Pool } = require('pg');
const { extractAllAddresses } = require('../services/indexer/addressExtractor');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  chain: null,
  batchSize: 1000,
  limit: null,
  dryRun: false
};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chain' && args[i + 1]) {
    options.chain = args[i + 1];
    i++;
  } else if (args[i] === '--batch-size' && args[i + 1]) {
    options.batchSize = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--limit' && args[i + 1]) {
    options.limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--dry-run') {
    options.dryRun = true;
  }
}

// Initialize database connection
const pgPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'pokt',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function backfillAddresses() {
  const client = await pgPool.connect();
  
  try {
    console.log('Starting transaction addresses backfill...');
    console.log('Options:', JSON.stringify(options, null, 2));
    
    if (options.dryRun) {
      console.log('DRY RUN MODE - No changes will be made');
    }

    // Build query to find transactions that need address extraction
    let query = `
      SELECT id, hash, sender, recipient, tx_data, chain
      FROM transactions
      WHERE tx_data IS NOT NULL
    `;
    
    const queryParams = [];
    let paramIndex = 1;

    if (options.chain) {
      query += ` AND chain = $${paramIndex}`;
      queryParams.push(options.chain);
      paramIndex++;
    }

    // Optionally filter for transactions without addresses populated
    // For initial backfill, we'll process all transactions to ensure consistency
    query += ` ORDER BY timestamp ASC`;

    if (options.limit) {
      query += ` LIMIT $${paramIndex}`;
      queryParams.push(options.limit);
    }

    console.log('Fetching transactions...');
    const result = await client.query(query, queryParams);
    const transactions = result.rows;
    
    console.log(`Found ${transactions.length} transactions to process`);

    if (transactions.length === 0) {
      console.log('No transactions to process');
      return;
    }

    let processed = 0;
    let updated = 0;
    let errors = 0;
    const startTime = Date.now();

    // Process in batches
    for (let i = 0; i < transactions.length; i += options.batchSize) {
      const batch = transactions.slice(i, i + options.batchSize);
      console.log(`Processing batch ${Math.floor(i / options.batchSize) + 1} (${batch.length} transactions)...`);

      for (const tx of batch) {
        try {
          // Extract addresses
          let addresses = null;
          try {
            const txData = typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data;
            addresses = extractAllAddresses(
              { sender: tx.sender, recipient: tx.recipient },
              txData
            );
            
            // Convert to array format (null if empty)
            addresses = addresses && addresses.length > 0 ? addresses : null;
          } catch (extractError) {
            console.warn(`Failed to extract addresses for ${tx.hash}:`, extractError.message);
            errors++;
            processed++;
            continue;
          }

          // Update transaction if addresses were found or if we want to set null explicitly
          if (!options.dryRun) {
            await client.query(
              `UPDATE transactions SET addresses = $1 WHERE id = $2`,
              [addresses, tx.id]
            );
          }

          if (addresses && addresses.length > 0) {
            updated++;
            if (processed % 100 === 0) {
              console.log(`  Processed ${processed + 1}/${transactions.length}, updated: ${updated}, errors: ${errors}`);
            }
          }

          processed++;
        } catch (error) {
          console.error(`Error processing transaction ${tx.hash}:`, error.message);
          errors++;
          processed++;
        }
      }

      // Log progress after each batch
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const rate = (processed / elapsed).toFixed(2);
      console.log(`Progress: ${processed}/${transactions.length} (${rate} tx/sec), Updated: ${updated}, Errors: ${errors}`);
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n=== Backfill Complete ===');
    console.log(`Total processed: ${processed}`);
    console.log(`Total updated: ${updated}`);
    console.log(`Total errors: ${errors}`);
    console.log(`Time elapsed: ${totalTime} seconds`);
    console.log(`Average rate: ${(processed / parseFloat(totalTime)).toFixed(2)} tx/sec`);

    if (options.dryRun) {
      console.log('\nDRY RUN - No changes were made');
    }

  } catch (error) {
    console.error('Fatal error during backfill:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run the backfill
backfillAddresses()
  .then(() => {
    console.log('Backfill completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  })
  .finally(() => {
    pgPool.end();
  });

