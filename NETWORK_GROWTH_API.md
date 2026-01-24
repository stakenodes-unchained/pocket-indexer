# Network Growth API

## Overview

The Network Growth API exposes pre-aggregated views of Pocket Network growth:

- Distinct first-seen **entities** over a rolling window (applications, suppliers, gateways, services).
- Daily **performance metrics** (relays and compute units) derived from `claim_settlements` and `proof_submissions`.
- A combined legacy endpoint preserved for backward compatibility.

Base URL:

```text
http://localhost:3007
```

Authentication: not required.

## Data Model (Conceptual)

- **Window**: integer number of days.
- **Window Types**:
  - **Summary endpoint** (`/summary`): Uses rolling time window (e.g., `window=1` = last 24 hours from NOW).
  - **Timeline endpoints** (`/performance`, `/entities`, combined): Use calendar day boundaries for bucketing daily data.
- **Day buckets** (for timeline endpoints):
  - Entity endpoints use UTC day boundaries.
  - Performance endpoints use `America/New_York` (EST/EDT) day boundaries.
- **Entities (first-seen)**:
  - Applications: first `pocket.application.MsgStakeApplication`.
  - Suppliers: first `pocket.supplier.MsgStakeSupplier`.
  - Gateways: first `pocket.gateway.MsgStakeGateway`.
  - Services: first `pocket.service.MsgAddService` per `service_id`.
- **Performance metrics**:
  - `proof_events` (event_type='created'):
    - `num_relays`
    - `num_claimed_compute_units`
    - `num_estimated_compute_units`

## Endpoints

### 1. Network Growth (Window Summary)

**Endpoint:** `GET /api/v1/network-growth/summary`

**Description:** Returns aggregate counts for the selected rolling window (no per-day breakdown). For example, `window=1` returns data from the last 24 hours.

**Query Parameters:**
- `window` (optional, integer days): Number of days for rolling window from NOW (e.g., `window=1` = last 24 hours). Default `7`. Max `365`.
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
    "claimed_compute_units": 120000000000,
    "estimated_compute_units": 125000000000
  }
}
```

**Notes:**
- `applications`, `suppliers`, `gateways`, `services`:
  - Distinct entities whose first `stake`/`add-service` event falls within the window (rolling time window).
- `relays`, `claimed_compute_units`, `estimated_compute_units`:
  - Summed from `proof_events` (event_type='created') over the window (rolling time window from NOW - N days).

### 2. Network Growth Performance (Daily Time Series, Fast)

**Endpoint:** `GET /api/v1/network-growth/performance`

**Description:** Returns a per-day time series over the selected window for relays and compute units from `proof_events`. This is the preferred endpoint for performance dashboards.

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
        "claimed_compute_units": 120000000000,
        "estimated_compute_units": 125000000000
      }
      // ... one object per day in ascending order
    ]
  }
}
```

**Notes:**
- `relays`, `claimed_compute_units`, `estimated_compute_units`:
  - All metrics aggregated from `proof_events` table where `event_type = 'created'`.
  - Data is joined with `blocks` table to get accurate timestamp information.
- Uses `America/New_York` time zone for day boundaries.
- Recommended for clients that need performance metrics with compute unit breakdown.

### 3. Network Growth Entities (Daily Time Series)

**Endpoint:** `GET /api/v1/network-growth/entities`

**Description:** Returns a per-day time series over the selected window for newly created entities (applications, suppliers, gateways, services) only. This endpoint parses transaction messages to count first-seen entities per day.

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
- Counts are “first-seen” per entity across the chain, then bucketed by the first day they appear.
- Parses `tx_data` messages in `transactions`, so it is slower than `/performance`.
- Use this when you only need entity statistics without relay/compute‑unit metrics.

### 4. Network Growth (Daily Time Series - Combined)

**Endpoint:** `GET /api/v1/network-growth`

**Description:** Returns a per-day time series over the selected window combining both performance metrics (relays, compute units) and entity statistics (applications, suppliers, gateways, services). This endpoint is slower than using the separate endpoints but is preserved for backward compatibility.

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
        "claimed_compute_units": 120000000000,
        "estimated_compute_units": 125000000000
      }
      // ... one object per day in ascending order
    ]
  }
}
```

**Notes:**
- Entity counts match `/entities` semantics.
- Relays and compute units match `/performance` semantics (using `proof_events`).
- For new clients, prefer `/performance` + `/entities` to reduce load and improve responsiveness.

## Example Usage

Basic cURL examples (replace `chain` as needed):

- Window summary (7‑day default):

```bash
curl "http://localhost:3007/api/v1/network-growth/summary?chain=pokt-mainnet"
```

- Performance time series (30‑day window):

```bash
curl "http://localhost:3007/api/v1/network-growth/performance?chain=pokt-mainnet&window=30"
```

- Entity growth time series:

```bash
curl "http://localhost:3007/api/v1/network-growth/entities?chain=pokt-mainnet&window=30"
```

## Limitations & Caveats

- Historical backfills and re-indexing:
  - When new historical data is ingested, entity “first‑seen” dates may shift earlier.
  - Dashboards should handle non‑monotonic changes in historical series.
- Timezone differences:
  - Entities use UTC days; performance endpoints use New York time.
  - If you combine data across endpoints, be aware of bucket boundary differences.
- Chain filter:
  - If `chain` is omitted, results are aggregated across all chains in the underlying tables.

## Notes for Future Maintainers

- Implementation lives in `server/api-server.js` under the `/api/v1/network-growth*` routes.
- Entity calculations rely on decoded `tx_data` messages in `transactions`; if message formats change, update the message type filters and projection logic.
- Performance calculations rely on `proof_events` table (filtered by `event_type = 'created'`) joined with `blocks` for timestamp information; schema changes there should be mirrored in both the SQL queries and this documentation.
