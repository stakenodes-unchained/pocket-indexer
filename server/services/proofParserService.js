const { Client } = require('pg');
const { parseProofSubmissions } = require('./indexer/entityParser');
const { bulkSaveProofSubmissions } = require('./proofParserDB');

/**
 * Proof Parser Service
 * 
 * This service processes transactions from the database to extract and store
 * proof submissions and claims. It runs in two modes:
 * 1. Historical: Process all transactions from the database for a given chain
 * 2. Watch mode: Monitor for new transactions and process them incrementally
 * 
 * The service includes health monitoring and graceful shutdown handling.
 */
class ProofParserService {
  constructor(options = {}) {
    this.chain = options.chain || process.env.CHAIN || 'mainnet';
    this.pollInterval = options.pollInterval || 10000; // 10 seconds default
    this.batchSize = options.batchSize || 100; // Process 100 transactions at a time
    this.healthCheckInterval = options.healthCheckInterval || 5000; // 5 seconds
    
    // State management
    this.isRunning = false;
    this.isWatching = false;
    this.historicalCompleted = false;
    this.lastProcessedTxId = null;
    this.processedCount = 0;
    this.errorCount = 0;
    this.lastError = null;
    this.lastProcessTime = null;
    this.startTime = null;
    
    // Database connection
    this.pgClient = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    });
    this.pgClient._connected = false;
    
    // Timers
    this.watchTimer = null;
    this.healthTimer = null;
  }

  /**
   * Connect to the database
   */
  async connectDB() {
    if (!this.pgClient._connected) {
      try {
        await this.pgClient.connect();
        this.pgClient._connected = true;
        console.log(`[ProofParser] Connected to database for chain ${this.chain}`);
      } catch (error) {
        console.error(`[ProofParser] Database connection failed:`, error.message);
        throw error;
      }
    }
  }

  /**
   * Parse a transaction and extract proof submissions and claims
   */
  async parseTransaction(tx) {
    try {
      // Parse tx_data if it's a string
      const txData = typeof tx.tx_data === 'string' ? JSON.parse(tx.tx_data) : tx.tx_data;
      
      // Get block information
      const block = await this.getBlockByTxHash(tx.hash, tx.chain);
      
      if (!block) {
        console.warn(`[ProofParser] Block not found for tx ${tx.hash}`);
        return { proofs: [], claims: [] };
      }
      
      // Prepare transaction object for parser
      // parseClaims expects: { body: { messages: [...] } }
      // parseProofSubmissions expects: { tx_response: { events: [...] } }
      
      // For parseClaims, pass the tx structure directly
      // COMMENTED OUT - focusing only on proof submissions
      // const txObjForClaims = txData?.tx || txData;
      // const claims = parseClaims(txObjForClaims, block, tx.chain);
      const claims = [];
      
      // For parseProofSubmissions, pass the txObj with tx_response
      const txObjForProofs = {
        hash: tx.hash,
        tx_response: txData?.tx_response,
        tx_data: tx.tx_data, // Keep raw data as backup
      };
      const proofs = parseProofSubmissions(txObjForProofs, block, tx.chain);
      
      return { proofs, claims };
      
    } catch (error) {
      console.error(`[ProofParser] Error parsing transaction ${tx.hash}:`, error.message);
      throw error;
    }
  }

  /**
   * Get block information by transaction hash
   */
  async getBlockByTxHash(txHash, chain) {
    try {
      const result = await this.pgClient.query(
        `SELECT b.* 
         FROM blocks b
         INNER JOIN transactions t ON t.block_id = b.id
         WHERE t.hash = $1 AND t.chain = $2
         LIMIT 1`,
        [txHash, chain]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const block = result.rows[0];
      return {
        block: {
          header: {
            height: block.height.toString(),
            time: block.timestamp,
            hash: block.hash,
          }
        },
        timestamp: block.timestamp,
        height: block.height,
      };
      
    } catch (error) {
      console.error(`[ProofParser] Error fetching block for tx ${txHash}:`, error.message);
      return null;
    }
  }

  /**
   * Process a batch of transactions
   */
  async processBatch(transactions) {
    const allProofs = [];
    const allClaims = [];
    
    for (const tx of transactions) {
      try {
        const { proofs, claims } = await this.parseTransaction(tx);
        
        if (proofs && proofs.length > 0) {
          allProofs.push(...proofs);
        }
        
        if (claims && claims.length > 0) {
          allClaims.push(...claims);
        }
        
        this.lastProcessedTxId = tx.id;
        this.processedCount++;
        
      } catch (error) {
        console.error(`[ProofParser] Error processing tx ${tx.id}:`, error.message);
        this.errorCount++;
        this.lastError = error.message;
        // Continue processing other transactions
      }
    }
    
    // Bulk save results
    try {
      if (allProofs.length > 0) {
        await bulkSaveProofSubmissions(allProofs);
        console.log(`[ProofParser] Saved ${allProofs.length} proof submissions`);
      }
      
      // COMMENTED OUT - focusing only on proof submissions
      // if (allClaims.length > 0) {
      //   await bulkSaveClaims(allClaims);
      //   console.log(`[ProofParser] Saved ${allClaims.length} claims`);
      // }
    } catch (error) {
      console.error(`[ProofParser] Error bulk saving results:`, error.message);
      throw error;
    }
    
    this.lastProcessTime = new Date();
    
    return {
      processed: transactions.length,
      proofs: allProofs.length,
      claims: allClaims.length,
    };
  }

  /**
   * Process historical transactions from the database
   */
  async processHistorical() {
    console.log(`[ProofParser] Starting historical processing for chain: ${this.chain}`);
    
    try {
      await this.connectDB();
      
      // Skip the expensive COUNT query - we'll process in batches until no more rows
      let totalCount = null;
      console.log(`[ProofParser] Starting batch processing for chain: ${this.chain}`);
      
      let offset = 0;
      let hasMore = true;
      let batchCount = 0;
      
      while (hasMore) {
        // Fetch a batch of transactions
        const result = await this.pgClient.query(
          `SELECT id, hash, block_id, chain, tx_data, timestamp
           FROM transactions 
           WHERE chain = $1 AND (tx_data->>'tx') IS NOT NULL
           ORDER BY timestamp ASC, id ASC
           LIMIT $2 OFFSET $3`,
          [this.chain, this.batchSize, offset]
        );
        
        const transactions = result.rows;
        
        if (transactions.length === 0) {
          hasMore = false;
          break;
        }
        
        console.log(`[ProofParser] Processing batch ${batchCount + 1} (${transactions.length} transactions)`);
        
        try {
          const batchResult = await this.processBatch(transactions);
          console.log(`[ProofParser] Batch ${batchCount + 1} completed - Processed: ${batchResult.processed}, Proofs: ${batchResult.proofs}, Claims: ${batchResult.claims}`);
        } catch (error) {
          console.error(`[ProofParser] Error processing batch ${batchCount + 1}:`, error.message);
          this.errorCount++;
          this.lastError = error.message;
        }
        
        batchCount++;
        offset += this.batchSize;
        
        // Progress update every 10 batches
        if (batchCount % 10 === 0) {
          if (totalCount !== null) {
            console.log(`[ProofParser] Progress: ${offset} / ${totalCount} transactions processed`);
          } else {
            console.log(`[ProofParser] Progress: ${offset} transactions processed`);
          }
        }
      }
      
      console.log(`[ProofParser] Historical processing completed for chain: ${this.chain}`);
      console.log(`[ProofParser] Total batches processed: ${batchCount}`);
      console.log(`[ProofParser] Total transactions processed: ${this.processedCount}`);
      console.log(`[ProofParser] Total errors: ${this.errorCount}`);
      
      this.historicalCompleted = true;
      
    } catch (error) {
      console.error(`[ProofParser] Error in historical processing:`, error);
      this.lastError = error.message;
      throw error;
    }
  }

  /**
   * Watch for new transactions and process them
   */
  async watchNewTransactions() {
    if (!this.historicalCompleted) {
      console.log(`[ProofParser] Waiting for historical processing to complete before watching...`);
      return;
    }
    
    console.log(`[ProofParser] Starting watch mode for chain: ${this.chain}`);
    
    try {
      await this.connectDB();
      
      // Get the last processed transaction timestamp
      const lastTxResult = await this.pgClient.query(
        `SELECT timestamp FROM transactions 
         WHERE chain = $1 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [this.chain]
      );
      
      const lastTimestamp = lastTxResult.rows.length > 0 
        ? lastTxResult.rows[0].timestamp 
        : new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      
      console.log(`[ProofParser] Watching for new transactions after: ${lastTimestamp}`);
      
      this.watchTimer = setInterval(async () => {
        try {
          // Fetch new transactions
          const result = await this.pgClient.query(
            `SELECT id, hash, block_id, chain, tx_data, timestamp
             FROM transactions 
             WHERE chain = $1 
               AND timestamp > $2 
               AND (tx_data->>'tx') IS NOT NULL
             ORDER BY timestamp ASC
             LIMIT $3`,
            [this.chain, lastTimestamp, this.batchSize]
          );
          
          const transactions = result.rows;
          
          if (transactions.length === 0) {
            // No new transactions
            return;
          }
          
          console.log(`[ProofParser] Found ${transactions.length} new transactions to process`);
          
          await this.processBatch(transactions);
          
          // Update last timestamp
          const newTimestamp = transactions[transactions.length - 1].timestamp;
          lastTimestamp.setTime(newTimestamp.getTime());
          
        } catch (error) {
          console.error(`[ProofParser] Error in watch loop:`, error.message);
          this.errorCount++;
          this.lastError = error.message;
        }
      }, this.pollInterval);
      
      this.isWatching = true;
      console.log(`[ProofParser] Watch mode started successfully`);
      
    } catch (error) {
      console.error(`[ProofParser] Error starting watch mode:`, error);
      this.lastError = error.message;
      throw error;
    }
  }

  /**
   * Start the service (historical + watch mode)
   */
  async start() {
    if (this.isRunning) {
      console.log(`[ProofParser] Service is already running`);
      return;
    }
    
    this.isRunning = true;
    this.startTime = new Date();
    
    console.log(`[ProofParser] Starting proof parser service for chain: ${this.chain}`);
    
    try {
      // First, process historical transactions
      await this.processHistorical();
      
      // Then, start watching for new transactions
      await this.watchNewTransactions();
      
    } catch (error) {
      console.error(`[ProofParser] Error starting service:`, error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the service
   */
  async stop() {
    console.log(`[ProofParser] Stopping service...`);
    
    this.isRunning = false;
    this.isWatching = false;
    
    // Clear timers
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    
    // Close database connection
    if (this.pgClient._connected) {
      try {
        await this.pgClient.end();
        this.pgClient._connected = false;
        console.log(`[ProofParser] Database connection closed`);
      } catch (error) {
        console.error(`[ProofParser] Error closing database connection:`, error.message);
      }
    }
    
    console.log(`[ProofParser] Service stopped`);
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    const uptime = this.startTime ? Date.now() - this.startTime.getTime() : 0;
    
    return {
      status: this.isRunning ? 'running' : 'stopped',
      chain: this.chain,
      uptime: uptime,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      lastProcessTime: this.lastProcessTime,
      lastError: this.lastError,
      historicalCompleted: this.historicalCompleted,
      isWatching: this.isWatching,
      database: this.pgClient._connected ? 'connected' : 'disconnected',
    };
  }
}

module.exports = ProofParserService;

