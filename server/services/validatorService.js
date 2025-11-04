'use strict';

const url = require('url');
const { Pool } = require('pg');
const { fromBech32, toBech32 } = require('@cosmjs/encoding');
const { getChainApiBase } = require('./chainConfig');

// Reuse existing DB connection strategy from transactionService if available
// but keep a minimal fallback for service isolation.
const connectionString = process.env.DATABASE_URL || process.env.PG_DSN || null;
let externalPool = null;

function setExternalPool(pool) {
  externalPool = pool;
}

function getPool() {
  if (externalPool) return externalPool;
  if (!connectionString) {
    throw new Error('No database connection string configured for validatorService');
  }
  return new Pool({ connectionString, max: 5 });
}

function extractDomain(website) {
  if (!website || typeof website !== 'string') return null;
  try {
    const withScheme = website.match(/^https?:\/\//i) ? website : `https://${website}`;
    const parsed = new url.URL(withScheme);
    // Strip leading www.
    return (parsed.hostname || '').replace(/^www\./, '');
  } catch (_) {
    try {
      // Fallback: simple host extraction
      return website.replace(/^https?:\/\//i, '').split('/')[0].replace(/^www\./, '');
    } catch (__) {
      return null;
    }
  }
}

/**
 * Convert operator address (poktvaloper...) to account address (pokt...)
 * @param {string} operatorAddress - Bech32 operator address
 * @returns {string|null} Account address or null if conversion fails
 */
function operatorAddressToAccount(operatorAddress) {
  if (!operatorAddress || typeof operatorAddress !== 'string') return null;
  try {
    const { prefix, data } = fromBech32(operatorAddress);
    // Handle special cases
    if (prefix === 'iva') {
      return toBech32('iaa', data);
    }
    if (prefix === 'crocncl') {
      return toBech32('cro', data);
    }
    // Replace 'valoper' with empty string (poktvaloper -> pokt)
    const accountPrefix = prefix.replace('valoper', '');
    return toBech32(accountPrefix, data);
  } catch (error) {
    console.warn(`Failed to convert operator address ${operatorAddress}:`, error.message);
    return null;
  }
}

async function upsertValidators(validators, chain) {
  if (!Array.isArray(validators) || validators.length === 0) return 0;
  if (!chain) {
    throw new Error('chain is required for upsertValidators');
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    const text = `INSERT INTO validators (operator_address, chain, account_address, moniker, website, website_domain, status, jailed, tokens, cached_at, updated_at)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
                  ON CONFLICT (operator_address, chain) DO UPDATE SET
                    account_address = EXCLUDED.account_address,
                    moniker = EXCLUDED.moniker,
                    website = EXCLUDED.website,
                    website_domain = EXCLUDED.website_domain,
                    status = EXCLUDED.status,
                    jailed = EXCLUDED.jailed,
                    tokens = EXCLUDED.tokens,
                    updated_at = NOW()`;

    for (const v of validators) {
      const operator = v.operator_address || v.address || null;
      if (!operator) continue;
      const accountAddress = operatorAddressToAccount(operator);
      const moniker = v.description?.moniker || null;
      const website = v.description?.website || null;
      const websiteDomain = extractDomain(website);
      const status = v.status || null;
      const jailed = typeof v.jailed === 'boolean' ? v.jailed : null;
      const tokens = v.tokens ? String(v.tokens) : null;
      await client.query(text, [operator, chain, accountAddress, moniker, website, websiteDomain, status, jailed, tokens]);
    }
    return validators.length;
  } finally {
    client.release();
  }
}

async function fetchAndCacheValidators({ chain, apiBase, pageSize = 100 } = {}) {
  // Resolve apiBase from chain if chain provided
  let resolvedApiBase = apiBase;
  if (chain && !apiBase) {
    const chainConfig = getChainApiBase(chain);
    if (!chainConfig) {
      throw new Error(`Chain '${chain}' not found in RPC_ENDPOINTS configuration`);
    }
    resolvedApiBase = chainConfig.url;
  }
  
  // Default fallback for backward compatibility
  if (!resolvedApiBase) {
    resolvedApiBase = 'https://shannon-grove-api.mainnet.poktroll.com';
  }
  
  const endpoint = `${resolvedApiBase}/cosmos/staking/v1beta1/validators`;
  let nextKey = null;
  let total = 0;
  do {
    const params = new URLSearchParams();
    params.set('pagination.limit', String(pageSize));
    if (nextKey) params.set('pagination.key', nextKey);
    const res = await fetch(`${endpoint}?${params.toString()}`, { timeout: 30000 });
    if (!res.ok) throw new Error(`Failed to fetch validators from ${resolvedApiBase}: ${res.status}`);
    const data = await res.json();
    const validators = data?.validators || [];
    
    // Chain is required - use provided chain or throw error if missing
    if (!chain) {
      throw new Error('chain parameter is required for fetchAndCacheValidators');
    }
    
    await upsertValidators(validators, chain);
    total += validators.length;
    nextKey = data?.pagination?.next_key || null;
  } while (nextKey);
  return total;
}

async function getOperatorsByDomain(domain, chain = null) {
  if (!domain) return [];
  const pool = getPool();
  const client = await pool.connect();
  try {
    let query = `SELECT operator_address FROM validators WHERE website_domain = $1`;
    const params = [domain];
    if (chain) {
      query += ` AND chain = $2`;
      params.push(chain);
    }
    const { rows } = await client.query(query, params);
    return rows.map(r => r.operator_address);
  } finally {
    client.release();
  }
}

module.exports = {
  setExternalPool,
  extractDomain,
  upsertValidators,
  fetchAndCacheValidators,
  getOperatorsByDomain,
};


