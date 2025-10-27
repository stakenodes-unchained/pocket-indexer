# Proof Parser Service

## Overview

The Proof Parser Service is a dedicated microservice that processes proof submissions and claims from existing transactions in the database. It runs separately from the main indexer service and is optimized for background processing of historical and new transactions.

## Architecture

### Components

1. **proof-parser-server.js** - Express server that manages the service lifecycle
2. **proofParserService.js** - Core service for parsing proof submissions and claims
3. **Docker service** - Containerized deployment via docker-compose

### Processing Modes

1. **Historical Processing**: Processes all existing transactions from the database for a given chain
2. **Watch Mode**: Monitors for new transactions and processes them incrementally

## Usage

### Development

```bash
# Start for a specific chain
node proof-parser-server.js --chain=mainnet

# Start for all chains
node proof-parser-server.js --all-chains
```

### Docker

```bash
# Start the proof-parser service
docker-compose up proof-parser

# View logs
docker-compose logs -f proof-parser

# Restart the service
docker-compose restart proof-parser
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PROOF_PARSER_PORT` | Port for health monitoring server | 3008 |
| `PROOF_PARSER_POLL_INTERVAL` | How often to check for new transactions (ms) | 10000 |
| `PROOF_PARSER_BATCH_SIZE` | Number of transactions to process per batch | 100 |
| `PROOF_PARSER_HEALTH_CHECK_INTERVAL` | Health check interval (ms) | 5000 |

## API Endpoints

### Health Endpoints (via API Server)

All health endpoints are proxied through the main API server:

#### Get Overall Health
```bash
GET /api/v1/health/proof-parser
```

Response:
```json
{
  "data": {
    "status": "healthy",
    "timestamp": "2025-01-27T16:24:05.000Z",
    "chains": [
      {
        "chain": "mainnet",
        "status": "running",
        "uptime": 3600000,
        "processedCount": 1500,
        "errorCount": 2,
        "lastProcessTime": "2025-01-27T16:23:50.000Z",
        "historicalCompleted": true,
        "isWatching": true,
        "database": "connected"
      }
    ]
  }
}
```

#### Get Chain-Specific Health
```bash
GET /api/v1/health/proof-parser/mainnet
```

Response:
```json
{
  "data": {
    "chain": "mainnet",
    "status": "running",
    "uptime": 3600000,
    "processedCount": 1500,
    "errorCount": 2,
    "lastProcessTime": "2025-01-27T16:23:50.000Z",
    "lastError": null,
    "historicalCompleted": true,
    "isWatching": true,
    "database": "connected"
  }
}
```

#### Get Statistics
```bash
GET /api/v1/health/proof-parser/stats
```

Response:
```json
{
  "data": {
    "stats": [
      {
        "chain": "mainnet",
        "processed": 1500,
        "errors": 2,
        "status": "running",
        "uptime": 3600000,
        "lastProcessTime": "2025-01-27T16:23:50.000Z"
      }
    ]
  }
}
```

### Direct Endpoints (Proof Parser Service)

You can also access endpoints directly on the proof-parser service (port 3008):

```bash
GET http://localhost:3008/health
GET http://localhost:3008/health/:chain
GET http://localhost:3008/stats
POST http://localhost:3008/start/:chain
POST http://localhost:3008/stop/:chain
```

## Features

### Performance Optimizations

1. **Batch Processing**: Processes transactions in configurable batches (default: 100)
2. **Efficient Database Queries**: Uses indexed queries for fast retrieval
3. **Connection Pooling**: Reuses database connections
4. **Error Recovery**: Continues processing even if individual transactions fail
5. **Watch Mode**: Only processes new transactions after historical processing completes

### Reliability

1. **Graceful Shutdown**: Handles SIGTERM and SIGINT signals
2. **Health Monitoring**: Provides health check endpoints
3. **Error Tracking**: Tracks error counts and last error messages
4. **Database Connection Management**: Automatic reconnection handling
5. **Auto-restart**: Docker container auto-restarts on failure

### Monitoring

The service tracks:
- Total transactions processed
- Total errors encountered
- Last processing time
- Uptime
- Database connection status
- Historical processing completion status
- Watch mode status

## Workflow

### 1. Historical Processing

1. Connect to database
2. Query for transactions that have `tx_data` populated
3. Process transactions in batches
4. For each transaction:
   - Parse `tx_data` to extract transaction events
   - Extract `EventProofSubmitted` events for proof submissions
   - Extract claim information
   - Save to `proof_submissions` and `claims` tables
5. Continue until all transactions are processed

### 2. Watch Mode

1. Wait for historical processing to complete
2. Poll database for new transactions (every 10 seconds by default)
3. Process new transactions in batches
4. Save results to database
5. Continue watching

## Database Integration

### Tables Used

- **transactions**: Source of transaction data
- **blocks**: Block information for transactions
- **proof_submissions**: Destination for proof submission data
- **claims**: Destination for claim data

### Queries

#### Get transactions to process
```sql
SELECT id, hash, block_id, chain, tx_data, timestamp
FROM transactions 
WHERE chain = $1 AND (tx_data->>'tx') IS NOT NULL
ORDER BY timestamp ASC, id ASC
LIMIT $2 OFFSET $3
```

#### Get block information
```sql
SELECT b.* 
FROM blocks b
INNER JOIN transactions t ON t.block_id = b.id
WHERE t.hash = $1 AND t.chain = $2
LIMIT 1
```

## Logging

The service logs:
- Service start/stop events
- Batch processing progress
- Error messages
- Statistics updates
- Health check events

Example log output:
```
[ProofParser] Starting proof parser service for chain: mainnet
[ProofParser] Connected to database for chain mainnet
[ProofParser] Found 15420 transactions to process for chain: mainnet
[ProofParser] Processing batch 1 (100 transactions)
[ProofParser] Saved 45 proof submissions
[ProofParser] Saved 12 claims
[ProofParser] Historical processing completed for chain: mainnet
[ProofParser] Watch mode started successfully
```

## Troubleshooting

### Service Not Processing Transactions

1. Check health endpoint: `GET /api/v1/health/proof-parser`
2. Check logs: `docker-compose logs -f proof-parser`
3. Verify database connection
4. Check if historical processing is complete

### High Error Rate

1. Check last error: `GET /api/v1/health/proof-parser/health`
2. Review transaction data quality
3. Check database constraints
4. Verify parser logic for specific transaction types

### Slow Processing

1. Increase batch size: Set `PROOF_PARSER_BATCH_SIZE` to a higher value
2. Check database performance
3. Review indexes on transactions table
4. Consider running multiple instances for different chains

## Best Practices

1. **Run historical processing once**: Let it complete before starting watch mode
2. **Monitor health**: Regularly check health endpoints
3. **Scale horizontally**: Run separate instances for different chains
4. **Backup before reprocessing**: Backup database before running on production
5. **Monitor resource usage**: Watch CPU and memory usage

## Integration with Main Indexer

The proof-parser service runs alongside the main indexer service. It:
- Reads from the same database
- Writes to the same tables
- Can run independently
- Does not interfere with main indexer processing

This separation allows:
- Dedicated resources for proof parsing
- Independent scaling
- Better error isolation
- Flexible deployment strategies

