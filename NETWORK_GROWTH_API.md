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
### 1. Network Growth (Window Summary)

**Endpoint:** `GET /api/v1/network-growth/summary`

**Description:** Returns aggregate counts for the selected window (no per-day breakdown).

**Query Parameters:**
- `window` (optional, integer days): Number of days to include ending today. Default `7`. Max `365`.
- `chain` (optional): Filter by chain (e.g., `pokt-mainnet`).

**Response:**
```json
{
  "data": {
    "window_days": 7,
    "applications": 10,
    "suppliers": 5,
    "gateways": 3,
    "services": 4,
    "relays": 654321,
    "compute_units": 210987
  }
}
```

**Notes:**
- Entity counts are distinct first-seen entities during the window.
- Relays and compute units are summed over the window.


### 2. Network Growth Performance (Daily Time Series - Fast)

**Endpoint:** `GET /api/v1/network-growth/performance`

**Description:** Returns a per-day time series over the selected window for relays, compute units, and detailed compute unit metrics from proof-submissions and settled claims. This is a fast endpoint that queries from `claim_settlements` and `proof_submissions` tables.

**Query Parameters:**
- `window` (optional, integer days): Number of days to include ending today. Default `7`. Max `365`.
- `chain` (optional): Filter by chain (e.g., `pokt-mainnet`).

**Response:**
```json
{
  "data": {
    "window_days": 7,
    "timeline": [
      {
        "day": "2025-11-01",
        "relays": 1234567890,
        "compute_units": 126000000000,
        "proof_submissions_computed_units": 120000000000,
        "proof_submissions_estimated_units": 125000000000,
        "settled_claims_computed_units": 6000000000,
        "settled_claims_estimated_units": 6100000000
      }
      // ... one object per day in ascending order
    ]
  }
}
```

**Notes:**
- This endpoint is optimized for performance and returns relays, compute units, and detailed compute unit metrics.
- `relays` and `compute_units` come from all claim settlements in the `claim_settlements` table.
- `proof_submissions_computed_units` and `proof_submissions_estimated_units` come from the `proof_submissions` table.
- `settled_claims_computed_units` and `settled_claims_estimated_units` come from settled claims (where `settlement_type = 'settled'`) in the `claim_settlements` table.
- Uses EST/EDT timezone for day boundaries.
- Recommended for clients that need performance metrics with detailed compute unit breakdowns.

### 3. Network Growth Entities (Daily Time Series)

**Endpoint:** `GET /api/v1/network-growth/entities`

**Description:** Returns a per-day time series over the selected window for newly created entities (applications, suppliers, gateways, services) only. This endpoint parses transaction messages to count first-seen entities.

**Query Parameters:**
- `window` (optional, integer days): Number of days to include ending today. Default `7`. Max `365`.
- `chain` (optional): Filter by chain (e.g., `pokt-mainnet`).

**Response:**
```json
{
  "data": {
    "window_days": 7,
    "timeline": [
      {
        "day": "2025-11-01",
        "applications": 2,
        "suppliers": 1,
        "gateways": 0,
        "services": 1
      }
      // ... one object per day in ascending order
    ]
  }
}
```

**Notes:**
- Entity counts are "first-seen" per entity within the window (stake/add-service messages).
- This endpoint is slower than the performance endpoint as it requires parsing transaction messages.
- Recommended for clients that only need entity statistics.

### 4. Network Growth (Daily Time Series - Combined)

**Endpoint:** `GET /api/v1/network-growth`

**Description:** Returns a per-day time series over the selected window combining both performance metrics (relays, compute units) and entity statistics (applications, suppliers, gateways, services). This endpoint is kept for backward compatibility but is slower than using the separate endpoints.

**Query Parameters:**
- `window` (optional, integer days): Number of days to include ending today. Default `7`. Max `365`.
- `chain` (optional): Filter by chain (e.g., `pokt-mainnet`).

**Response:**
```json
{
  "data": {
    "window_days": 7,
    "timeline": [
      {
        "day": "2025-11-01",
        "applications": 2,
        "suppliers": 1,
        "gateways": 0,
        "services": 1,
        "relays": 123456,
        "compute_units": 789012
      }
      // ... one object per day in ascending order
    ]
  }
}
```

**Notes:**
- Entity counts are "first-seen" per entity within the window (stake/add-service messages).
- Relays and compute units come from settled claims in the `claim_settlements` table.
- **Performance Note:** This endpoint combines both fast and slow queries. For better performance, consider using `/api/v1/network-growth/performance` and `/api/v1/network-growth/entities` separately.
- Kept for backward compatibility with existing clients.

