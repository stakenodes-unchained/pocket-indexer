# Backfill Service Configs

## Problem

The `supplier_service_configs` and `application_service_configs` tables were empty even though there were thousands of staking transactions in the database. This was because:

1. The `entityParser.v2.js` was correctly extracting `service_configs` from MsgStakeSupplier and MsgStakeApplication messages
2. But the `upsertSupplier` and `upsertApplication` functions in `db.js` were ignoring the `service_configs` field and not inserting them into the respective tables

## Solution

### 1. Fixed the indexer code

Updated `server/services/indexer/db.js`:
- Modified `upsertSupplier()` to insert service configs into `supplier_service_configs` table
- Modified `upsertApplication()` to insert service configs into `application_service_configs` table

These changes ensure that new staking transactions will properly populate the service config tables going forward.

### 2. Created backfill script

Created `server/scripts/backfill_service_configs.js` to populate historical data from existing transactions in the database.

## Running the Backfill

### Prerequisites

- PostgreSQL database with indexed transactions
- Node.js environment with access to the database

### Environment Variables

```bash
# Database configuration
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=pocket_indexer
export DB_USER=postgres
export DB_PASSWORD=postgres

# Script configuration (optional)
export CHAIN=pocket-mainnet        # Default: pocket-mainnet
export BATCH_SIZE=100             # Default: 100 transactions per batch
```

### Running the Script

```bash
# Basic usage (uses environment variables or defaults)
cd server/scripts
node backfill_service_configs.js

# Or with inline environment variables
DB_HOST=localhost DB_NAME=pocket_indexer CHAIN=pocket-mainnet node backfill_service_configs.js
```

### What the Script Does

1. **Counts transactions**: Identifies how many MsgStakeSupplier and MsgStakeApplication transactions exist
2. **Processes in batches**: Reads transactions in configurable batches (default 100)
3. **Parses service configs**: Extracts service configuration from transaction messages
4. **Inserts configs**: Upserts into `supplier_service_configs` and `application_service_configs` tables
5. **Reports progress**: Shows progress and final counts

### Expected Output

```
Starting service configs backfill...
Chain: pocket-mainnet
Batch Size: 100
Total MsgStakeSupplier transactions: 57423
Total MsgStakeApplication transactions: 12345

Processing supplier transactions...
Processed 100/57423 supplier transactions, inserted 234 configs
Processed 200/57423 supplier transactions, inserted 512 configs
...

Supplier service configs inserted: 15234

Processing application transactions...
Processed 100/12345 application transactions, inserted 123 configs
...

Application service configs inserted: 3456

=== Backfill Summary ===
Supplier service configs: 15234
Application service configs: 3456
Total configs: 18690

=== Final Database Counts ===
Supplier service configs in DB: 15234
Application service configs in DB: 3456

Backfill complete!
```

## Verification

After running the backfill, verify the results:

```sql
-- Check supplier service configs
SELECT COUNT(*) FROM supplier_service_configs WHERE chain='pocket-mainnet';

-- Check application service configs  
SELECT COUNT(*) FROM application_service_configs WHERE chain='pocket-mainnet';

-- Sample supplier configs with details
SELECT 
  supplier_address,
  service_id,
  array_length(endpoints, 1) as num_endpoints,
  config_options,
  last_seen
FROM supplier_service_configs 
WHERE chain='pocket-mainnet'
LIMIT 10;

-- Sample application configs with details
SELECT 
  application_address,
  service_id,
  array_length(endpoints, 1) as num_endpoints,
  config_options,
  last_seen
FROM application_service_configs 
WHERE chain='pocket-mainnet'
LIMIT 10;

-- Count unique suppliers with service configs
SELECT COUNT(DISTINCT supplier_address) 
FROM supplier_service_configs 
WHERE chain='pocket-mainnet';

-- Count unique services per supplier
SELECT 
  supplier_address,
  COUNT(DISTINCT service_id) as num_services
FROM supplier_service_configs 
WHERE chain='pocket-mainnet'
GROUP BY supplier_address
ORDER BY num_services DESC
LIMIT 10;
```

## Transaction Data Structure

The script parses MsgStakeSupplier transactions which have this structure:

```json
{
  "tx": {
    "body": {
      "messages": [{
        "@type": "/pocket.supplier.MsgStakeSupplier",
        "operator_address": "pokt1...",
        "stake": {
          "denom": "upokt",
          "amount": "15000000000"
        },
        "services": [{
          "service_id": "anvil",
          "endpoints": [
            "https://node1.example.com:443",
            "https://node2.example.com:443"
          ],
          "config_options": {
            "publicly_exposed_endpoints": ["https://public.example.com"],
            "revshare_percent": 10
          }
        }]
      }]
    }
  }
}
```

## Notes

- The script uses `ON CONFLICT ... DO UPDATE` to handle duplicate entries safely
- `last_seen` is set to `GREATEST(existing, new)` to preserve the most recent timestamp
- The script is idempotent - you can run it multiple times safely
- Large databases may take significant time; monitor the progress output
- Adjust `BATCH_SIZE` if you encounter memory issues with large transactions

## Troubleshooting

### No data inserted

- Check that transactions have the correct `type` field: `MsgStakeSupplier (supplier)` or `MsgStakeApplication (application)`
- Verify that `tx_data` field contains valid JSON
- Check that messages have the `services` array with `service_id`, `endpoints`, and `config_options`

### Database connection errors

- Verify database credentials and network connectivity
- Ensure PostgreSQL is running and accessible
- Check that the database name is correct

### Out of memory errors

- Reduce `BATCH_SIZE` (e.g., `BATCH_SIZE=50`)
- Increase Node.js heap size: `node --max-old-space-size=4096 backfill_service_configs.js`

## Future Improvements

- Add dry-run mode to preview changes without inserting
- Add progress bar for better UX
- Support resume from checkpoint for very large datasets
- Add validation mode to compare transaction data with database state

