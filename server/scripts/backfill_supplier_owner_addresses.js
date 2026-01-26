/**
 * Backfill Supplier Owner Addresses
 * 
 * Populates owner_address field in suppliers table from historical
 * MsgStakeSupplier transactions
 * 
 * Usage:
 *   node server/scripts/backfill_supplier_owner_addresses.js [options]
 * 
 * Options:
 *   --chain <chain>          Process only transactions for specific chain (default: pocket-mainnet)
 *   --batch-size <n>         Number of transactions to process per batch (default: 100)
 *   --dry-run                Show what would be done without making changes
 *   --help                   Show this help message
 * 
 * Environment Variables (used as fallback if CLI args not provided):
 *   DB_HOST                  Database host (default: localhost)
 *   DB_PORT                  Database port (default: 5432)
 *   DB_NAME                  Database name (default: pocket_indexer)
 *   DB_USER                  Database user (default: postgres)
 *   DB_PASS                  Database password (default: postgres)
 *   CHAIN                    Chain to process (default: pocket-mainnet)
 *   BATCH_SIZE               Batch size (default: 100)
 */

const dotenv = require('dotenv');
dotenv.config();

const { Pool } = require('pg');

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    chain: null,
    batchSize: null,
    dryRun: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    // Handle --key=value format
    if (arg.startsWith('--chain=')) {
      options.chain = arg.split('=')[1];
    } else if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10);
    }
    // Handle --key value format
    else if (arg === '--chain' && args[i + 1]) {
      options.chain = args[i + 1];
      i++;
    } else if (arg === '--batch-size' && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1], 10);
      i++;
    }
    // Handle flags
    else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
Backfill Supplier Owner Addresses

Populates owner_address field in suppliers table from historical
MsgStakeSupplier transactions.

Usage:
  node server/scripts/backfill_supplier_owner_addresses.js [options]

Options:
  --chain <chain>          Process only transactions for specific chain
                           (default: pocket-mainnet)
  --batch-size <n>         Number of transactions to process per batch
                           (default: 100)
  --dry-run                Show what would be done without making changes
  --help, -h               Show this help message

Environment Variables (used as fallback if CLI args not provided):
  DB_HOST                  Database host (default: localhost)
  DB_PORT                  Database port (default: 5432)
  DB_NAME                  Database name (default: pocket_indexer)
  DB_USER                  Database user (default: postgres)
  DB_PASS                  Database password (default: postgres)
  CHAIN                    Chain to process (default: pocket-mainnet)
  BATCH_SIZE               Batch size (default: 100)

Examples:
  # Process all chains with default settings
  node server/scripts/backfill_supplier_owner_addresses.js

  # Process only pocket-mainnet
  node server/scripts/backfill_supplier_owner_addresses.js --chain=pocket-mainnet

  # Dry run with custom batch size
  node server/scripts/backfill_supplier_owner_addresses.js --chain=pocket-mainnet --batch-size=50 --dry-run
`);
}

// Parse CLI arguments
const cliOptions = parseArgs();

// Show help and exit if requested
if (cliOptions.help) {
  showHelp();
  process.exit(0);
}

// Database configuration (CLI args override env vars, env vars override defaults)
// Note: Uses DB_PASS (not DB_PASSWORD) to match other scripts in this codebase
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'pocket_indexer',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || process.env.DB_PASSWORD || 'postgres', // Support both for compatibility
};

const pool = new Pool(dbConfig);

// Parse MsgStakeSupplier transaction data to extract owner_address
function parseSupplierOwnerAddress(tx) {
  try {
    // Parse tx_data JSON
    const txData = typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data;
    
    // Get messages from tx_data.body.messages or tx_data.tx.body.messages
    const messages = txData?.body?.messages || txData?.tx?.body?.messages || [];
    
    for (const msg of messages) {
      // Check if this is a MsgStakeSupplier message
      const msgType = msg['@type'] || '';
      if (msgType.includes('MsgStakeSupplier')) {
        const operatorAddress = msg.operator_address;
        const ownerAddress = msg.owner_address || msg.signer || null;
        
        if (operatorAddress && ownerAddress) {
          return {
            operator_address: operatorAddress,
            owner_address: ownerAddress,
            chain: tx.chain
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing supplier owner address from tx:', tx.hash, error.message);
    return null;
  }
}

// Update supplier owner address
async function updateSupplierOwnerAddress(operatorAddress, ownerAddress, chain, dryRun) {
  try {
    if (!dryRun) {
      await pool.query(
        `UPDATE suppliers 
         SET owner_address = $1 
         WHERE address = $2 AND chain = $3 
           AND (owner_address IS NULL OR owner_address = '')`,
        [ownerAddress, operatorAddress, chain]
      );
    }
    return true;
  } catch (error) {
    console.error('Error updating supplier owner address:', error.message);
    throw error;
  }
}

// Main backfill function
async function backfillSupplierOwnerAddresses() {
  // Use CLI options, fallback to env vars, then defaults
  const chain = cliOptions.chain || process.env.CHAIN || 'pocket-mainnet';
  const batchSize = cliOptions.batchSize || parseInt(process.env.BATCH_SIZE || '100', 10);
  const dryRun = cliOptions.dryRun || false;
  
  console.log('Starting supplier owner addresses backfill...');
  console.log(`Chain: ${chain}`);
  console.log(`Batch Size: ${batchSize}`);
  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No changes will be made to the database');
  }
  
  try {
    // Count total supplier stake transactions
    const supplierCountResult = await pool.query(
      `SELECT COUNT(*) FROM transactions 
       WHERE type = 'MsgStakeSupplier (supplier)' AND chain = $1`,
      [chain]
    );
    const totalSupplierTxs = parseInt(supplierCountResult.rows[0].count, 10);
    console.log(`Total MsgStakeSupplier transactions: ${totalSupplierTxs}`);
    
    // Count suppliers missing owner_address
    const missingCountResult = await pool.query(
      `SELECT COUNT(*) FROM suppliers 
       WHERE chain = $1 AND (owner_address IS NULL OR owner_address = '')`,
      [chain]
    );
    const totalMissing = parseInt(missingCountResult.rows[0].count, 10);
    console.log(`Suppliers missing owner_address: ${totalMissing}`);
    
    // Process supplier transactions in batches
    let offset = 0;
    let processed = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    console.log('\nProcessing supplier transactions...');
    while (offset < totalSupplierTxs) {
      const result = await pool.query(
        `SELECT hash, chain, timestamp, tx_data 
         FROM transactions 
         WHERE type = 'MsgStakeSupplier (supplier)' AND chain = $1
         ORDER BY block_height ASC
         LIMIT $2 OFFSET $3`,
        [chain, batchSize, offset]
      );
      
      if (result.rows.length === 0) break;
      
      for (const tx of result.rows) {
        try {
          const supplierData = parseSupplierOwnerAddress(tx);
          
          if (supplierData && supplierData.owner_address) {
            await updateSupplierOwnerAddress(
              supplierData.operator_address,
              supplierData.owner_address,
              supplierData.chain,
              dryRun
            );
            updated++;
          } else {
            skipped++;
          }
          processed++;
        } catch (error) {
          console.error(`Error processing tx ${tx.hash}:`, error.message);
          errors++;
          processed++;
        }
      }
      
      offset += result.rows.length;
      console.log(`Processed ${offset}/${totalSupplierTxs} transactions, ${dryRun ? 'would update' : 'updated'} ${updated} suppliers, skipped ${skipped}, errors ${errors}`);
    }
    
    console.log(`\n=== Backfill Summary ===`);
    console.log(`Transactions processed: ${processed}`);
    console.log(`Suppliers ${dryRun ? 'would be updated' : 'updated'}: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);
    
    if (!dryRun) {
      // Show final counts
      const finalCountResult = await pool.query(
        `SELECT 
           COUNT(*) AS total,
           COUNT(owner_address) FILTER (WHERE owner_address IS NOT NULL AND owner_address != '') AS with_owner
         FROM suppliers 
         WHERE chain = $1`,
        [chain]
      );
      
      const row = finalCountResult.rows[0];
      console.log(`\n=== Final Database Counts ===`);
      console.log(`Total suppliers: ${row.total}`);
      console.log(`Suppliers with owner_address: ${row.with_owner}`);
      console.log(`Suppliers missing owner_address: ${parseInt(row.total) - parseInt(row.with_owner)}`);
    } else {
      console.log('\n⚠️  DRY RUN - No changes were made to the database');
      console.log('Run without --dry-run to apply changes');
    }
    
    console.log('\nBackfill complete!');
  } catch (error) {
    console.error('Error during backfill:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the backfill
if (require.main === module) {
  backfillSupplierOwnerAddresses()
    .then(() => {
      console.log('Backfill script finished successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Backfill script failed:', error);
      process.exit(1);
    });
}

module.exports = { backfillSupplierOwnerAddresses };

