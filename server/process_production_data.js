#!/usr/bin/env node

/**
 * Production Data Processing Script
 * 
 * This script processes existing transactions from the production database
 * without making any changes to the database. It's designed to verify
 * that the entity parsing logic works correctly on real production data.
 * 
 * Usage:
 *   node process_production_data.js --chain pocket-mainnet
 *   node process_production_data.js --chain pocket-testnet-beta --batch-size 1000
 *   node process_production_data.js --chain pocket-testnet-alpha --limit 10000
 */

const { Client } = require('pg');
const { 
  parseApplications
} = require('./services/indexer/entityParser');
require('dotenv').config();

// Configuration
const CONFIG = {
  // Database connection (read-only)
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: process.env.DB_PORT || 5432,
  DB_NAME: process.env.DB_NAME || 'pokt_indexer',
  DB_USER: process.env.DB_USER || 'postgres',
  DB_PASSWORD: process.env.DB_PASS || 'somestringpassword',
  
  // Processing options
  DEFAULT_BATCH_SIZE: 1000,
  DEFAULT_LIMIT: null, // null = no limit
  MAX_BATCH_SIZE: 5000,
  
  // Output options
  VERBOSE: process.env.VERBOSE === 'true',
  SAVE_RESULTS: process.env.SAVE_RESULTS === 'true'
};

class ProductionDataProcessor {
  constructor(options = {}) {
    this.chain = options.chain;
    this.batchSize = Math.min(options.batchSize || CONFIG.DEFAULT_BATCH_SIZE, CONFIG.MAX_BATCH_SIZE);
    this.limit = options.limit || CONFIG.DEFAULT_LIMIT;
    this.verbose = options.verbose || CONFIG.VERBOSE;
    this.saveResults = options.saveResults || CONFIG.SAVE_RESULTS;
    
    this.pgClient = null;
    this.stats = {
      totalTransactions: 0,
      processedTransactions: 0,
      skippedTransactions: 0,
      errors: 0,
      entities: {
        applicationsUnique: 0,
        applicationEvents: 0
      },
      startTime: null,
      endTime: null
    };
    
    this.results = {
      applications: []
    };

    // In-memory application state accumulator
    this.applicationState = new Map(); // key: application address, value: state object
    this.applicationAddresses = new Set();

    // Debug counters to analyze parity issues
    this.debug = {
      delegationEventsWithStakeAmount: 0,
      stakeEventsFromTxEvents: 0,
      stakeEventsFromMsgBody: 0,
      stakeEventsMissingAmount: 0,
    };
  }

  async connect() {
    try {
      this.pgClient = new Client({
        host: CONFIG.DB_HOST,
        port: CONFIG.DB_PORT,
        database: CONFIG.DB_NAME,
        user: CONFIG.DB_USER,
        password: CONFIG.DB_PASSWORD,
        // Read-only connection
        application_name: 'production_data_processor'
      });
      
      await this.pgClient.connect();
      console.log(`✅ Connected to database: ${CONFIG.DB_HOST}:${CONFIG.DB_PORT}/${CONFIG.DB_NAME}`);
      
      // Verify chain exists
      const chainCheck = await this.pgClient.query(
        'SELECT COUNT(*) as count FROM transactions WHERE chain = $1',
        [this.chain]
      );
      
      this.stats.totalTransactions = parseInt(chainCheck.rows[0].count);
      console.log(`📊 Found ${this.stats.totalTransactions} transactions for chain: ${this.chain}`);
      
      if (this.stats.totalTransactions === 0) {
        throw new Error(`No transactions found for chain: ${this.chain}`);
      }
      
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.pgClient) {
      await this.pgClient.end();
      console.log('🔌 Disconnected from database');
    }
  }

  async processTransactions() {
    console.log(`\n🚀 Starting to process transactions for chain: ${this.chain}`);
    console.log(`📦 Batch size: ${this.batchSize}`);
    console.log(`🔢 Limit: ${this.limit || 'No limit'}`);
    console.log(`📝 Verbose: ${this.verbose ? 'Yes' : 'No'}`);
    console.log(`💾 Save results: ${this.saveResults ? 'Yes' : 'No'}`);
    
    this.stats.startTime = new Date();
    
    let offset = 0;
    let processedCount = 0;
    
    while (true) {
      // Check if we've hit the limit
      if (this.limit && processedCount >= this.limit) {
        console.log(`\n⏹️  Reached processing limit: ${this.limit}`);
        break;
      }
      
      // Calculate batch size for this iteration
      const currentBatchSize = this.limit ? 
        Math.min(this.batchSize, this.limit - processedCount) : 
        this.batchSize;
      
      if (currentBatchSize <= 0) break;
      
      // Fetch batch of transactions
      const transactions = await this.fetchTransactionBatch(offset, currentBatchSize);
      
      if (transactions.length === 0) {
        console.log('\n✅ No more transactions to process');
        break;
      }
      
      // Process each transaction in the batch
      for (const tx of transactions) {
        try {
          await this.processTransaction(tx);
          processedCount++;
          
          // Update progress in place every 10 transactions
          if (processedCount % 10 === 0) {
            const progress = ((processedCount / this.stats.totalTransactions) * 100).toFixed(1);
            process.stdout.write(`\r📊 Processing: ${processedCount}/${this.stats.totalTransactions} (${progress}%) | Batch ${Math.floor(offset / this.batchSize) + 1} | Errors: ${this.stats.errors}`);
          }
          
        } catch (error) {
          this.stats.errors++;
          console.error(`\n❌ Error processing transaction ${tx.hash}:`, error.message);
          
          if (this.verbose) {
            console.error('Transaction data:', JSON.stringify(tx, null, 2));
          }
        }
      }
      
      offset += transactions.length;
      
      // Final progress update for the batch
      const progress = ((processedCount / this.stats.totalTransactions) * 100).toFixed(1);
      process.stdout.write(`\r📊 Processing: ${processedCount}/${this.stats.totalTransactions} (${progress}%) | Batch ${Math.floor(offset / this.batchSize)} | Errors: ${this.stats.errors}`);
    }
    
    this.stats.endTime = new Date();
    this.stats.processedTransactions = processedCount;
    
    // Clear the progress line and show completion
    process.stdout.write('\r' + ' '.repeat(100) + '\r');
    console.log('🎉 Processing completed!');
    this.printSummary();
    
    if (this.saveResults) {
      await this.saveResultsToFile();
    }
  }

  async fetchTransactionBatch(offset, limit) {
    const query = `
      SELECT t.hash, t.chain, t.tx_data, t.timestamp, t.status
      FROM transactions t
      JOIN blocks b ON b.id = t.block_id AND b.chain = t.chain
      WHERE t.chain = $1
      ORDER BY b.height ASC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await this.pgClient.query(query, [this.chain, limit, offset]);
    return result.rows;
  }

  async processTransaction(tx) {
    try {
      // Check if transaction was successful
      if (!tx.status) {
        this.stats.skippedTransactions++;
        if (this.verbose) {
          console.log(`⏭️  Skipping failed transaction ${tx.hash} (status: ${tx.status})`);
        }
        return;
      }
      
      // Parse the transaction JSON from tx_data
      const txData = typeof tx.tx_data === 'string' ? 
        JSON.parse(tx.tx_data) : 
        tx.tx_data;
      
      // Check if tx_data exists and has the expected structure
      if (!txData || !txData.tx || !txData.tx_response) {
        this.stats.skippedTransactions++;
        if (this.verbose) {
          console.log(`⏭️  Skipping transaction ${tx.hash} - missing tx_data or invalid structure`);
        }
        return;
      }
      
      // Check if the transaction response was successful
      if (txData.tx_response.code !== 0) {
        this.stats.skippedTransactions++;
        if (this.verbose) {
          console.log(`⏭️  Skipping failed transaction ${tx.hash} (response code: ${txData.tx_response.code})`);
        }
        return;
      }
      
      // Create block data structure (same as worker.js)
      const blockData = {
        block: {
          header: {
            time: tx.timestamp
          }
        }
      };
      
      // Parse only applications, passing the full tx envelope (includes tx_response events)
      const applications = parseApplications(txData, blockData, tx.chain);
      
      // Update statistics
      this.stats.entities.applicationEvents += applications.length;
      
      // Store results if requested
      if (this.saveResults) {
        this.results.applications.push(...applications);
      }

      // Update in-memory application state
      for (const appEvent of applications) {
        // Debug: detect if delegation events mistakenly carry stake
        if (appEvent.status === 'delegated' && appEvent.staked_amount) {
          this.debug.delegationEventsWithStakeAmount++;
        }
        this.updateApplicationState(appEvent);
        if (appEvent.address) this.applicationAddresses.add(appEvent.address);
      }
      this.stats.entities.applicationsUnique = this.applicationAddresses.size;
      
      // Verbose output for first few transactions
      if (this.verbose && this.stats.processedTransactions < 5) {
        // Clear progress line before showing verbose output
        process.stdout.write('\r' + ' '.repeat(100) + '\r');
        console.log(`\n🔍 Transaction ${tx.hash}:`);
        console.log(`  Applications: ${applications.length}`);
      }
      
    } catch (error) {
      throw new Error(`Failed to process transaction: ${error.message}`);
    }
  }

  updateApplicationState(appEvent) {
    try {
      if (!appEvent || !appEvent.address) return;

      const existing = this.applicationState.get(appEvent.address) || {
        address: appEvent.address,
        staked_amount: '0',
        chains: [],
        delegated: false,
        gateway_address: null,
        status: 'unknown',
        unstake_session_end_height: undefined,
        last_seen: null
      };

      // Merge chains
      if (Array.isArray(appEvent.chains) && appEvent.chains.length > 0) {
        const merged = new Set([...(existing.chains || []), ...appEvent.chains]);
        existing.chains = Array.from(merged);
      }

      // Status-specific updates
      switch (appEvent.status) {
        case 'staked': {
          // On stake, set stake to provided staked_amount, else keep existing
          if (appEvent.staked_amount) {
            existing.staked_amount = appEvent.staked_amount;
          }
          existing.status = 'staked';
          break;
        }
        case 'edited': {
          if (appEvent.staked_amount) {
            existing.staked_amount = appEvent.staked_amount;
          }
          // Merge chains already handled above
          existing.status = 'edited';
          break;
        }
        case 'unstake_requested': {
          // Do not zero stake immediately; record session end height if provided
          if (appEvent.unstake_session_end_height) {
            existing.unstake_session_end_height = appEvent.unstake_session_end_height;
          }
          existing.status = 'unstake_requested';
          break;
        }
        case 'delegated': {
          existing.delegated = true;
          if (appEvent.gateway_address) existing.gateway_address = appEvent.gateway_address;
          existing.status = 'delegated';
          break;
        }
        case 'undelegated': {
          existing.delegated = false;
          existing.gateway_address = null;
          existing.status = 'undelegated';
          break;
        }
        case 'transferred': {
          // No direct state changes except status visibility
          existing.status = 'transferred';
          break;
        }
        case 'transfer_pending': {
          existing.status = 'transfer_pending';
          break;
        }
        case 'migrated': {
          existing.status = 'migrated';
          break;
        }
        default:
          break;
      }

      // Always update last_seen
      if (appEvent.last_seen) existing.last_seen = appEvent.last_seen;

      this.applicationState.set(appEvent.address, existing);
    } catch (e) {
      console.warn('Failed to update application state:', e.message);
    }
  }

  printSummary() {
    const duration = this.stats.endTime - this.stats.startTime;
    const durationSeconds = (duration / 1000).toFixed(2);
    
    console.log('\n📊 PROCESSING SUMMARY');
    console.log('='.repeat(50));
    console.log(`Chain: ${this.chain}`);
    console.log(`Total Transactions: ${this.stats.totalTransactions}`);
    console.log(`Processed Transactions: ${this.stats.processedTransactions}`);
    console.log(`Skipped Transactions: ${this.stats.skippedTransactions}`);
    console.log(`Errors: ${this.stats.errors}`);
    console.log(`Duration: ${durationSeconds} seconds`);
    console.log(`Rate: ${(this.stats.processedTransactions / (duration / 1000)).toFixed(2)} tx/sec`);
    
    console.log('\n📈 ENTITIES EXTRACTED');
    console.log('-'.repeat(30));
    console.log(`Applications (unique): ${this.stats.entities.applicationsUnique}`);
    console.log(`Application events: ${this.stats.entities.applicationEvents}`);
    
    const totalEntities = this.stats.entities.applicationEvents;
    console.log(`\nTotal Entities: ${totalEntities}`);
    
    // Show a snapshot of final application states (top 10 by address)
    if (this.applicationState.size > 0) {
      const sample = Array.from(this.applicationState.values())
        .sort((a, b) => a.address.localeCompare(b.address))
        .slice(0, 10);
      console.log('\n🗂️ Application State Sample (up to 10):');
      for (const s of sample) {
        console.log(`  - ${s.address} | status=${s.status} | staked=${s.staked_amount} | delegated=${s.delegated ? 'yes' : 'no'}${s.gateway_address ? ' | gateway=' + s.gateway_address : ''}`);
      }
    }

    // Diagnostics: simple histogram and anomaly checks
    const histogram = new Map();
    let count100000003 = 0;
    for (const s of this.applicationState.values()) {
      const key = s.staked_amount || 'undefined';
      histogram.set(key, (histogram.get(key) || 0) + 1);
      if (key === '100000003') count100000003++;
    }
    const topBuckets = Array.from(histogram.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    console.log(`\n🧪 Diagnostics:`);
    console.log(`  - Stake value top buckets: ${topBuckets}`);
    console.log(`  - Stake == 100000003 count: ${count100000003}`);
    console.log(`  - Delegation events with stake present (should be 0): ${this.debug.delegationEventsWithStakeAmount}`);
  }

  async saveResultsToFile() {
    const fs = require('fs').promises;
    const path = require('path');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `production_data_${this.chain}_${timestamp}.json`;
    const filepath = path.join(__dirname, filename);
    
    const output = {
      metadata: {
        chain: this.chain,
        processedAt: new Date().toISOString(),
        stats: this.stats
      },
      results: this.results
    };
    
    await fs.writeFile(filepath, JSON.stringify(output, null, 2));
    console.log(`\n💾 Results saved to: ${filename}`);
  }
}

// Command line argument parsing
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--chain':
        options.chain = args[++i];
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i]);
        break;
      case '--limit':
        options.limit = parseInt(args[++i]);
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--save-results':
        options.saveResults = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }
  
  return options;
}

function printHelp() {
  console.log(`
Production Data Processing Script

Usage:
  node process_production_data.js --chain <chain_name> [options]

Required:
  --chain <name>          Chain to process (e.g., pocket-mainnet, pocket-testnet-beta)

Options:
  --batch-size <number>   Batch size for processing (default: 1000, max: 5000)
  --limit <number>        Limit number of transactions to process (default: no limit)
  --verbose              Enable verbose output
  --save-results         Save parsed results to JSON file
  --help                 Show this help message

Examples:
  node process_production_data.js --chain pocket-mainnet
  node process_production_data.js --chain pocket-testnet-beta --batch-size 2000 --limit 5000
  node process_production_data.js --chain pocket-testnet-alpha --verbose --save-results

Environment Variables:
  DB_HOST                Database host (default: localhost)
  DB_PORT                Database port (default: 5432)
  DB_NAME                Database name (default: pokt_indexer)
  DB_USER                Database user (default: postgres)
  DB_PASSWORD            Database password (default: somestringpassword)
  VERBOSE                Enable verbose mode (default: false)
  SAVE_RESULTS           Save results to file (default: false)
`);
}

// Main execution
async function main() {
  try {
    const options = parseArguments();
    
    if (!options.chain) {
      console.error('❌ Error: --chain parameter is required');
      printHelp();
      process.exit(1);
    }
    
    const processor = new ProductionDataProcessor(options);
    
    await processor.connect();
    await processor.processTransactions();
    await processor.disconnect();
    
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = ProductionDataProcessor;
