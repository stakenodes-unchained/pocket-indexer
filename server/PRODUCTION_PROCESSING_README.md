# Production Data Processing Script

This script processes existing transactions from your production database without making any changes. It's designed to verify that the entity parsing logic works correctly on real production data before updating the database.

## Features

- **Read-only processing**: No database modifications
- **Batch processing**: Handles large datasets efficiently
- **Multi-chain support**: Process specific chains
- **Comprehensive reporting**: Detailed statistics and progress tracking
- **Flexible configuration**: Command-line arguments and environment variables
- **Error handling**: Robust error handling with detailed logging
- **Results export**: Optional JSON export of parsed entities

## Usage

### Basic Usage
```bash
# Process all transactions for a specific chain
node process_production_data.js --chain pocket-mainnet

# Process with custom batch size
node process_production_data.js --chain pocket-testnet-beta --batch-size 2000

# Process with limit (useful for testing)
node process_production_data.js --chain pocket-testnet-alpha --limit 10000

# Enable verbose output and save results
node process_production_data.js --chain pocket-mainnet --verbose --save-results
```

### Advanced Usage
```bash
# Process with all options
node process_production_data.js \
  --chain pocket-mainnet \
  --batch-size 1000 \
  --limit 50000 \
  --verbose \
  --save-results
```

## Command Line Arguments

| Argument | Description | Default | Example |
|----------|-------------|---------|---------|
| `--chain` | Chain to process (required) | - | `pocket-mainnet` |
| `--batch-size` | Batch size for processing | 1000 | `2000` |
| `--limit` | Limit number of transactions | No limit | `10000` |
| `--verbose` | Enable verbose output | false | - |
| `--save-results` | Save parsed results to JSON | false | - |
| `--help` | Show help message | - | - |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_HOST` | Database host | `localhost` |
| `DB_PORT` | Database port | `5432` |
| `DB_NAME` | Database name | `pokt_indexer` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASS` | Database password | `somestringpassword` |
| `VERBOSE` | Enable verbose mode | `false` |
| `SAVE_RESULTS` | Save results to file | `false` |

## Output

The script provides:

1. **Real-time progress**: Shows processing progress and statistics
2. **Summary report**: Complete processing summary with entity counts
3. **Performance metrics**: Processing rate and duration
4. **Error reporting**: Detailed error information for failed transactions
5. **Optional JSON export**: Complete parsed entity data

### Example Output
```
🚀 Starting to process transactions for chain: pocket-mainnet
📦 Batch size: 1000
🔢 Limit: No limit
📝 Verbose: No
💾 Save results: No

📦 Processing batch 1: 1000 transactions
📊 Progress: 1000/50000 (2.0%)

📦 Processing batch 2: 1000 transactions
📊 Progress: 2000/50000 (4.0%)

...

🎉 Processing completed!

📊 PROCESSING SUMMARY
==================================================
Chain: pocket-mainnet
Total Transactions: 50000
Processed Transactions: 50000
Skipped Transactions: 0
Errors: 0
Duration: 45.2 seconds
Rate: 1106.19 tx/sec

📈 ENTITIES EXTRACTED
------------------------------
Suppliers: 1250
Applications: 890
Gateways: 340
Nodes: 2100
Services: 5600
Claims: 12000
Relays: 15000
Staking Events: 4500

Total Entities: 45180
```

## Production Deployment

### 1. Copy Script to Production Server
```bash
scp process_production_data.js user@production-server:/path/to/indexer/server/
```

### 2. Set Environment Variables
```bash
export DB_HOST=your-production-db-host
export DB_PORT=5432
export DB_NAME=your-production-db-name
export DB_USER=your-production-db-user
export DB_PASS=your-production-db-password
```

### 3. Run Processing
```bash
# Test with small sample first
node process_production_data.js --chain pocket-mainnet --limit 1000 --verbose

# Process full dataset
node process_production_data.js --chain pocket-mainnet --batch-size 2000
```

## Safety Features

- **Read-only database connection**: No risk of data modification
- **Transaction validation**: Validates transaction data before processing
- **Error isolation**: Errors in individual transactions don't stop processing
- **Progress tracking**: Real-time progress monitoring
- **Comprehensive logging**: Detailed error reporting

## Performance Considerations

- **Batch processing**: Processes transactions in configurable batches
- **Memory efficient**: Doesn't load all data into memory
- **Database optimization**: Uses indexed queries for efficient data retrieval
- **Configurable limits**: Can process subsets for testing

## Troubleshooting

### Common Issues

1. **Database connection errors**: Check environment variables and network connectivity
2. **Memory issues**: Reduce batch size if processing large datasets
3. **Slow processing**: Increase batch size or check database performance
4. **No entities found**: Normal for chains with mostly bank transactions

### Debug Mode
```bash
# Enable verbose output for debugging
node process_production_data.js --chain pocket-mainnet --verbose --limit 100
```

## Next Steps

After successful processing and verification:

1. **Review results**: Check entity counts and data quality
2. **Test with production data**: Run on actual production database
3. **Prepare migration**: Create database migration scripts
4. **Deploy updates**: Update production indexer with new parsing logic
5. **Monitor performance**: Monitor processing performance and accuracy
