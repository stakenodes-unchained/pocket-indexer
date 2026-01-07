# Block Results Workers Health API Documentation

This document describes the health monitoring endpoints for block results workers, accessible through the main API server.

## Base URL

All endpoints are accessible via the main API server:
- Production: `http://localhost:3006`
- Development: `http://localhost:3006`

## Overview

Block results workers process block_results data from the Tendermint RPC endpoint asynchronously. This includes:
- Transaction events from `txs_results`
- Block-level events from `finalize_block_events` (BeginBlock/EndBlock events)
- Processing maintains a 4-5 block lag behind current chain height for stability

## Endpoints

### 1. Get Block Results Workers Health

Returns the health status of all block results workers for all configured RPC endpoints.

**Endpoint:** `GET /api/v1/health/block-results-workers`

**Query Parameters:** None

**Response:**

```json
{
  "data": {
    "workers": [
      {
        "rpc_name": "pokt-mainnet",
        "status": "running",
        "queue_size": 150,
        "delayed_items": 5,
        "processing_items": 8,
        "processed_count": 125000,
        "failed_count": 12,
        "success_rate": 99.99,
        "avg_processing_time_ms": 245.5,
        "current_block_height": 590300,
        "last_processed_block_height": 590295,
        "max_processed_height": 590295,
        "current_chain_height": 590300,
        "processing_lag": 5,
        "processing_gaps": [
          { "height": 589500 },
          { "height": 589501 }
        ],
        "coverage_percentage": 99.8,
        "worker_count": 2,
        "last_update": 1704067200000,
        "individual_workers": [
          {
            "worker_index": 0,
            "worker_id": "pokt-mainnet-block-results-0",
            "status": "running",
            "processed_count": 62500,
            "failed_count": 6,
            "success_rate": 99.99,
            "avg_processing_time_ms": 240.2,
            "current_block_height": 590298,
            "last_processed_block_height": 590293,
            "last_update": 1704067200000
          },
          {
            "worker_index": 1,
            "worker_id": "pokt-mainnet-block-results-1",
            "status": "running",
            "processed_count": 62500,
            "failed_count": 6,
            "success_rate": 99.99,
            "avg_processing_time_ms": 250.8,
            "current_block_height": 590297,
            "last_processed_block_height": 590292,
            "last_update": 1704067200000
          }
        ]
      }
    ],
    "summary": {
      "total_rpc_endpoints": 1,
      "active_rpc_endpoints": 1,
      "total_individual_workers": 2,
      "active_individual_workers": 2,
      "total_queue_size": 150,
      "total_delayed_items": 5,
      "total_processing_items": 8,
      "max_processed_height": 590295,
      "max_processing_lag": 5,
      "total_processed_count": 125000,
      "total_failed_count": 12
    }
  }
}
```

**Response Fields:**

#### Worker Object Fields

- `rpc_name` (string): RPC endpoint name / chain identifier
- `status` (string): Worker status - "running", "stopped", "stale", or "error"
- `queue_size` (number): Number of blocks waiting in the main queue
- `delayed_items` (number): Number of blocks in the delayed retry queue
- `processing_items` (number): Number of blocks currently being processed
- `processed_count` (number): Total number of successfully processed blocks (cumulative)
- `failed_count` (number): Total number of failed blocks (cumulative)
- `success_rate` (number|null): Success rate percentage (processed / (processed + failed)) or null if no attempts
- `avg_processing_time_ms` (number|null): Average processing time per block in milliseconds or null if no blocks processed
- `current_block_height` (number|null): Current block height being processed (from worker stats) or null
- `last_processed_block_height` (number|null): Last successfully processed block height (from worker stats) or null
- `max_processed_height` (number|null): Maximum processed height from database (most reliable source) or null if none
- `current_chain_height` (number|null): Current chain height from RPC or null if unavailable
- `processing_lag` (number|null): Number of blocks behind current chain height (current_chain_height - max_processed_height) or null if data unavailable
- `processing_gaps` (array): Array of unprocessed block heights (sample of first 10 gaps from recent blocks)
  - Each gap object contains: `height` (number)
- `coverage_percentage` (number|null): Percentage of blocks processed in the last 1000 blocks or null if insufficient data
- `worker_count` (number): Number of worker threads for this RPC endpoint
- `last_update` (number|null): Timestamp of last stats update from workers (milliseconds since epoch) or null
- `individual_workers` (array): Array of individual worker thread statistics
  - `worker_index` (number): Worker index (0-based)
  - `worker_id` (string): Unique worker identifier
  - `status` (string): Worker status
  - `processed_count` (number): Blocks processed by this worker
  - `failed_count` (number): Blocks failed by this worker
  - `success_rate` (number|null): Worker success rate
  - `avg_processing_time_ms` (number|null): Average processing time for this worker
  - `current_block_height` (number|null): Current block being processed
  - `last_processed_block_height` (number|null): Last processed block
  - `last_update` (number|null): Last update timestamp

#### Summary Object Fields

- `total_rpc_endpoints` (number): Total number of RPC endpoints configured
- `active_rpc_endpoints` (number): Number of RPC endpoints with running workers
- `total_individual_workers` (number): Total number of worker threads across all endpoints
- `active_individual_workers` (number): Number of active worker threads
- `total_queue_size` (number): Sum of queue sizes across all endpoints
- `total_delayed_items` (number): Sum of delayed items across all endpoints
- `total_processing_items` (number): Sum of processing items across all endpoints
- `max_processed_height` (number|null): Maximum processed height across all endpoints
- `max_processing_lag` (number|null): Maximum processing lag across all endpoints
- `total_processed_count` (number): Sum of processed counts across all endpoints
- `total_failed_count` (number): Sum of failed counts across all endpoints

**Example Request:**

```bash
curl http://localhost:3006/api/v1/health/block-results-workers
```

**Example Response:**

See response structure above.

---

### 2. Get Block Results Workers History

Returns historical health metrics for block results workers.

**Endpoint:** `GET /api/v1/health/block-results-workers/history`

**Query Parameters:**

- `from` (string, optional): Start timestamp (ISO 8601 or Unix timestamp). Default: 1 hour ago
- `to` (string, optional): End timestamp (ISO 8601 or Unix timestamp). Default: now
- `limit` (number, optional): Maximum number of records to return. Default: 200
- `rpc_name` (string, optional): Filter by specific RPC endpoint name

**Response:**

```json
{
  "data": {
    "records": [
      {
        "ts": "2025-01-01T12:00:00.000Z",
        "rpc_name": "pokt-mainnet",
        "queue_size": 150,
        "delayed_items": 5,
        "processing_items": 8,
        "processed_count": 125000,
        "failed_count": 12,
        "success_rate": 99.99,
        "avg_processing_time_ms": 245.5,
        "worker_status": "running",
        "current_block_height": 590300,
        "last_processed_block_height": 590295
      }
    ],
    "count": 1
  }
}
```

**Response Fields:**

- `records` (array): Array of historical health records
  - `ts` (string): Timestamp of the record
  - `rpc_name` (string): RPC endpoint name
  - `queue_size` (number): Queue size at this time
  - `delayed_items` (number): Delayed items count
  - `processing_items` (number): Processing items count
  - `processed_count` (number): Cumulative processed count
  - `failed_count` (number): Cumulative failed count
  - `success_rate` (number|null): Success rate percentage
  - `avg_processing_time_ms` (number|null): Average processing time
  - `worker_status` (string): Worker status
  - `current_block_height` (number|null): Current block height
  - `last_processed_block_height` (number|null): Last processed block height
- `count` (number): Total number of records returned

**Example Request:**

```bash
# Get history for last 24 hours
curl "http://localhost:3006/api/v1/health/block-results-workers/history?from=2025-01-01T00:00:00Z&to=2025-01-02T00:00:00Z&limit=100"

# Get history for specific RPC endpoint
curl "http://localhost:3006/api/v1/health/block-results-workers/history?rpc_name=pokt-mainnet&limit=50"
```

**Example Response:**

See response structure above.

---

## Response Field Reference

### Status Values

- `running`: Workers are active and processing blocks
- `stopped`: Workers are not running
- `stale`: Workers appear to be running but haven't sent updates in the last 2 minutes
- `error`: An error occurred while fetching stats

### Processing Lag

The `processing_lag` field indicates how many blocks behind the current chain height the processing is. This is calculated as:
```
processing_lag = current_chain_height - max_processed_height
```

A lag of 4-5 blocks is normal and expected (configured via `BLOCK_RESULTS_LAG_BLOCKS`). A larger lag may indicate:
- Workers are falling behind
- Queue is backing up
- Network or RPC issues

### Coverage Percentage

The `coverage_percentage` field shows what percentage of blocks in the last 1000 blocks have been processed. A value of:
- `100%`: All blocks processed (ideal)
- `95-99%`: Most blocks processed (acceptable, may have some gaps)
- `<95%`: Significant gaps in processing (investigation needed)

### Processing Gaps

The `processing_gaps` array shows a sample of unprocessed block heights. This helps identify:
- Missing blocks that need to be reprocessed
- Patterns in gaps (e.g., all gaps in a specific range)
- Whether gaps are recent or historical

Only the first 10 gaps are shown to keep the response size manageable. Use the restart script to reprocess missing blocks if needed.

### Success Rate

The success rate is calculated as:
```
success_rate = (processed_count / (processed_count + failed_count)) * 100
```

A success rate of:
- `>99%`: Excellent
- `95-99%`: Good
- `<95%`: May indicate issues with RPC endpoints or data quality

---

## Error Responses

### 500 Internal Server Error

```json
{
  "error": "Error message describing what went wrong"
}
```

Common causes:
- Database connection issues
- Redis connection issues
- Invalid query parameters

---

## Usage Examples

### Monitor Block Results Processing

```bash
# Get current status
curl http://localhost:3006/api/v1/health/block-results-workers | jq '.data.summary'

# Check processing lag
curl http://localhost:3006/api/v1/health/block-results-workers | jq '.data.workers[0].processing_lag'

# Check for gaps
curl http://localhost:3006/api/v1/health/block-results-workers | jq '.data.workers[0].processing_gaps'

# Monitor coverage
curl http://localhost:3006/api/v1/health/block-results-workers | jq '.data.workers[0].coverage_percentage'
```

### Historical Analysis

```bash
# Get processing trends over time
curl "http://localhost:3006/api/v1/health/block-results-workers/history?from=2025-01-01T00:00:00Z&to=2025-01-02T00:00:00Z" | jq '.data.records[] | {ts, queue_size, processing_lag}'

# Check for specific RPC endpoint
curl "http://localhost:3006/api/v1/health/block-results-workers/history?rpc_name=pokt-mainnet&limit=100" | jq '.data.records'
```

---

## Notes

- Block results workers maintain a 4-5 block lag behind current chain height for stability
- Processing is asynchronous and non-blocking
- Large block_results responses (>5MB) are logged with warnings
- Gaps in processing can be filled using the restart script: `restart_block_results.js`
- The `max_processed_height` field from the database is the most reliable source of truth for processed blocks
- Worker stats are updated every 30 seconds (configurable via `BLOCK_RESULTS_STATS_INTERVAL_MS`)

