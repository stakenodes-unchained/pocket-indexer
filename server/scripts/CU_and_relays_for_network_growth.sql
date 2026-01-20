
WITH block_days AS (
    SELECT
        height,
        chain,
        DATE_TRUNC('day', timestamp) AS day
    FROM blocks
    WHERE timestamp >= NOW() - INTERVAL '7 days'
)
SELECT
    TO_CHAR(bd.day, 'YYYY-MM-DD') AS day,
    pe.chain,
    pe.event_type,
    TO_CHAR(COUNT(*), '999,999,999') AS total_events,
    TO_CHAR(COUNT(DISTINCT pe.block_height), '999,999') AS distinct_blocks,
    TO_CHAR(SUM(pe.num_relays), '999,999,999,999') AS total_relays,
    TO_CHAR(ROUND(SUM(pe.num_claimed_compute_units) / 1000000.0, 2), '999,999,999.99') || 'M' AS total_claimed_cus_millions,
    TO_CHAR(ROUND(SUM(pe.num_estimated_compute_units) / 1000000.0, 2), '999,999,999.99') || 'M' AS total_estimated_cus_millions
FROM proof_events pe
INNER JOIN block_days bd ON pe.block_height = bd.height AND pe.chain = bd.chain
where event_type='created'  GROUP BY bd.day, pe.chain, pe.event_type
ORDER BY bd.day DESC, pe.chain, pe.event_type;

