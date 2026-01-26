/**
 * Backfill Service Configs
 * 
 * Populates supplier_service_configs and application_service_configs tables
 * from historical MsgStakeSupplier and MsgStakeApplication transactions
 * 
 * Usage:
 *   node server/scripts/backfill_service_configs.js [options]
 * 
 * Options:
 *   --chain <chain>          Process only transactions for specific chain (default: pocket-mainnet)
 *   --batch-size <n>         Number of transactions to process per batch (default: 100)
 *   --type <type>            Process 'suppliers', 'applications', or 'both' (default: both)
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
    type: 'both', // 'suppliers', 'applications', or 'both'
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
    } else if (arg.startsWith('--type=')) {
      options.type = arg.split('=')[1];
    }
    // Handle --key value format
    else if (arg === '--chain' && args[i + 1]) {
      options.chain = args[i + 1];
      i++;
    } else if (arg === '--batch-size' && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--type' && args[i + 1]) {
      options.type = args[i + 1];
      i++;
    }
    // Handle flags
    else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  // Validate type
  if (options.type && !['suppliers', 'applications', 'both'].includes(options.type)) {
    console.error(`Invalid --type value: ${options.type}. Must be 'suppliers', 'applications', or 'both'`);
    process.exit(1);
  }

  return options;
}

// Show help message
function showHelp() {
  console.log(`
Backfill Service Configs

Populates supplier_service_configs and application_service_configs tables
from historical MsgStakeSupplier and MsgStakeApplication transactions.

Usage:
  node server/scripts/backfill_service_configs.js [options]

Options:
  --chain <chain>          Process only transactions for specific chain
                           (default: pocket-mainnet)
  --batch-size <n>         Number of transactions to process per batch
                           (default: 100)
  --type <type>            Process 'suppliers', 'applications', or 'both'
                           (default: both)
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
  node server/scripts/backfill_service_configs.js

  # Process only suppliers for pocket-mainnet
  node server/scripts/backfill_service_configs.js --chain=pocket-mainnet --type=suppliers

  # Dry run with custom batch size
  node server/scripts/backfill_service_configs.js --chain=pocket-testnet-beta --batch-size=50 --dry-run

  # Process applications only
  node server/scripts/backfill_service_configs.js --type=applications
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

// Parse MsgStakeSupplier transaction data
function parseSupplierServiceConfigs(tx) {
  try {
    const configs = [];
    
    // Parse tx_data JSON
    const txData = typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data;
    
    // Get messages from tx_data.body.messages or tx_data.tx.body.messages
    const messages = txData?.body?.messages || txData?.tx?.body?.messages || [];
    
    for (const msg of messages) {
      // Check if this is a MsgStakeSupplier message
      const msgType = msg['@type'] || '';
      if (msgType.includes('MsgStakeSupplier')) {
        const operatorAddress = msg.operator_address;
        const services = msg.services || [];
        
        if (operatorAddress && Array.isArray(services)) {
          for (const service of services) {
            if (service.service_id) {
              configs.push({
                supplier_address: operatorAddress,
                chain: tx.chain,
                service_id: service.service_id,
                endpoints: Array.isArray(service.endpoints) ? service.endpoints : [],
                config_options: service.config_options || {},
                last_seen: tx.timestamp
              });
            }
          }
        }
      }
    }
    
    return configs;
  } catch (error) {
    console.error('Error parsing supplier service configs from tx:', tx.hash, error.message);
    return [];
  }
}

// Parse MsgStakeApplication transaction data
function parseApplicationServiceConfigs(tx) {
  try {
    const configs = [];
    
    // Parse tx_data JSON
    const txData = typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data;
    
    // Get messages from tx_data.body.messages or tx_data.tx.body.messages
    const messages = txData?.body?.messages || txData?.tx?.body?.messages || [];
    
    for (const msg of messages) {
      // Check if this is a MsgStakeApplication message
      const msgType = msg['@type'] || '';
      if (msgType.includes('MsgStakeApplication')) {
        const appAddress = msg.address;
        const services = msg.services || [];
        
        if (appAddress && Array.isArray(services)) {
          for (const service of services) {
            if (service.service_id) {
              configs.push({
                application_address: appAddress,
                chain: tx.chain,
                service_id: service.service_id,
                endpoints: Array.isArray(service.endpoints) ? service.endpoints : [],
                config_options: service.config_options || {},
                last_seen: tx.timestamp
              });
            }
          }
        }
      }
    }
    
    return configs;
  } catch (error) {
    console.error('Error parsing application service configs from tx:', tx.hash, error.message);
    return [];
  }
}

// Insert supplier service config
async function insertSupplierServiceConfig(config) {
  try {
    await pool.query(
      `INSERT INTO supplier_service_configs (supplier_address, chain, service_id, endpoints, config_options, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (supplier_address, chain, service_id) DO UPDATE SET
         endpoints = EXCLUDED.endpoints,
         config_options = EXCLUDED.config_options,
         last_seen = GREATEST(supplier_service_configs.last_seen, EXCLUDED.last_seen)`,
      [
        config.supplier_address,
        config.chain,
        config.service_id,
        config.endpoints,
        config.config_options,
        config.last_seen
      ]
    );
  } catch (error) {
    console.error('Error inserting supplier service config:', error.message);
    throw error;
  }
}

// Insert application service config
async function insertApplicationServiceConfig(config) {
  try {
    await pool.query(
      `INSERT INTO application_service_configs (application_address, chain, service_id, endpoints, config_options, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (application_address, chain, service_id) DO UPDATE SET
         endpoints = EXCLUDED.endpoints,
         config_options = EXCLUDED.config_options,
         last_seen = GREATEST(application_service_configs.last_seen, EXCLUDED.last_seen)`,
      [
        config.application_address,
        config.chain,
        config.service_id,
        config.endpoints,
        config.config_options,
        config.last_seen
      ]
    );
  } catch (error) {
    console.error('Error inserting application service config:', error.message);
    throw error;
  }
}

// Main backfill function
async function backfillServiceConfigs() {
  // Use CLI options, fallback to env vars, then defaults
  const chain = cliOptions.chain || process.env.CHAIN || 'pocket-mainnet';
  const batchSize = cliOptions.batchSize || parseInt(process.env.BATCH_SIZE || '100', 10);
  const type = cliOptions.type || 'both';
  const dryRun = cliOptions.dryRun || false;
  
  console.log('Starting service configs backfill...');
  console.log(`Chain: ${chain}`);
  console.log(`Batch Size: ${batchSize}`);
  console.log(`Type: ${type}`);
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
    
    // Count total application stake transactions
    const appCountResult = await pool.query(
      `SELECT COUNT(*) FROM transactions 
       WHERE type = 'MsgStakeApplication (application)' AND chain = $1`,
      [chain]
    );
    const totalAppTxs = parseInt(appCountResult.rows[0].count, 10);
    console.log(`Total MsgStakeApplication transactions: ${totalAppTxs}`);
    
    // Process supplier transactions in batches
    let supplierOffset = 0;
    let supplierConfigsInserted = 0;
    
    if (type === 'suppliers' || type === 'both') {
      console.log('\nProcessing supplier transactions...');
      while (supplierOffset < totalSupplierTxs) {
      const result = await pool.query(
        `SELECT hash, chain, timestamp, tx_data 
         FROM transactions 
         WHERE type = 'MsgStakeSupplier (supplier)' AND chain = $1
         ORDER BY block_height ASC
         LIMIT $2 OFFSET $3`,
        [chain, batchSize, supplierOffset]
      );
      
      if (result.rows.length === 0) break;
      
      for (const tx of result.rows) {
        const configs = parseSupplierServiceConfigs(tx);
        
        for (const config of configs) {
          if (!dryRun) {
            await insertSupplierServiceConfig(config);
          }
          supplierConfigsInserted++;
        }
      }
      
      supplierOffset += result.rows.length;
      console.log(`Processed ${supplierOffset}/${totalSupplierTxs} supplier transactions, ${dryRun ? 'would insert' : 'inserted'} ${supplierConfigsInserted} configs`);
    }
    
    console.log(`\nSupplier service configs ${dryRun ? 'would be inserted' : 'inserted'}: ${supplierConfigsInserted}`);
    } else {
      console.log('\nSkipping supplier transactions (--type excludes suppliers)');
    }
    
    // Process application transactions in batches
    let appOffset = 0;
    let appConfigsInserted = 0;
    
    if (type === 'applications' || type === 'both') {
      console.log('\nProcessing application transactions...');
      while (appOffset < totalAppTxs) {
      const result = await pool.query(
        `SELECT hash, chain, timestamp, tx_data 
         FROM transactions 
         WHERE type = 'MsgStakeApplication (application)' AND chain = $1
         ORDER BY block_height ASC
         LIMIT $2 OFFSET $3`,
        [chain, batchSize, appOffset]
      );
      
      if (result.rows.length === 0) break;
      
      for (const tx of result.rows) {
        const configs = parseApplicationServiceConfigs(tx);
        
        for (const config of configs) {
          if (!dryRun) {
            await insertApplicationServiceConfig(config);
          }
          appConfigsInserted++;
        }
      }
      
      appOffset += result.rows.length;
      console.log(`Processed ${appOffset}/${totalAppTxs} application transactions, ${dryRun ? 'would insert' : 'inserted'} ${appConfigsInserted} configs`);
    }
    
    console.log(`\nApplication service configs ${dryRun ? 'would be inserted' : 'inserted'}: ${appConfigsInserted}`);
    } else {
      console.log('\nSkipping application transactions (--type excludes applications)');
    }
    
    // Summary
    console.log('\n=== Backfill Summary ===');
    console.log(`Supplier service configs: ${supplierConfigsInserted}`);
    console.log(`Application service configs: ${appConfigsInserted}`);
    console.log(`Total configs: ${supplierConfigsInserted + appConfigsInserted}`);
    
    if (!dryRun) {
      // Show final counts only if we actually made changes
      const finalSupplierCount = await pool.query(
        `SELECT COUNT(*) FROM supplier_service_configs WHERE chain = $1`,
        [chain]
      );
      const finalAppCount = await pool.query(
        `SELECT COUNT(*) FROM application_service_configs WHERE chain = $1`,
        [chain]
      );
      
      console.log(`\n=== Final Database Counts ===`);
      console.log(`Supplier service configs in DB: ${finalSupplierCount.rows[0].count}`);
      console.log(`Application service configs in DB: ${finalAppCount.rows[0].count}`);
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
  backfillServiceConfigs()
    .then(() => {
      console.log('Backfill script finished successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('Backfill script failed:', error);
      process.exit(1);
    });
}

module.exports = { backfillServiceConfigs };

