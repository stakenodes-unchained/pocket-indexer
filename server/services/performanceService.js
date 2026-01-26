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
 * Search for suppliers by owner address and service URLs
 * @param {Object} params - Search parameters
 * @param {string} params.q - Search query string (owner address or service URL)
 * @param {string} [params.chain] - Optional chain filter
 * @param {number} [params.limit=20] - Maximum results per category
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Search results with suppliers and services
 */
async function searchSuppliersAndServices(params, client) {
  const { q, chain, limit = 20 } = params;
  
  if (!q || q.trim().length === 0) {
    throw new Error("Query parameter 'q' is required");
  }
  
  const searchQuery = q.trim();
  const searchPattern = `%${searchQuery}%`;
  const limitNum = Math.min(parseInt(limit, 10) || 20, 100); // Cap at 100
  const values = [searchPattern, searchQuery];
  let idx = 3;
  
  // Build supplier search query - search by owner_address
  const supplierConditions = [
    `(s.owner_address ILIKE $1 OR s.owner_address = $2 OR s.address ILIKE $1 OR s.address = $2)`
  ];
  if (chain) {
    supplierConditions.push(`s.chain = $${idx++}`);
    values.push(chain);
  }
  const supplierWhere = `WHERE ${supplierConditions.join(' AND ')}`;
  
  // Search suppliers by owner_address or operator_address (address field)
  const supplierSql = `
    SELECT DISTINCT
      s.owner_address,
      s.address AS supplier_operator_address,
      s.chain,
      s.status,
      s.staked_amount
    FROM suppliers s
    ${supplierWhere}
    ORDER BY 
      CASE 
        WHEN s.owner_address = $2 OR s.address = $2 THEN 1
        WHEN s.owner_address ILIKE $1 THEN 2
        ELSE 3
      END,
      s.owner_address NULLS LAST
    LIMIT $${idx}::integer
  `;
  values.push(limitNum);
  
  // Build service search query - search in supplier_service_configs.endpoints
  const serviceConditions = [];
  const serviceValues = [searchPattern];
  let serviceIdx = 2;
  
  if (chain) {
    serviceConditions.push(`ssc.chain = $${serviceIdx++}`);
    serviceValues.push(chain);
  }
  const serviceWhere = serviceConditions.length ? `WHERE ${serviceConditions.join(' AND ')}` : '';
  
  // Find services matching the URL and get all suppliers using them
  const serviceSql = `
    WITH matching_endpoints AS (
      SELECT DISTINCT
        ssc.service_id,
        ssc.chain,
        ssc.supplier_address,
        endpoint AS service_url
      FROM supplier_service_configs ssc,
      LATERAL unnest(ssc.endpoints) AS endpoint
      ${serviceWhere}
      ${serviceWhere ? 'AND' : 'WHERE'} endpoint ILIKE $1
    )
    SELECT 
      me.service_id,
      me.chain,
      me.service_url,
      array_agg(DISTINCT s.owner_address) FILTER (WHERE s.owner_address IS NOT NULL) AS owner_addresses,
      array_agg(DISTINCT me.supplier_address) AS supplier_operator_addresses,
      COUNT(DISTINCT me.supplier_address) AS supplier_count
    FROM matching_endpoints me
    LEFT JOIN suppliers s ON s.address = me.supplier_address AND s.chain = me.chain
    GROUP BY me.service_id, me.chain, me.service_url
    ORDER BY supplier_count DESC, me.service_id
    LIMIT $${serviceIdx}::integer
  `;
  serviceValues.push(limitNum);
  
  // Execute both queries in parallel
  const [supplierRes, serviceRes] = await Promise.all([
    client.query(supplierSql, values),
    client.query(serviceSql, serviceValues)
  ]);
  
  // Format supplier results
  const suppliers = supplierRes.rows.map(row => ({
    type: 'supplier',
    owner_address: row.owner_address || undefined,
    supplier_operator_address: row.supplier_operator_address,
    chain: row.chain,
    status: row.status || undefined,
    staked_amount: row.staked_amount ? String(row.staked_amount) : undefined
  }));
  
  // Format service results
  const services = serviceRes.rows.map(row => ({
    type: 'service',
    service_id: row.service_id,
    service_url: row.service_url,
    owner_addresses: row.owner_addresses || [],
    supplier_operator_addresses: row.supplier_operator_addresses || [],
    supplier_count: parseInt(row.supplier_count || '0', 10)
  }));
  
  return {
    suppliers,
    services
  };
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
  
  // Validate days
  const validDays = ['7', '15', '30'];
  const daysValue = validDays.includes(days) ? parseInt(days, 10) : 30;
  
  // Validate and parse pagination parameters
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 1000); // Cap at 1000 for performance
  const offset = (pageNum - 1) * limitNum;
  
  // Build WHERE conditions
  // Put chain first for optimal index usage, so it's always $1 if provided
  const conditions = [`ps.claim_proof_status_int = 0`, `ps.timestamp >= NOW() - INTERVAL '${daysValue} days'`];
  const values = [];
  let idx = 1;
  let needsJoin = false;
  
  // Put chain first in WHERE clause for optimal index usage (always $1 if provided)
  if (chain) {
    conditions.unshift(`ps.chain = $1::text`);
    values.unshift(chain);
    idx = 2; // Next parameter starts at 2
  }
  
  // Handle supplier_address filter - can be string, comma-separated string, or array
  // Addresses can be either account addresses (pokt1...) or operator addresses (poktvaloper1...)
  if (supplier_address) {
    needsJoin = true;
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
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
    
    // Match account addresses via owner_address in suppliers table
    // Also try matching directly against supplier_operator_address in case it contains account addresses
    if (accountAddresses.length > 0) {
      if (accountAddresses.length === 1) {
        addressConditions.push(`(s.owner_address = $${idx}::text OR ps.supplier_operator_address = $${idx}::text)`);
        values.push(accountAddresses[0]);
        idx++;
      } else {
        // Use ANY with array parameter to avoid parameter explosion
        addressConditions.push(`(s.owner_address = ANY($${idx}::text[]) OR ps.supplier_operator_address = ANY($${idx}::text[]))`);
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
  
  // Handle owner_address filter
  if (owner_address) {
    needsJoin = true;
    conditions.push(`s.owner_address = $${idx}::text`);
    values.push(owner_address);
    idx++;
  }
  
  const where = `WHERE ${conditions.join(' AND ')}`;
  const join = needsJoin ? `LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address AND s.chain = ps.chain` : '';
  
  // Build count query to get total number of services for pagination
  const countSql = chain
    ? `
      SELECT COUNT(DISTINCT ps.service_id) as total
      FROM proof_submissions ps
      ${join}
      ${where}
    `
    : `
      SELECT COUNT(*) as total
      FROM (
        SELECT DISTINCT ps.service_id, ps.chain
        FROM proof_submissions ps
        ${join}
        ${where}
      ) t
    `;
  
  // Optimized query - uses covering index for fast aggregation
  // When chain is provided, we group only by service_id (faster)
  // When chain is not provided, we include it in GROUP BY
  // Calculate chain param index (it's always the first parameter if provided)
  const chainParamIdx = chain ? 1 : null;
  const sql = chain
    ? `
      SELECT 
        ps.service_id,
        $1::text as chain,
        SUM(ps.num_claimed_compute_units) as total_claimed_compute_units,
        SUM(ps.num_estimated_compute_units) as total_estimated_compute_units,
        COUNT(*) as submission_count,
        AVG(ps.compute_unit_efficiency) as avg_efficiency_percent,
        MIN(ps.timestamp) as period_start,
        MAX(ps.timestamp) as period_end
      FROM proof_submissions ps
      ${join}
      ${where}
      GROUP BY ps.service_id
      ORDER BY total_claimed_compute_units DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
    `
    : `
      SELECT 
        ps.service_id,
        ps.chain,
        SUM(ps.num_claimed_compute_units) as total_claimed_compute_units,
        SUM(ps.num_estimated_compute_units) as total_estimated_compute_units,
        COUNT(*) as submission_count,
        AVG(ps.compute_unit_efficiency) as avg_efficiency_percent,
        MIN(ps.timestamp) as period_start,
        MAX(ps.timestamp) as period_end
      FROM proof_submissions ps
      ${join}
      ${where}
      GROUP BY ps.service_id, ps.chain
      ORDER BY total_claimed_compute_units DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
    `;
  
  // Execute count and data queries in parallel
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
  
  // Validate days
  const validDays = ['7', '15', '30'];
  const daysValue = validDays.includes(days) ? parseInt(days, 10) : 30;
  
  // Validate and parse pagination parameters
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(Math.max(1, parseInt(limit, 10) || 10), 1000); // Cap at 1000 for performance
  const offset = (pageNum - 1) * limitNum;
  
  // Build WHERE conditions
  // Put chain first for optimal index usage, so it's always $1 if provided
  const conditions = [`ps.claim_proof_status_int = 0`, `ps.timestamp >= NOW() - INTERVAL '${daysValue} days'`];
  const values = [];
  let idx = 1;
  let needsJoin = false;
  
  // Put chain first in WHERE clause for optimal index usage (always $1 if provided)
  if (chain) {
    conditions.unshift(`ps.chain = $1::text`);
    values.unshift(chain);
    idx = 2; // Next parameter starts at 2
  }
  
  // Handle supplier_address filter - can be string, comma-separated string, or array
  // Addresses can be either account addresses (pokt1...) or operator addresses (poktvaloper1...)
  if (supplier_address) {
    needsJoin = true;
    let addresses;
    if (Array.isArray(supplier_address)) {
      addresses = supplier_address;
    } else if (typeof supplier_address === 'string' && supplier_address.includes(',')) {
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
    
    // Match account addresses via owner_address in suppliers table
    // Also try matching directly against supplier_operator_address in case it contains account addresses
    if (accountAddresses.length > 0) {
      if (accountAddresses.length === 1) {
        addressConditions.push(`(s.owner_address = $${idx}::text OR ps.supplier_operator_address = $${idx}::text)`);
        values.push(accountAddresses[0]);
        idx++;
      } else {
        // Use ANY with array parameter to avoid parameter explosion
        addressConditions.push(`(s.owner_address = ANY($${idx}::text[]) OR ps.supplier_operator_address = ANY($${idx}::text[]))`);
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
  
  // Handle owner_address filter
  if (owner_address) {
    needsJoin = true;
    conditions.push(`s.owner_address = $${idx}::text`);
    values.push(owner_address);
    idx++;
  }
  
  const where = `WHERE ${conditions.join(' AND ')}`;
  const join = needsJoin ? `LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address AND s.chain = ps.chain` : '';
  
  // Build count query to get total number of services for pagination
  const countSql = chain
    ? `
      SELECT COUNT(DISTINCT ps.service_id) as total
      FROM proof_submissions ps
      ${join}
      ${where}
    `
    : `
      SELECT COUNT(*) as total
      FROM (
        SELECT DISTINCT ps.service_id, ps.chain
        FROM proof_submissions ps
        ${join}
        ${where}
      ) t
    `;
  
  // Build grand_total query - calculate total compute units across all services
  // This is needed for percentage calculations and should be calculated separately
  // to ensure we have it even when a page has no results
  const grandTotalSql = `
    SELECT COALESCE(SUM(ps.num_claimed_compute_units), 0) as total_compute_units
    FROM proof_submissions ps
    ${join}
    ${where}
  `;
  
  // Single optimized query with CTE for paginated services
  // Calculate chain param index (it's always the first parameter if provided)
  const chainParamIdx = chain ? 1 : null;
  const sql = chain
    ? `
      WITH service_totals AS (
        SELECT 
          ps.service_id,
          $1::text as chain,
          SUM(ps.num_claimed_compute_units) as total_claimed_compute_units,
          SUM(ps.num_estimated_compute_units) as total_estimated_compute_units,
          COUNT(*) as submission_count,
          AVG(ps.compute_unit_efficiency) as avg_efficiency_percent,
          MIN(ps.timestamp) as period_start,
          MAX(ps.timestamp) as period_end
        FROM proof_submissions ps
        ${join}
        ${where}
        GROUP BY ps.service_id
      )
      SELECT 
        st.*
      FROM service_totals st
      ORDER BY st.total_claimed_compute_units DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
    `
    : `
      WITH service_totals AS (
        SELECT 
          ps.service_id,
          ps.chain,
          SUM(ps.num_claimed_compute_units) as total_claimed_compute_units,
          SUM(ps.num_estimated_compute_units) as total_estimated_compute_units,
          COUNT(*) as submission_count,
          AVG(ps.compute_unit_efficiency) as avg_efficiency_percent,
          MIN(ps.timestamp) as period_start,
          MAX(ps.timestamp) as period_end
        FROM proof_submissions ps
        ${join}
        ${where}
        GROUP BY ps.service_id, ps.chain
      )
      SELECT 
        st.*
      FROM service_totals st
      ORDER BY st.total_claimed_compute_units DESC
      LIMIT $${idx}::integer OFFSET $${idx + 1}::integer
    `;
  
  // Execute count, grand_total, and data queries in parallel
  const [countResult, grandTotalResult, servicesResult] = await Promise.all([
    client.query(countSql, values),
    client.query(grandTotalSql, values),
    client.query(sql, [...values, limitNum, offset])
  ]);
  
  const total = parseInt(countResult.rows[0]?.total || '0', 10);
  const totalComputeUnits = parseInt(grandTotalResult.rows[0]?.total_compute_units || '0', 10);
  
  // Calculate percentages and add rank (rank is global position, not page position)
  const services = servicesResult.rows
    .filter(row => row.service_id) // Filter out any NULL service_ids
    .map((service, index) => {
      const claimed = parseInt(service.total_claimed_compute_units || '0', 10);
      const percentage = totalComputeUnits > 0 
        ? parseFloat(((claimed / totalComputeUnits) * 100).toFixed(2))
        : 0;
      
      return {
        rank: offset + index + 1, // Global rank based on offset
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
  getTopServicesByComputeUnits,
  getTopServicesByPerformance
};

