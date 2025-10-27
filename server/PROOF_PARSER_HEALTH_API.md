# Proof Parser Health API Documentation

This document describes the health monitoring endpoints for the proof-parser service, accessible through the main API server.

## Base URL

All endpoints are accessible via the main API server:
- Production: `http://localhost:3006`
- Development: `http://localhost:3006`

## Endpoints

### 1. Get Overall Health Status

Returns the health status of all proof-parser service instances.

**Endpoint:** `GET /api/v1/health/proof-parser`

**Query Parameters:** None

**Response:**

```json
{
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-28T00:27:43.000Z",
    "chains": [
      {
        "chain": "pocket-testnet-alpha",
        "status": "running",
        "uptime": 321000,
        "processedCount": 1247,
        "errorCount": 0,
        "lastProcessTime": "2025-10-28T00:27:23.000Z",
        "lastError": null,
        "historicalCompleted": true,
        "isWatching": true,
        "database": "connected"
      }
    ]
  }
}
```

**Response Fields:**

- `status` (string): Overall health status - "healthy" or "degraded"
- `timestamp` (string): Current timestamp in ISO format
- `chains` (array): Array of chain-specific health data
  - `chain` (string): Chain identifier
  - `status` (string): Service status ("running" or "stopped")
  - `uptime` (number): Service uptime in milliseconds
  - `processedCount` (number): Total transactions processed
  - `errorCount` (number): Total errors encountered
  - `lastProcessTime` (string): Last successful processing timestamp
  - `lastError` (string|null): Last error message
  - `historicalCompleted` (boolean): Whether historical processing is complete
  - `isWatching` (boolean): Whether watch mode is active
  - `database` (string): Database connection status

**Example Request:**

```bash
curl http://localhost:3006/api/v1/health/proof-parser
```

**Example Response:**

```json
{
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-28T00:27:43.000Z",
    "chains": [
      {
        "chain": "mainnet",
        "status": "running",
        "uptime": 86400000,
        "processedCount": 15420,
        "errorCount": 2,
        "lastProcessTime": "2025-10-28T00:27:00.000Z",
        "lastError": null,
        "historicalCompleted": true,
        "isWatching": true,
        "database": "connected"
      }
    ]
  }
}
```

---

### 2. Get Chain-Specific Health

Returns detailed health status for a specific chain.

**Endpoint:** `GET /api/v1/health/proof-parser/:chain`

**Path Parameters:**
- `chain` (string, required): Chain identifier (e.g., "mainnet", "shannon", "pocket-testnet-alpha")

**Response:**

```json
{
  "data": {
    "chain": "pocket-testnet-alpha",
    "status": "running",
    "uptime": 321000,
    "processedCount": 1247,
    "errorCount": 0,
    "lastProcessTime": "2025-10-28T00:27:23.000Z",
    "lastError": null,
    "historicalCompleted": true,
    "isWatching": true,
    "database": "connected"
  }
}
```

**Response Fields:** Same as individual chain object in overall health endpoint

**Example Request:**

```bash
curl http://localhost:3006/api/v1/health/proof-parser/mainnet
```

**Example Response:**

```json
{
  "data": {
    "chain": "mainnet",
    "status": "running",
    "uptime": 86400000,
    "processedCount": 15420,
    "errorCount": 2,
    "lastProcessTime": "2025-10-28T00:27:00.000Z",
    "lastError": null,
    "historicalCompleted": true,
    "isWatching": true,
    "database": "connected"
  }
}
```

**Error Responses:**

- `404`: Chain not found
- `500`: Internal server error

```json
{
  "error": "Chain shannon not found"
}
```

---

### 3. Get Statistics

Returns processing statistics for all chains.

**Endpoint:** `GET /api/v1/health/proof-parser/stats`

**Query Parameters:** None

**Response:**

```json
{
  "data": {
    "stats": [
      {
        "chain": "pocket-testnet-alpha",
        "processed": 1247,
        "errors": 0,
        "status": "running",
        "uptime": 321000,
        "lastProcessTime": "2025-10-28T00:27:23.000Z"
      }
    ]
  }
}
```

**Response Fields:**

- `stats` (array): Array of statistics objects
  - `chain` (string): Chain identifier
  - `processed` (number): Total transactions processed
  - `errors` (number): Total errors encountered
  - `status` (string): Service status
  - `uptime` (number): Service uptime in milliseconds
  - `lastProcessTime` (string|null): Last processing timestamp

**Example Request:**

```bash
curl http://localhost:3006/api/v1/health/proof-parser/stats
```

**Example Response:**

```json
{
  "data": {
    "stats": [
      {
        "chain": "mainnet",
        "processed": 15420,
        "errors": 2,
        "status": "running",
        "uptime": 86400000,
        "lastProcessTime": "2025-10-28T00:27:00.000Z"
      },
      {
        "chain": "shannon",
        "processed": 8230,
        "errors": 0,
        "status": "running",
        "uptime": 43200000,
        "lastProcessTime": "2025-10-28T00:26:50.000Z"
      }
    ]
  }
}
```

---

## Status Values

### Overall Status
- `healthy`: All services are running and connected
- `degraded`: Some services have issues (e.g., disconnected database, errors)

### Service Status
- `running`: Service is actively processing
- `stopped`: Service is not running

### Database Status
- `connected`: Database connection is active
- `disconnected`: Database connection is not active

---

## Frontend Integration Examples

### React Example

```jsx
import React, { useState, useEffect } from 'react';

function ProofParserHealth() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 30000); // Poll every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchHealth = async () => {
    try {
      const response = await fetch('http://localhost:3006/api/v1/health/proof-parser');
      const data = await response.json();
      setHealth(data.data);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <h2>Proof Parser Service Health</h2>
      <p>Status: {health.status}</p>
      {health.chains.map(chain => (
        <div key={chain.chain}>
          <h3>{chain.chain}</h3>
          <p>Status: {chain.status}</p>
          <p>Processed: {chain.processedCount}</p>
          <p>Errors: {chain.errorCount}</p>
          <p>Uptime: {formatUptime(chain.uptime)}</p>
        </div>
      ))}
    </div>
  );
}

function formatUptime(ms) {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${days}d ${hours}h ${minutes}m`;
}
```

### JavaScript Example

```javascript
// Fetch overall health
async function getProofParserHealth() {
  try {
    const response = await fetch('http://localhost:3006/api/v1/health/proof-parser');
    const data = await response.json();
    console.log('Health Status:', data.data.status);
    console.log('Chains:', data.data.chains);
    return data.data;
  } catch (error) {
    console.error('Error fetching health:', error);
  }
}

// Fetch chain-specific health
async function getChainHealth(chain) {
  try {
    const response = await fetch(`http://localhost:3006/api/v1/health/proof-parser/${chain}`);
    const data = await response.json();
    console.log(`${chain} health:`, data.data);
    return data.data;
  } catch (error) {
    console.error(`Error fetching ${chain} health:`, error);
  }
}

// Fetch statistics
async function getProofParserStats() {
  try {
    const response = await fetch('http://localhost:3006/api/v1/health/proof-parser/stats');
    const data = await response.json();
    console.log('Stats:', data.data.stats);
    return data.data.stats;
  } catch (error) {
    console.error('Error fetching stats:', error);
  }
}
```

### Vue Example

```vue
<template>
  <div class="proof-parser-health">
    <h2>Proof Parser Service Health</h2>
    <p :class="overallStatus">{{ overallStatusText }}</p>
    
    <div v-for="chain in chains" :key="chain.chain" class="chain-status">
      <h3>{{ chain.chain }}</h3>
      <div class="status-grid">
        <div class="status-item">
          <label>Status:</label>
          <span :class="chain.status">{{ chain.status }}</span>
        </div>
        <div class="status-item">
          <label>Processed:</label>
          <span>{{ chain.processedCount }}</span>
        </div>
        <div class="status-item">
          <label>Errors:</label>
          <span class="error-count">{{ chain.errorCount }}</span>
        </div>
        <div class="status-item">
          <label>Uptime:</label>
          <span>{{ formatUptime(chain.uptime) }}</span>
        </div>
        <div class="status-item">
          <label>Database:</label>
          <span :class="chain.database">{{ chain.database }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      health: null,
      loading: true,
      error: null
    };
  },
  mounted() {
    this.fetchHealth();
    this.interval = setInterval(this.fetchHealth, 30000);
  },
  beforeUnmount() {
    clearInterval(this.interval);
  },
  computed: {
    overallStatus() {
      return this.health?.status || 'unknown';
    },
    overallStatusText() {
      return this.health?.status || 'Loading...';
    },
    chains() {
      return this.health?.chains || [];
    }
  },
  methods: {
    async fetchHealth() {
      try {
        const response = await fetch('http://localhost:3006/api/v1/health/proof-parser');
        const data = await response.json();
        this.health = data.data;
        this.loading = false;
      } catch (err) {
        this.error = err.message;
        this.loading = false;
      }
    },
    formatUptime(ms) {
      const days = Math.floor(ms / (1000 * 60 * 60 * 24));
      const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
      return `${days}d ${hours}h ${minutes}m`;
    }
  }
};
</script>
```

---

## Direct Service Endpoints

You can also access the proof-parser service directly on port 3008:

- Health: `http://localhost:3008/health`
- Chain Health: `http://localhost:3008/health/:chain`
- Stats: `http://localhost:3008/stats`
- Start: `POST http://localhost:3008/start/:chain`
- Stop: `POST http://localhost:3008/stop/:chain`

---

## Monitoring Best Practices

1. **Polling Interval**: Poll every 30-60 seconds for health status
2. **Error Alerting**: Alert when `status === "degraded"` or `errorCount > 10`
3. **Database Monitoring**: Alert when `database !== "connected"`
4. **Watch Mode**: Monitor `isWatching` to ensure new transactions are being processed
5. **Performance**: Monitor `processedCount` growth rate
6. **Historical Sync**: Alert if `historicalCompleted === false` for extended periods

---

## Status Indicators

### Service Status
- 🟢 **Running**: Service is active
- 🔴 **Stopped**: Service is inactive
- 🟡 **Degraded**: Service has issues

### Database Status
- 🟢 **Connected**: Database connection active
- 🔴 **Disconnected**: Database connection lost

### Processing Status
- 🟢 **Historical Complete + Watching**: Fully operational
- 🟡 **Historical Complete + Not Watching**: Waiting for new transactions
- 🔴 **Historical Incomplete**: Service may be behind

---

## Error Codes

- `404`: Chain not found
- `500`: Internal server error
- `503`: Service unavailable (may occur during container restart)

