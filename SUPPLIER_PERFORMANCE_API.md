# Supplier Performance API - Frontend Integration Guide

## Table of Contents

1. [Overview](#overview)
2. [API Endpoints](#api-endpoints)
3. [Request/Response Schemas](#requestresponse-schemas)
4. [Integration Patterns](#integration-patterns)
5. [UI/UX Recommendations](#uiux-recommendations)
6. [Example Code Snippets](#example-code-snippets)
7. [Error Handling](#error-handling)
8. [Performance Optimization](#performance-optimization)
9. [Data Visualization Guidelines](#data-visualization-guidelines)
10. [Testing Checklist](#testing-checklist)

---

## Overview

The Supplier Performance API provides comprehensive metrics for tracking supplier performance in terms of relays, compute units, rewards, and efficiency. Data is aggregated from claims (EventClaimCreated events) and enriched with supplier metadata.

### Key Concepts

- **Suppliers**: Service providers identified by `operator_address` (pokt1...)
- **Owner Address**: The owner of a supplier, used for grouping suppliers under the same entity
- **Supplier Operator Address**: The operator address that actually created claims
- **Claims**: Source of truth for supplier performance metrics (EventClaimCreated events)
- **Grouping**: Data can be aggregated by day, hour, or total (all time)

### Base URL

```
http://localhost:3006/api/v1
```

---

## API Endpoints

### 1. Supplier Performance List/Leaderboard

**GET** `/api/v1/suppliers/performance`

Retrieve performance metrics for suppliers with flexible filtering and grouping options.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `owner_address` | string | No | - | Filter by supplier owner address |
| `supplier_address` | string | No | - | Filter by supplier operator address (can be comma-separated) |
| `chain` | string | No | - | Filter by blockchain chain identifier |
| `service_id` | string | No | - | Filter by service ID |
| `start_date` | ISO 8601 | No | - | Start timestamp (e.g., "2025-10-01T00:00:00Z") |
| `end_date` | ISO 8601 | No | - | End timestamp (e.g., "2025-10-31T23:59:59Z") |
| `group_by` | enum | No | "day" | Grouping: "day", "hour", or "total" |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 100 | Results per page |

#### Response Schema

```typescript
interface SupplierPerformanceResponse {
  data: SupplierPerformanceRow[];
  meta: PaginationMeta;
}

interface SupplierPerformanceRow {
  bucket: string | null;                    // ISO timestamp for day/hour, null for total
  supplier_operator_address: string;         // pokt1... address
  owner_address: string | null;             // Owner address if available
  total_claims: number;                       // Number of claims
  total_relays: number;                      // Total relays processed
  total_claimed_compute_units: number;       // Total claimed compute units
  total_estimated_compute_units: number;     // Total estimated compute units
  avg_efficiency_percent: number | null;    // Average efficiency percentage
  avg_reward_per_relay: number | null;      // Average reward per relay (upokt)
  unique_applications: number;               // Count of distinct applications served
  unique_services: number;                   // Count of distinct services
}

interface PaginationMeta {
  total: number;                            // Total number of results
  page: number;                             // Current page number
  limit: number;                             // Results per page
  totalPages: number;                       // Total number of pages
}
```

#### Example Request

```bash
GET /api/v1/suppliers/performance?owner_address=pokt1abc123&group_by=day&start_date=2025-10-01T00:00:00Z&limit=50
```

#### Example Response

```json
{
  "data": [
    {
      "bucket": "2025-10-15T00:00:00Z",
      "supplier_operator_address": "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
      "owner_address": "pokt1abc123...",
      "total_claims": 245,
      "total_relays": 1250000,
      "total_claimed_compute_units": 125000000,
      "total_estimated_compute_units": 125000000,
      "avg_efficiency_percent": 100.00,
      "avg_reward_per_relay": 166.67,
      "unique_applications": 15,
      "unique_services": 8
    }
  ],
  "meta": {
    "total": 150,
    "page": 1,
    "limit": 50,
    "totalPages": 3
  }
}
```

---

### 2. Supplier Detail Performance

**GET** `/api/v1/suppliers/:operator_address/performance`

Retrieve detailed performance metrics for a specific supplier operator address.

#### URL Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `operator_address` | string | Yes | Supplier operator address (pokt1...) |

#### Query Parameters

Same as endpoint #1, except `owner_address` and `supplier_address` are not applicable (already scoped by `operator_address`).

#### Response Schema

```typescript
interface SupplierDetailResponse {
  data: SupplierPerformanceRow[];
  supplier: SupplierMetadata | null;
  meta: PaginationMeta;
}

interface SupplierMetadata {
  address: string;
  chain: string;
  owner_address: string | null;
  staked_amount: string;
  status: string;
  last_seen: string;
}
```

#### Example Request

```bash
GET /api/v1/suppliers/pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj/performance?group_by=hour&start_date=2025-10-31T00:00:00Z
```

#### Example Response

```json
{
  "data": [
    {
      "bucket": "2025-10-31T14:00:00Z",
      "supplier_operator_address": "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
      "total_claims": 12,
      "total_relays": 60000,
      "total_claimed_compute_units": 6000000,
      "total_estimated_compute_units": 6000000,
      "avg_efficiency_percent": 100.00,
      "avg_reward_per_relay": 166.67,
      "unique_applications": 8,
      "unique_services": 5
    }
  ],
  "supplier": {
    "address": "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
    "chain": "pocket-mainnet",
    "owner_address": "pokt1abc123...",
    "staked_amount": "1000000000",
    "status": "staked",
    "last_seen": "2025-10-31T14:30:00Z"
  },
  "meta": {
    "total": 24,
    "page": 1,
    "limit": 100,
    "totalPages": 1
  }
}
```

---

### 2b. Supplier Performance (POST - Multiple Suppliers)

**POST** `/api/v1/suppliers/performance`

Retrieve detailed performance metrics for multiple supplier operator addresses. This endpoint is useful when you need to fetch performance data for multiple suppliers in a single request, avoiding URL length limitations.

#### Request Body Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `operator_addresses` | array of strings | Yes | - | Array of supplier operator addresses (pokt1...) |
| `chain` | string | No | - | Filter by blockchain chain identifier |
| `service_id` | string | No | - | Filter by service ID |
| `start_date` | ISO 8601 | No | - | Start timestamp (e.g., "2025-10-01T00:00:00Z") |
| `end_date` | ISO 8601 | No | - | End timestamp (e.g., "2025-10-31T23:59:59Z") |
| `group_by` | enum | No | "day" | Grouping: "day", "hour", or "total" |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 100 | Results per page |

#### Response Schema

```typescript
interface SupplierDetailPostResponse {
  data: SupplierPerformanceRow[];
  meta: PaginationMeta;
}
```

#### Example Request

```bash
POST /api/v1/suppliers/performance
Content-Type: application/json

{
  "supplier_address": [
    "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
    "pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj"
  ],
  "chain": "pocket-mainnet",
  "group_by": "day",
  "start_date": "2025-10-01T00:00:00Z",
  "end_date": "2025-10-31T23:59:59Z",
  "limit": 100
}
```

#### Example Response

```json
{
  "data": [
    {
      "bucket": "2025-10-15T00:00:00Z",
      "supplier_operator_address": "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
      "total_claims": 245,
      "total_relays": 1250000,
      "total_claimed_compute_units": 125000000,
      "total_estimated_compute_units": 125000000,
      "avg_efficiency_percent": 100.00,
      "avg_reward_per_relay": 166.67,
      "unique_applications": 15,
      "unique_services": 8
    },
    {
      "bucket": "2025-10-15T00:00:00Z",
      "supplier_operator_address": "pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj",
      "total_claims": 180,
      "total_relays": 900000,
      "total_claimed_compute_units": 90000000,
      "total_estimated_compute_units": 95000000,
      "avg_efficiency_percent": 94.74,
      "avg_reward_per_relay": 155.56,
      "unique_applications": 12,
      "unique_services": 6
    }
  ],
  "meta": {
    "total": 60,
    "page": 1,
    "limit": 100,
    "totalPages": 1
  }
}
```

#### Curl Example

```bash
curl -X POST "http://localhost:3006/api/v1/suppliers/performance" \
  -H "Content-Type: application/json" \
  -d '{
    "supplier_address": [
      "pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj",
      "pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj"
    ],
    "chain": "pocket-mainnet",
    "group_by": "day",
    "start_date": "2025-10-01T00:00:00Z",
    "end_date": "2025-10-31T23:59:59Z"
  }'
```

#### When to Use POST vs GET

- **Use GET** `/api/v1/suppliers/:operator_address/performance` when:
  - You need performance data for a single supplier
  - You want a simpler request (no request body needed)
  - The supplier address fits comfortably in the URL

- **Use POST** `/api/v1/suppliers/performance` when:
  - You need performance data for multiple suppliers (2+)
  - You want to avoid URL length limitations
  - You're building a comparison view or batch processing

---

### 3. Owner Leaderboard

**GET** `/api/v1/suppliers/owners`

Retrieve aggregated performance metrics grouped by supplier owner address.

#### Query Parameters

Same as endpoint #1, except `owner_address` and `supplier_address` are not applicable (owner is the grouping dimension).

#### Response Schema

```typescript
interface OwnerLeaderboardResponse {
  data: OwnerPerformanceRow[];
  meta: PaginationMeta;
}

interface OwnerPerformanceRow {
  owner_address: string | null;             // Owner address or null
  supplier_count: number;                   // Number of distinct suppliers owned
  total_claims: number;                     // Total claims across all suppliers
  total_relays: number;                     // Total relays across all suppliers
  total_claimed_compute_units: number;      // Total claimed compute units
  total_estimated_compute_units: number;    // Total estimated compute units
  avg_efficiency_percent: number | null;    // Average efficiency
}
```

#### Example Request

```bash
GET /api/v1/suppliers/owners?chain=pocket-mainnet&limit=50
```

#### Example Response

```json
{
  "data": [
    {
      "owner_address": "pokt1abc123def456...",
      "supplier_count": 3,
      "total_claims": 500,
      "total_relays": 25000000,
      "total_claimed_compute_units": 2500000000,
      "total_estimated_compute_units": 2500000000,
      "avg_efficiency_percent": 100.00
    }
  ],
  "meta": {
    "total": 120,
    "page": 1,
    "limit": 50,
    "totalPages": 3
  }
}
```

---

## Integration Patterns

### 1. Dashboard Overview

For a dashboard showing top suppliers, use the performance endpoint with `group_by=total`:

```typescript
// Fetch top 10 suppliers by relays
const response = await fetch(
  '/api/v1/suppliers/performance?group_by=total&limit=10&page=1'
);
const { data, meta } = await response.json();
```

### 2. Time Series Charts

For line/area charts showing trends over time:

```typescript
// Daily aggregation for last 30 days
const endDate = new Date();
const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

const response = await fetch(
  `/api/v1/suppliers/performance?` +
  `group_by=day&` +
  `start_date=${startDate.toISOString()}&` +
  `end_date=${endDate.toISOString()}&` +
  `limit=1000`
);
const { data } = await response.json();

// Sort by bucket (date) for charting
const sortedData = data.sort((a, b) => 
  new Date(a.bucket) - new Date(b.bucket)
);
```

### 3. Filter by Owner

Populate filter dropdowns using the owner leaderboard endpoint:

```typescript
// Fetch top owners for owner filter
const ownersResponse = await fetch(
  '/api/v1/suppliers/owners?limit=100'
);
const { data: owners } = await ownersResponse.json();

// Use in dropdown
const ownerOptions = owners.map(o => ({
  value: o.owner_address,
  label: o.owner_address || 'Unknown',
  count: o.supplier_count
}));
```

### 4. Detail Page

For a supplier detail page:

```typescript
// Fetch supplier detail with hourly breakdown (single supplier)
const operatorAddress = 'pokt1...';
const response = await fetch(
  `/api/v1/suppliers/${operatorAddress}/performance?` +
  `group_by=hour&` +
  `start_date=${startDate.toISOString()}`
);
const { data, supplier, meta } = await response.json();
```

### 4b. Multiple Supplier Comparison

For comparing multiple suppliers:

```typescript
// Fetch performance for multiple suppliers using POST
const supplierAddresses = [
  'pokt1q9nzr2fa33yy0vux5gpv6qxk79umfcvwxrv2qj',
  'pokt1xqaeh4zg6tnqzz0elzt4ka2yua2p29wa660yhj'
];

const response = await fetch('/api/v1/suppliers/performance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    supplier_address: supplierAddresses,
    chain: 'pocket-mainnet',
    group_by: 'day',
    start_date: startDate.toISOString(),
    end_date: endDate.toISOString()
  })
});

const { data, meta } = await response.json();

// Group data by supplier for comparison
const bySupplier = data.reduce((acc, row) => {
  if (!acc[row.supplier_operator_address]) {
    acc[row.supplier_operator_address] = [];
  }
  acc[row.supplier_operator_address].push(row);
  return acc;
}, {});
```

---

## UI/UX Recommendations

### 1. Filter UI Layout

```
┌─────────────────────────────────────────────────┐
│ Supplier Performance Dashboard                 │
├─────────────────────────────────────────────────┤
│ Filters:                                        │
│  Owner: [Input]     Supplier: [Input]           │
│  Chain: [Dropdown ▼]  Service: [Dropdown ▼]    │
│  Date Range: [Picker]                           │
│  Group By: [○ Day  ○ Hour  ○ Total]            │
└─────────────────────────────────────────────────┘
```

### 2. Table Columns

Recommended table columns for the performance list:

| Column | Description | Format |
|--------|-------------|--------|
| Supplier Address | Operator address | Text link to detail page |
| Owner Address | Owner address | Text (if available) |
| Total Claims | Number of claims | Number with commas |
| Total Relays | Aggregate relays | Number with commas |
| Total Compute Units | Aggregate compute units | Number with commas |
| Avg Efficiency | Efficiency percentage | Progress bar or badge (green/yellow/red) |
| Unique Apps | Applications served | Badge count |
| Unique Services | Services provided | Badge count |
| Actions | View detail | Button |

### 3. Status Indicators

Use color coding for supplier status:

- **Green**: `staked`
- **Yellow**: `unstake_requested`
- **Red**: `unstaked`

### 4. Efficiency Display

```typescript
// Efficiency percentage display
const getEfficiencyColor = (efficiency: number | null) => {
  if (efficiency === null) return 'gray';
  if (efficiency >= 95) return 'green';
  if (efficiency >= 80) return 'yellow';
  return 'red';
};

// Display as progress bar
<ProgressBar 
  value={row.avg_efficiency_percent || 0} 
  color={getEfficiencyColor(row.avg_efficiency_percent)}
  max={100}
/>
```

### 5. Date Range Picker

Recommend using a date range picker component:

- Default: Last 7 days
- Presets: Today, Last 7 days, Last 30 days, Last 90 days, Custom
- Format: ISO 8601 timestamps (UTC)

---

## Example Code Snippets

### React Hook for Supplier Performance

```typescript
import { useState, useEffect } from 'react';

interface SupplierPerformanceFilters {
  owner_address?: string;
  supplier_address?: string;
  chain?: string;
  service_id?: string;
  start_date?: string;
  end_date?: string;
  group_by?: 'day' | 'hour' | 'total';
  page?: number;
  limit?: number;
}

export function useSupplierPerformance(filters: SupplierPerformanceFilters) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, String(value));
        }
      });

      try {
        const response = await fetch(
          `/api/v1/suppliers/performance?${params.toString()}`
        );
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [JSON.stringify(filters)]);

  return { data, loading, error };
}

// Usage
function SupplierPerformanceTable() {
  const [filters, setFilters] = useState({
    group_by: 'day' as const,
    limit: 50
  });
  
  const { data, loading, error } = useSupplierPerformance(filters);

  if (loading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!data) return null;

  return (
    <Table>
      {data.data.map(row => (
        <TableRow key={row.supplier_operator_address}>
          <TableCell>{row.supplier_operator_address}</TableCell>
          <TableCell>{row.owner_address || '-'}</TableCell>
          <TableCell>{row.total_relays.toLocaleString()}</TableCell>
          <TableCell>{row.avg_efficiency_percent?.toFixed(2)}%</TableCell>
        </TableRow>
      ))}
    </Table>
  );
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Action |
|------|---------|--------|
| 200 | Success | Process response normally |
| 400 | Bad Request | Check query parameters (date format, enum values) |
| 404 | Not Found | Supplier not found (detail endpoint) |
| 500 | Server Error | Retry with exponential backoff, show user-friendly message |

### Error Response Format

```typescript
interface ErrorResponse {
  error: string;  // Error message
}
```

---

## Performance Optimization

### 1. Pagination Strategy

- **For Tables**: Use server-side pagination with reasonable page sizes (25-100 rows)
- **For Charts**: Fetch all data needed (increase `limit` or paginate and merge client-side)
- **For Dashboards**: Use `group_by=total` to get single aggregated row per supplier

### 2. Caching

Cache filter dropdown data (owners) since they change infrequently:

```typescript
// Cache owner list for 5 minutes
const ownerCache = {
  data: null,
  timestamp: null,
  ttl: 5 * 60 * 1000
};

async function getOwners() {
  if (ownerCache.data && Date.now() - ownerCache.timestamp < ownerCache.ttl) {
    return ownerCache.data;
  }
  
  const response = await fetch('/api/v1/suppliers/owners?limit=100');
  const result = await response.json();
  ownerCache.data = result.data;
  ownerCache.timestamp = Date.now();
  return result.data;
}
```

### 3. Debouncing Filters

Debounce filter changes to avoid excessive API calls:

```typescript
import { debounce } from 'lodash';

const debouncedFetch = debounce((filters) => {
  fetchPerformance(filters);
}, 500);

// On filter change
debouncedFetch(filters);
```

---

## Data Visualization Guidelines

### 1. Time Series Charts

**Use Cases**: Daily/hourly trends, performance over time

**Recommended Libraries**: 
- Recharts (React)
- Chart.js
- D3.js (advanced)

**Example Configuration**:

```typescript
// Line chart showing relays over time
const chartData = data.map(row => ({
  date: row.bucket,
  relays: row.total_relays,
  computeUnits: row.total_claimed_compute_units
}));

<LineChart data={chartData}>
  <Line dataKey="relays" stroke="#8884d8" />
  <Line dataKey="computeUnits" stroke="#82ca9d" />
  <XAxis dataKey="date" />
  <YAxis />
</LineChart>
```

### 2. Leaderboard Tables

**Columns to Display**:
- Rank (computed client-side)
- Supplier Info (operator address, owner address with link)
- Key Metrics (relays, compute units, efficiency)
- Status Badge
- Actions (view detail)

**Sorting**: Support sorting by any numeric column, default by `total_relays` DESC

---

## Testing Checklist

### Functional Testing

- [ ] All four endpoints return expected data structure
- [ ] Pagination works correctly (page, limit, totalPages)
- [ ] Date filtering (start_date, end_date) works
- [ ] Owner address filter matches correctly
- [ ] Supplier address filter works
- [ ] Group by (day/hour/total) produces correct aggregations
- [ ] Empty results handled gracefully
- [ ] Null values in response handled (owner_address, etc.)

### Error Testing

- [ ] Invalid date formats return 400
- [ ] Invalid group_by value returns 400
- [ ] Non-existent supplier in detail endpoint returns 404
- [ ] Server errors (500) handled with retry logic
- [ ] Network errors handled gracefully

### UI Testing

- [ ] Filters update results correctly
- [ ] Table sorting works on all sortable columns
- [ ] Pagination controls navigate correctly
- [ ] Loading states display during fetch
- [ ] Error messages display clearly
- [ ] Empty states show helpful messages
- [ ] Responsive design works on mobile/tablet

---

## Additional Notes

### Data Source

- **Claims table**: Source of truth for supplier performance
- **EventClaimCreated**: Events that populate the claims table
- **Filter**: Only successful claims (`claim_proof_status_int = 0`) are included

### Missing Data Handling

Some suppliers may not have:
- Owner address → `owner_address` will be `null`
- Supplier metadata → supplier join fields will be `null`

Handle these cases gracefully in UI (show "Unknown" or "-" instead of crashing).

---

## Quick Reference

### Common Filter Combinations

```typescript
// Top suppliers by owner
GET /api/v1/suppliers/performance?owner_address=pokt1abc123&group_by=total&limit=10

// Daily performance last 30 days
GET /api/v1/suppliers/performance?group_by=day&start_date=2025-10-01T00:00:00Z&end_date=2025-10-31T23:59:59Z

// Specific supplier hourly breakdown
GET /api/v1/suppliers/{address}/performance?group_by=hour&start_date=2025-10-31T00:00:00Z

// Top owners
GET /api/v1/suppliers/owners?chain=pocket-mainnet&limit=20
```

### Date Format

Always use ISO 8601 format in UTC:
```
2025-10-31T14:30:00Z
```

---

## Support

For API issues or questions:
- Check server logs for detailed error messages
- Verify database connection and claims table has data for the requested time range
- Ensure `suppliers` table has owner_address populated for owner-based queries

