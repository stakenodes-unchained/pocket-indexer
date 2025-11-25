# Proof Submissions API Endpoints

This document describes the API endpoints for accessing proof submission data and analytics.

## Base URL
All endpoints are prefixed with `/api/v1`

## Endpoints

### 1. Get Proof Submissions
**GET** `/api/v1/proof-submissions`

Retrieve proof submissions with optional filters.

**Query Parameters:**
- `chain` (string, optional): Filter by chain identifier (e.g., "mainnet", "testnet")
- `supplier_address` (string, optional): Filter by supplier operator address
- `application_address` (string, optional): Filter by application address
- `service_id` (string, optional): Filter by service ID (e.g., "iotex", "avax", "blast")
- `start_date` (datetime, optional): Filter submissions from this date onwards
- `end_date` (datetime, optional): Filter submissions up to this date
- `page` (integer, default: 1): Page number for pagination
- `limit` (integer, default: 100): Number of results per page

**Response Example:**
```json
{
  "data": [
    {
      "id": 1,
      "transaction_hash": "711EF830537F468B61C0C7BFDBFACAC4B2DF49A63A46F4D67AE9F5070C2CAFD3",
      "block_height": 412104,
      "timestamp": "2025-09-27T22:50:10Z",
      "chain": "mainnet",
      "supplier_operator_address": "pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc",
      "application_address": "pokt17w6jtw7q02398afx7urfgma3mwv5wtw9nm7a48",
      "service_id": "iotex",
      "session_id": "1d54a8352f3e2fd417b34259891bf7d839e2ee0830e15e123e8837a688543b2e",
      "session_end_block_height": 412080,
      "claim_proof_status_int": 0,
      "claimed_upokt": "24060upokt",
      "claimed_upokt_amount": 24060,
      "num_claimed_compute_units": 800000,
      "num_estimated_compute_units": 800000,
      "num_relays": 160,
      "compute_unit_efficiency": 100.00,
      "reward_per_relay": 150.38,
      "msg_index": 3,
      "created_at": "2025-09-27T22:50:10Z"
    }
  ],
  "meta": {
    "total": 1234,
    "page": 1,
    "limit": 100,
    "totalPages": 13
  }
}
```

**Curl Example:**
```bash
# Get submissions for a specific chain
curl "http://localhost:3006/api/v1/proof-submissions?chain=mainnet&service_id=iotex&page=1&limit=50"

# Get submissions for all chains
curl "http://localhost:3006/api/v1/proof-submissions?service_id=iotex&page=1&limit=50"
```

---

### 2. Get Reward Analytics (Service Aggregated)
**GET** `/api/v1/proof-submissions/rewards`  
**POST** `/api/v1/proof-submissions/rewards`

Retrieve reward and performance metrics aggregated by service across a time period. Returns one record per service (per chain) with totals aggregated across all hours in the specified time range. Results are sorted by total rewards in descending order.

**Important:** 
- Results are aggregated by `service_id` and `chain` (not by hour or supplier)
- Supplier filters are applied to filter the underlying data, but aggregation remains by service
- When `days` parameter is used, it returns rewards collected in the last X days
- When `start_date`/`end_date` are used, it returns rewards for that specific date range

**GET Query Parameters:**
- `chain` (string, optional): Filter by chain identifier
- `supplier_address` (string, optional): Filter by supplier operator address (used for filtering, but aggregation is still by service)
- `application_address` (string, optional): Filter by application address
- `service_id` (string, optional): Filter by specific service ID
- `days` (integer, optional): Get rewards for the last X days (e.g., `days=7` for last 7 days)
- `start_date` (datetime, optional): Filter from this date (used if `days` is not provided)
- `end_date` (datetime, optional): Filter to this date (used if `days` is not provided)
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 100): Results per page

**POST Request Body:**
- `chain` (string, optional): Filter by chain identifier
- `supplier_address` (string, optional): Filter by a single supplier operator address
- `supplier_addresses` (array of strings, optional): Filter by multiple supplier operator addresses
- `application_address` (string, optional): Filter by application address
- `service_id` (string, optional): Filter by specific service ID
- `days` (integer, optional): Get rewards for the last X days (e.g., `days=30` for last 30 days)
- `start_date` (datetime, optional): Filter from this date (used if `days` is not provided)
- `end_date` (datetime, optional): Filter to this date (used if `days` is not provided)
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 100): Results per page

**Note:** 
- When using POST, you can provide either `supplier_address` (single) or `supplier_addresses` (array). If both are provided, `supplier_addresses` takes precedence.
- If `days` is provided, `start_date` and `end_date` are ignored.
- Supplier filters are applied to the data but results are still aggregated by service (not by supplier).

**Response Example:**
```json
{
  "data": [
    {
      "service_id": "fuse",
      "chain": "mainnet",
      "total_submissions": 15000,
      "total_rewards_upokt": 5000000,
      "total_relays": 100000,
      "total_claimed_compute_units": 500000000,
      "total_estimated_compute_units": 550000000,
      "avg_efficiency_percent": 90.91,
      "avg_reward_per_relay": 50.00,
      "max_reward_per_submission": 1000,
      "min_reward_per_submission": 10
    },
    {
      "service_id": "iotex",
      "chain": "mainnet",
      "total_submissions": 12000,
      "total_rewards_upokt": 4500000,
      "total_relays": 90000,
      "total_claimed_compute_units": 450000000,
      "total_estimated_compute_units": 480000000,
      "avg_efficiency_percent": 93.75,
      "avg_reward_per_relay": 50.00,
      "max_reward_per_submission": 950,
      "min_reward_per_submission": 15
    }
  ],
  "meta": {
    "total": 25,
    "page": 1,
    "limit": 100,
    "totalPages": 1
  }
}
```

**Curl Examples:**
```bash
# GET - Get rewards for last 7 days, aggregated by service
curl "http://localhost:3006/api/v1/proof-submissions/rewards?days=7"

# GET - Get rewards for last 30 days for a specific chain
curl "http://localhost:3006/api/v1/proof-submissions/rewards?chain=mainnet&days=30"

# GET - Get rewards for a specific date range
curl "http://localhost:3006/api/v1/proof-submissions/rewards?chain=mainnet&start_date=2025-09-01T00:00:00Z&end_date=2025-09-30T23:59:59Z"

# GET - Get rewards filtered by supplier but still aggregated by service
curl "http://localhost:3006/api/v1/proof-submissions/rewards?supplier_address=pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc&days=30"

# POST - Get rewards for multiple supplier addresses (filtered but aggregated by service)
curl -X POST "http://localhost:3006/api/v1/proof-submissions/rewards" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_addresses": [
      "pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc",
      "pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj"
    ],
    "chain": "mainnet",
    "days": 30
  }'

# POST - Get rewards for a specific service in last 7 days
curl -X POST "http://localhost:3006/api/v1/proof-submissions/rewards" \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "fuse",
    "chain": "mainnet",
    "days": 7
  }'

# POST - Get rewards using date range
curl -X POST "http://localhost:3006/api/v1/proof-submissions/rewards" \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "mainnet",
    "start_date": "2025-09-01T00:00:00Z",
    "end_date": "2025-09-30T23:59:59Z"
  }'
```

---

### 3. Get Supplier Performance Analytics
**GET** `/api/v1/suppliers/:address/performance`

Retrieve daily performance metrics for a specific supplier.

**URL Parameters:**
- `address` (string, required): Supplier operator address

**Query Parameters:**
- `start_date` (datetime, optional): Filter from this date
- `end_date` (datetime, optional): Filter to this date
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 100): Results per page

**Response Example:**
```json
{
  "data": [
    {
      "supplier_operator_address": "pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc",
      "day_bucket": "2025-09-27T00:00:00Z",
      "unique_applications": 4,
      "unique_services": 4,
      "total_submissions": 50,
      "total_rewards_upokt": 2500000,
      "total_relays": 15000,
      "avg_efficiency_percent": 100.00,
      "avg_reward_per_relay": 166.67,
      "total_claimed_compute_units": 75000000,
      "total_estimated_compute_units": 75000000
    }
  ],
  "meta": {
    "total": 30,
    "page": 1,
    "limit": 100,
    "totalPages": 1
  }
}
```

**Curl Example:**
```bash
curl "http://localhost:3006/api/v1/suppliers/pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc/performance?start_date=2025-09-01T00:00:00Z"
```

---

### 4. Get Application Usage Analytics
**GET** `/api/v1/applications/:address/usage`

Retrieve daily usage metrics for a specific application.

**URL Parameters:**
- `address` (string, required): Application address

**Query Parameters:**
- `start_date` (datetime, optional): Filter from this date
- `end_date` (datetime, optional): Filter to this date
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 100): Results per page

**Response Example:**
```json
{
  "data": [
    {
      "application_address": "pokt17w6jtw7q02398afx7urfgma3mwv5wtw9nm7a48",
      "day_bucket": "2025-09-27T00:00:00Z",
      "unique_suppliers": 5,
      "unique_services": 3,
      "total_submissions": 100,
      "total_rewards_upokt": 5000000,
      "total_relays": 30000,
      "avg_efficiency_percent": 100.00,
      "avg_reward_per_relay": 166.67,
      "total_claimed_compute_units": 150000000,
      "total_estimated_compute_units": 150000000
    }
  ],
  "meta": {
    "total": 30,
    "page": 1,
    "limit": 100,
    "totalPages": 1
  }
}
```

**Curl Example:**
```bash
curl "http://localhost:3006/api/v1/applications/pokt17w6jtw7q02398oshfx7urfgma3mwv5wtw9nm7a48/usage?start_date=2025-09-01T00:00:00Z"
```

---

### 5. Get Proof Submissions Summary Statistics
**GET** `/api/v1/proof-submissions/summary`  
**POST** `/api/v1/proof-submissions/summary`

Get aggregated summary statistics for proof submissions.

**GET Query Parameters:**
- `chain` (string, optional): Filter by chain identifier
- `start_date` (datetime, optional): Filter from this date
- `end_date` (datetime, optional): Filter to this date
- `supplier_address` (string, optional): Filter by supplier (can be comma-separated)
- `application_address` (string, optional): Filter by application
- `service_id` (string, optional): Filter by service

**POST Request Body:**
- `chain` (string, optional): Filter by chain identifier
- `start_date` (datetime, optional): Filter from this date
- `end_date` (datetime, optional): Filter to this date
- `supplier_address` (string or array, optional): Filter by supplier(s) - can be single string, comma-separated string, or array
- `supplier_addresses` (array of strings, optional): Filter by multiple supplier operator addresses
- `application_address` (string, optional): Filter by application
- `service_id` (string, optional): Filter by service

**Note:** When using POST, you can provide either `supplier_address` (single, comma-separated, or array) or `supplier_addresses` (array). If both are provided, `supplier_addresses` takes precedence.

**Response Example:**
```json
{
  "data": {
    "total_submissions": 1234,
    "unique_suppliers": 50,
    "unique_applications": 25,
    "unique_services": 10,
    "total_rewards_upokt": 50000000,
    "total_relays": 300000,
    "total_claimed_compute_units": 7500000000,
    "total_estimated_compute_units": 7500000000,
    "avg_efficiency_percent": 100.00,
    "avg_reward_per_relay": 166.67,
    "first_submission": "2025-09-01T00:00:00Z",
    "last_submission": "2025-09-27T22:50:10Z"
  }
}
```

**Curl Examples:**
```bash
# GET - Get summary for a specific chain
curl "http://localhost:3006/api/v1/proof-submissions/summary?chain=mainnet&service_id=iotex"

# GET - Get summary for all chains
curl "http://localhost:3006/api/v1/proof-submissions/summary?service_id=iotex"

# POST - Get summary for multiple supplier addresses
curl -X POST "http://localhost:3006/api/v1/proof-submissions/summary" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_addresses": [
      "pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc",
      "pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj"
    ],
    "chain": "mainnet",
    "service_id": "iotex"
  }'

# POST - Get summary for a single supplier address (alternative to GET)
curl -X POST "http://localhost:3006/api/v1/proof-submissions/summary" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_address": "pokt183lm40qjafypys95g52szszxk8pqe7tnphpphc",
    "chain": "mainnet"
  }'
```

---

## Data Fields Explanation

### Core Fields
- `chain`: The chain identifier (e.g., "mainnet", "testnet") - used for filtering data by specific chain
- `supplier_operator_address`: The Pocket Network supplier that submitted the proof (used in filtering, not in rewards endpoint response)
- `application_address`: The application that the relays were served for (used in filtering, not in rewards endpoint response)
- `service_id`: The blockchain service ID (e.g., "iotex", "avax", "blast", "fuse")
- `session_id`: Unique session identifier (used in proof submissions endpoint, not in rewards endpoint)

### Proof Submissions Endpoint Fields
- `claimed_upokt_amount`: Numeric value of rewards claimed in upokt (per submission)
- `num_relays`: Number of relays processed in this submission
- `num_claimed_compute_units`: Compute units that were claimed (per submission)
- `num_estimated_compute_units`: Compute units that were estimated (per submission)
- `compute_unit_efficiency`: Percentage efficiency (claimed / estimated * 100) per submission
- `reward_per_relay`: Average reward per relay (upokt per relay) per submission

### Rewards Endpoint Fields (Service Aggregated)
- `service_id`: The blockchain service ID
- `chain`: The chain identifier
- `total_submissions`: Total number of submissions aggregated across the time period
- `total_rewards_upokt`: Total rewards in upokt aggregated across the time period
- `total_relays`: Total number of relays aggregated across the time period
- `total_claimed_compute_units`: Total claimed compute units aggregated across the time period
- `total_estimated_compute_units`: Total estimated compute units aggregated across the time period
- `avg_efficiency_percent`: Weighted average efficiency percentage (calculated from totals, not average of averages)
- `avg_reward_per_relay`: Average reward per relay (calculated as total_rewards_upokt / total_relays)
- `max_reward_per_submission`: Maximum reward per submission in the time period
- `min_reward_per_submission`: Minimum reward per submission in the time period

### Relationship Tracking
These endpoints enable tracking of:
1. **Service-Level Rewards**: Track total rewards aggregated by service across time periods (rewards endpoint)
2. **Supplier Performance**: Track daily performance metrics for specific suppliers (supplier performance endpoint)
3. **Application Usage**: Track daily usage metrics for specific applications (application usage endpoint)
4. **Compute Units**: Monitor claimed vs estimated compute units for efficiency analysis
5. **Relays**: Count of relays processed (per submission or aggregated)
6. **Performance**: Efficiency metrics and reward rates at different aggregation levels

---

## Use Cases

1. **Service Performance Rankings**: Use `/proof-submissions/rewards` with `days` parameter to get top services by total rewards (e.g., `days=30` for last 30 days)
2. **Service Analytics**: Use `/proof-submissions/rewards` to compare reward performance across different services, aggregated over time periods
3. **Supplier-Filtered Service Analysis**: Use `/proof-submissions/rewards` with `supplier_addresses` to see which services generated the most rewards for specific suppliers, while still getting service-level aggregation
4. **Supplier Analytics**: Use `/suppliers/:address/performance` for supplier-specific daily performance metrics
5. **Application Monitoring**: Use `/applications/:address/usage` to track application activity
6. **Performance Analysis**: Use `avg_efficiency_percent` to monitor compute unit efficiency across services
7. **Financial Tracking**: Use `total_rewards_upokt` and `avg_reward_per_relay` for financial metrics and service comparison

---

## Notes

- All datetime fields are in ISO 8601 format (UTC)
- Pagination is supported on all list endpoints
- Filtering by date range is optimized with database indexes
- Computed columns (efficiency, reward_per_relay) are calculated automatically by the database
