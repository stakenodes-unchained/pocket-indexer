# Claims API Endpoints

This document describes the API endpoints for accessing claim data and analytics.

## Base URL
All endpoints are prefixed with `/api/v1`

## Endpoints

### 1. Get Claims
**GET** `/api/v1/claims`  
**POST** `/api/v1/claims`

Retrieve claims with optional filters.

**GET Query Parameters:**
- `chain` (string, optional): Filter by chain identifier (e.g., "pocket-mainnet", "pocket-testnet")
- `owner_address` (string, optional): Filter by supplier owner address
- `supplier_address` (string, optional): Filter by supplier operator address or owner address (can be comma-separated)
- `application_address` (string, optional): Filter by application address
- `service_id` (string, optional): Filter by service ID (e.g., "iotex", "avax", "blast")
- `status` (string, optional, default: "staked"): Filter by supplier status - "staked", "unstaked", "unstake_requested", or "all"
- `start_date` (datetime, optional): Filter claims from this date onwards
- `end_date` (datetime, optional): Filter claims up to this date
- `page` (integer, default: 1): Page number for pagination
- `limit` (integer, default: 100): Number of results per page

**POST Request Body:**
Same parameters as GET, but in JSON body format.

**Response Example:**
```json
{
  "data": [
    {
      "id": 1,
      "supplier_operator_address": "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
      "application_address": "pokt185tgfw9lxyuznh9rz89556l4p8dshdkjd5283d",
      "service_id": "eth",
      "session_id": "1922525b1cfb40672ffe7988b35252c9dbb76aa4a8e8c83cd003a62a9520f01b",
      "session_start_block_height": "373201",
      "session_end_block_height": "373260",
      "root_hash": "DoH5K8wnivh7HhQe9f6FDGIh+8a5BwpH0U7qkx9ve10AAAAAApQYYAAAAAAAACHM",
      "proof": null,
      "status": "claimed",
      "timestamp": "2025-09-13T10:21:38Z",
      "chain": "pocket-mainnet",
      "claim_proof_status_int": 0,
      "claimed_upokt": "1332061upokt",
      "claimed_upokt_amount": 1332061,
      "num_claimed_compute_units": 43260000,
      "num_estimated_compute_units": 43260000,
      "num_relays": 8652,
      "compute_unit_efficiency": 100.00,
      "reward_per_relay": 153.88,
      "created_at": "2025-09-13T10:21:38Z"
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

**Curl Examples:**
```bash
# GET - Get claims for a specific supplier
curl "http://localhost:3006/api/v1/claims?supplier_address=pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj&service_id=eth&page=1&limit=50"

# GET - Get claims filtered by owner address
curl "http://localhost:3006/api/v1/claims?owner_address=pokt1abc123&status=staked&page=1&limit=50"

# GET - Get claims filtered by status
curl "http://localhost:3006/api/v1/claims?status=staked&service_id=eth&page=1&limit=50"

# POST - Get claims with multiple filters
curl -X POST "http://localhost:3006/api/v1/claims" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_address": "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
    "service_id": "eth",
    "start_date": "2025-09-13T00:00:00Z",
    "page": 1,
    "limit": 50
  }'

# POST - Get claims filtered by owner address and status
curl -X POST "http://localhost:3006/api/v1/claims" \
  -H "Content-Type: application/json" \
  -d '{
    "owner_address": "pokt1abc123",
    "status": "staked",
    "service_id": "eth",
    "page": 1,
    "limit": 50
  }'
```

---

### 2. Get Reward Analytics (Service Aggregated)
**GET** `/api/v1/claims/rewards`  
**POST** `/api/v1/claims/rewards`

Retrieve reward and performance metrics aggregated by service across a time period. Returns one record per service (per chain) with totals aggregated across all hours in the specified time range. Results are sorted by total rewards in descending order.

**Important:** 
- Results are aggregated by `service_id` and `chain` (not by hour or supplier)
- Supplier filters are applied to filter the underlying data, but aggregation remains by service
- When `days` parameter is used, it returns rewards collected in the last X days
- When `start_date`/`end_date` are used, it returns rewards for that specific date range

**GET Query Parameters:**
- `chain` (string, optional): Filter by chain identifier
- `owner_address` (string, optional): Filter by supplier owner address
- `supplier_address` (string, optional): Filter by supplier operator address or owner address (used for filtering, but aggregation is still by service)
- `supplier_addresses` (string, optional): Comma-separated supplier operator addresses or owner addresses (for GET requests)
- `application_address` (string, optional): Filter by application address
- `service_id` (string, optional): Filter by specific service ID
- `status` (string, optional, default: "staked"): Filter by supplier status - "staked", "unstaked", "unstake_requested", or "all"
- `days` (integer, optional): Get rewards for the last X days (e.g., `days=7` for last 7 days)
- `start_date` (datetime, optional): Filter from this date (used if `days` is not provided)
- `end_date` (datetime, optional): Filter to this date (used if `days` is not provided)
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 100): Results per page

**POST Request Body:**
- `chain` (string, optional): Filter by chain identifier
- `owner_address` (string, optional): Filter by supplier owner address
- `supplier_address` (string, optional): Filter by a single supplier operator address or owner address
- `supplier_addresses` (array of strings, optional): Filter by multiple supplier operator addresses or owner addresses
- `application_address` (string, optional): Filter by application address
- `service_id` (string, optional): Filter by specific service ID
- `status` (string, optional, default: "staked"): Filter by supplier status - "staked", "unstaked", "unstake_requested", or "all"
- `days` (integer, optional): Get rewards for the last X days (e.g., `days=30` for last 30 days)
- `start_date` (datetime, optional): Filter from this date (used if `days` is not provided)
- `end_date` (datetime, optional): Filter to this date (used if `days` is not provided)
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 100): Results per page

**Note:** 
- When using POST, you can provide either `supplier_address` (single) or `supplier_addresses` (array). If both are provided, `supplier_addresses` takes precedence.
- If `days` is provided, `start_date` and `end_date` are ignored.
- Supplier filters (owner_address, supplier_address, status) are applied to the data but results are still aggregated by service (not by supplier).
- The `owner_address` parameter filters claims from suppliers owned by that address.
- The `status` parameter filters claims by supplier status. Use "all" to include claims from suppliers with any status.
- The `supplier_address` parameter can match either operator addresses or owner addresses.

**Response Example:**
```json
{
  "data": [
    {
      "service_id": "fuse",
      "chain": "pocket-mainnet",
      "total_claims": 15000,
      "total_rewards_upokt": 5000000,
      "total_relays": 100000,
      "total_claimed_compute_units": 500000000,
      "total_estimated_compute_units": 550000000,
      "avg_efficiency_percent": 90.91,
      "avg_reward_per_relay": 50.00,
      "max_reward_per_claim": 1000,
      "min_reward_per_claim": 10
    },
    {
      "service_id": "iotex",
      "chain": "pocket-mainnet",
      "total_claims": 12000,
      "total_rewards_upokt": 4500000,
      "total_relays": 90000,
      "total_claimed_compute_units": 450000000,
      "total_estimated_compute_units": 480000000,
      "avg_efficiency_percent": 93.75,
      "avg_reward_per_relay": 50.00,
      "max_reward_per_claim": 950,
      "min_reward_per_claim": 15
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
curl "http://localhost:3006/api/v1/claims/rewards?days=7"

# GET - Get rewards for a specific service
curl "http://localhost:3006/api/v1/claims/rewards?service_id=eth&start_date=2025-09-13T00:00:00Z"

# GET - Get rewards filtered by owner address
curl "http://localhost:3006/api/v1/claims/rewards?owner_address=pokt1abc123&days=30"

# GET - Get rewards filtered by supplier operator address
curl "http://localhost:3006/api/v1/claims/rewards?supplier_address=pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj&days=7"

# GET - Get rewards filtered by supplier status
curl "http://localhost:3006/api/v1/claims/rewards?status=staked&days=7"

# GET - Get rewards filtered by owner address and status
curl "http://localhost:3006/api/v1/claims/rewards?owner_address=pokt1abc123&status=staked&days=30"

# POST - Get rewards for multiple supplier addresses
curl -X POST "http://localhost:3006/api/v1/claims/rewards" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_addresses": [
      "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
      "pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj"
    ],
    "service_id": "eth",
    "start_date": "2025-09-13T00:00:00Z"
  }'

# POST - Get rewards filtered by owner address
curl -X POST "http://localhost:3006/api/v1/claims/rewards" \
  -H "Content-Type: application/json" \
  -d '{
    "owner_address": "pokt1abc123",
    "days": 30
  }'

# POST - Get rewards filtered by status
curl -X POST "http://localhost:3006/api/v1/claims/rewards" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "staked",
    "days": 30
  }'

# POST - Get rewards filtered by owner address and status
curl -X POST "http://localhost:3006/api/v1/claims/rewards" \
  -H "Content-Type: application/json" \
  -d '{
    "owner_address": "pokt1abc123",
    "status": "staked",
    "days": 30
  }'
```

---

### 3. Get Supplier Claim Performance Analytics
**GET** `/api/v1/suppliers/:address/claims/performance`

Retrieve daily performance metrics for a specific supplier based on claims.

**URL Parameters:**
- `address` (string, required): Supplier operator address

**Query Parameters:**
- `chain` (string, optional): Filter by chain identifier
- `start_date` (datetime, optional): Filter from this date
- `end_date` (datetime, optional): Filter to this date
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 100): Results per page

**Response Example:**
```json
{
  "data": [
    {
      "supplier_operator_address": "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
      "day_bucket": "2025-09-13T00:00:00Z",
      "unique_applications": 4,
      "unique_services": 4,
      "total_claims": 50,
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
curl "http://localhost:3006/api/v1/suppliers/pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj/claims/performance?start_date=2025-09-01T00:00:00Z"
```

---

### 4. Get Application Claim Usage Analytics
**GET** `/api/v1/applications/:address/claims/usage`

Retrieve daily usage metrics for a specific application based on claims.

**URL Parameters:**
- `address` (string, required): Application address

**Query Parameters:**
- `chain` (string, optional): Filter by chain identifier
- `start_date` (datetime, optional): Filter from this date
- `end_date` (datetime, optional): Filter to this date
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 100): Results per page

**Response Example:**
```json
{
  "data": [
    {
      "application_address": "pokt185tgfw9lxyuznh9rz89556l4p8dshdkjd5283d",
      "day_bucket": "2025-09-13T00:00:00Z",
      "unique_suppliers": 5,
      "unique_services": 3,
      "total_claims": 100,
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
curl "http://localhost:3006/api/v1/applications/pokt185tgfw9lxyuznh9rz89556l4p8dshdkjd5283d/claims/usage?start_date=2025-09-01T00:00:00Z"
```

---

### 5. Get Claims Summary Statistics
**GET** `/api/v1/claims/summary`  
**POST** `/api/v1/claims/summary`

Get aggregated summary statistics for claims.

**GET Query Parameters:**
- `chain` (string, optional): Filter by chain identifier
- `owner_address` (string, optional): Filter by supplier owner address
- `start_date` (datetime, optional): Filter from this date
- `end_date` (datetime, optional): Filter to this date
- `supplier_address` (string, optional): Filter by supplier operator address or owner address (can be comma-separated)
- `application_address` (string, optional): Filter by application
- `service_id` (string, optional): Filter by service
- `status` (string, optional, default: "staked"): Filter by supplier status - "staked", "unstaked", "unstake_requested", or "all"

**POST Request Body:**
- `chain` (string, optional): Filter by chain identifier
- `owner_address` (string, optional): Filter by supplier owner address
- `start_date` (datetime, optional): Filter from this date
- `end_date` (datetime, optional): Filter to this date
- `supplier_address` (string or array, optional): Filter by supplier(s) - can be single string, comma-separated string, or array (matches operator or owner addresses)
- `supplier_addresses` (array of strings, optional): Filter by multiple supplier operator addresses or owner addresses
- `application_address` (string, optional): Filter by application
- `service_id` (string, optional): Filter by service
- `status` (string, optional, default: "staked"): Filter by supplier status - "staked", "unstaked", "unstake_requested", or "all"

**Note:** 
- When using POST, you can provide either `supplier_address` (single, comma-separated, or array) or `supplier_addresses` (array). If both are provided, `supplier_addresses` takes precedence.
- The `supplier_address` parameter can match either operator addresses or owner addresses.
- The `status` parameter filters claims by supplier status. Use "all" to include claims from suppliers with any status.

**Response Example:**
```json
{
  "data": {
    "total_claims": 1234,
    "unique_suppliers": 50,
    "unique_applications": 25,
    "unique_services": 10,
    "total_rewards_upokt": 50000000,
    "total_relays": 300000,
    "total_claimed_compute_units": 7500000000,
    "total_estimated_compute_units": 7500000000,
    "avg_efficiency_percent": 100.00,
    "avg_reward_per_relay": 166.67,
    "first_claim": "2025-09-01T00:00:00Z",
    "last_claim": "2025-09-13T10:21:38Z"
  }
}
```

**Curl Examples:**
```bash
# GET - Get summary for a specific service
curl "http://localhost:3006/api/v1/claims/summary?service_id=eth"

# GET - Get summary filtered by owner address and status
curl "http://localhost:3006/api/v1/claims/summary?owner_address=pokt1abc123&status=staked"

# POST - Get summary for multiple supplier addresses
curl -X POST "http://localhost:3006/api/v1/claims/summary" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_addresses": [
      "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
      "pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj"
    ],
    "service_id": "eth"
  }'

# POST - Get summary filtered by owner address and status
curl -X POST "http://localhost:3006/api/v1/claims/summary" \
  -H "Content-Type: application/json" \
  -d '{
    "owner_address": "pokt1abc123",
    "status": "staked"
  }'
```

---

## Data Fields Explanation

### Core Fields
- `supplier_operator_address`: The Pocket Network supplier that created the claim
- `application_address`: The application that the relays were served for
- `service_id`: The blockchain service ID (e.g., "iotex", "avax", "blast", "fuse", "eth")
- `session_id`: Unique session identifier
- `root_hash`: Merkle root hash for the claim
- `claimed_upokt_amount`: Numeric value of rewards claimed in upokt
- `num_relays`: Number of relays processed in this claim
- `num_claimed_compute_units`: Compute units that were claimed
- `num_estimated_compute_units`: Compute units that were estimated
- `compute_unit_efficiency`: Percentage efficiency (claimed / estimated * 100)
- `reward_per_relay`: Average reward per relay (upokt per relay)
- `claim_proof_status_int`: Status of the claim proof (0 = success, other values indicate different states)

### Rewards Endpoint Fields (Service Aggregated)
- `service_id`: The blockchain service ID
- `chain`: The chain identifier
- `total_claims`: Total number of claims aggregated across the time period
- `total_rewards_upokt`: Total rewards in upokt aggregated across the time period
- `total_relays`: Total number of relays aggregated across the time period
- `total_claimed_compute_units`: Total claimed compute units aggregated across the time period
- `total_estimated_compute_units`: Total estimated compute units aggregated across the time period
- `avg_efficiency_percent`: Weighted average efficiency percentage (calculated from totals, not average of averages)
- `avg_reward_per_relay`: Average reward per relay (calculated as total_rewards_upokt / total_relays)
- `max_reward_per_claim`: Maximum reward per claim in the time period
- `min_reward_per_claim`: Minimum reward per claim in the time period

### Relationship Tracking
These endpoints enable tracking of:
1. **Rewards**: Track how much each supplier earns from claims
2. **Compute Units**: Monitor claimed vs estimated compute units for efficiency analysis
3. **Relays**: Count of relays processed per claim
4. **Relationships**: Links between applications, suppliers, and services
5. **Performance**: Efficiency metrics and reward rates

---

## Use Cases

1. **Service Performance Rankings**: Use `/claims/rewards` with `days` parameter to get top services by total rewards (e.g., `days=30` for last 30 days)
2. **Service Analytics**: Use `/claims/rewards` to compare reward performance across different services, aggregated over time periods
3. **Owner-Filtered Service Analysis**: Use `/claims/rewards` with `owner_address` to see which services generated the most rewards for suppliers owned by a specific owner
4. **Supplier-Filtered Service Analysis**: Use `/claims/rewards` with `supplier_address` or `supplier_addresses` to see which services generated the most rewards for specific suppliers, while still getting service-level aggregation
5. **Supplier Analytics**: Use `/suppliers/:address/claims/performance` for supplier-specific metrics
6. **Application Monitoring**: Use `/applications/:address/claims/usage` to track application activity
7. **Performance Analysis**: Use `compute_unit_efficiency` to monitor system efficiency
8. **Financial Tracking**: Use `total_rewards_upokt` and `avg_reward_per_relay` for financial metrics

---

## Notes

- All datetime fields are in ISO 8601 format (UTC)
- Pagination is supported on all list endpoints
- Filtering by date range is optimized with database indexes
- Computed columns (efficiency, reward_per_relay) are calculated automatically by the database
- Claims represent the initial claim creation, while proof submissions represent the proof submission after claims

