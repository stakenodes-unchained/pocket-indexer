'use strict';

/**
 * Performance Service
 * 
 * Handles business logic for validator and service performance queries,
 * search functionality, and service analytics.
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
  const validatorSql = `
    SELECT DISTINCT
      v.account_address AS validator_account_address,
      v.moniker,
      v.operator_address,
      v.chain
    FROM validators v
    ${validatorWhere}
    ORDER BY 
      CASE 
        WHEN v.account_address = $2 OR v.operator_address = $2 THEN 1
        WHEN v.moniker ILIKE $1 THEN 2
        ELSE 3
      END,
      v.moniker NULLS LAST
    LIMIT $${idx}
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
    LIMIT $${serviceIdx}
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

  if (chain) { conditions.push(`ps.chain = $${idx++}`); values.push(chain); }
  if (service_id) { conditions.push(`ps.service_id = $${idx++}`); values.push(service_id); }
  if (start_date) { conditions.push(`ps.timestamp >= $${idx++}`); values.push(start_date); }
  if (end_date) { conditions.push(`ps.timestamp <= $${idx++}`); values.push(end_date); }
  
  // Handle supplier_address - can be single string, comma-separated string, or array
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
    
    if (addresses.length === 1) {
      // Single address - use equality for better index usage
      conditions.push(`ps.supplier_operator_address = $${idx++}`);
      values.push(addresses[0]);
    } else if (addresses.length > 1) {
      // Multiple addresses - use IN clause
      const placeholders = addresses.map((_, i) => `$${idx + i}`).join(', ');
      conditions.push(`ps.supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  if (owner_address) { conditions.push(`s.owner_address = $${idx++}`); values.push(owner_address); }
  if (domain) { conditions.push(`v.website_domain = $${idx++}`); values.push(domain); }

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
      ORDER BY bucket DESC NULLS LAST
      LIMIT $${idx} OFFSET $${idx + 1}`;
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
      ORDER BY bucket DESC NULLS LAST, total_relays DESC
      LIMIT $${idx} OFFSET $${idx + 1}`;
  }

  const countRes = await client.query(countSql, values);
  const total = parseInt(countRes.rows?.[0]?.total || '0', 10);

  const listRes = await client.query(listSql, [...values, limitNum, offset]);

  return {
    data: listRes.rows,
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
 * @param {string} [params.limit='10'] - Number of top services (5, 10, 25, or 50)
 * @param {string} [params.days='30'] - Time period in days (7, 15, or 30)
 * @param {string} [params.chain] - Optional chain filter
 * @param {string|string[]} [params.supplier_address] - Optional supplier operator address filter
 * @param {string} [params.owner_address] - Optional owner address filter
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Top services data with metadata
 */
async function getTopServicesByComputeUnits(params, client) {
  const { limit = '10', days = '30', chain, supplier_address, owner_address } = params;
  
  // Validate limit
  const validLimits = ['5', '10', '25', '50'];
  const limitValue = validLimits.includes(limit) ? parseInt(limit, 10) : 10;
  
  // Validate days
  const validDays = ['7', '15', '30'];
  const daysValue = validDays.includes(days) ? parseInt(days, 10) : 30;
  
  // Build WHERE conditions
  const conditions = [`ps.claim_proof_status_int = 0`, `ps.timestamp >= NOW() - INTERVAL '${daysValue} days'`];
  const values = [];
  let idx = 1;
  let needsJoin = false;
  
  // Handle supplier_address filter (operator address) - can be string, comma-separated string, or array
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
    
    if (addresses.length === 1) {
      conditions.push(`ps.supplier_operator_address = $${idx++}`);
      values.push(addresses[0]);
    } else if (addresses.length > 1) {
      const placeholders = addresses.map((_, i) => `$${idx + i}`).join(', ');
      conditions.push(`ps.supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  // Handle owner_address filter
  if (owner_address) {
    needsJoin = true;
    conditions.push(`s.owner_address = $${idx++}`);
    values.push(owner_address);
  }
  
  // Put chain first in WHERE clause for optimal index usage
  if (chain) {
    conditions.unshift(`ps.chain = $${idx++}`);
    values.unshift(chain);
  }
  
  const where = `WHERE ${conditions.join(' AND ')}`;
  const join = needsJoin ? `LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address AND s.chain = ps.chain` : '';
  
  // Optimized query - uses covering index for fast aggregation
  // When chain is provided, we group only by service_id (faster)
  // When chain is not provided, we include it in GROUP BY
  // Calculate chain param index (it's always the first parameter if provided)
  const chainParamIdx = chain ? 1 : null;
  const sql = chain
    ? `
      SELECT 
        ps.service_id,
        $${chainParamIdx}::text as chain,
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
      LIMIT $${idx}
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
      LIMIT $${idx}
    `;
  
  values.push(limitValue);
  
  const result = await client.query(sql, values);
  
  return {
    data: result.rows,
    meta: {
      limit: limitValue,
      days: daysValue,
      chain: chain || 'all',
      period_start: result.rows[0]?.period_start || null,
      period_end: result.rows[0]?.period_end || null
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
 * @param {Object} client - PostgreSQL client
 * @returns {Promise<Object>} Top services with percentage distribution
 */
async function getTopServicesByPerformance(params, client) {
  const { chain, days = '30', supplier_address, owner_address } = params;
  
  // Validate days
  const validDays = ['7', '15', '30'];
  const daysValue = validDays.includes(days) ? parseInt(days, 10) : 30;
  
  // Build WHERE conditions
  const conditions = [`ps.claim_proof_status_int = 0`, `ps.timestamp >= NOW() - INTERVAL '${daysValue} days'`];
  const values = [];
  let idx = 1;
  let needsJoin = false;
  
  // Handle supplier_address filter (operator address) - can be string, comma-separated string, or array
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
    
    if (addresses.length === 1) {
      conditions.push(`ps.supplier_operator_address = $${idx++}`);
      values.push(addresses[0]);
    } else if (addresses.length > 1) {
      const placeholders = addresses.map((_, i) => `$${idx + i}`).join(', ');
      conditions.push(`ps.supplier_operator_address IN (${placeholders})`);
      values.push(...addresses);
      idx += addresses.length;
    }
  }
  
  // Handle owner_address filter
  if (owner_address) {
    needsJoin = true;
    conditions.push(`s.owner_address = $${idx++}`);
    values.push(owner_address);
  }
  
  // Put chain first in WHERE clause for optimal index usage
  if (chain) {
    conditions.unshift(`ps.chain = $${idx++}`);
    values.unshift(chain);
  }
  
  const where = `WHERE ${conditions.join(' AND ')}`;
  const join = needsJoin ? `LEFT JOIN suppliers s ON s.address = ps.supplier_operator_address AND s.chain = ps.chain` : '';
  
  // Single optimized query with CTE - faster than two separate queries
  // Uses covering index and calculates total in one pass
  // Calculate chain param index (it's always the first parameter if provided)
  const chainParamIdx = chain ? 1 : null;
  const sql = chain
    ? `
      WITH service_totals AS (
        SELECT 
          ps.service_id,
          $${chainParamIdx}::text as chain,
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
      ),
      grand_total AS (
        SELECT SUM(total_claimed_compute_units) as total_compute_units
        FROM service_totals
      )
      SELECT 
        st.*,
        gt.total_compute_units
      FROM service_totals st
      CROSS JOIN grand_total gt
      ORDER BY st.total_claimed_compute_units DESC
      LIMIT 10
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
      ),
      grand_total AS (
        SELECT SUM(total_claimed_compute_units) as total_compute_units
        FROM service_totals
      )
      SELECT 
        st.*,
        gt.total_compute_units
      FROM service_totals st
      CROSS JOIN grand_total gt
      ORDER BY st.total_claimed_compute_units DESC
      LIMIT 10
    `;
  
  const servicesResult = await client.query(sql, values);
  const totalComputeUnits = parseInt(servicesResult.rows[0]?.total_compute_units || '0', 10);
  
  // Calculate percentages and add rank
  const services = servicesResult.rows.map((service, index) => {
    const claimed = parseInt(service.total_claimed_compute_units || '0', 10);
    const percentage = totalComputeUnits > 0 
      ? parseFloat(((claimed / totalComputeUnits) * 100).toFixed(2))
      : 0;
    
    return {
      rank: index + 1,
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
      days: daysValue,
      chain: chain || 'all',
      period_start: services[0]?.period_start || null,
      period_end: services[0]?.period_end || null
    }
  };
}

module.exports = {
  searchValidatorsAndServices,
  getValidatorPerformance,
  getTopServicesByComputeUnits,
  getTopServicesByPerformance
};

