-- Compute Units Queries for EventClaimSettled Events
-- These queries aggregate compute units from claim_settlements table
-- where settlement_type = 'settled' (EventClaimSettled events)

-- ============================================================================
-- 1. LAST 24 HOURS (ROLLING WINDOW)
-- ============================================================================

-- Total compute units for the last 24 hours (rolling)
SELECT 
    'Last 24 Hours (Rolling)' AS time_period,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    AVG(num_claimed_compute_units) AS avg_claimed_compute_units,
    AVG(num_estimated_compute_units) AS avg_estimated_compute_units,
    MIN(created_timestamp) AS earliest_settlement,
    MAX(created_timestamp) AS latest_settlement
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= NOW() - INTERVAL '24 hours';

-- Last 24 hours with breakdown by service
SELECT 
    service_id,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    ROUND(SUM(num_estimated_compute_units)::numeric / NULLIF(SUM(num_claimed_compute_units), 0), 4) AS efficiency_ratio
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY service_id
ORDER BY total_estimated_compute_units DESC;

-- Last 24 hours with breakdown by supplier
SELECT 
    supplier_operator_address,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    SUM(claimed_upokt) AS total_claimed_upokt
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY supplier_operator_address
ORDER BY total_estimated_compute_units DESC
LIMIT 50;

-- Last 24 hours with breakdown by application
SELECT 
    application_address,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    SUM(claimed_upokt) AS total_claimed_upokt
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY application_address
ORDER BY total_estimated_compute_units DESC
LIMIT 50;

-- Last 24 hours hourly breakdown
SELECT 
    DATE_TRUNC('hour', created_timestamp) AS hour_bucket,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', created_timestamp)
ORDER BY hour_bucket DESC;

-- ============================================================================
-- 2. CALENDAR DAY (TODAY)
-- ============================================================================

-- Total compute units for today (calendar day)
SELECT 
    'Today (Calendar Day)' AS time_period,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    AVG(num_claimed_compute_units) AS avg_claimed_compute_units,
    AVG(num_estimated_compute_units) AS avg_estimated_compute_units,
    MIN(created_timestamp) AS earliest_settlement,
    MAX(created_timestamp) AS latest_settlement
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= CURRENT_DATE
    AND created_timestamp < CURRENT_DATE + INTERVAL '1 day';

-- Today with breakdown by service
SELECT 
    service_id,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    ROUND(SUM(num_estimated_compute_units)::numeric / NULLIF(SUM(num_claimed_compute_units), 0), 4) AS efficiency_ratio
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= CURRENT_DATE
    AND created_timestamp < CURRENT_DATE + INTERVAL '1 day'
GROUP BY service_id
ORDER BY total_estimated_compute_units DESC;

-- Today with breakdown by supplier
SELECT 
    supplier_operator_address,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    SUM(claimed_upokt) AS total_claimed_upokt
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= CURRENT_DATE
    AND created_timestamp < CURRENT_DATE + INTERVAL '1 day'
GROUP BY supplier_operator_address
ORDER BY total_estimated_compute_units DESC
LIMIT 50;

-- Today with breakdown by application
SELECT 
    application_address,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    SUM(claimed_upokt) AS total_claimed_upokt
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= CURRENT_DATE
    AND created_timestamp < CURRENT_DATE + INTERVAL '1 day'
GROUP BY application_address
ORDER BY total_estimated_compute_units DESC
LIMIT 50;

-- Today hourly breakdown
SELECT 
    DATE_TRUNC('hour', created_timestamp) AS hour_bucket,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= CURRENT_DATE
    AND created_timestamp < CURRENT_DATE + INTERVAL '1 day'
GROUP BY DATE_TRUNC('hour', created_timestamp)
ORDER BY hour_bucket DESC;

-- ============================================================================
-- 3. COMPARISON QUERIES
-- ============================================================================

-- Compare last 24 hours vs today
SELECT 
    CASE 
        WHEN created_timestamp >= NOW() - INTERVAL '24 hours' THEN 'Last 24 Hours (Rolling)'
        ELSE 'Other'
    END AS time_period,
    COUNT(*) AS total_settlements,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND (
        created_timestamp >= NOW() - INTERVAL '24 hours'
        OR created_timestamp >= CURRENT_DATE
    )
GROUP BY 
    CASE 
        WHEN created_timestamp >= NOW() - INTERVAL '24 hours' THEN 'Last 24 Hours (Rolling)'
        ELSE 'Other'
    END;

-- ============================================================================
-- 4. DETAILED QUERIES WITH ADDITIONAL METRICS
-- ============================================================================

-- Last 24 hours with relays and rewards
SELECT 
    COUNT(*) AS total_settlements,
    SUM(num_relays) AS total_relays,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    SUM(claimed_upokt) AS total_claimed_upokt,
    ROUND(AVG(num_estimated_compute_units::numeric / NULLIF(num_claimed_compute_units, 0)), 4) AS avg_efficiency_ratio,
    ROUND(SUM(num_estimated_compute_units::numeric) / NULLIF(SUM(num_claimed_compute_units), 0), 4) AS overall_efficiency_ratio
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= NOW() - INTERVAL '24 hours';

-- Today with relays and rewards
SELECT 
    COUNT(*) AS total_settlements,
    SUM(num_relays) AS total_relays,
    SUM(num_claimed_compute_units) AS total_claimed_compute_units,
    SUM(num_estimated_compute_units) AS total_estimated_compute_units,
    SUM(claimed_upokt) AS total_claimed_upokt,
    ROUND(AVG(num_estimated_compute_units::numeric / NULLIF(num_claimed_compute_units, 0)), 4) AS avg_efficiency_ratio,
    ROUND(SUM(num_estimated_compute_units::numeric) / NULLIF(SUM(num_claimed_compute_units), 0), 4) AS overall_efficiency_ratio
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= CURRENT_DATE
    AND created_timestamp < CURRENT_DATE + INTERVAL '1 day';

-- ============================================================================
-- 5. TIME SERIES QUERIES (FOR CHARTING)
-- ============================================================================

-- Last 24 hours by hour (for time series chart)
SELECT 
    DATE_TRUNC('hour', created_timestamp) AS hour_bucket,
    COUNT(*) AS settlements_count,
    SUM(num_claimed_compute_units) AS claimed_cu,
    SUM(num_estimated_compute_units) AS estimated_cu,
    SUM(num_relays) AS total_relays,
    SUM(claimed_upokt) AS total_upokt
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', created_timestamp)
ORDER BY hour_bucket ASC;

-- Today by hour (for time series chart)
SELECT 
    DATE_TRUNC('hour', created_timestamp) AS hour_bucket,
    COUNT(*) AS settlements_count,
    SUM(num_claimed_compute_units) AS claimed_cu,
    SUM(num_estimated_compute_units) AS estimated_cu,
    SUM(num_relays) AS total_relays,
    SUM(claimed_upokt) AS total_upokt
FROM claim_settlements
WHERE settlement_type = 'settled'
    AND created_timestamp >= CURRENT_DATE
    AND created_timestamp < CURRENT_DATE + INTERVAL '1 day'
GROUP BY DATE_TRUNC('hour', created_timestamp)
ORDER BY hour_bucket ASC;

