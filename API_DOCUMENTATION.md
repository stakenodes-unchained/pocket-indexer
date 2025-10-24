# Pocket Network Indexer API Documentation

## Overview

The Pocket Network Indexer provides RESTful APIs for monitoring blockchain data processing, worker health, and synchronization status. The system now operates with separate processes for historical synchronization and real-time monitoring.

## Base URL

```
http://localhost:3007
```

## Authentication

Currently, no authentication is required for these endpoints.

## Endpoints

### 1. Worker Health Status

**Endpoint:** `GET /api/v1/health/workers`

**Description:** Provides comprehensive health information about all workers, including separate tracking for historical sync and monitoring processes.

**Response:**
```json
{
  "data": {
    "heartbeats": {
      "historical": [
        {
          "worker_id": "pocket-mainnet-historical",
          "last_seen": "2024-01-15T10:30:00Z",
          "meta": {
            "threadId": "pocket-mainnet-historical",
            "type": "historical",
            "currentHeight": 1500000,
            "targetHeight": 1500100,
            "progress": 95,
            "status": "filling_gaps"
          }
        }
      ],
      "monitor": [
        {
          "worker_id": "pocket-mainnet-monitor",
          "last_seen": "2024-01-15T10:30:00Z",
          "meta": {
            "threadId": "pocket-mainnet-monitor",
            "type": "monitor",
            "lastProcessedHeight": 1500105,
            "status": "active",
            "latestHeight": 1500105
          }
        }
      ],
      "all": [...]
    },
    "workers": [
      {
        "name": "pocket-mainnet-historical",
        "type": "historical",
        "threadId": 12345,
        "isRunning": true
      },
      {
        "name": "pocket-mainnet-monitor",
        "type": "monitor",
        "threadId": 12346,
        "isRunning": true
      }
    ],
    "process": {
      "pid": 1234,
      "uptime_s": 3600,
      "memory": {
        "rss": 100000000,
        "heapTotal": 50000000,
        "heapUsed": 30000000,
        "external": 10000000
      },
      "cpu_usage": {
        "user": 1000000,
        "system": 500000
      },
      "node": "v18.17.0",
      "argv": [...],
      "env": {
        "WORKER_CONCURRENCY": "2",
        "HISTORICAL_BATCH_SIZE": "50"
      }
    },
    "redis": {
      "memory": "...",
      "stats": "...",
      "keyspace": "..."
    },
    "chains": [
      {
        "chain": "pocket-mainnet",
        "historical_checkpoint": 1500000,
        "monitoring_height": 1500100,
        "latest_height": 1500105,
        "monitor_lag": 5,
        "historical_backlog": 100,
        "total_backlog": 105,
        "status": {
          "monitoring": "active",
          "historical": "catching_up",
          "overall": "lagging"
        }
      }
    ]
  }
}
```

**Status Fields:**
- `monitoring`: `"active"` | `"inactive"`
- `historical`: `"synced"` | `"catching_up"`
- `overall`: `"synced"` | `"lagging"` | `"critical"`

### 2. RPC Health Status

**Endpoint:** `GET /api/v1/health/rpc`

**Description:** Provides RPC endpoint health and chain synchronization status.

**Response:**
```json
{
  "data": {
    "status": "ok",
    "workers": [...],
    "chains": [
      {
        "chain": "pocket-mainnet",
        "historical_checkpoint": 1500000,
        "monitoring_height": 1500100,
        "latest_height": 1500105,
        "monitor_lag": 5,
        "historical_backlog": 100,
        "total_backlog": 105
      }
    ]
  }
}
```

### 3. Gap Analysis

**Endpoint:** `GET /api/v1/health/gaps`

**Description:** Analyzes and reports missing blocks (gaps) in the blockchain data for each chain.

**Response:**
```json
{
  "data": {
    "gap_analysis": [
      {
        "chain": "pocket-mainnet",
        "historical_checkpoint": 1500000,
        "monitoring_height": 1500100,
        "latest_height": 1500105,
        "gap_count": 3,
        "gaps": [1500005, 1500010, 1500015],
        "historical_backlog": 100,
        "monitor_lag": 5,
        "total_backlog": 105,
        "status": {
          "has_gaps": true,
          "critical": false
        }
      }
    ]
  }
}
```

**Gap Analysis Fields:**
- `gap_count`: Number of missing blocks
- `gaps`: Array of missing block heights (first 10 shown)
- `has_gaps`: Boolean indicating if gaps exist
- `critical`: Boolean indicating if gap situation is critical (>100 gaps or >1000 total backlog)

## Worker Types

### Historical Workers
- **Purpose**: Fill gaps between historical checkpoint and monitoring height
- **Process Type**: `historical`
- **Worker ID Pattern**: `{chain}-historical`
- **Status Values**:
  - `filling_gaps`: Actively filling sequential gaps
  - `filling_remaining_gaps`: Filling scattered missing blocks
  - `continuous_gap_filling`: Continuously monitoring and filling gaps
  - `monitoring_for_gaps`: Monitoring for new gaps to appear
  - `synced`: No gaps to fill

### Monitor Workers
- **Purpose**: Process new blocks as they arrive on the network
- **Process Type**: `monitor`
- **Worker ID Pattern**: `{chain}-monitor`
- **Status Values**:
  - `active`: Actively monitoring for new blocks
  - `inactive`: Not processing new blocks

## Lag Metrics Explained

### Monitor Lag
- **Definition**: Difference between latest network height and monitoring height
- **Formula**: `latest_height - monitoring_height`
- **Meaning**: How far behind the monitoring process is from the actual network

### Historical Backlog
- **Definition**: Gap between monitoring height and historical checkpoint
- **Formula**: `monitoring_height - historical_checkpoint`
- **Meaning**: How many blocks the historical sync needs to catch up to monitoring

### Total Backlog
- **Definition**: Complete gap from network to historical sync
- **Formula**: `latest_height - historical_checkpoint`
- **Meaning**: Total blocks that need to be processed to be fully synced

## Error Responses

All endpoints return errors in the following format:

```json
{
  "error": "Error message describing what went wrong"
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `500`: Internal server error
- `503`: Service unavailable (database connection issues)

## Monitoring Best Practices

### 1. Health Monitoring
- Check `/api/v1/health/workers` every 30 seconds
- Monitor `overall` status for each chain
- Alert when status becomes `critical`

### 2. Gap Monitoring
- Use `/api/v1/health/gaps` to identify missing blocks
- Monitor `gap_count` and `critical` status
- Historical workers should reduce `gap_count` over time

### 3. Performance Monitoring
- Track `monitor_lag` to ensure real-time processing
- Monitor `historical_backlog` to track gap-filling progress
- Use `total_backlog` for overall sync health

### 4. Worker Health
- Ensure both `historical` and `monitor` workers are `isRunning: true`
- Check heartbeat timestamps for worker activity
- Monitor worker restart frequency

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INDEXER_PORT` | `3007` | Port for the indexer server |
| `WORKER_CONCURRENCY` | `2` | Number of workers per chain |
| `HISTORICAL_BATCH_SIZE` | `50` | Batch size for historical processing |
| `MONITOR_INTERVAL_MS` | `10000` | Monitoring interval in milliseconds |
| `GAP_CHECK_INTERVAL_MS` | `30000` | Gap checking interval in continuous mode |

### Worker Configuration

Each chain runs two separate worker processes:
1. **Historical Worker**: Fills gaps in blockchain data
   - **Sequential Gap Filling**: Fills gaps in order from historical checkpoint
   - **Remaining Gap Filling**: Fills scattered missing blocks
   - **Continuous Gap Monitoring**: After catching up, continuously monitors for new gaps
2. **Monitor Worker**: Processes new blocks in real-time

## Troubleshooting

### High Monitor Lag
- Check RPC endpoint connectivity
- Verify monitor worker is running
- Check for network issues

### High Historical Backlog
- Historical worker may be processing large gaps
- Check historical worker heartbeat and status
- Monitor gap count reduction over time

### Critical Gaps
- Large number of missing blocks detected
- Check for database issues
- Verify historical worker is actively filling gaps
- Consider manual intervention for large gaps

### Worker Not Running
- Check worker logs for errors
- Verify database connectivity
- Check Redis connection
- Restart workers if necessary

## Example Usage

### Check Overall Health
```bash
curl http://localhost:3007/api/v1/health/workers
```

### Monitor Specific Chain Gaps
```bash
curl http://localhost:3007/api/v1/health/gaps | jq '.data.gap_analysis[] | select(.chain=="pocket-mainnet")'
```

### Check Worker Status
```bash
curl http://localhost:3007/api/v1/health/workers | jq '.data.workers[] | select(.type=="historical")'
```

## Changelog

### Version 2.0.0
- Separated historical sync and monitoring into distinct processes
- Added comprehensive gap analysis and filling
- Enhanced health monitoring with detailed lag metrics
- Added new `/api/v1/health/gaps` endpoint
- Improved worker status tracking with process types
- Added gap detection and automatic filling logic
