'use strict';

const { Pool } = require('pg');
const { getChainApiBase } = require('./chainConfig');

// Reuse existing DB connection strategy
const connectionString = process.env.DATABASE_URL || process.env.PG_DSN || null;
let externalPool = null;

function setExternalPool(pool) {
  externalPool = pool;
}

function getPool() {
  if (externalPool) return externalPool;
  if (!connectionString) {
    throw new Error('No database connection string configured for supplierEnrichmentService');
  }
  return new Pool({ connectionString, max: 5 });
}

/**
 * Fetch supplier data from chain API
 * @param {string} chain - Chain name
 * @param {string} operatorAddress - Supplier operator address
 * @returns {Promise<Object|null>} Supplier data or null if not found
 */
async function fetchSupplier(chain, operatorAddress) {
  if (!chain || !operatorAddress) {
    throw new Error('chain and operatorAddress are required');
  }
  
  const chainConfig = getChainApiBase(chain);
  if (!chainConfig) {
    throw new Error(`Chain '${chain}' not found in RPC_ENDPOINTS configuration`);
  }
  
  const apiBase = chainConfig.url;
  const endpoint = `${apiBase}/pokt-network/poktroll/supplier/supplier/${operatorAddress}`;
  
  try {
    const res = await fetch(endpoint, { timeout: 30000 });
    if (res.status === 404) {
      return null; // Supplier not found
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch supplier: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return data?.supplier || null;
  } catch (error) {
    if (error.message.includes('404')) {
      return null;
    }
    throw error;
  }
}

/**
 * Update supplier owner_address in database
 * @param {string} chain - Chain name
 * @param {string} operatorAddress - Supplier operator address
 * @param {string} ownerAddress - Owner address to set
 * @returns {Promise<boolean>} True if updated, false if no change needed
 */
async function upsertOwner(chain, operatorAddress, ownerAddress) {
  if (!chain || !operatorAddress || !ownerAddress) {
    return false;
  }
  
  const pool = getPool();
  const client = await pool.connect();
  try {
    // Update only if owner_address is NULL or empty
    const result = await client.query(
      `UPDATE suppliers 
       SET owner_address = $1 
       WHERE address = $2 AND chain = $3 
         AND (owner_address IS NULL OR owner_address = '')
       RETURNING address`,
      [ownerAddress, operatorAddress, chain]
    );
    return result.rowCount > 0;
  } finally {
    client.release();
  }
}

/**
 * Enrich a batch of suppliers for a specific chain
 * @param {string} chain - Chain name
 * @param {number} batchSize - Number of suppliers to process
 * @param {string[]} operatorAddresses - Optional: specific operator addresses to enrich
 * @returns {Promise<Object>} Results: { processed, updated, skipped, failed }
 */
async function enrichBatch(chain, batchSize = 200, operatorAddresses = null) {
  if (!chain) {
    throw new Error('chain is required');
  }
  
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    let candidates = [];
    
    if (operatorAddresses && operatorAddresses.length > 0) {
      // Enrich specific suppliers
      candidates = operatorAddresses.map(addr => ({ address: addr }));
    } else {
      // Query suppliers missing owner_address
      const result = await client.query(
        `SELECT address FROM suppliers 
         WHERE chain = $1 
           AND (owner_address IS NULL OR owner_address = '')
         LIMIT $2`,
        [chain, batchSize]
      );
      candidates = result.rows;
    }
    
    const results = {
      processed: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    };
    
    // Process each supplier with rate limiting
    for (const candidate of candidates) {
      results.processed++;
      const operatorAddress = candidate.address;
      
      try {
        const supplierData = await fetchSupplier(chain, operatorAddress);
        
        if (!supplierData) {
          results.skipped++;
          continue;
        }
        
        const ownerAddress = supplierData.owner_address || supplierData.operator_address;
        if (!ownerAddress) {
          results.skipped++;
          continue;
        }
        
        const updated = await upsertOwner(chain, operatorAddress, ownerAddress);
        if (updated) {
          results.updated++;
        } else {
          results.skipped++; // Already had owner_address or update failed
        }
        
        // Rate limiting: 5 requests per second (200ms delay)
        if (results.processed < candidates.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      } catch (error) {
        console.error(`[supplier-enrichment] Failed to enrich ${operatorAddress} on ${chain}:`, error.message);
        results.failed++;
        // Continue with next supplier
      }
    }
    
    return results;
  } finally {
    client.release();
  }
}

module.exports = {
  setExternalPool,
  fetchSupplier,
  upsertOwner,
  enrichBatch
};

