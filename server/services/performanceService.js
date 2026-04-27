'use strict';

/**
 * Performance Service
 *
 * Central place for validator and service performance analytics.
 * All long-running performance queries for dashboards should live here.
 */

/**
 * Search for validators and services
 * @param {Object} params - Search parameters
 * @param {string} params.q - Search query string
 * @param {string} [params.chain] - Optional chain filter
 * @param {number} [params.limit=20] - Maximum results per category
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Search results with validators and services
 */
async function searchValidatorsAndServices(params, client) {
  const { q, chain, limit = 20 } = params;
  
  if (!q || q.trim().length === 0) {
    throw new Error("Query parameter 'q' is required");
  }
  
  const searchQuery = q.trim();
  const searchPattern = `%${searchQuery}%`;
  const limitNum = Math.min(parseInt(limit, 10) || 20, 100); // Cap at 100
  const values = [searchPattern, searchQuery];
  let idx = 3;
  
  // Build validator search query
  const validatorConditions = [
    `(v.moniker ILIKE $1 OR v.account_address ILIKE $1 OR v.operator_address ILIKE $1 OR v.account_address = $2 OR v.operator_address = $2)`
  ];
  if (chain) {
    validatorConditions.push(`v.chain = $${idx++}`);
    values.push(chain);
  }
  const validatorWhere = `WHERE ${validatorConditions.join(' AND ')}`;
  
  // Search validators: moniker, account_address (pokt1...), operator_address (poktvaloper1...)
  // Use subquery to handle DISTINCT with ORDER BY properly
  const validatorSql = `
    SELECT 
      validator_account_address,
      moniker,
      operator_address,
      chain
    FROM (
      SELECT DISTINCT
        v.account_address AS validator_account_address,
        v.moniker,
        v.operator_address,
        v.chain
      FROM validators v
      ${validatorWhere}
    ) AS distinct_validators
      ORDER BY 
        CASE 
          WHEN validator_account_address = $2 OR operator_address = $2 THEN 1
          WHEN moniker ILIKE $1 THEN 2
          ELSE 3
        END,
        moniker NULLS LAST
      LIMIT $${idx}::integer
    `;
    values.push(limitNum);
  
  // Build service search query
  // Search in supplier_service_configs.endpoints array for JSON-RPC URLs
  // Use LATERAL unnest for efficient endpoint matching with GIN index support
  const serviceConditions = [];
  const serviceValues = [searchPattern];
  let serviceIdx = 2;
  
  if (chain) {
    serviceConditions.push(`ssc.chain = $${serviceIdx++}`);
    serviceValues.push(chain);
  }
  const serviceWhere = serviceConditions.length ? `WHERE ${serviceConditions.join(' AND ')}` : '';
  
  // Find services matching the URL and get all suppliers using them
  // Use LATERAL join for efficient endpoint matching
  const serviceSql = `
    WITH matching_endpoints AS (
      SELECT DISTINCT
        ssc.service_id,
        ssc.chain,
        ssc.supplier_address,
        endpoint AS json_rpc_url
      FROM supplier_service_configs ssc,
      LATERAL unnest(ssc.endpoints) AS endpoint
      ${serviceWhere}
      ${serviceWhere ? 'AND' : 'WHERE'} endpoint ILIKE $1
    )
    SELECT 
      me.service_id,
      me.chain,
      me.json_rpc_url,
      array_agg(DISTINCT me.supplier_address) AS supplier_operator_addresses,
      COUNT(DISTINCT me.supplier_address) AS supplier_count
    FROM matching_endpoints me
      GROUP BY me.service_id, me.chain, me.json_rpc_url
      ORDER BY supplier_count DESC, me.service_id
      LIMIT $${serviceIdx}::integer
    `;
    serviceValues.push(limitNum);
  
  // Execute both queries in parallel
  const [validatorRes, serviceRes] = await Promise.all([
    client.query(validatorSql, values),
    client.query(serviceSql, serviceValues)
  ]);
  
  // Format validator results
  const validators = validatorRes.rows.map(row => ({
    type: 'validator',
    validator_account_address: row.validator_account_address,
    moniker: row.moniker || undefined,
    operator_address: row.operator_address || undefined
  }));
  
  // Format service results
  const services = serviceRes.rows.map(row => ({
    type: 'service',
    service_id: row.service_id,
    json_rpc_url: row.json_rpc_url,
    supplier_operator_addresses: row.supplier_operator_addresses || [],
    supplier_count: parseInt(row.supplier_count || '0', 10)
  }));
  
  return {
    validators,
    services
  };
}

/**
 * Search for suppliers by owner address, operator address, or service URLs
 * @param {Object} params - Search parameters
 * @param {string} params.q - Search query string (owner address, operator address, or service URL)
 * @param {string} [params.chain] - Optional chain filter
 * @param {string} [params.status='staked'] - Filter by supplier status (staked, unstaked, unstake_requested, all)
 * @param {number} [params.limit=20] - Maximum results per category
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Search results with unique owner addresses and supplier operator addresses
 */
async function searchSuppliersAndServices(params, client) {
  const { q, chain, status = 'staked', limit = 20 } = params;
  
  if (!q || q.trim().length === 0) {
    throw new Error("Query parameter 'q' is required");
  }
  
  const searchQuery = q.trim();
  const searchPattern = `%${searchQuery}%`;
  const exactQuery = searchQuery;
  
  // Determine if query looks like an address (pokt1... or poktvaloper1...)
  const isAddressQuery = searchQuery.startsWith('pokt');
  
  const values = [];
  let idx = 1;
  
  if (isAddressQuery) {
    // Search by owner address or operator address
    const supplierConditions = [
      `(s.owner_address ILIKE $${idx} OR s.owner_address = $${idx + 1} OR s.address ILIKE $${idx} OR s.address = $${idx + 1})`
    ];
    values.push(searchPattern, exactQuery);
    idx += 2;
    
    if (chain) {
      supplierConditions.push(`s.chain = $${idx++}`);
      values.push(chain);
    }
    
    // Add status filter (skip if status is 'all')
    if (status && status !== 'all' && ['staked', 'unstaked', 'unstake_requested'].includes(status)) {
      supplierConditions.push(`s.status = $${idx++}`);
      values.push(status);
    }
    
    const supplierWhere = `WHERE ${supplierConditions.join(' AND ')}`;
    
    // Find suppliers matching the address query
    const searchSql = `
      SELECT DISTINCT
        s.owner_address,
        s.address AS supplier_operator_address
      FROM suppliers s
      ${supplierWhere}
    `;
    
    const result = await client.query(searchSql, values);
    
    const ownerAddresses = [];
    const supplierAddresses = [];
    
    result.rows.forEach(row => {
      if (row.owner_address) {
        ownerAddresses.push(row.owner_address);
      }
      if (row.supplier_operator_address) {
        supplierAddresses.push(row.supplier_operator_address);
      }
    });
    
    return {
      owner_addresses: [...new Set(ownerAddresses)],
      supplier_operator_addresses: [...new Set(supplierAddresses)]
    };
  } else {
    // Search by service URL
    const serviceConditions = [];
    values.push(searchPattern);
    idx = 2;
    
    if (chain) {
      serviceConditions.push(`ssc.chain = $${idx++}`);
      values.push(chain);
    }
    const serviceWhere = serviceConditions.length ? `WHERE ${serviceConditions.join(' AND ')}` : '';
    
    // Add status filter parameter if needed (skip if status is 'all')
    let statusParamIdx = null;
    if (status && status !== 'all' && ['staked', 'unstaked', 'unstake_requested'].includes(status)) {
      statusParamIdx = idx;
      values.push(status);
      idx++;
    }
    
    // Find all suppliers that have service URLs matching the search query
    // Return unique owner addresses and unique supplier operator addresses
    const searchSql = `
      WITH matching_endpoints AS (
        SELECT DISTINCT
          ssc.supplier_address,
          ssc.chain,
          endpoint AS service_url
        FROM supplier_service_configs ssc,
        LATERAL unnest(ssc.endpoints) AS endpoint
        ${serviceWhere}
        ${serviceWhere ? 'AND' : 'WHERE'} endpoint ILIKE $1
      ),
      supplier_info AS (
        SELECT DISTINCT
          me.supplier_address,
          me.chain,
          s.owner_address
        FROM matching_endpoints me
        LEFT JOIN suppliers s ON s.address = me.supplier_address 
          AND s.chain = me.chain
          ${statusParamIdx ? `AND s.status = $${statusParamIdx}` : ''}
      )
      SELECT 
        array_agg(DISTINCT si.owner_address) FILTER (WHERE si.owner_address IS NOT NULL) AS owner_addresses,
        array_agg(DISTINCT si.supplier_address) AS supplier_operator_addresses
      FROM supplier_info si
    `;
    
    // Execute query
    const result = await client.query(searchSql, values);
    
    const row = result.rows[0] || {};
    
    return {
      owner_addresses: row.owner_addresses || [],
      supplier_operator_addresses: row.supplier_operator_addresses || []
    };
  }
}

/**
 * Get validator performance data
 * @param {Object} params - Performance query parameters
 * @param {string} [params.domain] - Filter by website domain
 * @param {string} [params.owner_address] - Filter by supplier owner address
 * @param {string|string[]} [params.supplier_address] - Filter by supplier operator address(es)
 * @param {string} [params.chain] - Filter by chain
 * @param {string} [params.service_id] - Filter by service ID
 * @param {string} [params.start_date] - Start timestamp
 * @param {string} [params.end_date] - End timestamp
 * @param {string} [params.group_by='day'] - Grouping: 'day', 'hour', or 'total'
 * @param {number} [params.page=1] - Page number
 * @param {number} [params.limit=100] - Results per page
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Performance data with pagination metadata
 */
async function getValidatorPerformance(params, client) {
  const { 
    domain, 
    owner_address, 
    supplier_address, // Can be string or array
    chain, 
    service_id, 
    start_date, 
    end_date, 
    group_by = 'day', 
    page = 1, 
    limit = 100 
  } = params;

  // Build WHERE conditions over proof_submissions joined to suppliers and validators
  const conditions = ["ps.claim_proof_status_int = 0"]; // successful submissions only
  const values = [];
  let idx = 1;

  if (chain) { conditions.push(`ps.chain = $${idx}::text`); values.push(chain); idx++; }
  if (service_id) { conditions.push(`ps.service_id = $${idx}::text`); values.push(service_id); idx++; }
  if (start_date) { conditions.push(`ps.timestamp >= $${idx}::timestamp`); values.push(start_date); idx++; }
  if (end_date) { conditions.push(`ps.timestamp <= $${idx}::timestamp`); values.push(end_date); idx++; }
  
  // Handle supplier_address - can be single string, comma-separated string, or array
  // Addresses can be either account addresses (pokt1...) or operator addresses (poktvaloper1...)
  // Account addresses should match via owner_address or account_address
  // Operator addresses should match via supplier_operator_address
  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      // Handle comma-separated string (for GET requests)
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    
    // Check if addresses are account addresses (pokt1...) or operator addresses (poktvaloper1...)
    const isAccountAddress = (addr) => addr && addr.startsWith('pokt1') && !addr.startsWith('poktvaloper1');
    
    // Separate account and operator addresses
    const accountAddresses = addresses.filter(isAccountAddress);
    const operatorAddresses = addresses.filter(addr => !isAccountAddress(addr));
    
    const addressConditions = [];
    
    // Match account addresses via owner_address in suppliers table or account_address in validators
    // Also try matching directly against supplier_operator_address in case it contains account addresses
    if (accountAddresses.length > 0) {
      if (accountAddresses.length === 1) {
        addressConditions.push(`(s.owner_address = $${idx}::text OR v.account_address = $${idx}::text OR ps.supplier_operator_address = $${idx}::text)`);
        values.push(accountAddresses[0]);
        idx++;
      } else {
        // Use ANY with array parameter to avoid parameter explosion
        addressConditions.push(`(s.owner_address = ANY($${idx}::text[]) OR v.account_address = ANY($${idx}::text[]) OR ps.supplier_operator_address = ANY($${idx}::text[]))`);
        values.push(accountAddresses);
        idx++;
      }
    }
    
    // Match operator addresses directly via supplier_operator_address
    if (operatorAddresses.length > 0) {
      if (operatorAddresses.length === 1) {
        addressConditions.push(`ps.supplier_operator_address = $${idx}::text`);
        values.push(operatorAddresses[0]);
        idx++;
      } else {
        // Use ANY with array parameter to avoid parameter explosion
        addressConditions.push(`ps.supplier_operator_address = ANY($${idx}::text[])`);
        values.push(operatorAddresses);
        idx++;
      }
    }
    
    if (addressConditions.length > 0) {
      conditions.push(`(${addressConditions.join(' OR ')})`);
    }
  }
  
  if (owner_address) { conditions.push(`s.owner_address = $${idx}::text`); values.push(owner_address); idx++; }
  if (domain) { conditions.push(`v.website_domain = $${idx}::text`); values.push(domain); idx++; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Grouping
  let bucketExpr = null;
  if (group_by === 'hour') bucketExpr = `DATE_TRUNC('hour', ps.timestamp) AS bucket`;
  else if (group_by === 'total') bucketExpr = `NULL::timestamp AS bucket`;
  else bucketExpr = `DATE_TRUNC('day', ps.timestamp) AS bucket`;

  // Count total groups for pagination
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  // Determine if we're aggregating multiple suppliers
  // Aggregation happens when multiple supplier addresses are provided
  let isAggregating = false;
  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    isAggregating = addresses.length > 1;
  }

  let countSql, listSql;
  
  if (isAggregating) {
    // Aggregated query - group only by bucket, not by supplier
    countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT ${bucketExpr.replace(' AS bucket', '')} AS bucket_key
        FROM proof_submissions ps
        LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address AND s.chain = ps.chain
        LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
        ${where}
        GROUP BY bucket_key
      ) t`;

    listSql = `
      SELECT 
        ${bucketExpr},
        NULL::text AS supplier_operator_address,
        NULL::text AS owner_address,
        NULL::text AS moniker,
        NULL::text AS website,
        NULL::text AS website_domain,
        NULL::text AS validator_status,
        COALESCE(COUNT(*)::BIGINT, 0) AS submissions,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent,
        ROUND(
          CASE 
            WHEN SUM(ps.num_relays) > 0 
            THEN SUM(ps.claimed_upokt_amount)::numeric / SUM(ps.num_relays)::numeric
            ELSE 0
          END, 
          2
        ) AS avg_reward_per_relay,
        COUNT(DISTINCT ps.application_address) AS unique_applications,
        COUNT(DISTINCT ps.service_id) AS unique_services
      FROM proof_submissions ps
      LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address AND s.chain = ps.chain
      LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
      ${where}
      GROUP BY bucket
      ORDER BY bucket DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;
  } else {
    // Normal query - group by bucket and supplier
    countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT 
          ${bucketExpr.replace(' AS bucket', '')} AS bucket_key,
          ps.supplier_operator_address
        FROM proof_submissions ps
        LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address AND s.chain = ps.chain
        LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
        ${where}
        GROUP BY bucket_key, ps.supplier_operator_address
      ) t`;

    listSql = `
      SELECT 
        ${bucketExpr},
        ps.supplier_operator_address,
        s.owner_address,
        v.moniker,
        v.website,
        v.website_domain,
        v.status AS validator_status,
        COALESCE(COUNT(*)::BIGINT, 0) AS submissions,
        COALESCE(SUM(ps.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(ps.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(ps.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ROUND(AVG(ps.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent,
        ROUND(AVG(ps.reward_per_relay)::numeric, 2) AS avg_reward_per_relay,
        COUNT(DISTINCT ps.application_address) AS unique_applications,
        COUNT(DISTINCT ps.service_id) AS unique_services
      FROM proof_submissions ps
      LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address AND s.chain = ps.chain
      LEFT JOIN validators v ON v.account_address = ps.supplier_operator_address AND v.chain = ps.chain
      ${where}
      GROUP BY bucket, ps.supplier_operator_address, s.owner_address, v.moniker, v.website, v.website_domain, v.status
      ORDER BY bucket DESC, total_relays DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;
  }

  const countRes = await client.query(countSql, values);
  const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

  const listRes = await client.query(listSql, [...values, limitNum, offset]);

  // Parse numeric fields from strings to numbers
  const parsedData = listRes.rows.map(row => ({
    ...row,
    submissions: parseInt(row.submissions || '0', 10),
    total_relays: parseInt(row.total_relays || '0', 10),
    total_claimed_compute_units: parseInt(row.total_claimed_compute_units || '0', 10),
    total_estimated_compute_units: parseInt(row.total_estimated_compute_units || '0', 10),
    avg_efficiency_percent: parseFloat(row.avg_efficiency_percent || '0'),
    avg_reward_per_relay: parseFloat(row.avg_reward_per_relay || '0'),
    unique_applications: parseInt(row.unique_applications || '0', 10),
    unique_services: parseInt(row.unique_services || '0', 10)
  }));

  return {
    data: parsedData,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

/**
 * Get supplier performance data from claims
 * @param {Object} params - Performance query parameters
 * @param {string} [params.owner_address] - Filter by supplier owner address
 * @param {string|string[]} [params.supplier_address] - Filter by supplier operator address(es)
 * @param {string} [params.chain] - Filter by chain
 * @param {string} [params.service_id] - Filter by service ID
 * @param {string} [params.start_date] - Start timestamp
 * @param {string} [params.end_date] - End timestamp
 * @param {string} [params.group_by='day'] - Grouping: 'day', 'hour', or 'total'
 * @param {number} [params.page=1] - Page number
 * @param {number} [params.limit=100] - Results per page
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Performance data with pagination metadata
 */
async function getSupplierPerformance(params, client) {
  const {
    owner_address,
    supplier_address, // Can be string or array
    chain,
    service_id,
    start_date,
    end_date,
    group_by = 'day',
    page = 1,
    limit = 100
  } = params;

  // Settled claims only — claim_settlements is the source of truth
  const conditions = [`cs.settlement_type = 'settled'`];
  const values = [];
  let idx = 1;

  if (chain) { conditions.push(`cs.chain = $${idx}::text`); values.push(chain); idx++; }
  if (service_id) { conditions.push(`cs.service_id = $${idx}::text`); values.push(service_id); idx++; }
  if (start_date) { conditions.push(`cs.created_timestamp >= $${idx}::timestamp`); values.push(start_date); idx++; }
  if (end_date) { conditions.push(`cs.created_timestamp <= $${idx}::timestamp`); values.push(end_date); idx++; }

  // supplier_address can be a single address, comma-separated string (GET), or array (POST)
  // Match against both operator address (on claim_settlements) and owner address (via suppliers join)
  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }

    if (addresses.length === 1) {
      conditions.push(`(s.owner_address = $${idx}::text OR cs.supplier_operator_address = $${idx}::text)`);
      values.push(addresses[0]);
      idx++;
    } else {
      conditions.push(`(s.owner_address = ANY($${idx}::text[]) OR cs.supplier_operator_address = ANY($${idx}::text[]))`);
      values.push(addresses);
      idx++;
    }
  }

  if (owner_address) { conditions.push(`s.owner_address = $${idx}::text`); values.push(owner_address); idx++; }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // Time bucket for grouping/trending
  let bucketExpr;
  if (group_by === 'hour') bucketExpr = `DATE_TRUNC('hour', cs.created_timestamp) AS bucket`;
  else if (group_by === 'total') bucketExpr = `NULL::timestamp AS bucket`;
  else bucketExpr = `DATE_TRUNC('day', cs.created_timestamp) AS bucket`;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  // Aggregating mode: multiple suppliers collapsed into a single time-series (no per-supplier breakdown).
  // Only applies for time-series groupings (day/hour). For group_by='total' we always want
  // per-supplier rows so the frontend can build supplierMap for charts/tables.
  let isAggregating = false;
  if (supplier_address && group_by !== 'total') {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }
    isAggregating = addresses.length > 1;
  }

  // Weighted efficiency and reward-per-relay are computed inline — claim_settlements
  // has no stored computed columns, and simple AVG() would give wrong results when
  // rows have different relay counts.
  const efficiencyExpr = `ROUND(
          CASE WHEN SUM(cs.num_estimated_compute_units) > 0
            THEN (SUM(cs.num_claimed_compute_units)::numeric / SUM(cs.num_estimated_compute_units)::numeric) * 100
            ELSE 0 END,
          2) AS avg_efficiency_percent`;

  const rewardPerRelayExpr = `ROUND(
          CASE WHEN SUM(cs.num_relays) > 0
            THEN SUM(cs.claimed_upokt)::numeric / SUM(cs.num_relays)::numeric
            ELSE 0 END,
          2) AS avg_reward_per_relay`;

  let countSql, listSql;

  if (isAggregating) {
    // Multiple suppliers: collapse into bucket-only time series
    countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT ${bucketExpr.replace(' AS bucket', '')} AS bucket_key
        FROM claim_settlements cs
        LEFT JOIN suppliers s ON s.address = cs.supplier_operator_address AND s.chain = cs.chain
        ${where}
        GROUP BY bucket_key
      ) t`;

    listSql = `
      SELECT
        ${bucketExpr},
        NULL::text AS supplier_operator_address,
        NULL::text AS owner_address,
        COALESCE(COUNT(*)::BIGINT, 0) AS total_claims,
        COALESCE(SUM(cs.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(cs.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(cs.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ${efficiencyExpr},
        ${rewardPerRelayExpr},
        COUNT(DISTINCT cs.application_address) AS unique_applications,
        COUNT(DISTINCT cs.service_id) AS unique_services
      FROM claim_settlements cs
      LEFT JOIN suppliers s ON s.address = cs.supplier_operator_address AND s.chain = cs.chain
      ${where}
      GROUP BY bucket
      ORDER BY bucket DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;
  } else {
    // Single supplier (or no filter): per-supplier breakdown within each time bucket
    countSql = `
      SELECT COUNT(*) AS total FROM (
        SELECT
          ${bucketExpr.replace(' AS bucket', '')} AS bucket_key,
          cs.supplier_operator_address
        FROM claim_settlements cs
        LEFT JOIN suppliers s ON s.address = cs.supplier_operator_address AND s.chain = cs.chain
        ${where}
        GROUP BY bucket_key, cs.supplier_operator_address
      ) t`;

    listSql = `
      SELECT
        ${bucketExpr},
        cs.supplier_operator_address,
        s.owner_address,
        COALESCE(COUNT(*)::BIGINT, 0) AS total_claims,
        COALESCE(SUM(cs.num_relays)::BIGINT, 0) AS total_relays,
        COALESCE(SUM(cs.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
        COALESCE(SUM(cs.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
        ${efficiencyExpr},
        ${rewardPerRelayExpr},
        COUNT(DISTINCT cs.application_address) AS unique_applications,
        COUNT(DISTINCT cs.service_id) AS unique_services
      FROM claim_settlements cs
      LEFT JOIN suppliers s ON s.address = cs.supplier_operator_address AND s.chain = cs.chain
      ${where}
      GROUP BY bucket, cs.supplier_operator_address, s.owner_address
      ORDER BY bucket DESC, total_relays DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;
  }

  const countRes = await client.query(countSql, values);
  const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

  const listRes = await client.query(listSql, [...values, limitNum, offset]);

  // Parse numeric fields from strings to numbers
  const parsedData = listRes.rows.map(row => ({
    ...row,
    total_claims: parseInt(row.total_claims || '0', 10),
    total_relays: parseInt(row.total_relays || '0', 10),
    total_claimed_compute_units: parseInt(row.total_claimed_compute_units || '0', 10),
    total_estimated_compute_units: parseInt(row.total_estimated_compute_units || '0', 10),
    avg_efficiency_percent: parseFloat(row.avg_efficiency_percent || '0'),
    avg_reward_per_relay: parseFloat(row.avg_reward_per_relay || '0'),
    unique_applications: parseInt(row.unique_applications || '0', 10),
    unique_services: parseInt(row.unique_services || '0', 10)
  }));

  return {
    data: parsedData,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

/**
 * Get supplier owner performance data (aggregated by owner address)
 * @param {Object} params - Performance query parameters
 * @param {string} [params.chain] - Filter by chain
 * @param {string} [params.service_id] - Filter by service ID
 * @param {string} [params.start_date] - Start timestamp
 * @param {string} [params.end_date] - End timestamp
 * @param {number} [params.page=1] - Page number
 * @param {number} [params.limit=100] - Results per page
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Owner performance data with pagination metadata
 */
async function getSupplierOwnerPerformance(params, client) {
  const { 
    chain, 
    service_id, 
    start_date, 
    end_date, 
    page = 1, 
    limit = 100 
  } = params;

  // Build WHERE conditions over claims joined to suppliers
  const conditions = ["c.claim_proof_status_int = 0"]; // successful claims only
  const values = [];
  let idx = 1;

  if (chain) { conditions.push(`c.chain = $${idx}::text`); values.push(chain); idx++; }
  if (service_id) { conditions.push(`c.service_id = $${idx}::text`); values.push(service_id); idx++; }
  if (start_date) { conditions.push(`c.timestamp >= $${idx}::timestamp`); values.push(start_date); idx++; }
  if (end_date) { conditions.push(`c.timestamp <= $${idx}::timestamp`); values.push(end_date); idx++; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count total groups for pagination
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  const countSql = `
    SELECT COUNT(*) AS total FROM (
      SELECT s.owner_address
      FROM claims c
      LEFT JOIN suppliers s ON s.address = c.supplier_operator_address AND s.chain = c.chain
      ${where}
      GROUP BY s.owner_address
      HAVING s.owner_address IS NOT NULL
    ) t`;

  const listSql = `
    SELECT 
      s.owner_address,
      COUNT(DISTINCT c.supplier_operator_address) AS supplier_count,
      COALESCE(COUNT(*)::BIGINT, 0) AS total_claims,
      COALESCE(SUM(c.num_relays)::BIGINT, 0) AS total_relays,
      COALESCE(SUM(c.num_claimed_compute_units)::BIGINT, 0) AS total_claimed_compute_units,
      COALESCE(SUM(c.num_estimated_compute_units)::BIGINT, 0) AS total_estimated_compute_units,
      ROUND(AVG(c.compute_unit_efficiency)::numeric, 2) AS avg_efficiency_percent
    FROM claims c
    LEFT JOIN suppliers s ON s.address = c.supplier_operator_address AND s.chain = c.chain
    ${where}
    GROUP BY s.owner_address
    HAVING s.owner_address IS NOT NULL
    ORDER BY total_relays DESC
    LIMIT $${idx}::integer OFFSET $${idx + 1}::integer`;

  const countRes = await client.query(countSql, values);
  const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

  const listRes = await client.query(listSql, [...values, limitNum, offset]);

  // Parse numeric fields from strings to numbers
  const parsedData = listRes.rows.map(row => ({
    ...row,
    supplier_count: parseInt(row.supplier_count || '0', 10),
    total_claims: parseInt(row.total_claims || '0', 10),
    total_relays: parseInt(row.total_relays || '0', 10),
    total_claimed_compute_units: parseInt(row.total_claimed_compute_units || '0', 10),
    total_estimated_compute_units: parseInt(row.total_estimated_compute_units || '0', 10),
    avg_efficiency_percent: parseFloat(row.avg_efficiency_percent || '0')
  }));

  return {
    data: parsedData,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  };
}

/**
 * Get top services by compute units
 * @param {Object} params - Query parameters
 * @param {string} [params.days='30'] - Time period in days (7, 15, or 30)
 * @param {string} [params.chain] - Optional chain filter
 * @param {string|string[]} [params.supplier_address] - Optional supplier operator address filter
 * @param {string} [params.owner_address] - Optional owner address filter
 * @param {number} [params.page=1] - Page number for pagination
 * @param {number} [params.limit=10] - Number of results per page
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Top services data with metadata
 */
async function getTopServicesByComputeUnits(params, client) {
  const { days = '30', chain, supplier_address, owner_address, page = 1, limit = 10 } = params;

  const daysValue = Math.max(1, Math.min(parseInt(days, 10) || 30, 365));

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 1000);
  const offset = (pageNum - 1) * limitNum;

  // settled-only filter + time window; chain goes first for index usage
  const conditions = [`cs.settlement_type = 'settled'`, `cs.created_timestamp >= NOW() - INTERVAL '${daysValue} days'`];
  const values = [];
  let idx = 1;

  if (chain) {
    conditions.unshift(`cs.chain = $1::text`);
    values.unshift(chain);
    idx = 2;
  }

  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }

    const isAccountAddress = (addr) => addr && addr.startsWith('pokt1') && !addr.startsWith('poktvaloper1');
    const accountAddresses = addresses.filter(isAccountAddress);
    const operatorAddresses = addresses.filter(addr => !isAccountAddress(addr));
    const addressConditions = [];

    // Account addresses: use subquery to find their operators — avoids JOIN chain mismatch
    if (accountAddresses.length > 0) {
      if (accountAddresses.length === 1) {
        addressConditions.push(`cs.supplier_operator_address IN (SELECT address FROM suppliers WHERE owner_address = $${idx}::text OR address = $${idx}::text)`);
        values.push(accountAddresses[0]);
        idx++;
      } else {
        addressConditions.push(`cs.supplier_operator_address IN (SELECT address FROM suppliers WHERE owner_address = ANY($${idx}::text[]) OR address = ANY($${idx}::text[]))`);
        values.push(accountAddresses);
        idx++;
      }
    }

    // Operator addresses: direct filter on claim_settlements
    if (operatorAddresses.length > 0) {
      if (operatorAddresses.length === 1) {
        addressConditions.push(`cs.supplier_operator_address = $${idx}::text`);
        values.push(operatorAddresses[0]);
        idx++;
      } else {
        addressConditions.push(`cs.supplier_operator_address = ANY($${idx}::text[])`);
        values.push(operatorAddresses);
        idx++;
      }
    }

    if (addressConditions.length > 0) {
      conditions.push(`(${addressConditions.join(' OR ')})`);
    }
  }

  // owner_address: use subquery to find operators — avoids chain mismatch in LEFT JOIN
  if (owner_address) {
    conditions.push(`cs.supplier_operator_address IN (SELECT address FROM suppliers WHERE owner_address = $${idx}::text)`);
    values.push(owner_address);
    idx++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countSql = chain
    ? `SELECT COUNT(DISTINCT cs.service_id) AS total FROM claim_settlements cs ${where}`
    : `SELECT COUNT(*) AS total FROM (
        SELECT DISTINCT cs.service_id, cs.chain FROM claim_settlements cs ${where}
      ) t`;

  const sql = chain
    ? `
      SELECT
        cs.service_id,
        $1::text AS chain,
        SUM(cs.num_claimed_compute_units) AS total_claimed_compute_units,
        SUM(cs.num_estimated_compute_units) AS total_estimated_compute_units,
        COUNT(*) AS submission_count,
        CASE WHEN SUM(cs.num_estimated_compute_units) > 0
          THEN (SUM(cs.num_claimed_compute_units)::numeric / SUM(cs.num_estimated_compute_units)::numeric) * 100
          ELSE 0 END AS avg_efficiency_percent,
        MIN(cs.created_timestamp) AS period_start,
        MAX(cs.created_timestamp) AS period_end
      FROM claim_settlements cs
      ${where}
      GROUP BY cs.service_id
      ORDER BY total_claimed_compute_units DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
    `
    : `
      SELECT
        cs.service_id,
        cs.chain,
        SUM(cs.num_claimed_compute_units) AS total_claimed_compute_units,
        SUM(cs.num_estimated_compute_units) AS total_estimated_compute_units,
        COUNT(*) AS submission_count,
        CASE WHEN SUM(cs.num_estimated_compute_units) > 0
          THEN (SUM(cs.num_claimed_compute_units)::numeric / SUM(cs.num_estimated_compute_units)::numeric) * 100
          ELSE 0 END AS avg_efficiency_percent,
        MIN(cs.created_timestamp) AS period_start,
        MAX(cs.created_timestamp) AS period_end
      FROM claim_settlements cs
      ${where}
      GROUP BY cs.service_id, cs.chain
      ORDER BY total_claimed_compute_units DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
    `;

  const [countResult, servicesResult] = await Promise.all([
    client.query(countSql, values),
    client.query(sql, [...values, limitNum, offset])
  ]);

  const total = parseInt(countResult.rows[0]?.total || '0', 10);

  return {
    data: servicesResult.rows,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      days: daysValue,
      chain: chain || 'all',
      period_start: servicesResult.rows[0]?.period_start || null,
      period_end: servicesResult.rows[0]?.period_end || null
    }
  };
}

/**
 * Get top services by performance with percentage distribution
 * @param {Object} params - Query parameters
 * @param {string} [params.chain] - Optional chain filter
 * @param {string} [params.days='30'] - Time period in days (7, 15, or 30)
 * @param {string|string[]} [params.supplier_address] - Optional supplier operator address filter
 * @param {string} [params.owner_address] - Optional owner address filter
 * @param {number} [params.page=1] - Page number for pagination
 * @param {number} [params.limit=10] - Number of results per page
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Top services with percentage distribution
 */
async function getTopServicesByPerformance(params, client) {
  const { chain, days = '30', supplier_address, owner_address, page = 1, limit = 10 } = params;

  const daysValue = Math.max(1, Math.min(parseInt(days, 10) || 30, 365));

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 1000);
  const offset = (pageNum - 1) * limitNum;

  // settled-only filter + time window; chain goes first for index usage
  const conditions = [`cs.settlement_type = 'settled'`, `cs.created_timestamp >= NOW() - INTERVAL '${daysValue} days'`];
  const values = [];
  let idx = 1;

  if (chain) {
    conditions.unshift(`cs.chain = $1::text`);
    values.unshift(chain);
    idx = 2;
  }

  if (supplier_address) {
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
      addresses = supplier_address.split(',').map(addr => addr.trim()).filter(addr => addr.length > 0);
    } else {
      addresses = [supplier_address];
    }

    const isAccountAddress = (addr) => addr && addr.startsWith('pokt1') && !addr.startsWith('poktvaloper1');
    const accountAddresses = addresses.filter(isAccountAddress);
    const operatorAddresses = addresses.filter(addr => !isAccountAddress(addr));
    const addressConditions = [];

    // Account addresses: use subquery to find their operators — avoids JOIN chain mismatch
    if (accountAddresses.length > 0) {
      if (accountAddresses.length === 1) {
        addressConditions.push(`cs.supplier_operator_address IN (SELECT address FROM suppliers WHERE owner_address = $${idx}::text OR address = $${idx}::text)`);
        values.push(accountAddresses[0]);
        idx++;
      } else {
        addressConditions.push(`cs.supplier_operator_address IN (SELECT address FROM suppliers WHERE owner_address = ANY($${idx}::text[]) OR address = ANY($${idx}::text[]))`);
        values.push(accountAddresses);
        idx++;
      }
    }

    // Operator addresses: direct filter on claim_settlements
    if (operatorAddresses.length > 0) {
      if (operatorAddresses.length === 1) {
        addressConditions.push(`cs.supplier_operator_address = $${idx}::text`);
        values.push(operatorAddresses[0]);
        idx++;
      } else {
        addressConditions.push(`cs.supplier_operator_address = ANY($${idx}::text[])`);
        values.push(operatorAddresses);
        idx++;
      }
    }

    if (addressConditions.length > 0) {
      conditions.push(`(${addressConditions.join(' OR ')})`);
    }
  }

  // owner_address: use subquery to find operators — avoids chain mismatch in LEFT JOIN
  if (owner_address) {
    conditions.push(`cs.supplier_operator_address IN (SELECT address FROM suppliers WHERE owner_address = $${idx}::text)`);
    values.push(owner_address);
    idx++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const countSql = chain
    ? `SELECT COUNT(DISTINCT cs.service_id) AS total FROM claim_settlements cs ${where}`
    : `SELECT COUNT(*) AS total FROM (
        SELECT DISTINCT cs.service_id, cs.chain FROM claim_settlements cs ${where}
      ) t`;

  const grandTotalSql = `
    SELECT COALESCE(SUM(cs.num_claimed_compute_units), 0) AS total_compute_units
    FROM claim_settlements cs
    ${where}`;

  const sql = chain
    ? `
      WITH service_totals AS (
        SELECT
          cs.service_id,
          $1::text AS chain,
          SUM(cs.num_claimed_compute_units) AS total_claimed_compute_units,
          SUM(cs.num_estimated_compute_units) AS total_estimated_compute_units,
          COUNT(*) AS submission_count,
          CASE WHEN SUM(cs.num_estimated_compute_units) > 0
            THEN (SUM(cs.num_claimed_compute_units)::numeric / SUM(cs.num_estimated_compute_units)::numeric) * 100
            ELSE 0 END AS avg_efficiency_percent,
          MIN(cs.created_timestamp) AS period_start,
          MAX(cs.created_timestamp) AS period_end
        FROM claim_settlements cs
        ${where}
        GROUP BY cs.service_id
      )
      SELECT st.* FROM service_totals st
      ORDER BY st.total_claimed_compute_units DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
    `
    : `
      WITH service_totals AS (
        SELECT
          cs.service_id,
          cs.chain,
          SUM(cs.num_claimed_compute_units) AS total_claimed_compute_units,
          SUM(cs.num_estimated_compute_units) AS total_estimated_compute_units,
          COUNT(*) AS submission_count,
          CASE WHEN SUM(cs.num_estimated_compute_units) > 0
            THEN (SUM(cs.num_claimed_compute_units)::numeric / SUM(cs.num_estimated_compute_units)::numeric) * 100
            ELSE 0 END AS avg_efficiency_percent,
          MIN(cs.created_timestamp) AS period_start,
          MAX(cs.created_timestamp) AS period_end
        FROM claim_settlements cs
        ${where}
        GROUP BY cs.service_id, cs.chain
      )
      SELECT st.* FROM service_totals st
      ORDER BY st.total_claimed_compute_units DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
    `;

  const [countResult, grandTotalResult, servicesResult] = await Promise.all([
    client.query(countSql, values),
    client.query(grandTotalSql, values),
    client.query(sql, [...values, limitNum, offset])
  ]);

  const total = parseInt(countResult.rows[0]?.total || '0', 10);
  const totalComputeUnits = parseInt(grandTotalResult.rows[0]?.total_compute_units || '0', 10);

  const services = servicesResult.rows
    .filter(row => row.service_id)
    .map((service, index) => {
      const claimed = parseInt(service.total_claimed_compute_units || '0', 10);
      const percentage = totalComputeUnits > 0
        ? parseFloat(((claimed / totalComputeUnits) * 100).toFixed(2))
        : 0;

      return {
        rank: offset + index + 1,
        service_id: service.service_id,
        chain: service.chain,
        total_claimed_compute_units: claimed,
        total_estimated_compute_units: parseInt(service.total_estimated_compute_units || '0', 10),
        submission_count: parseInt(service.submission_count || '0', 10),
        avg_efficiency_percent: parseFloat(parseFloat(service.avg_efficiency_percent || '0').toFixed(2)),
        percentage_of_total: percentage,
        period_start: service.period_start,
        period_end: service.period_end
      };
    });

  return {
    data: services,
    total_compute_units: totalComputeUnits,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      days: daysValue,
      chain: chain || 'all',
      period_start: services[0]?.period_start || null,
      period_end: services[0]?.period_end || null
    }
  };
}

module.exports = {
  searchValidatorsAndServices,
  searchSuppliersAndServices,
  getValidatorPerformance,
  getSupplierPerformance,
  getSupplierOwnerPerformance,
  getTopServicesByComputeUnits,
  getTopServicesByPerformance
};

