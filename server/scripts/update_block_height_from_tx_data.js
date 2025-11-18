/**
 * Update block_height in transactions table from tx_data JSONB column
 * This script extracts block_height from tx_data->'tx_response'->>'height'
 * and updates only rows where block_height IS NULL
 * 
 * Usage: node scripts/update_block_height_from_tx_data.js [--chain=chain_name] [--batch-size=1000] [--limit=null] [--dry-run]
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

async function updateBlockHeightFromTxData(options = {}) {
  const {
    chain = null,
    batchSize = 1000,
    limit = null,
    dryRun = false
  } = options;

  try {
    console.log('Starting block_height update from tx_data...');
    console.log(`Chain: ${chain || 'all'}, Batch size: ${batchSize}, Limit: ${limit || 'unlimited'}, Dry run: ${dryRun ? 'YES' : 'NO'}`);

    // Show initial statistics
    let statsQuery = 'SELECT COUNT(*) as total, COUNT(block_height) as with_height, COUNT(*) - COUNT(block_height) as missing_height FROM transactions';
    const statsParams = [];
    if (chain) {
      statsQuery += ' WHERE chain = $1';
      statsParams.push(chain);
    }
    const initialStats = await pool.query(statsQuery, statsParams);
    console.log('\nInitial statistics:');
    console.log(`  Total transactions: ${initialStats.rows[0].total}`);
    console.log(`  With block_height: ${initialStats.rows[0].with_height}`);
    console.log(`  Missing block_height: ${initialStats.rows[0].missing_height}\n`);

    let processed = 0;
    let updated = 0;
    let errors = 0;
    let offset = 0;

    while (true) {
      // Get batch of transactions with NULL block_height
      let query = `
        SELECT id, tx_data
        FROM transactions
        WHERE block_height IS NULL
          AND tx_data IS NOT NULL
      `;
      const params = [];
      let paramIdx = 1;

      if (chain) {
        query += ` AND chain = $${paramIdx}`;
        params.push(chain);
        paramIdx++;
      }

      query += ` ORDER BY timestamp DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(batchSize, offset);

      const result = await pool.query(query, params);

      if (result.rows.length === 0) {
        console.log('No more transactions to process');
        break;
      }

      // Extract block_height from JSONB and prepare updates
      const updates = [];
      for (const row of result.rows) {
        try {
          let txData = row.tx_data;
          
          // Handle both JSONB (object) and text-stored JSON
          if (typeof txData === 'string') {
            try {
              txData = JSON.parse(txData);
            } catch (parseError) {
              console.warn(`Error parsing tx_data string for ${row.id}:`, parseError.message);
              errors++;
              continue;
            }
          }
          
          // Extract height from tx_data->'tx_response'->>'height'
          const heightStr = txData?.tx_response?.height;
          if (heightStr) {
            const blockHeight = parseInt(heightStr, 10);
            if (!isNaN(blockHeight) && blockHeight > 0) {
              updates.push({ id: row.id, block_height: blockHeight });
            }
          }
        } catch (err) {
          console.warn(`Error processing tx_data for ${row.id}:`, err.message);
          errors++;
        }
      }

      // Batch update
      if (updates.length > 0) {
        if (dryRun) {
          console.log(`[DRY RUN] Would update ${updates.length} transactions`);
          // Show sample of what would be updated
          if (updates.length > 0) {
            console.log(`  Sample: ${updates.slice(0, 3).map(u => `${u.id} -> ${u.block_height}`).join(', ')}`);
          }
        } else {
          // Use a single transaction for batch update
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            
            // Use a prepared statement for better performance
            const updatePromises = updates.map(update => 
              client.query('UPDATE transactions SET block_height = $1 WHERE id = $2', 
                [update.block_height, update.id])
            );
            await Promise.all(updatePromises);
            
            await client.query('COMMIT');
            updated += updates.length;
          } catch (updateError) {
            await client.query('ROLLBACK');
            console.error('Error in batch update:', updateError.message);
            throw updateError;
          } finally {
            client.release();
          }
        }
      }

      processed += result.rows.length;
      offset += batchSize;

      const statusMsg = dryRun 
        ? `Processed: ${processed}, Would update: ${updated}, Errors: ${errors}, Current batch: ${result.rows.length}`
        : `Processed: ${processed}, Updated: ${updated}, Errors: ${errors}, Current batch: ${result.rows.length}`;
      console.log(statusMsg);

      if (limit && processed >= limit) {
        console.log(`Reached limit of ${limit}`);
        break;
      }

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Update complete! Processed: ${processed}, ${dryRun ? 'Would update' : 'Updated'}: ${updated}, Errors: ${errors}`);
    
    // Show final statistics
    if (!dryRun) {
      console.log('\nUpdating table statistics...');
      await pool.query('ANALYZE transactions');
      console.log('Statistics updated');
      
      const finalStats = await pool.query(statsQuery, statsParams);
      console.log('\nFinal statistics:');
      console.log(`  Total transactions: ${finalStats.rows[0].total}`);
      console.log(`  With block_height: ${finalStats.rows[0].with_height}`);
      console.log(`  Missing block_height: ${finalStats.rows[0].missing_height}`);
    }

  } catch (error) {
    console.error('Error during update:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

args.forEach(arg => {
  if (arg.startsWith('--chain=')) {
    options.chain = arg.split('=')[1];
  } else if (arg.startsWith('--batch-size=')) {
    options.batchSize = parseInt(arg.split('=')[1], 10);
  } else if (arg.startsWith('--limit=')) {
    const limit = arg.split('=')[1];
    options.limit = limit === 'null' ? null : parseInt(limit, 10);
  } else if (arg === '--dry-run') {
    options.dryRun = true;
  }
});

updateBlockHeightFromTxData(options)
  .then(() => {
    console.log('Script completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
  });

