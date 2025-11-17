# API Updates Documentation

This document describes the recent updates to the Pocket Network Indexer API endpoints. These updates add new aggregate statistics, pagination support, and additional metadata to various endpoints for enhanced frontend integration.

## Table of Contents

1. [Blocks Endpoint](#blocks-endpoint)
2. [Transactions Endpoint](#transactions-endpoint)
3. [Applications Endpoint](#applications-endpoint)
4. [Suppliers Endpoint](#suppliers-endpoint)
5. [Services - Top by Performance](#services-top-by-performance)
6. [Services - Top by Compute Units](#services-top-by-compute-units)

---

## Blocks Endpoint

### GET /api/v1/blocks

Retrieve blocks with pagination and optional filters. **NEW:** Returns average block production time and average block size when a chain parameter is provided.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chain` | string | No | - | Filter by chain identifier (e.g., "mainnet", "testnet") |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 100 | Number of results per page (max: 1000) |
| `start_height` | integer | No | - | Filter blocks from this height onwards |
| `end_height` | integer | No | - | Filter blocks up to this height |
| `start_date` | datetime | No | - | Filter blocks from this timestamp onwards |
| `end_date` | datetime | No | - | Filter blocks up to this timestamp |
| `skip_count` | boolean | No | false | Skip total count query for faster responses |

#### Response Format

```json
{
  "data": [
    {
      "id": "mainnet:ABC123...",
      "height": 482817,
      "hash": "ABC123DEF456...",
      "timestamp": "2025-01-27T10:30:00Z",
      "proposer": "pokt1abc...",
      "chain": "mainnet",
      "raw_block_size": 45678,
      "block_production_time": 15.234,
      "transaction_count": 42
    }
  ],
  "meta": {
    "total": 1000,
    "page": 1,
    "limit": 100,
    "totalPages": 10,
    "avgBlockProductionTime": 15.234,
    "avgBlockSize": 45678
  }
}
```

#### New Meta Fields

- **`avgBlockProductionTime`** (number, optional): Average block production time in seconds for the chain. Only included if `chain` parameter is provided.
- **`avgBlockSize`** (integer, optional): Average block size in bytes for the chain. Only included if `chain` parameter is provided.

#### Example Requests

```bash
# Get blocks with chain statistics
GET /api/v1/blocks?chain=mainnet&page=1&limit=50

# Get blocks without chain (no averages returned)
GET /api/v1/blocks?page=1&limit=100
```

#### Frontend Usage

```javascript
// Fetch blocks with chain statistics for stat cards
async function fetchBlocksWithStats(chain) {
  const response = await fetch(`/api/v1/blocks?chain=${chain}&page=1&limit=100`);
  const data = await response.json();
  
  // Display in stat cards
  console.log('Avg Block Time:', data.meta.avgBlockProductionTime, 'seconds');
  console.log('Avg Block Size:', data.meta.avgBlockSize, 'bytes');
  
  return data;
}
```

---

## Transactions Endpoint

### GET /api/v1/transactions
### POST /api/v1/transactions

Retrieve transactions with comprehensive filtering, sorting, and pagination. **NEW:** Returns count of failed transactions in the last 24 hours.

#### Query Parameters (GET) / Body Parameters (POST)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `address` or `addresses` | string\|array | No | - | Single address, comma-separated addresses, or array of addresses |
| `type` | string | No | - | Filter by transaction type |
| `status` | string | No | - | Filter by transaction status (e.g., 'success', 'failed') |
| `chain` | string | No | - | Filter by chain identifier |
| `start_date` | string | No | - | ISO date string - filter transactions from this date onwards |
| `end_date` | string | No | - | ISO date string - filter transactions up to this date |
| `min_amount` | number | No | - | Minimum transaction amount filter |
| `max_amount` | number | No | - | Maximum transaction amount filter |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 10 | Number of results per page (max: 1000) |
| `sort_by` | string | No | 'timestamp' | Field to sort by (timestamp, amount, fee, block_height, type, status) |
| `sort_order` | string | No | 'desc' | Sort order (asc, desc) |

#### Response Format

```json
{
  "data": [
    {
      "id": "tx_hash_123",
      "hash": "ABC123...",
      "block_id": "mainnet:block_123",
      "sender": "pokt1abc...",
      "recipient": "pokt1xyz...",
      "amount": 1000.5,
      "fee": 0.01,
      "memo": "Payment",
      "type": "send",
      "status": "success",
      "chain": "mainnet",
      "timestamp": "2025-01-27T10:30:00Z",
      "block_height": 482817
    }
  ],
  "meta": {
    "total": 5000,
    "page": 1,
    "limit": 10,
    "totalPages": 500,
    "has_more": true,
    "failedLast24h": 42
  }
}
```

#### New Meta Fields

- **`failedLast24h`** (integer): Number of failed transactions in the last 24 hours. This count is independent of current filters and shows the total across all transactions.

#### Example Requests

```bash
# GET request
GET /api/v1/transactions?chain=mainnet&page=1&limit=20&status=success

# POST request (recommended for multiple addresses)
POST /api/v1/transactions
Content-Type: application/json

{
  "addresses": ["pokt1abc...", "pokt1xyz..."],
  "chain": "mainnet",
  "page": 1,
  "limit": 50
}
```

#### Frontend Usage

```javascript
// Fetch transactions with failed count for dashboard
async function fetchTransactions(filters) {
  const response = await fetch('/api/v1/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters)
  });
  const data = await response.json();
  
  // Display failed transactions count in stat card
  console.log('Failed TXs (24h):', data.meta.failedLast24h);
  
  return data;
}
```

---

## Applications Endpoint

### GET /api/v1/applications

Retrieve applications with pagination and optional filters. **NEW:** Returns aggregate statistics including total staked amount, unstaking count, and total unstaking tokens.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chain` | string | No | - | Filter by chain identifier |
| `status` | string | No | - | Filter by application status |
| `address` | string | No | - | Filter by application address |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 25 | Number of results per page |

#### Response Format

```json
{
  "data": [
    {
      "address": "pokt1app123...",
      "chain": "mainnet",
      "staked_amount": 15000.5,
      "stake_denom": "upokt",
      "status": "staked",
      "chains": ["mainnet", "testnet"],
      "delegated": false,
      "gateway_address": null,
      "delegatee_gateway_addresses": [],
      "unstake_session_end_height": null,
      "last_seen": "2025-01-27T10:30:00Z"
    }
  ],
  "meta": {
    "total": 1000,
    "page": 1,
    "limit": 25,
    "totalPages": 40,
    "totalStakedAmount": 1234567890.5,
    "unstakingCount": 15,
    "totalUnstakingTokens": 500000.0
  }
}
```

#### New Meta Fields

- **`totalStakedAmount`** (number): Total staked amount for all applications (excluding unstaking ones). Respects current filters.
- **`unstakingCount`** (integer): Number of applications currently unstaking (where `unstake_session_end_height IS NOT NULL`). Respects current filters.
- **`totalUnstakingTokens`** (number): Total amount of tokens being unstaked. Respects current filters.

#### Example Requests

```bash
# Get all applications with statistics
GET /api/v1/applications?page=1&limit=25

# Filter by chain
GET /api/v1/applications?chain=mainnet&page=1&limit=50

# Filter by status
GET /api/v1/applications?status=staked&page=1&limit=25
```

#### Frontend Usage

```javascript
// Fetch applications with aggregate statistics for stat cards
async function fetchApplications(filters) {
  const response = await fetch(`/api/v1/applications?${new URLSearchParams(filters)}`);
  const data = await response.json();
  
  // Display in stat cards
  console.log('Total Staked:', data.meta.totalStakedAmount);
  console.log('Unstaking Apps:', data.meta.unstakingCount);
  console.log('Unstaking Tokens:', data.meta.totalUnstakingTokens);
  
  return data;
}
```

---

## Suppliers Endpoint

### GET /api/v1/suppliers

Retrieve suppliers with pagination and optional filters. **NEW:** Returns aggregate statistics including total staked tokens, unstaking count, and total unstaking tokens.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chain` | string | No | - | Filter by chain identifier |
| `status` | string | No | - | Filter by supplier status |
| `address` | string | No | - | Filter by supplier address |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 25 | Number of results per page |

#### Response Format

```json
{
  "data": [
    {
      "address": "poktvaloper1supplier123...",
      "chain": "mainnet",
      "staked_amount": 50000.0,
      "stake_denom": "upokt",
      "status": "staked",
      "last_seen": "2025-01-27T10:30:00Z",
      "unstake_session_end_height": null
    }
  ],
  "meta": {
    "total": 500,
    "page": 1,
    "limit": 25,
    "totalPages": 20,
    "totalStakedTokens": 9876543210.0,
    "unstakingCount": 8,
    "totalUnstakingTokens": 250000.0
  }
}
```

#### New Meta Fields

- **`totalStakedTokens`** (number): Total staked tokens for all suppliers (excluding unstaking ones). Respects current filters.
- **`unstakingCount`** (integer): Number of suppliers currently unstaking (where `unstake_session_end_height IS NOT NULL`). Respects current filters.
- **`totalUnstakingTokens`** (number): Total amount of tokens being unstaked. Respects current filters.

#### Example Requests

```bash
# Get all suppliers with statistics
GET /api/v1/suppliers?page=1&limit=25

# Filter by chain
GET /api/v1/suppliers?chain=mainnet&page=1&limit=50
```

#### Frontend Usage

```javascript
// Fetch suppliers with aggregate statistics for stat cards
async function fetchSuppliers(filters) {
  const response = await fetch(`/api/v1/suppliers?${new URLSearchParams(filters)}`);
  const data = await response.json();
  
  // Display in stat cards
  console.log('Total Staked Tokens:', data.meta.totalStakedTokens);
  console.log('Unstaking Suppliers:', data.meta.unstakingCount);
  console.log('Unstaking Tokens:', data.meta.totalUnstakingTokens);
  
  return data;
}
```

---

## Services - Top by Performance

### GET /api/v1/services/top-by-performance
### POST /api/v1/services/top-by-performance

Returns services by compute units with percentage distribution and pagination. **UPDATED:** Now supports full pagination instead of fixed limit of 10.

#### Query Parameters (GET) / Body Parameters (POST)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chain` | string | No | - | Optional chain filter (e.g., "mainnet", "testnet") |
| `days` | string | No | '30' | Time period in days (7, 15, or 30) |
| `supplier_address` | string\|array | No | - | Optional supplier operator address filter (single or comma-separated) |
| `owner_address` | string | No | - | Optional owner address filter (filters by supplier owner address) |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 10 | Number of results per page (max: 1000) |

#### Response Format

```json
{
  "data": [
    {
      "rank": 1,
      "service_id": "0001",
      "chain": "mainnet",
      "total_claimed_compute_units": 5000000,
      "total_estimated_compute_units": 4800000,
      "submission_count": 1250,
      "avg_efficiency_percent": 96.5,
      "percentage_of_total": 25.5,
      "period_start": "2025-01-01T00:00:00Z",
      "period_end": "2025-01-30T23:59:59Z"
    }
  ],
  "total_compute_units": 19607843,
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 10,
    "totalPages": 15,
    "days": 30,
    "chain": "mainnet",
    "period_start": "2025-01-01T00:00:00Z",
    "period_end": "2025-01-30T23:59:59Z"
  }
}
```

#### New Meta Fields

- **`total`** (integer): Total number of services matching the filters
- **`page`** (integer): Current page number
- **`limit`** (integer): Number of results per page
- **`totalPages`** (integer): Total number of pages

**Note:** The `rank` field in data items represents the global rank (not page-based), calculated as `offset + index + 1`.

#### Example Requests

```bash
# GET request with pagination
GET /api/v1/services/top-by-performance?chain=mainnet&days=15&page=1&limit=20

# POST request (recommended for multiple supplier addresses)
POST /api/v1/services/top-by-performance
Content-Type: application/json

{
  "chain": "mainnet",
  "days": "30",
  "supplier_address": ["poktvaloper1abc...", "poktvaloper1xyz..."],
  "page": 2,
  "limit": 25
}
```

#### Frontend Usage

```javascript
// Fetch top services with pagination
async function fetchTopServicesByPerformance(filters) {
  const response = await fetch('/api/v1/services/top-by-performance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters)
  });
  const data = await response.json();
  
  // Display services with pagination
  console.log(`Page ${data.meta.page} of ${data.meta.totalPages}`);
  console.log(`Total services: ${data.meta.total}`);
  
  return data;
}
```

---

## Services - Top by Compute Units

### GET /api/v1/services/top-by-compute-units
### POST /api/v1/services/top-by-compute-units

Returns services by total compute units for the specified time period with pagination. **UPDATED:** Now supports full pagination instead of fixed limits (5, 10, 25, 50).

#### Query Parameters (GET) / Body Parameters (POST)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `days` | string | No | '30' | Time period in days (7, 15, or 30) |
| `chain` | string | No | - | Optional chain filter (e.g., "mainnet", "testnet") |
| `supplier_address` | string\|array | No | - | Optional supplier operator address filter (single or comma-separated) |
| `owner_address` | string | No | - | Optional owner address filter (filters by supplier owner address) |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 10 | Number of results per page (max: 1000) |

#### Response Format

```json
{
  "data": [
    {
      "service_id": "0001",
      "chain": "mainnet",
      "total_claimed_compute_units": 5000000,
      "total_estimated_compute_units": 4800000,
      "submission_count": 1250,
      "avg_efficiency_percent": 96.5,
      "period_start": "2025-01-01T00:00:00Z",
      "period_end": "2025-01-30T23:59:59Z"
    }
  ],
  "meta": {
    "total": 200,
    "page": 1,
    "limit": 10,
    "totalPages": 20,
    "days": 30,
    "chain": "mainnet",
    "period_start": "2025-01-01T00:00:00Z",
    "period_end": "2025-01-30T23:59:59Z"
  }
}
```

#### New Meta Fields

- **`total`** (integer): Total number of services matching the filters
- **`page`** (integer): Current page number
- **`limit`** (integer): Number of results per page
- **`totalPages`** (integer): Total number of pages

#### Example Requests

```bash
# GET request with pagination
GET /api/v1/services/top-by-compute-units?page=1&limit=25&days=7&chain=mainnet

# POST request
POST /api/v1/services/top-by-compute-units
Content-Type: application/json

{
  "days": "30",
  "supplier_address": "poktvaloper1abc...",
  "page": 2,
  "limit": 50
}
```

#### Frontend Usage

```javascript
// Fetch top services by compute units with pagination
async function fetchTopServicesByComputeUnits(filters) {
  const response = await fetch('/api/v1/services/top-by-compute-units', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters)
  });
  const data = await response.json();
  
  // Display services with pagination
  console.log(`Page ${data.meta.page} of ${data.meta.totalPages}`);
  console.log(`Total services: ${data.meta.total}`);
  
  return data;
}
```

---

## Summary of Changes

### New Features Added

1. **Blocks Endpoint**
   - Average block production time (when chain is provided)
   - Average block size (when chain is provided)

2. **Transactions Endpoint**
   - Failed transactions count in last 24 hours

3. **Applications Endpoint**
   - Total staked amount
   - Unstaking applications count
   - Total unstaking tokens

4. **Suppliers Endpoint**
   - Total staked tokens
   - Unstaking suppliers count
   - Total unstaking tokens

5. **Services - Top by Performance**
   - Full pagination support (replaces fixed limit of 10)
   - Global ranking system

6. **Services - Top by Compute Units**
   - Full pagination support (replaces fixed limits of 5, 10, 25, 50)

### Performance Considerations

- All aggregate queries run in parallel with main queries for optimal performance
- Statistics respect the same filters as the main query (where applicable)
- Failed transactions count is independent of filters for dashboard consistency

### Backward Compatibility

All changes are backward compatible:
- New fields are added to the `meta` object without breaking existing structure
- Default values maintain previous behavior
- Optional fields are only included when relevant (e.g., block averages only with chain parameter)

---

## Error Handling

All endpoints return standard HTTP status codes:

- `200`: Success
- `400`: Bad request (invalid parameters)
- `500`: Server error

Error responses follow this format:

```json
{
  "error": "Error message description"
}
```

---

## Rate Limiting

Currently, there are no rate limits enforced. However, it's recommended to:
- Use pagination appropriately (limit values)
- Cache responses when possible
- Use POST method for complex queries with many addresses

---

## Support

For issues or questions about these API endpoints, please refer to the main project documentation or contact the development team.

