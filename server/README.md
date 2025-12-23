# Indexer & API Server

This directory contains the Node.js indexer workers and API server for Pocket Indexer. The indexer ingests blocks and events from Pocket RPC endpoints into PostgreSQL, and the API server exposes REST endpoints consumed by dashboards and clients.

## How to Run

### Prerequisites

- Node.js 18+
- PostgreSQL
- (Optional) Redis for caching and worker coordination

### Environment Variables

Create a `.env` file in the repo root (or inject env via your runtime) with at least:

```bash
# RPC endpoints - comma-separated list of RPC_NAME=RPC_ENDPOINT pairs
RPC_ENDPOINTS=shannon=https://shannon-testnet-grove-api.beta.poktroll.com,mainnet=https://rpc.pokt.network

# Postgres
DB_HOST=localhost
DB_PORT=5432
DB_NAME=pokt_indexer
DB_USER=postgres
DB_PASS=your-password

# Redis (optional but recommended)
REDIS_URL=redis://127.0.0.1:6379
REDIS_PASSWORD=
REDIS_DB=0

# Worker configuration
WORKER_CONCURRENCY=2
HISTORICAL_BATCH_SIZE=50
```

### Docker (Recommended)

```bash
cd server
docker-compose up -d

# View logs
docker-compose logs -f
```

### Local (Manual)

```bash
cd server
npm install

# Start Redis (install separately or use Docker)
docker run -d -p 6379:6379 redis:7-alpine

# Start indexer workers and API server
./start_indexer_server.sh
./start_api_server.sh
```

## API Overview

Base URL (default): `http://localhost:3006`

### Transactions

- GET `/api/v1/transactions`
  - Description: List transactions (paginated)
  - Query
    - `chain` (string, optional)
    - `page` (int, default 1)
    - `limit` (int, default 25)
  - Response: `{ data: Transaction[], meta: { page, limit, total, totalPages } }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/transactions?chain=pocket-testnet-beta&page=1&limit=25"
    ```

- GET `/api/v1/transactions/count`
  - Description: Total transaction count. With `chain`, returns count for that chain
  - Query
    - `chain` (string, optional)
  - Response: `{ data: { total: number } }` or chain-specific shape used by service
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/transactions/count?chain=pocket-testnet-beta"
    ```

- GET `/api/v1/transactions/:transaction_id`
  - Description: Transaction detail by hash/id
  - Query
    - `chain` (string, optional)
  - Response: `{ data: Transaction | null }` (404 if not found)
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/transactions/9DDF28C847DA284C...?...chain=pocket-testnet-beta"
    ```

### Chains

- GET `/api/v1/chains`
  - Description: List available chains
  - Response: `{ data: string[] }`
  - Example:
    ```bash
    curl http://localhost:3006/api/v1/chains
    ```

- GET `/api/v1/chains/stats`
  - Description: High-level chain statistics
  - Response: `{ ... }` (aggregate stats object)
  - Example:
    ```bash
    curl http://localhost:3006/api/v1/chains/stats
    ```

### Applications

- GET `/api/v1/applications`
  - Description: List applications (paginated, filterable)
  - Query
    - `chain` (string)
    - `status` (string)
    - `address` (string)
    - `page` (int, default 1)
    - `limit` (int, default 25)
  - Response: `{ data: Application[], meta: { page, limit, total, totalPages } }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/applications?chain=pocket-testnet-beta&status=staked&page=1&limit=25"
    ```

- GET `/api/v1/applications/:address`
  - Description: Application detail with service configs and delegations
  - Query
    - `chain` (string)
  - Response: `{ data: { ...application, service_configs: [...], delegations: [...] } }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/applications/pokt1...addr?chain=pocket-testnet-beta"
    ```

### Suppliers

- GET `/api/v1/suppliers`
  - Description: List suppliers (paginated, filterable)
  - Query
    - `chain` (string)
    - `status` (string)
    - `address` (string)
    - `page` (int, default 1)
    - `limit` (int, default 25)
  - Response: `{ data: Supplier[], meta: { page, limit, total, totalPages } }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/suppliers?chain=pocket-testnet-beta&status=staked"
    ```

- GET `/api/v1/suppliers/:address`
  - Description: Supplier detail with service configs
  - Query
    - `chain` (string)
  - Response: `{ data: { ...supplier, service_configs: [...] } }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/suppliers/pokt1...operator?chain=pocket-testnet-beta"
    ```

### Gateways

- GET `/api/v1/gateways`
  - Description: List gateways (paginated, filterable)
  - Query
    - `chain` (string)
    - `status` (string)
    - `address` (string)
    - `page` (int, default 1)
    - `limit` (int, default 25)
  - Response: `{ data: Gateway[], meta: { page, limit, total, totalPages } }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/gateways?chain=pocket-testnet-beta&status=staked"
    ```

- GET `/api/v1/gateways/:address`
  - Description: Gateway detail
  - Query
    - `chain` (string)
  - Response: `{ data: Gateway }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/gateways/pokt1...gateway?chain=pocket-testnet-beta"
    ```

### Delegations

- GET `/api/v1/delegations`
  - Description: List application-to-gateway delegations (most recent first)
  - Query
    - `chain` (string)
    - `application_address` (string)
    - `gateway_address` (string)
    - `active` ('true'|'false')
  - Response: `{ data: Delegation[] }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/delegations?chain=pocket-testnet-beta&application_address=pokt1..."
    ```

### Staking

- GET `/api/v1/staking`
  - Description: List staking events (paginated)
  - Query
    - `chain` (string)
    - `type` (string)
    - `event` (string)
    - `address` (string)
    - `page` (int, default 1)
    - `limit` (int, default 50)
  - Response: `{ data: StakingEvent[], meta: { page, limit, total, totalPages } }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/staking?chain=pocket-testnet-beta&type=application&event=staked&limit=50"
    ```

### Metrics

- GET `/api/v1/metrics/chains`
  - Description: Latest metrics snapshot per chain
  - Response: `{ data: ChainMetrics[] }`
  - Example:
    ```bash
    curl http://localhost:3006/api/v1/metrics/chains
    ```

- GET `/api/v1/metrics/chains/:chain`
  - Description: Time series metrics for a chain (most recent first)
  - Query
    - `limit` (int, default 200)
  - Response: `{ data: ChainMetrics[] }`
  - Example:
    ```bash
    curl "http://localhost:3006/api/v1/metrics/chains/pocket-testnet-beta?limit=100"
    ```

### Jobs

- POST `/api/v1/jobs`
  - Description: Create a background job
  - Body: `{ type: string, params?: object, created_by?: string }`
  - Response: `{ data: Job }`
  - Example:
    ```bash
    curl -X POST http://localhost:3006/api/v1/jobs \
      -H 'Content-Type: application/json' \
      -d '{"type":"reindex","params":{"chain":"pocket-testnet-beta"}}'
    ```

- GET `/api/v1/jobs`
  - Description: List recent jobs
  - Response: `{ data: Job[] }`

- GET `/api/v1/jobs/:id`
  - Description: Get a job and its runs
  - Response: `{ data: { job: Job, runs: JobRun[] } }`

- POST `/api/v1/jobs/:id/cancel`
  - Description: Cancel a queued/running job
  - Response: `{ data: Job }`

### Health

- GET `/api/v1/health/workers`
  - Description: Detailed workers/process/Redis health
  - Response:
    ```json
    {
      "data": {
        "heartbeats": [
          {
            "worker_id": "pocket-testnet-beta",
            "last_seen": "2025-09-24T03:40:00.000Z",
            "meta": {
              "type": "monitor",
              "threadId": 14,
              "lastProcessedHeight": 344124
            }
          }
        ],
        "workers": [
          { "name": "pocket-testnet-beta", "threadId": 14, "isRunning": true }
        ],
        "process": {
          "pid": 12345,
          "uptime_s": 3600,
          "memory": {
            "rss": 123456789,
            "heapTotal": 98765432,
            "heapUsed": 76543210,
            "external": 1234567,
            "arrayBuffers": 234567
          },
          "cpu_usage": { "user": 1234567, "system": 234567 },
          "node": "v18.x.x",
          "argv": ["node", "server/index.js"],
          "env": {
            "WORKER_CONCURRENCY": "2",
            "HISTORICAL_BATCH_SIZE": "50"
          }
        },
        "redis": {
          "memory": "# Memory\nused_memory:...\n...",
          "stats": "# Stats\ntotal_connections_received:...\n...",
          "keyspace": "# Keyspace\n# db0:keys=...,expires=...,avg_ttl=...\n..."
        },
        "chains": [
          {
            "chain": "pocket-testnet-beta",
            "history_checkpoint": 343000,
            "processed_height": 344120,
            "latest_height": 344130,
            "monitor_lag": 10,
            "history_backlog": 1120
          }
        ]
      }
    }
    ```

- GET `/api/v1/health/rpc`
  - Description: Lightweight health with current worker list
  - Response:
    ```json
    {
      "data": {
        "status": "ok",
        "workers": [
          { "name": "pocket-testnet-beta", "threadId": 14, "isRunning": true }
        ],
        "chains": [
          {
            "chain": "pocket-testnet-beta",
            "latest_height": 344130,
            "processed_height": 344120,
            "monitor_lag": 10
          }
        ]
      }
    }
    ```

---

### Response Model Notes

- Transaction: includes on-chain fields, normalized sender/recipient, amounts/denoms, gas, status, timestamps.
- Application/Supplier/Gateway: include stake amounts/denoms, status, last_seen, and entity-specific fields; detail endpoints augment with related configs/delegations.
- Delegation: `{ application_address, gateway_address, chain, is_active, action, timestamp }`.
- Metrics: snapshots contain processed/latest heights, lag, tx/error rates, counts of entities.

All list endpoints support pagination via `page` and `limit` where applicable and return `meta` objects for UI pagination.

For full per-endpoint details, see:

- `TRANSACTIONS_API.md`, `BLOCKS_API.md`, `SERVICES_API.md`, `CLAIMS_API.md`, `PROOF_SUBMISSIONS_API.md`
- `NETWORK_GROWTH_API.md`, `VALIDATOR_PERFORMANCE_API.md`, `VALIDATOR_SERVICE_SEARCH_API.md`
- `ADMIN_API.md`, `LOG_VIEWER_API.md`, `PROOF_PARSER_HEALTH_API.md`

## For New Maintainers

- Read `indexer-server.js` and `services/indexer/worker.js` to understand historical vs monitor workers, gap filling, and event processing.
- Read `api-server.js` together with the `*_API.md` files to see how Express routes map to service modules in `services/`.
- Use `migrations/` together with `POCKET_NETWORK_INDEXER_REQUIREMENTS.md` to understand and extend the schema safely.