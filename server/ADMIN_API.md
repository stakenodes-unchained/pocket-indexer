# Admin API Documentation

This document provides comprehensive documentation for all admin endpoints in the Pocket Network Indexer API. These endpoints are designed for administrative operations, monitoring, and system management.

## Table of Contents

1. [Jobs Management](#jobs-management)
2. [Reward Analytics Refresh](#reward-analytics-refresh)
3. [Health Monitoring](#health-monitoring)
4. [Metrics & Monitoring](#metrics--monitoring)

---

## Jobs Management

The jobs system allows administrators to create, monitor, and manage background tasks for system operations.

### POST `/api/v1/jobs`

Create a new background job.

**Business Logic:**
- Creates a job record in the database with status `queued`
- Jobs are processed asynchronously by a job runner service
- Job types can include: `sync_start`, `sync_stop`, `reprocess_range`, `rebuild_entities`, `backfill_delegations`, `reindex`, etc.
- The job runner service (separate from API server) picks up queued jobs and executes them

**Request Body:**
```json
{
  "type": "string (required)",
  "params": "object (optional)",
  "created_by": "string (optional)"
}
```

**Parameters:**
- `type` (required): Job type identifier (e.g., `"reindex"`, `"sync_start"`, `"reprocess_range"`)
- `params` (optional): Job-specific parameters as JSON object
  - Example for `reprocess_range`: `{ "chain": "mainnet", "start_height": 1000, "end_height": 2000 }`
  - Example for `sync_start`: `{ "chain": "mainnet" }`
- `created_by` (optional): Identifier of the user/system creating the job (for audit trail)

**Response:**
```json
{
  "data": {
    "id": 1,
    "type": "reindex",
    "params": { "chain": "mainnet" },
    "status": "queued",
    "created_by": "admin@example.com",
    "created_at": "2024-01-15T10:30:00Z",
    "started_at": null,
    "finished_at": null,
    "error": null
  }
}
```

**Status Codes:**
- `200`: Job created successfully
- `400`: Missing required `type` parameter
- `500`: Server error

**Frontend Integration:**
```javascript
// Create a reindex job
const createJob = async (type, params, createdBy) => {
  const response = await fetch('/api/v1/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, params, created_by: createdBy })
  });
  return response.json();
};

// Usage
await createJob('reindex', { chain: 'mainnet', start_height: 1000, end_height: 2000 }, 'admin@example.com');
```

**UI Considerations:**
- Show a loading state while creating the job
- Display success message with job ID
- Redirect to job detail page or show job in job list
- Handle validation errors (missing type)

---

### GET `/api/v1/jobs`

List recent jobs with pagination.

**Business Logic:**
- Returns the 200 most recent jobs ordered by creation date (newest first)
- Jobs are stored in the `jobs` table with status tracking
- Status values: `queued`, `running`, `completed`, `failed`, `cancelled`
- Useful for monitoring job queue and audit trail

**Query Parameters:**
- None (returns fixed limit of 200 most recent jobs)

**Response:**
```json
{
  "data": [
    {
      "id": 1,
      "type": "reindex",
      "params": { "chain": "mainnet" },
      "status": "completed",
      "created_by": "admin@example.com",
      "created_at": "2024-01-15T10:30:00Z",
      "started_at": "2024-01-15T10:30:05Z",
      "finished_at": "2024-01-15T10:35:00Z",
      "error": null
    },
    {
      "id": 2,
      "type": "sync_start",
      "params": { "chain": "testnet" },
      "status": "running",
      "created_by": "admin@example.com",
      "created_at": "2024-01-15T11:00:00Z",
      "started_at": "2024-01-15T11:00:02Z",
      "finished_at": null,
      "error": null
    }
  ]
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch jobs list
const fetchJobs = async () => {
  const response = await fetch('/api/v1/jobs');
  const result = await response.json();
  return result.data;
};

// Display jobs in a table
const jobs = await fetchJobs();
jobs.forEach(job => {
  console.log(`Job ${job.id}: ${job.type} - ${job.status}`);
});
```

**UI Considerations:**
- Display jobs in a table with columns: ID, Type, Status, Created At, Created By, Duration
- Color-code status badges (queued: yellow, running: blue, completed: green, failed: red, cancelled: gray)
- Show relative time (e.g., "2 minutes ago")
- Add filters for status and type
- Add search functionality
- Show job duration (finished_at - started_at) for completed jobs
- Display error message if status is "failed"

---

### GET `/api/v1/jobs/:id`

Get detailed information about a specific job including its execution runs.

**Business Logic:**
- Retrieves job details from the `jobs` table
- Fetches associated job runs from the `job_runs` table
- Job runs contain execution details, metrics, logs, and outcomes
- Useful for debugging failed jobs and monitoring job progress

**Path Parameters:**
- `id` (required): Job ID (integer)

**Response:**
```json
{
  "data": {
    "job": {
      "id": 1,
      "type": "reindex",
      "params": { "chain": "mainnet", "start_height": 1000, "end_height": 2000 },
      "status": "completed",
      "created_by": "admin@example.com",
      "created_at": "2024-01-15T10:30:00Z",
      "started_at": "2024-01-15T10:30:05Z",
      "finished_at": "2024-01-15T10:35:00Z",
      "error": null
    },
    "runs": [
      {
        "id": 1,
        "job_id": 1,
        "status": "completed",
        "metrics": {
          "blocks_processed": 1000,
          "transactions_processed": 5000,
          "duration_ms": 295000
        },
        "logs_url": "https://logs.example.com/job/1/run/1",
        "started_at": "2024-01-15T10:30:05Z",
        "finished_at": "2024-01-15T10:35:00Z",
        "error": null
      }
    ]
  }
}
```

**Status Codes:**
- `200`: Success
- `404`: Job not found
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch job details
const fetchJobDetails = async (jobId) => {
  const response = await fetch(`/api/v1/jobs/${jobId}`);
  return response.json();
};

// Display job details
const jobDetails = await fetchJobDetails(1);
console.log('Job:', jobDetails.data.job);
console.log('Runs:', jobDetails.data.runs);
```

**UI Considerations:**
- Show job information in a card or detail view
- Display job parameters in a formatted JSON viewer
- Show job runs in a timeline or list
- Display metrics in a metrics panel (if available)
- Show logs link/button if `logs_url` is present
- Display error message prominently if job failed
- Show progress indicator if job is running
- Add refresh button to poll for updates on running jobs

---

### POST `/api/v1/jobs/:id/cancel`

Cancel a queued or running job.

**Business Logic:**
- Only cancels jobs with status `queued` or `running`
- Sets job status to `cancelled` and records `finished_at` timestamp
- Does not cancel already completed or failed jobs
- The job runner should check for cancellation status and stop execution gracefully

**Path Parameters:**
- `id` (required): Job ID (integer)

**Request Body:**
- None

**Response:**
```json
{
  "data": {
    "id": 2,
    "type": "sync_start",
    "params": { "chain": "testnet" },
    "status": "cancelled",
    "created_by": "admin@example.com",
    "created_at": "2024-01-15T11:00:00Z",
    "started_at": "2024-01-15T11:00:02Z",
    "finished_at": "2024-01-15T11:05:00Z",
    "error": null
  }
}
```

**Status Codes:**
- `200`: Job cancelled successfully
- `400`: Job not found or not cancellable (already completed/failed/cancelled)
- `500`: Server error

**Frontend Integration:**
```javascript
// Cancel a job
const cancelJob = async (jobId) => {
  const response = await fetch(`/api/v1/jobs/${jobId}/cancel`, {
    method: 'POST'
  });
  return response.json();
};

// Usage with confirmation
const handleCancelJob = async (jobId) => {
  if (confirm('Are you sure you want to cancel this job?')) {
    const result = await cancelJob(jobId);
    if (result.data) {
      alert('Job cancelled successfully');
    } else {
      alert('Failed to cancel job: ' + result.error);
    }
  }
};
```

**UI Considerations:**
- Show cancel button only for `queued` or `running` jobs
- Display confirmation dialog before cancelling
- Show loading state during cancellation
- Update job status in UI after successful cancellation
- Handle error cases (job already completed, not found, etc.)
- Refresh job list/detail view after cancellation

---

## Reward Analytics Refresh

These endpoints manage the automatic refresh of the `proof_submission_rewards_mv` materialized view, which powers the reward analytics endpoints.

### GET `/api/v1/proof-submissions/rewards/refresh/status`

Get the current status of the reward analytics refresh service.

**Business Logic:**
- The refresh service runs on worker 1 only (in cluster mode) to avoid duplicate refreshes
- Refreshes the materialized view every 15 minutes (configurable via `REWARD_ANALYTICS_REFRESH_INTERVAL_MS`)
- Uses `REFRESH MATERIALIZED VIEW CONCURRENTLY` to avoid blocking reads
- Falls back to regular refresh if concurrent refresh fails (e.g., missing unique index)
- Tracks refresh count, error count, and timing information

**Response:**
```json
{
  "isRunning": true,
  "isRefreshing": false,
  "lastRefreshTime": "2024-01-15T10:30:00Z",
  "lastRefreshDuration": 45000,
  "refreshCount": 96,
  "errorCount": 0,
  "refreshIntervalMs": 900000,
  "nextRefreshTime": "2024-01-15T10:45:00Z"
}
```

**Response Fields:**
- `isRunning`: Whether the refresh service is active
- `isRefreshing`: Whether a refresh is currently in progress
- `lastRefreshTime`: Timestamp of the last successful refresh
- `lastRefreshDuration`: Duration of last refresh in milliseconds
- `refreshCount`: Total number of successful refreshes
- `errorCount`: Total number of failed refreshes
- `refreshIntervalMs`: Refresh interval in milliseconds (default: 900000 = 15 minutes)
- `nextRefreshTime`: Estimated time of next refresh

**Status Codes:**
- `200`: Success
- `503`: Refresh service not initialized (not running on this worker)
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch refresh status
const fetchRefreshStatus = async () => {
  const response = await fetch('/api/v1/proof-submissions/rewards/refresh/status');
  return response.json();
};

// Display status in UI
const status = await fetchRefreshStatus();
console.log(`Refresh service: ${status.isRunning ? 'Running' : 'Stopped'}`);
console.log(`Last refresh: ${status.lastRefreshTime}`);
console.log(`Next refresh: ${status.nextRefreshTime}`);
```

**UI Considerations:**
- Display refresh status in a status card
- Show last refresh time with relative time (e.g., "2 minutes ago")
- Display next refresh time countdown
- Show refresh duration in human-readable format (e.g., "45 seconds")
- Display refresh count and error count
- Show warning if `errorCount` is high
- Show indicator if refresh is currently in progress
- Add auto-refresh to poll status every 30 seconds

---

### POST `/api/v1/proof-submissions/rewards/refresh`

Manually trigger a refresh of the reward analytics materialized view.

**Business Logic:**
- Triggers an immediate refresh of `proof_submission_rewards_mv`
- Uses concurrent refresh if possible (requires unique index)
- Falls back to regular refresh if concurrent refresh fails
- Prevents concurrent refresh attempts (if already refreshing, returns immediately)
- Useful for forcing data refresh after bulk operations or data corrections

**Request Body:**
- None

**Response (Success):**
```json
{
  "success": true,
  "message": "Materialized view refreshed successfully",
  "duration": 45000,
  "timestamp": "2024-01-15T10:30:00Z",
  "fallback": false
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Error message here",
  "message": "Refresh failed",
  "duration": 5000
}
```

**Response Fields:**
- `success`: Whether refresh was successful
- `message`: Human-readable message
- `duration`: Refresh duration in milliseconds
- `timestamp`: Timestamp when refresh completed
- `fallback`: Whether fallback (non-concurrent) refresh was used
- `error`: Error message (only present if success is false)

**Status Codes:**
- `200`: Refresh completed (check `success` field for actual result)
- `503`: Refresh service not initialized (not running on this worker)
- `500`: Server error

**Frontend Integration:**
```javascript
// Trigger manual refresh
const triggerRefresh = async () => {
  const response = await fetch('/api/v1/proof-submissions/rewards/refresh', {
    method: 'POST'
  });
  return response.json();
};

// Usage with loading state
const handleRefresh = async () => {
  setLoading(true);
  try {
    const result = await triggerRefresh();
    if (result.success) {
      alert(`Refresh completed in ${result.duration}ms`);
    } else {
      alert(`Refresh failed: ${result.error}`);
    }
  } finally {
    setLoading(false);
  }
};
```

**UI Considerations:**
- Show "Refresh Now" button in admin panel
- Display loading state during refresh
- Show success message with duration
- Show error message if refresh fails
- Disable button if refresh is already in progress
- Update refresh status after manual refresh
- Show confirmation dialog before triggering (optional, as refresh is non-destructive)

---

## Health Monitoring

Health endpoints provide real-time and historical monitoring of system components.

### GET `/api/v1/health/workers`

Get current health status of indexer workers.

**Business Logic:**
- Proxies request to indexer service on port 3007
- Returns worker health information including heartbeats, lag, and worker counts
- Used to monitor indexer service health and worker activity

**Response:**
```json
{
  "data": {
    "workers": 4,
    "heartbeats": 4,
    "avg_lag": 150,
    "p95_lag": 300,
    "chains": {
      "mainnet": {
        "workers": 2,
        "heartbeats": 2,
        "avg_lag": 100,
        "p95_lag": 200
      },
      "testnet": {
        "workers": 2,
        "heartbeats": 2,
        "avg_lag": 200,
        "p95_lag": 400
      }
    }
  }
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error or indexer service unavailable

**Frontend Integration:**
```javascript
// Fetch workers health
const fetchWorkersHealth = async () => {
  const response = await fetch('/api/v1/health/workers');
  return response.json();
};
```

**UI Considerations:**
- Display worker count and heartbeat status
- Show lag metrics (average and P95)
- Display per-chain breakdown if available
- Color-code based on health (green: healthy, yellow: warning, red: critical)
- Add auto-refresh every 10-30 seconds

---

### GET `/api/v1/health/rpc`

Get current RPC endpoint health status.

**Business Logic:**
- Proxies request to indexer service on port 3007
- Returns RPC endpoint status and active worker count
- Used to monitor RPC connectivity and availability

**Response:**
```json
{
  "data": {
    "status": "healthy",
    "active_workers": 4,
    "last_check": "2024-01-15T10:30:00Z"
  }
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error or indexer service unavailable

**Frontend Integration:**
```javascript
// Fetch RPC health
const fetchRpcHealth = async () => {
  const response = await fetch('/api/v1/health/rpc');
  return response.json();
};
```

**UI Considerations:**
- Display RPC status badge
- Show active worker count
- Display last check time
- Color-code status (healthy: green, degraded: yellow, down: red)

---

### GET `/api/v1/health/rpc/history`

Get historical RPC health data.

**Business Logic:**
- Returns time-series data of RPC health from the `health_rpc` table
- Data points include timestamp, status, and active worker count
- Useful for trend analysis and identifying issues over time

**Query Parameters:**
- `from` (optional): Start timestamp (ISO 8601). Default: 1 hour ago
- `to` (optional): End timestamp (ISO 8601). Default: now
- `limit` (optional): Maximum number of records. Default: 200
- `interval` (optional): Bucketing interval (future feature)

**Response:**
```json
{
  "data": [
    {
      "ts": "2024-01-15T10:00:00Z",
      "status": "healthy",
      "active_workers": 4
    },
    {
      "ts": "2024-01-15T10:05:00Z",
      "status": "healthy",
      "active_workers": 4
    }
  ]
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch RPC health history
const fetchRpcHistory = async (from, to, limit = 200) => {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit
  });
  const response = await fetch(`/api/v1/health/rpc/history?${params}`);
  return response.json();
};
```

**UI Considerations:**
- Display data in a time-series chart (line chart)
- Show status changes over time
- Display active worker count trend
- Add time range selector (last hour, 6 hours, 24 hours, custom)
- Add zoom/pan functionality for detailed view

---

### GET `/api/v1/health/workers/history`

Get historical worker health data.

**Business Logic:**
- Returns time-series data of worker health from the `health_workers` table
- Data points include timestamp, chain, worker count, heartbeats, and lag metrics
- Useful for monitoring worker performance and identifying bottlenecks

**Query Parameters:**
- `from` (optional): Start timestamp (ISO 8601). Default: 1 hour ago
- `to` (optional): End timestamp (ISO 8601). Default: now
- `limit` (optional): Maximum number of records. Default: 200
- `chain` (optional): Filter by chain identifier
- `interval` (optional): Bucketing interval (future feature)

**Response:**
```json
{
  "data": [
    {
      "ts": "2024-01-15T10:00:00Z",
      "chain": "mainnet",
      "workers": 2,
      "heartbeats": 2,
      "avg_lag": 100,
      "p95_lag": 200
    },
    {
      "ts": "2024-01-15T10:05:00Z",
      "chain": "mainnet",
      "workers": 2,
      "heartbeats": 2,
      "avg_lag": 120,
      "p95_lag": 250
    }
  ]
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch workers health history
const fetchWorkersHistory = async (from, to, chain, limit = 200) => {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit
  });
  if (chain) params.append('chain', chain);
  const response = await fetch(`/api/v1/health/workers/history?${params}`);
  return response.json();
};
```

**UI Considerations:**
- Display multiple metrics in a multi-line chart
- Show worker count, heartbeats, avg_lag, p95_lag
- Add chain filter dropdown
- Group by chain if multiple chains
- Add time range selector
- Show alerts for high lag values

---

### GET `/api/v1/health/process/history`

Get historical process health data (memory, CPU usage).

**Business Logic:**
- Returns time-series data of process health from the `health_process` table
- Tracks memory usage (RSS, heap), CPU usage, and other process metrics
- Useful for monitoring resource consumption and identifying memory leaks

**Query Parameters:**
- `from` (optional): Start timestamp (ISO 8601). Default: 1 hour ago
- `to` (optional): End timestamp (ISO 8601). Default: now
- `limit` (optional): Maximum number of records. Default: 200

**Response:**
```json
{
  "data": [
    {
      "ts": "2024-01-15T10:00:00Z",
      "rss": 524288000,
      "heap_used": 104857600,
      "heap_total": 209715200,
      "external": 10485760,
      "array_buffers": 5242880,
      "cpu_user_ms": 1000,
      "cpu_system_ms": 500
    }
  ]
}
```

**Response Fields:**
- `rss`: Resident Set Size (total memory used) in bytes
- `heap_used`: Heap memory used in bytes
- `heap_total`: Total heap memory allocated in bytes
- `external`: External memory in bytes
- `array_buffers`: Array buffer memory in bytes
- `cpu_user_ms`: CPU time spent in user mode (milliseconds)
- `cpu_system_ms`: CPU time spent in system mode (milliseconds)

**Status Codes:**
- `200`: Success
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch process health history
const fetchProcessHistory = async (from, to, limit = 200) => {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit
  });
  const response = await fetch(`/api/v1/health/process/history?${params}`);
  return response.json();
};
```

**UI Considerations:**
- Display memory metrics in a stacked area chart
- Show RSS, heap_used, heap_total, external, array_buffers
- Display CPU metrics in a separate line chart
- Convert bytes to human-readable format (MB, GB)
- Add time range selector
- Show memory usage percentage if max memory is known
- Add alerts for high memory usage

---

### GET `/api/v1/health/redis/history`

Get historical Redis health data.

**Business Logic:**
- Returns time-series data of Redis health from the `health_redis` table
- Tracks memory usage, operations per second, and fragmentation ratio
- Useful for monitoring Redis performance and capacity

**Query Parameters:**
- `from` (optional): Start timestamp (ISO 8601). Default: 1 hour ago
- `to` (optional): End timestamp (ISO 8601). Default: now
- `limit` (optional): Maximum number of records. Default: 200

**Response:**
```json
{
  "data": [
    {
      "ts": "2024-01-15T10:00:00Z",
      "used_memory": 104857600,
      "maxmemory": 1073741824,
      "instantaneous_ops_per_sec": 1000,
      "mem_fragmentation_ratio": 1.2
    }
  ]
}
```

**Response Fields:**
- `used_memory`: Memory used by Redis in bytes
- `maxmemory`: Maximum memory configured for Redis in bytes
- `instantaneous_ops_per_sec`: Operations per second at the time of measurement
- `mem_fragmentation_ratio`: Memory fragmentation ratio (higher = more fragmented)

**Status Codes:**
- `200`: Success
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch Redis health history
const fetchRedisHistory = async (from, to, limit = 200) => {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit
  });
  const response = await fetch(`/api/v1/health/redis/history?${params}`);
  return response.json();
};
```

**UI Considerations:**
- Display memory usage in a line chart with maxmemory threshold
- Show operations per second in a separate chart
- Display fragmentation ratio (alert if > 1.5)
- Convert bytes to human-readable format
- Show memory usage percentage (used_memory / maxmemory)
- Add time range selector
- Add alerts for high memory usage (> 80% of maxmemory)

---

### GET `/api/v1/health/redis/keyspace/history`

Get historical Redis keyspace data.

**Business Logic:**
- Returns time-series data of Redis keyspace from the `health_redis_keyspace` table
- Tracks keys, expires, and average TTL per database
- Useful for monitoring cache size and key expiration patterns

**Query Parameters:**
- `from` (optional): Start timestamp (ISO 8601). Default: 1 hour ago
- `to` (optional): End timestamp (ISO 8601). Default: now
- `limit` (optional): Maximum number of records. Default: 200
- `db` (optional): Database identifier. Default: `"db0"`

**Response:**
```json
{
  "data": [
    {
      "ts": "2024-01-15T10:00:00Z",
      "db": "db0",
      "keys": 10000,
      "expires": 5000,
      "avg_ttl": 3600000
    }
  ]
}
```

**Response Fields:**
- `keys`: Total number of keys in the database
- `expires`: Number of keys with expiration set
- `avg_ttl`: Average time-to-live in milliseconds

**Status Codes:**
- `200`: Success
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch Redis keyspace history
const fetchRedisKeyspaceHistory = async (from, to, db = 'db0', limit = 200) => {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
    limit,
    db
  });
  const response = await fetch(`/api/v1/health/redis/keyspace/history?${params}`);
  return response.json();
};
```

**UI Considerations:**
- Display keys count in a line chart
- Show expires count and percentage
- Display average TTL in human-readable format (hours, minutes)
- Add database selector dropdown
- Add time range selector
- Show key growth/decline trends

---

## Metrics & Monitoring

These endpoints provide aggregated metrics for system monitoring and dashboards.

### GET `/api/v1/metrics/chains`

Get latest metrics snapshot for all chains.

**Business Logic:**
- Returns the most recent metrics snapshot per chain from the `metrics_snapshots` table
- Each snapshot includes processed height, latest height, transaction rate, error rate, and entity counts
- Used for dashboard overview and quick health checks

**Response:**
```json
{
  "data": [
    {
      "chain": "mainnet",
      "ts": "2024-01-15T10:30:00Z",
      "processed_height": 1000000,
      "latest_height": 1000100,
      "tx_rate": 10.5,
      "error_rate": 0.01,
      "applications": 5000,
      "suppliers": 2000,
      "gateways": 100,
      "services": 50
    },
    {
      "chain": "testnet",
      "ts": "2024-01-15T10:30:00Z",
      "processed_height": 500000,
      "latest_height": 500050,
      "tx_rate": 5.2,
      "error_rate": 0.02,
      "applications": 2000,
      "suppliers": 800,
      "gateways": 50,
      "services": 25
    }
  ]
}
```

**Response Fields:**
- `chain`: Chain identifier
- `ts`: Timestamp of the snapshot
- `processed_height`: Latest block height processed by indexer
- `latest_height`: Latest block height on the chain
- `tx_rate`: Transactions per second
- `error_rate`: Error rate (0-1)
- `applications`: Number of applications
- `suppliers`: Number of suppliers
- `gateways`: Number of gateways
- `services`: Number of services

**Status Codes:**
- `200`: Success
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch chain metrics
const fetchChainMetrics = async () => {
  const response = await fetch('/api/v1/metrics/chains');
  return response.json();
};

// Display metrics in dashboard
const metrics = await fetchChainMetrics();
metrics.data.forEach(chain => {
  const lag = chain.latest_height - chain.processed_height;
  console.log(`${chain.chain}: ${lag} blocks behind`);
});
```

**UI Considerations:**
- Display metrics in cards or a table
- Calculate and display lag (latest_height - processed_height)
- Color-code lag (green: < 100, yellow: 100-1000, red: > 1000)
- Show transaction rate with trend indicator
- Display error rate as percentage with color coding
- Show entity counts
- Add auto-refresh every 30-60 seconds
- Add click-through to chain detail page

---

### GET `/api/v1/metrics/chains/:chain`

Get time-series metrics for a specific chain.

**Business Logic:**
- Returns historical metrics snapshots for a specific chain
- Ordered by timestamp (most recent first)
- Useful for trend analysis and identifying performance issues over time

**Path Parameters:**
- `chain` (required): Chain identifier (e.g., `"mainnet"`, `"testnet"`)

**Query Parameters:**
- `limit` (optional): Maximum number of records. Default: 200

**Response:**
```json
{
  "data": [
    {
      "chain": "mainnet",
      "ts": "2024-01-15T10:30:00Z",
      "processed_height": 1000100,
      "latest_height": 1000200,
      "tx_rate": 10.5,
      "error_rate": 0.01,
      "applications": 5000,
      "suppliers": 2000,
      "gateways": 100,
      "services": 50
    },
    {
      "chain": "mainnet",
      "ts": "2024-01-15T10:25:00Z",
      "processed_height": 1000000,
      "latest_height": 1000100,
      "tx_rate": 10.2,
      "error_rate": 0.01,
      "applications": 5000,
      "suppliers": 2000,
      "gateways": 100,
      "services": 50
    }
  ]
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

**Frontend Integration:**
```javascript
// Fetch chain metrics history
const fetchChainMetricsHistory = async (chain, limit = 200) => {
  const response = await fetch(`/api/v1/metrics/chains/${chain}?limit=${limit}`);
  return response.json();
};

// Display in chart
const history = await fetchChainMetricsHistory('mainnet');
// Plot processed_height, latest_height, tx_rate, error_rate over time
```

**UI Considerations:**
- Display multiple metrics in a multi-line chart
- Show processed_height vs latest_height to visualize lag
- Display tx_rate and error_rate trends
- Add time range selector or limit selector
- Show entity count changes over time
- Add zoom/pan functionality
- Reverse order for chart display (oldest first)

---

## Frontend Integration Best Practices

### Error Handling

Always handle errors gracefully:

```javascript
const fetchWithErrorHandling = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    // Show user-friendly error message
    return { error: error.message };
  }
};
```

### Polling for Real-time Updates

For endpoints that need real-time updates (jobs, health, metrics):

```javascript
const usePolling = (fetchFn, intervalMs = 30000) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await fetchFn();
        setData(result);
      } catch (error) {
        console.error('Polling error:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, intervalMs);
    return () => clearInterval(interval);
  }, []);
  
  return { data, loading };
};
```

### Loading States

Always show loading states during API calls:

```javascript
const [loading, setLoading] = useState(false);

const handleAction = async () => {
  setLoading(true);
  try {
    await performAction();
  } finally {
    setLoading(false);
  }
};
```

### Caching

Consider caching responses for endpoints that don't change frequently:

```javascript
const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

const fetchWithCache = async (url) => {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const data = await fetch(url).then(r => r.json());
  cache.set(url, { data, timestamp: Date.now() });
  return data;
};
```

---

## Security Considerations

**Important:** These admin endpoints should be protected with authentication and authorization in production. Consider:

1. **API Token Authentication**: Require an API token in the `Authorization` header
2. **Role-Based Access Control**: Restrict certain endpoints to admin users only
3. **Rate Limiting**: Implement rate limiting to prevent abuse
4. **Audit Logging**: Log all admin actions for security auditing
5. **HTTPS Only**: Ensure all admin endpoints are served over HTTPS

Example authentication middleware:

```javascript
const authenticateAdmin = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !isValidAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Apply to admin routes
app.post('/api/v1/jobs', authenticateAdmin, ...);
app.post('/api/v1/proof-submissions/rewards/refresh', authenticateAdmin, ...);
```

---

## Summary

This documentation covers all admin endpoints in the Pocket Network Indexer API:

- **Jobs Management**: Create, list, view, and cancel background jobs
- **Reward Analytics Refresh**: Monitor and manually trigger materialized view refreshes
- **Health Monitoring**: Real-time and historical health data for workers, RPC, process, and Redis
- **Metrics**: Chain metrics overview and time-series data

Each endpoint includes:
- Business logic explanation
- Request/response formats
- Status codes
- Frontend integration examples
- UI considerations
