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
  parseStakingEvents,
  parseRelationships
} = require('./services/indexer/entityParser.v2');
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

/**
 * Production Data Processor with Chronological Order Guarantee
 * 
 * RECONCILIATION STRATEGY:
 * 1. Database Query: ORDER BY b.height ASC ensures transactions are fetched in block order
 * 2. Batch Processing: Each batch maintains chronological order within the batch
 * 3. Parallel Parsing: Parse transactions in parallel (safe - no state mutation)
 * 4. Sequential State Application: Apply state changes in exact chronological order
 * 5. State Accumulation: In-memory Maps track latest state for each entity
 * 
 * This ensures that:
 * - Applications are processed in the exact order they appeared on-chain
 * - Stake changes, delegations, unstakes are applied in correct sequence
 * - Final state matches the actual blockchain state
 * - No race conditions or out-of-order state mutations
 */
class ProductionDataProcessor {
  constructor(options = {}) {
    this.chain = options.chain;
    this.batchSize = Math.min(options.batchSize || CONFIG.DEFAULT_BATCH_SIZE, CONFIG.MAX_BATCH_SIZE);
    this.limit = options.limit || CONFIG.DEFAULT_LIMIT;
    this.verbose = options.verbose || CONFIG.VERBOSE;
    this.saveResults = options.saveResults || CONFIG.SAVE_RESULTS;
    
    this.pgClient = null;
    
    // Performance optimizations
    this.parseInParallel = options.parseInParallel !== false; // Default to true
    this.maxConcurrency = options.maxConcurrency || 10;
    this.skipEmptyTransactions = options.skipEmptyTransactions !== false; // Default to true
    
    this.stats = {
      totalTransactions: 0,
      processedTransactions: 0,
      skippedTransactions: 0,
      errors: 0,
      entities: {
        applicationsUnique: 0,
        applicationEvents: 0,
        suppliers: 0,
        gateways: 0,
        nodes: 0,
        services: 0,
        claims: 0,
        relays: 0,
        stakingEvents: 0,
        appDelegations: 0,
        appServiceConfigs: 0
      },
      startTime: null,
      endTime: null
    };
    
    this.results = {
      applications: [],
      suppliers: [],
      gateways: [],
      nodes: [],
      services: [],
      claims: [],
      relays: [],
      stakingEvents: [],
      relationships: {
        applicationDelegations: [],
        applicationServiceConfigs: []
      }
    };

    // In-memory application state accumulator
    this.applicationState = new Map(); // key: application address, value: state object
    this.applicationAddresses = new Set();
    // In-memory state for suppliers and gateways
    this.supplierState = new Map(); // key: operator_address
    this.gatewayState = new Map(); // key: address
    this.supplierAddresses = new Set();
    this.gatewayAddresses = new Set();

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
      const batchNumber = Math.floor(offset / this.batchSize) + 1;
      const batchCounters = {
        applications: 0,
        suppliers: 0,
        gateways: 0,
        nodes: 0,
        services: 0,
        claims: 0,
        relays: 0,
        stakingEvents: 0,
        errors: 0
      };

      // Verify chronological order (critical for state reconciliation)
      if (!this.verifyChronologicalOrder(transactions)) {
        console.error(`❌ Chronological order violation detected in batch ${batchNumber}`);
        throw new Error('Chronological order violation - cannot proceed safely');
      }

      // Pre-filter transactions to skip empty/invalid ones early
      const validTransactions = transactions.filter(tx => {
        if (!tx.status || tx.status !== 'true') return false;
        if (!tx.tx_data) return false;
        try {
          const txData = typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data;
          return txData && txData.tx && txData.tx_response && txData.tx_response.code === 0;
        } catch {
          return false;
        }
      });

      if (this.parseInParallel && validTransactions.length > 1) {
        // CRITICAL: Process transactions in chronological order to maintain state consistency
        // We can parallelize parsing but must apply state changes sequentially
        const parseResults = [];
        
        // Parse all transactions in parallel (safe - no state mutation)
        const parsePromises = validTransactions.map(async (tx, index) => {
          try {
            const result = await this.parseTransactionOnly(tx);
            return { index, result, tx };
          } catch (error) {
            return { index, error, tx };
          }
        });
        
        const parseResults_raw = await Promise.allSettled(parsePromises);
        
        // Sort results by original index to maintain chronological order
        for (const result of parseResults_raw) {
          if (result.status === 'fulfilled') {
            parseResults.push(result.value);
          } else {
            this.stats.errors++;
            batchCounters.errors++;
            if (this.verbose) {
              console.error(`\n❌ Error parsing transaction:`, result.reason.message);
            }
          }
        }
        
        // Sort by original transaction order
        parseResults.sort((a, b) => a.index - b.index);
        
        // Apply state changes sequentially in chronological order
        for (const { result, tx } of parseResults) {
          if (result) {
            this.applyStateChanges(result, tx);
            batchCounters.applications += (result.applications?.length || 0);
            batchCounters.suppliers += (result.suppliers?.length || 0);
            batchCounters.gateways += (result.gateways?.length || 0);
            batchCounters.nodes += (result.nodes?.length || 0);
            batchCounters.services += (result.services?.length || 0);
            batchCounters.claims += (result.claims?.length || 0);
            batchCounters.relays += (result.relays?.length || 0);
            batchCounters.stakingEvents += (result.stakingEvents?.length || 0);
          }
          processedCount++;
        }
      } else {
        // Sequential processing (fallback) - maintains chronological order
        for (const tx of validTransactions) {
          try {
            const counts = await this.processTransaction(tx);
            if (counts) {
              batchCounters.applications += counts.applications || 0;
              batchCounters.suppliers += counts.suppliers || 0;
              batchCounters.gateways += counts.gateways || 0;
              batchCounters.nodes += counts.nodes || 0;
              batchCounters.services += counts.services || 0;
              batchCounters.claims += counts.claims || 0;
              batchCounters.relays += counts.relays || 0;
              batchCounters.stakingEvents += counts.stakingEvents || 0;
            }
            processedCount++;
        } catch (error) {
          this.stats.errors++;
            batchCounters.errors++;
            console.error(`\n❌ Error processing transaction ${tx.hash}:`, error.message);
          
          if (this.verbose) {
            console.error('Transaction data:', JSON.stringify(tx, null, 2));
          }
        }
      }
      }
      
      // Update skipped count
      this.stats.skippedTransactions += transactions.length - validTransactions.length;
      
      offset += transactions.length;
      
      // Final progress update for the batch (less frequent updates)
      const progress = ((processedCount / this.stats.totalTransactions) * 100).toFixed(1);
      if (batchNumber % 5 === 0 || batchNumber === 1) { // Update every 5 batches or first batch
        process.stdout.write(`\r📊 Processing: ${processedCount}/${this.stats.totalTransactions} (${progress}%) | Batch ${Math.floor(offset / this.batchSize)} | Errors: ${this.stats.errors}`);
      }

      // Print concise batch summary
      process.stdout.write('\r' + ' '.repeat(120) + '\r');
      console.log(`✅ Batch ${batchNumber} summary: tx=${transactions.length} valid=${validTransactions.length} | apps=${batchCounters.applications} sup=${batchCounters.suppliers} gw=${batchCounters.gateways} nodes=${batchCounters.nodes} svc=${batchCounters.services} claims=${batchCounters.claims} relays=${batchCounters.relays} stakeEv=${batchCounters.stakingEvents} | errors=${batchCounters.errors}`);
      
      // Debug: Show sample transaction if no entities found
      if (batchCounters.applications === 0 && batchCounters.suppliers === 0 && batchCounters.gateways === 0 && batchCounters.services === 0 && batchNumber <= 3) {
        console.log(`🔍 Debug: No entities found in batch ${batchNumber}. Sample transaction:`, {
          hash: validTransactions[0]?.hash,
          hasTxData: !!validTransactions[0]?.tx_data,
          txDataType: typeof validTransactions[0]?.tx_data
        });
      }
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

  // Verification method to ensure chronological order
  verifyChronologicalOrder(transactions) {
    if (transactions.length < 2) return true;
    
    for (let i = 1; i < transactions.length; i++) {
      const prev = transactions[i-1];
      const curr = transactions[i];
      
      // Compare block heights (should be ascending)
      if (prev.height && curr.height && prev.height > curr.height) {
        console.warn(`⚠️  Chronological order violation: ${prev.height} > ${curr.height}`);
        return false;
      }
      
      // Compare timestamps (should be ascending or equal)
      if (prev.timestamp && curr.timestamp && prev.timestamp > curr.timestamp) {
        console.warn(`⚠️  Timestamp order violation: ${prev.timestamp} > ${curr.timestamp}`);
        return false;
      }
    }
    
    return true;
  }

  async fetchTransactionBatch(offset, limit) {
    const query = `
      SELECT t.hash, t.chain, t.tx_data, t.timestamp, t.status
      FROM transactions t
      JOIN blocks b ON b.id = t.block_id AND b.chain = t.chain
      WHERE t.chain = $1
        AND t.status = 'true'
      ORDER BY b.height ASC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await this.pgClient.query(query, [this.chain, limit, offset]);
    return result.rows;
  }

  async parseTransactionOnly(tx) {
    // Parse transaction without applying state changes (safe for parallel processing)
    try {
      const txData = typeof tx.tx_data === 'string' ? 
        JSON.parse(tx.tx_data) : 
        tx.tx_data;
      
      const blockData = {
        block: {
          header: {
            time: tx.timestamp
          }
        }
      };
      
      // Early filtering: only parse entities if transaction has relevant message types
      const messages = txData?.tx?.body?.messages || [];
      const hasRelevantMessages = messages.some(msg => {
        const msgType = typeof msg?.['@type'] === 'string' ? msg['@type'] : '';
        // Handle both "/pocket.*" and "pocket.*" formats
        return msgType.includes('/pocket.') || msgType.includes('pocket.') || 
               msgType.includes('/cosmos.staking.') || msgType.includes('cosmos.staking.') || 
               msgType.includes('/cosmos.bank.') || msgType.includes('cosmos.bank.');
      });
      
      if (!hasRelevantMessages) {
        return { applications: 0, suppliers: 0, gateways: 0, nodes: 0, services: 0, claims: 0, relays: 0, stakingEvents: 0 };
      }
      
      // Debug: Log message types for first few transactions (temporarily disabled)
      // if (messages.length > 0) {
      //   const msgTypes = messages.map(msg => msg?.['@type']).filter(Boolean);
      //   console.log(`🔍 Debug: Transaction ${tx.hash} has messages:`, msgTypes.slice(0, 3));
      // }
      
      // Parse all entities (no state mutation)
      const applications = parseApplications(txData, blockData, tx.chain);
      const suppliers = parseSuppliers(txData, blockData, tx.chain);
      const gateways = parseGateways(txData, blockData, tx.chain);
      const nodes = parseNodes(txData, blockData, tx.chain);
      const services = parseServices(txData, blockData, tx.chain);
      const claims = parseClaims(txData, blockData, tx.chain);
      const relays = parseRelays(txData, blockData, tx.chain);
      const stakingEvents = parseStakingEvents(txData, blockData, tx.chain);
      const relationships = parseRelationships(txData, blockData, tx.chain);
      
      return {
        applications: applications || [],
        suppliers: suppliers || [],
        gateways: gateways || [],
        nodes: nodes || [],
        services: services || [],
        claims: claims || [],
        relays: relays || [],
        stakingEvents: stakingEvents || [],
        relationships: relationships || { applicationDelegations: [], applicationServiceConfigs: [] },
        txData,
        blockData,
        tx
      };
    } catch (error) {
      throw new Error(`Parse error for ${tx.hash}: ${error.message}`);
    }
  }

  applyStateChanges(parseResult, tx) {
    // Apply state changes sequentially to maintain chronological order
    const { applications, suppliers, gateways, relationships } = parseResult;
    const apps = Array.isArray(applications) ? applications : [];
    const sups = Array.isArray(suppliers) ? suppliers : [];
    const gws = Array.isArray(gateways) ? gateways : [];
    
    // Update statistics
    this.stats.entities.applicationEvents += apps.length;
    this.stats.entities.suppliers += sups.length;
    this.stats.entities.gateways += gws.length;
    this.stats.entities.appDelegations += (relationships?.applicationDelegations?.length || 0);
    this.stats.entities.appServiceConfigs += (relationships?.applicationServiceConfigs?.length || 0);
    
    // Save results if enabled
      if (this.saveResults) {
      if (apps.length) this.results.applications.push(...apps);
      if (sups.length) this.results.suppliers.push(...sups);
      if (gws.length) this.results.gateways.push(...gws);
        if (relationships?.applicationDelegations && Array.isArray(relationships.applicationDelegations)) {
          this.results.relationships.applicationDelegations.push(...relationships.applicationDelegations);
        }
        if (relationships?.applicationServiceConfigs && Array.isArray(relationships.applicationServiceConfigs)) {
          this.results.relationships.applicationServiceConfigs.push(...relationships.applicationServiceConfigs);
        }
      }
    
    // Update application state (chronological order critical)
    for (const appEvent of apps) {
      // Skip relationship records mistakenly mixed in
      if (appEvent && appEvent.type === 'relationship') continue;
      // Normalize possible field names
      if (appEvent && !appEvent.address && appEvent.application_address) {
        appEvent.address = appEvent.application_address;
      }
      this.updateApplicationState(appEvent);
    }
    
    // Update suppliers state (chronological order critical)
    for (const supEvent of sups) {
      this.updateSupplierState(supEvent);
    }
    
    // Update gateways state (chronological order critical)
    for (const gwEvent of gws) {
      this.updateGatewayState(gwEvent);
    }
  }

  async processTransaction(tx) {
    try {
      // Parse the transaction JSON from tx_data (already validated in filter)
      const txData = typeof tx.tx_data === 'string' ? 
        JSON.parse(tx.tx_data) : 
        tx.tx_data;
      
      // Create block data structure (same as worker.js)
      const blockData = {
        block: {
          header: {
            time: tx.timestamp
          }
        }
      };
      
      // Early filtering: only parse entities if transaction has relevant message types
      const messages = txData?.tx?.body?.messages || [];
      const hasRelevantMessages = messages.some(msg => {
        const msgType = typeof msg?.['@type'] === 'string' ? msg['@type'] : '';
        // Handle both "/pocket.*" and "pocket.*" formats
        return msgType.includes('/pocket.') || msgType.includes('pocket.') || 
               msgType.includes('/cosmos.staking.') || msgType.includes('cosmos.staking.') || 
               msgType.includes('/cosmos.bank.') || msgType.includes('cosmos.bank.');
      });
      
      if (!hasRelevantMessages) {
        return { applications: 0, suppliers: 0, gateways: 0, nodes: 0, services: 0, claims: 0, relays: 0, stakingEvents: 0 };
      }
      
      // Parse all entities, passing the full tx envelope (includes tx_response events)
      const applications = parseApplications(txData, blockData, tx.chain);
      const suppliers = parseSuppliers(txData, blockData, tx.chain);
      const gateways = parseGateways(txData, blockData, tx.chain);
      const nodes = parseNodes(txData, blockData, tx.chain);
      const services = parseServices(txData, blockData, tx.chain);
      const claims = parseClaims(txData, blockData, tx.chain);
      const relays = parseRelays(txData, blockData, tx.chain);
      const stakingEvents = parseStakingEvents(txData, blockData, tx.chain);
      const relationships = parseRelationships(txData, blockData, tx.chain);
      
      // Update statistics (defensive)
      this.stats.entities.applicationEvents += (Array.isArray(applications) ? applications.length : 0);
      this.stats.entities.suppliers += (Array.isArray(suppliers) ? suppliers.length : 0);
      this.stats.entities.gateways += (Array.isArray(gateways) ? gateways.length : 0);
      this.stats.entities.nodes += (Array.isArray(nodes) ? nodes.length : 0);
      this.stats.entities.services += (Array.isArray(services) ? services.length : 0);
      this.stats.entities.claims += (Array.isArray(claims) ? claims.length : 0);
      this.stats.entities.relays += (Array.isArray(relays) ? relays.length : 0);
      this.stats.entities.stakingEvents += (Array.isArray(stakingEvents) ? stakingEvents.length : 0);
      this.stats.entities.appDelegations += (relationships?.applicationDelegations?.length || 0);
      this.stats.entities.appServiceConfigs += (relationships?.applicationServiceConfigs?.length || 0);
      
      // Store results if requested
      if (this.saveResults) {
        if (Array.isArray(applications) && applications.length) this.results.applications.push(...applications);
        if (Array.isArray(suppliers) && suppliers.length) this.results.suppliers.push(...suppliers);
        if (Array.isArray(gateways) && gateways.length) this.results.gateways.push(...gateways);
        if (Array.isArray(nodes) && nodes.length) this.results.nodes.push(...nodes);
        if (Array.isArray(services) && services.length) this.results.services.push(...services);
        if (Array.isArray(claims) && claims.length) this.results.claims.push(...claims);
        if (Array.isArray(relays) && relays.length) this.results.relays.push(...relays);
        if (Array.isArray(stakingEvents) && stakingEvents.length) this.results.stakingEvents.push(...stakingEvents);
        if (relationships?.applicationDelegations && Array.isArray(relationships.applicationDelegations) && relationships.applicationDelegations.length) {
          this.results.relationships.applicationDelegations.push(...relationships.applicationDelegations);
        }
        if (relationships?.applicationServiceConfigs && Array.isArray(relationships.applicationServiceConfigs) && relationships.applicationServiceConfigs.length) {
          this.results.relationships.applicationServiceConfigs.push(...relationships.applicationServiceConfigs);
        }
      }

      // Update in-memory application state
      for (const raw of Array.isArray(applications) ? applications : []) {
        if (!raw || typeof raw !== 'object') continue;
        if (raw.type === 'relationship') continue;
        const appEvent = { ...raw };
        if (!appEvent.address && appEvent.application_address) appEvent.address = appEvent.application_address;
        // Debug: detect if delegation events mistakenly carry stake
        if (appEvent.status === 'delegated' && appEvent.staked_amount) {
          this.debug.delegationEventsWithStakeAmount++;
        }
        this.updateApplicationState(appEvent);
        if (appEvent.address) this.applicationAddresses.add(appEvent.address);
      }
      this.stats.entities.applicationsUnique = this.applicationAddresses.size;

      // Update suppliers state
      for (const supEvent of suppliers) {
        this.updateSupplierState(supEvent);
      }
      // Update gateways state
      for (const gwEvent of gateways) {
        this.updateGatewayState(gwEvent);
      }
      
      // Verbose output for first few transactions
      if (false && this.verbose && this.stats.processedTransactions < 5) {
        // Clear progress line before showing verbose output
        process.stdout.write('\r' + ' '.repeat(100) + '\r');
        console.log(`\n🔍 Transaction ${tx.hash}:`);
        console.log(`  Applications: ${applications.length}`);
      }
      
      // Return counts for batch summary
      return {
        applications: applications.length,
        suppliers: suppliers.length,
        gateways: gateways.length,
        nodes: nodes.length,
        services: services.length,
        claims: claims.length,
        relays: relays.length,
        stakingEvents: stakingEvents.length,
      };
      
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

  updateSupplierState(supEvent) {
    try {
      if (!supEvent || !supEvent.operator_address) return;
      this.supplierAddresses.add(supEvent.operator_address);
      const existing = this.supplierState.get(supEvent.operator_address) || {
        operator_address: supEvent.operator_address,
        staked_amount: '0',
        services: [],
        status: 'unknown',
        unstake_session_end_height: undefined,
        last_seen: null,
      };
      if (Array.isArray(supEvent.services) && supEvent.services.length > 0) {
        const merged = new Set([...(existing.services || []), ...supEvent.services]);
        existing.services = Array.from(merged);
      }
      if (supEvent.status === 'staked' && supEvent.staked_amount) {
        existing.staked_amount = supEvent.staked_amount;
        existing.status = 'staked';
      }
      if (supEvent.status === 'unstake_requested') {
        existing.status = 'unstake_requested';
        if (supEvent.unstake_session_end_height) existing.unstake_session_end_height = supEvent.unstake_session_end_height;
      }
      if (supEvent.last_seen) existing.last_seen = supEvent.last_seen;
      this.supplierState.set(supEvent.operator_address, existing);
    } catch (_) {}
  }

  updateGatewayState(gwEvent) {
    try {
      if (!gwEvent || !gwEvent.address) return;
      this.gatewayAddresses.add(gwEvent.address);
      const existing = this.gatewayState.get(gwEvent.address) || {
        address: gwEvent.address,
        staked_amount: '0',
        status: 'unknown',
        unstake_session_end_height: undefined,
        last_seen: null,
      };
      if (gwEvent.status === 'staked' && gwEvent.staked_amount) {
        existing.staked_amount = gwEvent.staked_amount;
        existing.status = 'staked';
      }
      if (gwEvent.status === 'unstake_requested') {
        existing.status = 'unstake_requested';
        if (gwEvent.unstake_session_end_height) existing.unstake_session_end_height = gwEvent.unstake_session_end_height;
      }
      if (gwEvent.last_seen) existing.last_seen = gwEvent.last_seen;
      this.gatewayState.set(gwEvent.address, existing);
    } catch (_) {}
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
    console.log(`Suppliers (unique): ${this.supplierAddresses.size}`);
    console.log(`Supplier events: ${this.stats.entities.suppliers}`);
    console.log(`Gateways (unique): ${this.gatewayAddresses.size}`);
    console.log(`Gateway events: ${this.stats.entities.gateways}`);
    console.log(`Nodes: ${this.stats.entities.nodes}`);
    console.log(`Services: ${this.stats.entities.services}`);
    console.log(`Claims: ${this.stats.entities.claims}`);
    console.log(`Relays: ${this.stats.entities.relays}`);
    console.log(`Staking Events: ${this.stats.entities.stakingEvents}`);
    console.log(`App Delegations: ${this.stats.entities.appDelegations}`);
    console.log(`App Service Configs: ${this.stats.entities.appServiceConfigs}`);
    
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

    // Show samples for suppliers and gateways
    if (this.supplierState.size > 0) {
      const sampleSup = Array.from(this.supplierState.values())
        .sort((a, b) => a.operator_address.localeCompare(b.operator_address))
        .slice(0, 10);
      console.log('\n🗂️ Supplier State Sample (up to 10):');
      for (const s of sampleSup) {
        console.log(`  - ${s.operator_address} | status=${s.status} | staked=${s.staked_amount}${s.unstake_session_end_height ? ' | unstake_height=' + s.unstake_session_end_height : ''}`);
      }
    }
    if (this.gatewayState.size > 0) {
      const sampleGw = Array.from(this.gatewayState.values())
        .sort((a, b) => a.address.localeCompare(b.address))
        .slice(0, 10);
      console.log('\n🗂️ Gateway State Sample (up to 10):');
      for (const g of sampleGw) {
        console.log(`  - ${g.address} | status=${g.status} | staked=${g.staked_amount}${g.unstake_session_end_height ? ' | unstake_height=' + g.unstake_session_end_height : ''}`);
      }
    }
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
