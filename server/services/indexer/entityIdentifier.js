/**
 * Entity Identifier
 * Identifies entity type (application, supplier, gateway) from address with caching
 */

const { connectClients, pgPool } = require('./db');

// In-memory cache for entity types
// Key: "address:chain", Value: entity type or null
const entityCache = new Map();

// Cache size limit to prevent memory issues
const MAX_CACHE_SIZE = 10000;

/**
 * Identify entity type for an address
 * @param {string} address - Address to check
 * @param {string} chain - Chain identifier
 * @returns {Promise<string|null>} 'application', 'supplier', 'gateway', or null
 */
async function identifyEntityType(address, chain) {
  if (!address || !chain) {
    return null;
  }

  const cacheKey = `${address}:${chain}`;
  
  // Check cache first
  if (entityCache.has(cacheKey)) {
    return entityCache.get(cacheKey);
  }

  try {
    await connectClients();
    const client = pgPool;

    // Check applications table
    const appResult = await client.query(
      'SELECT 1 FROM applications WHERE address = $1 AND chain = $2 LIMIT 1',
      [address, chain]
    );
    if (appResult.rows.length > 0) {
      const entityType = 'application';
      setCache(cacheKey, entityType);
      return entityType;
    }

    // Check suppliers table (note: suppliers use 'address' column, not 'operator_address' in this schema)
    const supplierResult = await client.query(
      'SELECT 1 FROM suppliers WHERE address = $1 AND chain = $2 LIMIT 1',
      [address, chain]
    );
    if (supplierResult.rows.length > 0) {
      const entityType = 'supplier';
      setCache(cacheKey, entityType);
      return entityType;
    }

    // Check gateways table
    const gatewayResult = await client.query(
      'SELECT 1 FROM gateways WHERE address = $1 AND chain = $2 LIMIT 1',
      [address, chain]
    );
    if (gatewayResult.rows.length > 0) {
      const entityType = 'gateway';
      setCache(cacheKey, entityType);
      return entityType;
    }

    // Not an entity - regular account
    const entityType = null;
    setCache(cacheKey, entityType);
    return entityType;
  } catch (error) {
    console.error(`Error identifying entity type for ${address}:${chain}:`, error);
    // On error, return null (assume regular account) but don't cache
    return null;
  }
}

/**
 * Set cache value with size limit management
 * @param {string} key - Cache key
 * @param {string|null} value - Entity type or null
 */
function setCache(key, value) {
  // If cache is too large, remove oldest entries (simple FIFO)
  if (entityCache.size >= MAX_CACHE_SIZE) {
    // Remove first 10% of entries
    const entriesToRemove = Math.floor(MAX_CACHE_SIZE * 0.1);
    let removed = 0;
    for (const cacheKey of entityCache.keys()) {
      if (removed >= entriesToRemove) break;
      entityCache.delete(cacheKey);
      removed++;
    }
  }
  
  entityCache.set(key, value);
}

/**
 * Clear the entity cache (useful for testing or memory management)
 */
function clearCache() {
  entityCache.clear();
}

/**
 * Get cache size (for monitoring)
 */
function getCacheSize() {
  return entityCache.size;
}

module.exports = {
  identifyEntityType,
  clearCache,
  getCacheSize
};

