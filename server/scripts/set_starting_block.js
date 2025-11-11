#!/usr/bin/env node

/**
 * Script to set the starting block number for historical indexing
 * 
 * Usage:
 *   node scripts/set_starting_block.js --chain=pocket-mainnet --height=1000000
 * 
 * This updates the historical_sync table to set the checkpoint for the specified chain.
 * The indexer will start indexing from this block number (or continue from here if it's lower than current).
 */

const { Client } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

// Parse command line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    chain: null,
    height: null,
    help: false
  };

  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--chain=')) {
      options.chain = arg.split('=')[1];
    } else if (arg.startsWith('--height=')) {
      options.height = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--block=')) {
      options.height = parseInt(arg.split('=')[1], 10);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
Set Starting Block Number for Historical Indexing

Usage:
  node scripts/set_starting_block.js --chain=<chain_name> --height=<block_number>

Options:
  --chain=<name>     Chain name (must match the RPC name in RPC_ENDPOINTS)
                     Example: pocket-mainnet
  --height=<number>  Block height to start from (or --block=<number>)
  --help, -h         Show this help message

Examples:
  # Set starting block for pocket-mainnet to block 1000000
  node scripts/set_starting_block.js --chain=pocket-mainnet --height=1000000

  # Set starting block for mainnet to block 500000
  node scripts/set_starting_block.js --chain=mainnet --height=500000

Note:
  - The chain name must match the name used in your RPC_ENDPOINTS configuration
  - Setting a height will update the historical_sync checkpoint
  - The indexer will start from this block on the next run
  - If you set a height lower than already processed blocks, it will skip existing blocks
`);
}

async function setStartingBlock(chain, height) {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'somestringpassword',
    database: process.env.DB_NAME || 'pokt_indexer',
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Validate height
    if (!Number.isInteger(height) || height < 0) {
      throw new Error(`Invalid height: ${height}. Must be a non-negative integer.`);
    }

    // Check current checkpoint
    const currentRes = await client.query(
      'SELECT last_height, updated_at FROM historical_sync WHERE chain = $1',
      [chain]
    );

    if (currentRes.rows.length > 0) {
      const currentHeight = parseInt(currentRes.rows[0].last_height, 10);
      const updatedAt = currentRes.rows[0].updated_at;
      console.log(`📊 Current checkpoint for ${chain}:`);
      console.log(`   Height: ${currentHeight}`);
      console.log(`   Updated: ${updatedAt}`);
    } else {
      console.log(`📊 No existing checkpoint found for ${chain}`);
    }

    // Update or insert the checkpoint
    await client.query(
      `INSERT INTO historical_sync (chain, last_height, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (chain) DO UPDATE SET 
         last_height = EXCLUDED.last_height, 
         updated_at = NOW()`,
      [chain, height]
    );

    console.log(`\n✅ Successfully set starting block for ${chain} to height ${height}`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Restart the indexer server to apply the new checkpoint`);
    console.log(`   2. The indexer will start indexing from block ${height}`);
    console.log(`   3. Monitor progress at: http://localhost:3007/api/v1/health/workers`);

  } catch (error) {
    console.error('❌ Error setting starting block:', error.message);
    if (error.code === '42P01') {
      console.error('   Database table "historical_sync" does not exist. Please run migrations first.');
    } else if (error.code === '28P01' || error.code === '3D000') {
      console.error('   Database connection failed. Please check your database credentials.');
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

async function main() {
  const options = parseArguments();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (!options.chain) {
    console.error('❌ Error: --chain parameter is required');
    console.error('   Use --help for usage information');
    process.exit(1);
  }

  if (options.height === null) {
    console.error('❌ Error: --height parameter is required');
    console.error('   Use --help for usage information');
    process.exit(1);
  }

  await setStartingBlock(options.chain, options.height);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

