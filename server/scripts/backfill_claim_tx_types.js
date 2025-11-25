#!/usr/bin/env node

/**
 * Backfill script to update transaction types from 'unknown' to 'MsgCreateClaim (proof)'
 * for transactions that contain MsgCreateClaim messages
 * 
 * Usage: node server/scripts/backfill_claim_tx_types.js [options]
 * 
 * Options:
 *   --chain <chain>     Process only transactions for specific chain
 *   --batch-size <n>    Number of transactions to process per batch (default: 1000)
 *   --limit <n>         Maximum number of transactions to process (default: unlimited)
 *   --dry-run           Show what would be done without making changes
 */

const { Pool } = require('pg');

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

/**
 * Check if a transaction contains MsgCreateClaim messages
 */
function hasMsgCreateClaim(txData) {
  try {
    const data = typeof txData === 'string' ? JSON.parse(txData) : txData;
    const messages = data?.tx?.body?.messages || data?.body?.messages || data?.messages || [];
    
    for (const msg of messages) {
      const msgType = msg?.['@type'] || msg?.type || '';
      // Check for both formats: /pocket.proof.MsgCreateClaim and pocket.proof.MsgCreateClaim
      if (msgType.includes('pocket.proof.MsgCreateClaim')) {
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function backfillClaimTxTypes() {
  const client = await pgPool.connect();
  
  try {
    console.log('Starting transaction type backfill for MsgCreateClaim...');
    console.log('Options:', JSON.stringify(options, null, 2));
    
    if (options.dryRun) {
      console.log('DRY RUN MODE - No changes will be made');
    }

    // Get total count for progress tracking
    let totalCount = null;
    try {
      let countQuery = `
        SELECT COUNT(*) as total
        FROM transactions
        WHERE type = 'unknown' AND tx_data IS NOT NULL
      `;
      const countParams = [];
      if (options.chain) {
        countQuery += ` AND chain = $1`;
        countParams.push(options.chain);
      }
      const countResult = await client.query(countQuery, countParams);
      totalCount = parseInt(countResult.rows[0].total, 10);
      console.log(`Total unknown transactions to check: ${totalCount.toLocaleString()}`);
    } catch (countError) {
      console.warn('Could not get total count:', countError.message);
      console.log('Proceeding without total count...');
    }

    let processed = 0;
    let updated = 0;
    let errors = 0;
    const startTime = Date.now();
    let lastId = null; // For cursor-based pagination

    // Build base WHERE conditions
    const baseConditions = ["type = 'unknown'", 'tx_data IS NOT NULL'];
    const baseParams = [];
    let paramIndex = 1;

    if (options.chain) {
      baseConditions.push(`chain = $${paramIndex}`);
      baseParams.push(options.chain);
      paramIndex++;
    }

    // Use cursor-based pagination
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
      if (lastId) {
        conditions.push(`id > $${queryParamIndex}`);
        queryParams.push(lastId);
        queryParamIndex++;
      }

      // Build the complete query
      const query = `
        SELECT id, hash, tx_data, chain, timestamp, type
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

      console.log(`\nProcessing batch ${batchNumber} (${transactions.length} transactions)...`);

      // Process transactions in this batch
      for (const tx of transactions) {
        try {
          // Check if transaction contains MsgCreateClaim
          if (hasMsgCreateClaim(tx.tx_data)) {
            if (!options.dryRun) {
              await client.query(
                `UPDATE transactions SET type = $1 WHERE id = $2`,
                ['MsgCreateClaim (proof)', tx.id]
              );
            }
            updated++;
            if (options.dryRun) {
              console.log(`  Would update: ${tx.hash} -> MsgCreateClaim (proof)`);
            }
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
backfillClaimTxTypes()
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



