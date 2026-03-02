#!/usr/bin/env node

/**
 * Backfill script to update transaction types from 'unknown'
 * using the classifyTransaction helper from the indexer.
 *
 * It inspects the stored tx_data JSON (full RPC response),
 * calls classifyTransaction on the embedded tx object, and
 * updates the transactions.type column where appropriate.
 *
 * Usage: node server/scripts/backfill_unknown_tx_types.js [options]
 *
 * Options:
 *   --chain <chain>     Process only transactions for specific chain
 *   --batch-size <n>    Number of transactions to process per batch (default: 10)
 *   --limit <n>         Maximum number of transactions to process (default: unlimited)
 *   --dry-run           Show what would be done without making changes
 */

const { Pool } = require('pg');
const { classifyTransaction } = require('../services/indexer/entityParser');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  chain: null,
  batchSize: 10,
  limit: null, // Default: unlimited (process all)
  dryRun: false,
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

// Initialize database connection (favor env vars; defaults are safety nets)
const pgPool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'pocket_indexer',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

/**
 * Safely classify a transaction row using its tx_data JSON.
 * Expects tx_data to be the full RPC response object with a nested `tx` field.
 */
function classifyFromTxData(txRow) {
  try {
    if (!txRow || !txRow.tx_data) return 'unknown';

    const txData =
      typeof txRow.tx_data === 'string'
        ? JSON.parse(txRow.tx_data)
        : txRow.tx_data;

    if (!txData) return 'unknown';

    // Prefer the nested tx object (matches how the indexer uses classifyTransaction)
    const txForClassification = txData.tx || txData;

    return classifyTransaction(txForClassification) || 'unknown';
  } catch (error) {
    console.warn(
      `Error classifying transaction ${txRow.hash || txRow.id}:`,
      error.message
    );
    return 'unknown';
  }
}

async function backfillUnknownTxTypes() {
  const client = await pgPool.connect();

  try {
    console.log(
      "Starting transaction type backfill for transactions with type = 'unknown'..."
    );
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
      console.log(
        `Total unknown transactions with tx_data to check: ${totalCount.toLocaleString()}`
      );
    } catch (countError) {
      console.warn('Could not get total count:', countError.message);
      console.log('Proceeding without total count...');
    }

    let processed = 0;
    let updated = 0;
    let skipped = 0;
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

    // Cursor-based pagination
    const baseOrderBy = ` ORDER BY id ASC, timestamp ASC`;

    let hasMore = true;
    let batchNumber = 0;

    while (hasMore) {
      if (options.limit && processed >= options.limit) {
        console.log(`Reached limit of ${options.limit} transactions`);
        break;
      }

      batchNumber++;

      const conditions = [...baseConditions];
      const queryParams = [...baseParams];
      let queryParamIndex = paramIndex;

      if (lastId) {
        conditions.push(`id > $${queryParamIndex}`);
        queryParams.push(lastId);
        queryParamIndex++;
      }

      const query = `
        SELECT id, hash, tx_data, chain, timestamp, type
        FROM transactions
        WHERE ${conditions.join(' AND ')}
        ${baseOrderBy}
      `;

      const batchLimit = options.limit
        ? Math.min(options.batchSize, options.limit - processed)
        : options.batchSize;

      const finalQuery = query.trim() + ` LIMIT $${queryParamIndex}`;
      queryParams.push(batchLimit);

      const result = await client.query(finalQuery, queryParams);
      const transactions = result.rows;

      if (transactions.length === 0) {
        hasMore = false;
        console.log('No more transactions to process');
        break;
      }

      console.log(
        `\nProcessing batch ${batchNumber} (${transactions.length} transactions)...`
      );

      for (const tx of transactions) {
        try {
          const newType = classifyFromTxData(tx);

          if (!newType || newType === 'unknown') {
            skipped++;
          } else if (newType === tx.type) {
            skipped++;
          } else {
            if (!options.dryRun) {
              await client.query(
                `UPDATE transactions SET type = $1 WHERE id = $2`,
                [newType, tx.id]
              );
            }
            updated++;
            if (options.dryRun) {
              console.log(
                `  Would update: ${tx.hash} -> ${tx.type} => ${newType}`
              );
            }
          }

          processed++;
          lastId = tx.id;

          if (processed % 1000 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            const rate = (processed / elapsed).toFixed(2);
            const progress = totalCount
              ? `${processed.toLocaleString()}/${totalCount.toLocaleString()} (${(
                  (processed / totalCount) *
                  100
                ).toFixed(2)}%)`
              : `${processed.toLocaleString()}`;
            console.log(
              `  Progress: ${progress} | Rate: ${rate} tx/sec | Updated: ${updated.toLocaleString()} | Skipped: ${skipped.toLocaleString()} | Errors: ${errors.toLocaleString()}`
            );
          }
        } catch (error) {
          console.error(
            `Error processing transaction ${tx.hash}:`,
            error.message
          );
          errors++;
          processed++;
          lastId = tx.id;
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const rate = (processed / elapsed).toFixed(2);
      const progress = totalCount
        ? `${processed.toLocaleString()}/${totalCount.toLocaleString()} (${(
            (processed / totalCount) *
            100
          ).toFixed(2)}%)`
        : `${processed.toLocaleString()}`;
      console.log(
        `Batch ${batchNumber} complete: ${progress} | Rate: ${rate} tx/sec | Updated: ${updated.toLocaleString()} | Skipped: ${skipped.toLocaleString()} | Errors: ${errors.toLocaleString()}`
      );

      if (transactions.length < batchLimit) {
        hasMore = false;
        console.log('Reached end of transactions');
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n=== Backfill Complete ===');
    console.log(`Total processed: ${processed.toLocaleString()}`);
    console.log(`Total updated: ${updated.toLocaleString()}`);
    console.log(`Total skipped: ${skipped.toLocaleString()}`);
    console.log(`Total errors: ${errors.toLocaleString()}`);
    console.log(`Time elapsed: ${totalTime} seconds`);
    console.log(
      `Average rate: ${(processed / parseFloat(totalTime || '1')).toFixed(
        2
      )} tx/sec`
    );

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

backfillUnknownTxTypes()
  .then(() => {
    console.log('Backfill completed successfully');
  })
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  })
  .finally(() => {
    pgPool.end();
    process.exit(0);
  });

