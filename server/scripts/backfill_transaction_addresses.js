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
  limit: null, // Default: unlimited (process all)
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

    // Get total count for progress tracking (optional, can be slow on large tables)
    let totalCount = null;
    try {
      let countQuery = `
        SELECT COUNT(*) as total
        FROM transactions
        WHERE tx_data IS NOT NULL AND addresses IS NULL
      `;
      const countParams = [];
      if (options.chain) {
        countQuery += ` AND chain = $1`;
        countParams.push(options.chain);
      }
      const countResult = await client.query(countQuery, countParams);
      totalCount = parseInt(countResult.rows[0].total, 10);
      console.log(`Total transactions to process: ${totalCount.toLocaleString()}`);
    } catch (countError) {
      console.warn('Could not get total count (this is OK for very large tables):', countError.message);
      console.log('Proceeding without total count...');
    }

    let processed = 0;
    let updated = 0;
    let errors = 0;
    const startTime = Date.now();
    let lastId = null; // For cursor-based pagination (more efficient than OFFSET)

    // Build base WHERE conditions
    const baseConditions = ['tx_data IS NOT NULL', 'addresses IS NULL'];
    const baseParams = [];
    let paramIndex = 1;

    if (options.chain) {
      baseConditions.push(`chain = $${paramIndex}`);
      baseParams.push(options.chain);
      paramIndex++;
    }

    // Use cursor-based pagination (more efficient than OFFSET for large datasets)
    // Order by (id, timestamp) for consistent pagination
    const baseOrderBy = ` ORDER BY id ASC, timestamp ASC`;

    // Fetch and process in batches
    let hasMore = true;
    let batchNumber = 0;

    while (hasMore) {
      // Check if we've hit the limit
      if (options.limit && processed >= options.limit) {
        console.log(`Reached limit of ${options.limit} transactions`);
        break;
      }

      batchNumber++;
      
      // Build query for this batch
      const conditions = [...baseConditions];
      const queryParams = [...baseParams];
      let queryParamIndex = paramIndex;

      // Use cursor-based pagination if we have a lastId
      // Since id is the primary key (unique), we can use simple id > lastId
      if (lastId) {
        conditions.push(`id > $${queryParamIndex}`);
        queryParams.push(lastId);
        queryParamIndex++;
      }

      // Build the complete query
      const query = `
        SELECT id, hash, sender, recipient, tx_data, chain, timestamp
        FROM transactions
        WHERE ${conditions.join(' AND ')}
        ${baseOrderBy}
      `;

      // Add LIMIT for batch size
      const batchLimit = options.limit 
        ? Math.min(options.batchSize, options.limit - processed)
        : options.batchSize;
      
      const finalQuery = query.trim() + ` LIMIT $${queryParamIndex}`;
      queryParams.push(batchLimit);

      // Fetch batch from database
      const result = await client.query(finalQuery, queryParams);
      const transactions = result.rows;
      
      if (transactions.length === 0) {
        hasMore = false;
        console.log('No more transactions to process');
        break;
      }

      console.log(`\nFetching batch ${batchNumber} (${transactions.length} transactions)...`);

      // Process transactions in this batch
      for (const tx of transactions) {
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
            lastId = tx.id; // Update cursor even on error
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
          }

          processed++;
          lastId = tx.id; // Update cursor for next batch

          // Log progress periodically
          if (processed % 1000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            const rate = (processed / elapsed).toFixed(2);
            const progress = totalCount 
              ? `${processed.toLocaleString()}/${totalCount.toLocaleString()} (${((processed / totalCount) * 100).toFixed(2)}%)`
              : `${processed.toLocaleString()}`;
            console.log(`  Progress: ${progress} | Rate: ${rate} tx/sec | Updated: ${updated.toLocaleString()} | Errors: ${errors.toLocaleString()}`);
          }
        } catch (error) {
          console.error(`Error processing transaction ${tx.hash}:`, error.message);
          errors++;
          processed++;
          lastId = tx.id; // Update cursor even on error
        }
      }

      // Log progress after each batch
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const rate = (processed / elapsed).toFixed(2);
      const progress = totalCount 
        ? `${processed.toLocaleString()}/${totalCount.toLocaleString()} (${((processed / totalCount) * 100).toFixed(2)}%)`
        : `${processed.toLocaleString()}`;
      console.log(`Batch ${batchNumber} complete: ${progress} | Rate: ${rate} tx/sec | Updated: ${updated.toLocaleString()} | Errors: ${errors.toLocaleString()}`);

      // Check if we got fewer results than requested (end of data)
      if (transactions.length < batchLimit) {
        hasMore = false;
        console.log('Reached end of transactions');
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n=== Backfill Complete ===');
    console.log(`Total processed: ${processed.toLocaleString()}`);
    console.log(`Total updated: ${updated.toLocaleString()}`);
    console.log(`Total errors: ${errors.toLocaleString()}`);
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

