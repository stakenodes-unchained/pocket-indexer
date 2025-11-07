/**
 * Backfill script to populate block_height column from tx_data JSONB
 * This optimizes queries by avoiding expensive JSONB extraction
 * 
 * Usage: node scripts/backfill_block_height.js [--chain=chain_name] [--batch-size=1000] [--limit=null]
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

async function backfillBlockHeight(options = {}) {
  const {
    chain = null,
    batchSize = 1000,
    limit = null
  } = options;

  try {
    console.log('Starting block_height backfill...');
    console.log(`Chain: ${chain || 'all'}, Batch size: ${batchSize}, Limit: ${limit || 'unlimited'}`);

    let processed = 0;
    let updated = 0;
    let offset = 0;

    while (true) {
      // Get batch of transactions with NULL block_height
      let query = `
        SELECT id, tx_data
        FROM transactions
        WHERE block_height IS NULL
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

      // Extract block_height from JSONB and update
      const updates = [];
      for (const row of result.rows) {
        try {
          const txData = typeof row.tx_data === 'string' 
            ? JSON.parse(row.tx_data) 
            : row.tx_data;
          
          const blockHeight = txData?.tx_response?.height 
            ? parseInt(txData.tx_response.height, 10) 
            : null;

          if (blockHeight !== null) {
            updates.push({ id: row.id, block_height: blockHeight });
          }
        } catch (err) {
          console.warn(`Error parsing tx_data for ${row.id}:`, err.message);
        }
      }

      // Batch update
      if (updates.length > 0) {
        const updatePromises = updates.map(update => 
          pool.query('UPDATE transactions SET block_height = $1 WHERE id = $2', 
            [update.block_height, update.id])
        );
        await Promise.all(updatePromises);
        updated += updates.length;
      }

      processed += result.rows.length;
      offset += batchSize;

      console.log(`Processed: ${processed}, Updated: ${updated}, Current batch: ${result.rows.length}`);

      if (limit && processed >= limit) {
        console.log(`Reached limit of ${limit}`);
        break;
      }

      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\nBackfill complete! Processed: ${processed}, Updated: ${updated}`);
    
    // Update statistics
    console.log('Updating table statistics...');
    await pool.query('ANALYZE transactions');
    console.log('Statistics updated');

  } catch (error) {
    console.error('Error during backfill:', error);
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
  }
});

backfillBlockHeight(options)
  .then(() => {
    console.log('Backfill completed successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });

