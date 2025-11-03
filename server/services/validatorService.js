'use strict';

const url = require('url');
const { Pool } = require('pg');

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

async function upsertValidators(validators) {
  if (!Array.isArray(validators) || validators.length === 0) return 0;
  const pool = getPool();
  const client = await pool.connect();
  try {
    const text = `INSERT INTO validators (operator_address, moniker, website, website_domain, status, jailed, tokens, cached_at, updated_at)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
                  ON CONFLICT (operator_address) DO UPDATE SET
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
      const moniker = v.description?.moniker || null;
      const website = v.description?.website || null;
      const websiteDomain = extractDomain(website);
      const status = v.status || null;
      const jailed = typeof v.jailed === 'boolean' ? v.jailed : null;
      const tokens = v.tokens ? String(v.tokens) : null;
      await client.query(text, [operator, moniker, website, websiteDomain, status, jailed, tokens]);
    }
    return validators.length;
  } finally {
    client.release();
  }
}

async function fetchAndCacheValidators({ apiBase = 'https://shannon-grove-api.mainnet.poktroll.com', pageSize = 100 } = {}) {
  const endpoint = `${apiBase}/cosmos/staking/v1beta1/validators`;
  let nextKey = null;
  let total = 0;
  do {
    const params = new URLSearchParams();
    params.set('pagination.limit', String(pageSize));
    if (nextKey) params.set('pagination.key', nextKey);
    const res = await fetch(`${endpoint}?${params.toString()}`, { timeout: 30000 });
    if (!res.ok) throw new Error(`Failed to fetch validators: ${res.status}`);
    const data = await res.json();
    const validators = data?.validators || [];
    await upsertValidators(validators);
    total += validators.length;
    nextKey = data?.pagination?.next_key || null;
  } while (nextKey);
  return total;
}

async function getOperatorsByDomain(domain) {
  if (!domain) return [];
  const pool = getPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT operator_address FROM validators WHERE website_domain = $1`,
      [domain]
    );
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


