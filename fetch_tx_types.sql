-- Query to fetch one transaction of each type from the transactions table
-- This will help verify our parsing logic and see what message types are in the DB

SELECT 
    type,
    hash,
    sender,
    recipient,
    amount,
    fee,
    memo,
    status,
    timestamp,
    chain,
	tx_data
FROM (
    SELECT 
        *,
        ROW_NUMBER() OVER (PARTITION BY type ORDER BY timestamp DESC) as rn
    FROM transactions
    WHERE type IS NOT NULL 
    AND type != 'unknown'
) ranked
WHERE rn = 1
ORDER BY type;

-- Alternative query to see all unique types and their counts
-- SELECT 
--     type,
--     COUNT(*) as count,
--     MIN(timestamp) as first_seen,
--     MAX(timestamp) as last_seen
-- FROM transactions 
-- WHERE type IS NOT NULL 
-- AND type != 'unknown'
-- GROUP BY type
-- ORDER BY count DESC;
