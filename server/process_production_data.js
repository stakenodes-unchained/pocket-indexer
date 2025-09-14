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
  parseSuppliers, 
  parseApplications, 
  parseGateways, 
  parseNodes, 
  parseServices, 
  parseClaims, 
  parseRelays, 
  parseStakingEvents 
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
        suppliers: 0,
        applications: 0,
        gateways: 0,
        nodes: 0,
        services: 0,
        claims: 0,
        relays: 0,
        stakingEvents: 0
      },
      startTime: null,
      endTime: null
    };
    
    this.results = {
      suppliers: [],
      applications: [],
      gateways: [],
      nodes: [],
      services: [],
      claims: [],
      relays: [],
      stakingEvents: []
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
      
      console.log(`\n📦 Processing batch ${Math.floor(offset / this.batchSize) + 1}: ${transactions.length} transactions`);
      
      // Process each transaction in the batch
      for (const tx of transactions) {
        try {
          await this.processTransaction(tx);
          processedCount++;
          
          if (this.verbose && processedCount % 100 === 0) {
            console.log(`  📈 Processed ${processedCount} transactions...`);
          }
          
        } catch (error) {
          this.stats.errors++;
          console.error(`❌ Error processing transaction ${tx.hash}:`, error.message);
          
          if (this.verbose) {
            console.error('Transaction data:', JSON.stringify(tx, null, 2));
          }
        }
      }
      
      offset += transactions.length;
      
      // Show progress
      const progress = ((processedCount / this.stats.totalTransactions) * 100).toFixed(1);
      console.log(`📊 Progress: ${processedCount}/${this.stats.totalTransactions} (${progress}%)`);
    }
    
    this.stats.endTime = new Date();
    this.stats.processedTransactions = processedCount;
    
    console.log('\n🎉 Processing completed!');
    this.printSummary();
    
    if (this.saveResults) {
      await this.saveResultsToFile();
    }
  }

  async fetchTransactionBatch(offset, limit) {
    const query = `
      SELECT hash, chain, tx_data, timestamp, status
      FROM transactions 
      WHERE chain = $1
      AND (type ILIKE '%application%'
      OR type ILIKE '%supplier%'
      OR type ILIKE '%gateway%'
      OR type ILIKE '%node%'
      OR type ILIKE '%service%'
      OR type ILIKE '%claim%'
      OR type ILIKE '%relay%')
      ORDER BY timestamp ASC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await this.pgClient.query(query, [this.chain, limit, offset]);
    return result.rows;
  }

  async processTransaction(tx) {
    try {
      // Check if transaction was successful
      if (tx.status !== 'success' && tx.status !== '1') {
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
      
      // Parse all entity types using the inner transaction object (txData.tx)
      // The parsing functions expect tx.body.messages, which is in txData.tx.body.messages
      const suppliers = parseSuppliers(txData.tx, blockData, tx.chain);
      const applications = parseApplications(txData.tx, blockData, tx.chain);
      const gateways = parseGateways(txData.tx, blockData, tx.chain);
      const nodes = parseNodes(txData.tx, blockData, tx.chain);
      const services = parseServices(txData.tx, blockData, tx.chain);
      const claims = parseClaims(txData.tx, blockData, tx.chain);
      const relays = parseRelays(txData.tx, blockData, tx.chain);
      const stakingEvents = parseStakingEvents(txData.tx, blockData, tx.chain);
      
      // Update statistics
      this.stats.entities.suppliers += suppliers.length;
      this.stats.entities.applications += applications.length;
      this.stats.entities.gateways += gateways.length;
      this.stats.entities.nodes += nodes.length;
      this.stats.entities.services += services.length;
      this.stats.entities.claims += claims.length;
      this.stats.entities.relays += relays.length;
      this.stats.entities.stakingEvents += stakingEvents.length;
      
      // Store results if requested
      if (this.saveResults) {
        this.results.suppliers.push(...suppliers);
        this.results.applications.push(...applications);
        this.results.gateways.push(...gateways);
        this.results.nodes.push(...nodes);
        this.results.services.push(...services);
        this.results.claims.push(...claims);
        this.results.relays.push(...relays);
        this.results.stakingEvents.push(...stakingEvents);
      }
      
      // Verbose output for first few transactions
      if (this.verbose && this.stats.processedTransactions < 5) {
        console.log(`\n🔍 Transaction ${tx.hash}:`);
        console.log(`  Suppliers: ${suppliers.length}`);
        console.log(`  Applications: ${applications.length}`);
        console.log(`  Gateways: ${gateways.length}`);
        console.log(`  Nodes: ${nodes.length}`);
        console.log(`  Services: ${services.length}`);
        console.log(`  Claims: ${claims.length}`);
        console.log(`  Relays: ${relays.length}`);
        console.log(`  Staking Events: ${stakingEvents.length}`);
      }
      
    } catch (error) {
      throw new Error(`Failed to process transaction: ${error.message}`);
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
    console.log(`Suppliers: ${this.stats.entities.suppliers}`);
    console.log(`Applications: ${this.stats.entities.applications}`);
    console.log(`Gateways: ${this.stats.entities.gateways}`);
    console.log(`Nodes: ${this.stats.entities.nodes}`);
    console.log(`Services: ${this.stats.entities.services}`);
    console.log(`Claims: ${this.stats.entities.claims}`);
    console.log(`Relays: ${this.stats.entities.relays}`);
    console.log(`Staking Events: ${this.stats.entities.stakingEvents}`);
    
    const totalEntities = Object.values(this.stats.entities).reduce((sum, count) => sum + count, 0);
    console.log(`\nTotal Entities: ${totalEntities}`);
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
