# Validator and Service Search API - Implementation Guide

## Overview

This document provides comprehensive documentation for the Validator and Service Search API, including implementation details, business logic, and frontend integration guide. The API enables users to search for validators and services, then filter performance data based on their selections.

## Base URL

```
http://localhost:3006/api/v1
```

---

## API Endpoints

### 1. Validator and Service Search

**GET** `/api/v1/validators/search`

Search for validators and services based on a query string. The search matches:
- Validator moniker (name)
- Validator account address (pokt1...)
- Validator operator address (poktvaloper1...)
- Service JSON-RPC URL (partial or full match)

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query string |
| `chain` | string | No | - | Filter by blockchain chain identifier (e.g., "pocket-testnet-beta") |
| `limit` | integer | No | 20 | Maximum number of results per category (validators/services), capped at 100 |

#### Response Schema

```typescript
interface ValidatorServiceSearchResponse {
  validators: ValidatorSearchResult[];
  services: ServiceSearchResult[];
}

interface ValidatorSearchResult {
  type: 'validator';
  validator_account_address: string;  // pokt1... address (owner address)
  moniker?: string;                   // Validator display name
  operator_address?: string;          // poktvaloper1... address (supplier operator address)
}

interface ServiceSearchResult {
  type: 'service';
  service_id: string;                 // Service ID
  json_rpc_url: string;               // Full JSON-RPC URL that matched
  supplier_operator_addresses: string[]; // Array of all supplier operator addresses using this service
  supplier_count: number;              // Number of suppliers using this service
}
```

#### Search Logic

1. **Validator Search**:
   - Searches validator moniker (case-insensitive partial match using ILIKE)
   - Searches validator account address (pokt1...) - exact or partial match
   - Searches validator operator address (poktvaloper1...) - exact or partial match
   - Results ordered by relevance: exact address matches first, then moniker matches, then partial matches
   - Returns the validator's account address (`validator_account_address`) which is the owner address

2. **Service Search**:
   - Searches in service JSON-RPC URLs stored in `supplier_service_configs.endpoints` array
   - Uses case-insensitive partial matching (ILIKE)
   - For each matching service endpoint, finds all suppliers using that service
   - Returns all supplier operator addresses that use the matched service
   - Results ordered by supplier count (descending), then by service ID

3. **Performance**:
   - Uses PostgreSQL GIN indexes for fast array searches
   - Trigram indexes for fast moniker text search
   - Parallel query execution for validators and services
   - Cached with 300s TTL for improved performance

#### Example Request

```bash
GET /api/v1/validators/search?q=ethereum&chain=pocket-testnet-beta&limit=10
```

#### Example Response

```json
{
  "validators": [
    {
      "type": "validator",
      "validator_account_address": "pokt1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
      "moniker": "Ethereum Validator",
      "operator_address": "poktvaloper1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz"
    }
  ],
  "services": [
    {
      "type": "service",
      "service_id": "ethereum-mainnet",
      "json_rpc_url": "https://eth-mainnet.gateway.pokt.network/v1/lb/ethereum-mainnet",
      "supplier_operator_addresses": [
        "poktvaloper1xyz789abc123def456ghi789jkl012mno345pqr678stu901vwx",
        "poktvaloper1def456ghi789jkl012mno345pqr678stu901vwx234yzabc123"
      ],
      "supplier_count": 2
    }
  ]
}
```

#### Error Responses

**400 Bad Request**
```json
{
  "error": "Query parameter 'q' is required"
}
```

**500 Internal Server Error**
```json
{
  "error": "Internal server error"
}
```

---

### 2. Validator Performance API

#### GET Method (Backward Compatible)

**GET** `/api/v1/validators/performance`

Supports single supplier address or comma-separated addresses for backward compatibility. When multiple comma-separated addresses are provided, results are aggregated.

#### Query Parameters (GET)

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `domain` | string | No | - | Filter by website domain (e.g., "grove.city") |
| `owner_address` | string | No | - | Filter by supplier owner address (pokt1...) |
| `supplier_address` | string | No | - | Filter by supplier operator address(es). Supports single address or comma-separated addresses (e.g., "addr1,addr2,addr3") |
| `chain` | string | No | - | Filter by blockchain chain identifier |
| `service_id` | string | No | - | Filter by service ID |
| `start_date` | ISO 8601 | No | - | Start timestamp (e.g., "2025-10-01T00:00:00Z") |
| `end_date` | ISO 8601 | No | - | End timestamp (e.g., "2025-10-31T23:59:59Z") |
| `group_by` | enum | No | "day" | Grouping: "day", "hour", or "total" |
| `page` | integer | No | 1 | Page number for pagination |
| `limit` | integer | No | 100 | Results per page |

#### POST Method (Recommended for Multiple Addresses)

**POST** `/api/v1/validators/performance`

Use POST when filtering by multiple supplier addresses or when the query string would exceed URL length limits.

#### Request Body (POST)

```typescript
interface PerformanceRequest {
  domain?: string;
  owner_address?: string;
  supplier_address?: string | string[];  // Single address (string) or array of addresses
  chain?: string;
  service_id?: string;
  start_date?: string;  // ISO 8601 format
  end_date?: string;    // ISO 8601 format
  group_by?: 'day' | 'hour' | 'total';
  page?: number;
  limit?: number;
}
```

#### Response Schema

```typescript
interface PerformanceResponse {
  data: PerformanceDataPoint[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface PerformanceDataPoint {
  bucket: string | null;  // Timestamp bucket (null for 'total' grouping)
  supplier_operator_address: string | null;  // null when aggregating multiple suppliers
  owner_address: string | null;  // null when aggregating multiple suppliers
  moniker: string | null;  // null when aggregating multiple suppliers
  website: string | null;
  website_domain: string | null;
  validator_status: string | null;
  submissions: number;  // Count of proof submissions
  total_relays: number;  // Sum of all relays
  total_claimed_compute_units: number;  // Sum of claimed compute units
  total_estimated_compute_units: number;  // Sum of estimated compute units
  avg_efficiency_percent: number;  // Average efficiency (weighted when aggregating)
  avg_reward_per_relay: number;  // Average reward per relay (weighted when aggregating)
  unique_applications: number;  // Count of distinct applications
  unique_services: number;  // Count of distinct services
}
```

#### Behavior

- **Single Address**: If `supplier_address` is a single string or array with one address, returns per-supplier performance data (original behavior)
- **Multiple Addresses**: If `supplier_address` is an array with multiple addresses or comma-separated string, returns aggregated performance data:
  - Sums all metrics (relays, compute units, submissions) across all suppliers
  - Calculates weighted averages (efficiency, reward per relay)
  - Groups by time buckets (day/hour) as specified by `group_by`
  - Returns one row per time bucket with aggregated data
  - Sets supplier-specific fields (`supplier_operator_address`, `owner_address`, `moniker`, etc.) to `null` in aggregated results

#### Example GET Request (Single Address)

```bash
GET /api/v1/validators/performance?supplier_address=poktvaloper1abc...&group_by=day&start_date=2025-10-01T00:00:00Z&end_date=2025-10-07T23:59:59Z
```

#### Example GET Request (Comma-Separated Addresses)

```bash
GET /api/v1/validators/performance?supplier_address=poktvaloper1abc...,poktvaloper1def...,poktvaloper1ghi...&group_by=day&start_date=2025-10-01T00:00:00Z&end_date=2025-10-07T23:59:59Z
```

#### Example POST Request (Multiple Addresses)

```bash
POST /api/v1/validators/performance
Content-Type: application/json

{
  "supplier_address": [
    "poktvaloper1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
    "poktvaloper1def456ghi789jkl012mno345pqr678stu901vwx234yzabc123",
    "poktvaloper1ghi789jkl012mno345pqr678stu901vwx234yzabc123def456"
  ],
  "group_by": "day",
  "start_date": "2025-10-01T00:00:00Z",
  "end_date": "2025-10-07T23:59:59Z"
}
```

#### Example Response (Single Supplier)

```json
{
  "data": [
    {
      "bucket": "2025-10-01T00:00:00Z",
      "supplier_operator_address": "poktvaloper1abc...",
      "owner_address": "pokt1xyz...",
      "moniker": "My Validator",
      "website": "https://myvalidator.com",
      "website_domain": "myvalidator.com",
      "validator_status": "BOND_STATUS_BONDED",
      "submissions": 500,
      "total_relays": 2500000,
      "total_claimed_compute_units": 250000000,
      "total_estimated_compute_units": 250000000,
      "avg_efficiency_percent": 98.5,
      "avg_reward_per_relay": 170.25,
      "unique_applications": 25,
      "unique_services": 12
    }
  ],
  "meta": {
    "total": 7,
    "page": 1,
    "limit": 100,
    "totalPages": 1
  }
}
```

#### Example Response (Aggregated - Multiple Suppliers)

```json
{
  "data": [
    {
      "bucket": "2025-10-01T00:00:00Z",
      "supplier_operator_address": null,
      "owner_address": null,
      "moniker": null,
      "website": null,
      "website_domain": null,
      "validator_status": null,
      "submissions": 1500,
      "total_relays": 7500000,
      "total_claimed_compute_units": 750000000,
      "total_estimated_compute_units": 750000000,
      "avg_efficiency_percent": 98.5,
      "avg_reward_per_relay": 170.25,
      "unique_applications": 50,
      "unique_services": 15
    }
  ],
  "meta": {
    "total": 7,
    "page": 1,
    "limit": 1000,
    "totalPages": 1
  }
}
```

---

### 3. Service Performance Endpoints

#### GET `/api/v1/services/top-by-compute-units`

Returns top N services by total compute units for the specified time period. Supports filtering by supplier operator addresses and owner addresses.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `limit` | string | No | "10" | Number of top services (5, 10, 25, or 50) |
| `days` | string | No | "30" | Time period in days (7, 15, or 30) |
| `chain` | string | No | - | Filter by chain identifier |
| `supplier_address` | string | No | - | Filter by supplier operator address(es) - single or comma-separated |
| `owner_address` | string | No | - | Filter by supplier owner address |

#### POST `/api/v1/services/top-by-compute-units`

Same as GET but accepts parameters in request body. Recommended for multiple supplier addresses.

#### GET `/api/v1/services/top-by-performance`

Returns top 10 services by compute units with percentage distribution. Supports filtering by supplier operator addresses and owner addresses.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `chain` | string | No | - | Filter by chain identifier |
| `days` | string | No | "30" | Time period in days (7, 15, or 30) |
| `supplier_address` | string | No | - | Filter by supplier operator address(es) - single or comma-separated |
| `owner_address` | string | No | - | Filter by supplier owner address |

#### POST `/api/v1/services/top-by-performance`

Same as GET but accepts parameters in request body. Recommended for multiple supplier addresses.

---

## Business Logic and Data Flow

### Search Flow

1. **User Input**: User types a search query in the frontend
2. **Search Request**: Frontend calls `/api/v1/validators/search` with query string
3. **Backend Processing**:
   - Validator search: Queries `validators` table for moniker, account_address, or operator_address matches
   - Service search: Queries `supplier_service_configs` table, unnesting endpoints array to find URL matches
   - Both queries execute in parallel for performance
4. **Results**: Returns separate arrays for validators and services
5. **Frontend Display**: Shows results in dropdown/autocomplete

### Filter Application Flow

1. **Validator Selection**:
   - User selects a validator from search results
   - Frontend extracts `validator_account_address` (owner address)
   - Frontend sets `owner_address` filter in performance query
   - Performance data shows all suppliers owned by this address

2. **Service Selection**:
   - User selects a service from search results
   - Frontend extracts `supplier_operator_addresses` array
   - Frontend uses POST method with array of addresses (or comma-separated for GET)
   - Performance data aggregates across all suppliers using this service

3. **Performance Query**:
   - Frontend constructs performance request with selected filters
   - Uses POST if multiple supplier addresses (avoids URL length limits)
   - Backend aggregates data when multiple suppliers are provided
   - Returns time-series performance data grouped by day/hour/total

### Aggregation Logic

When multiple supplier addresses are provided:

1. **Metric Aggregation**:
   - **Sum**: `submissions`, `total_relays`, `total_claimed_compute_units`, `total_estimated_compute_units`
   - **Weighted Average**: `avg_efficiency_percent` (weighted by compute units), `avg_reward_per_relay` (weighted by relays)
   - **Union**: `unique_applications`, `unique_services` (COUNT DISTINCT)

2. **Grouping**:
   - Data grouped by time bucket (`bucket` field) as specified by `group_by`
   - One row per time bucket with aggregated metrics
   - Supplier-specific fields set to `null` in aggregated results

3. **Time Buckets**:
   - `day`: Groups by date (one row per day)
   - `hour`: Groups by hour (one row per hour)
   - `total`: Single row with all-time aggregated data

---

## Frontend Integration Guide

### TypeScript Interfaces

```typescript
// Search API Types
interface ValidatorSearchResult {
  type: 'validator';
  validator_account_address: string;
  moniker?: string;
  operator_address?: string;
}

interface ServiceSearchResult {
  type: 'service';
  service_id: string;
  json_rpc_url: string;
  supplier_operator_addresses: string[];
  supplier_count: number;
}

interface SearchResponse {
  validators: ValidatorSearchResult[];
  services: ServiceSearchResult[];
}

// Performance API Types
interface PerformanceRequest {
  domain?: string;
  owner_address?: string;
  supplier_address?: string | string[];
  chain?: string;
  service_id?: string;
  start_date?: string;
  end_date?: string;
  group_by?: 'day' | 'hour' | 'total';
  page?: number;
  limit?: number;
}

interface PerformanceDataPoint {
  bucket: string | null;
  supplier_operator_address: string | null;
  owner_address: string | null;
  moniker: string | null;
  website: string | null;
  website_domain: string | null;
  validator_status: string | null;
  submissions: number;
  total_relays: number;
  total_claimed_compute_units: number;
  total_estimated_compute_units: number;
  avg_efficiency_percent: number;
  avg_reward_per_relay: number;
  unique_applications: number;
  unique_services: number;
}

interface PerformanceResponse {
  data: PerformanceDataPoint[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

### API Client Implementation

```typescript
const API_BASE_URL = 'http://localhost:3006/api/v1';

class ValidatorServiceAPI {
  /**
   * Search for validators and services
   */
  async search(query: string, chain?: string, limit: number = 20): Promise<SearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString()
    });
    if (chain) params.append('chain', chain);
    
    const response = await fetch(`${API_BASE_URL}/validators/search?${params}`);
    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get validator performance data
   * Automatically uses POST for multiple addresses to avoid URL length limits
   */
  async getPerformance(
    params: PerformanceRequest
  ): Promise<PerformanceResponse> {
    const hasMultipleAddresses = 
      Array.isArray(params.supplier_address) && params.supplier_address.length > 1;
    
    // Use POST for multiple addresses or complex queries
    if (hasMultipleAddresses || this.shouldUsePost(params)) {
      const response = await fetch(`${API_BASE_URL}/validators/performance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      if (!response.ok) {
        throw new Error(`Performance query failed: ${response.statusText}`);
      }
      return response.json();
    } else {
      // Use GET for simple queries
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            queryParams.append(key, value.join(','));
          } else {
            queryParams.append(key, String(value));
          }
        }
      });
      
      const response = await fetch(
        `${API_BASE_URL}/validators/performance?${queryParams}`
      );
      if (!response.ok) {
        throw new Error(`Performance query failed: ${response.statusText}`);
      }
      return response.json();
    }
  }

  private shouldUsePost(params: PerformanceRequest): boolean {
    // Use POST if query would be too long (estimate > 2000 chars)
    const queryString = new URLSearchParams(
      Object.entries(params).reduce((acc, [k, v]) => {
        if (v !== undefined && v !== null) {
          acc[k] = Array.isArray(v) ? v.join(',') : String(v);
        }
        return acc;
      }, {} as Record<string, string>)
    ).toString();
    return queryString.length > 2000;
  }
}
```

### React Component Example

```typescript
import React, { useState, useCallback, useMemo } from 'react';
import { useDebounce } from './hooks/useDebounce';

interface FilterState {
  ownerAddress?: string;
  supplierAddresses?: string[];
  chain?: string;
  startDate?: string;
  endDate?: string;
  groupBy: 'day' | 'hour' | 'total';
}

export const ValidatorFilterModal: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResponse>({
    validators: [],
    services: []
  });
  const [filters, setFilters] = useState<FilterState>({
    groupBy: 'day'
  });
  const [performanceData, setPerformanceData] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const debouncedQuery = useDebounce(searchQuery, 300);
  const api = useMemo(() => new ValidatorServiceAPI(), []);

  // Search for validators and services
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults({ validators: [], services: [] });
      return;
    }

    setLoading(true);
    try {
      const results = await api.search(query, filters.chain);
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults({ validators: [], services: [] });
    } finally {
      setLoading(false);
    }
  }, [filters.chain, api]);

  // Update search when debounced query changes
  React.useEffect(() => {
    handleSearch(debouncedQuery);
  }, [debouncedQuery, handleSearch]);

  // Handle validator selection
  const handleValidatorSelect = useCallback((validator: ValidatorSearchResult) => {
    setFilters(prev => ({
      ...prev,
      ownerAddress: validator.validator_account_address,
      supplierAddresses: undefined // Clear supplier filter when selecting validator
    }));
    setSearchQuery('');
    setSearchResults({ validators: [], services: [] });
  }, []);

  // Handle service selection
  const handleServiceSelect = useCallback((service: ServiceSearchResult) => {
    setFilters(prev => ({
      ...prev,
      supplierAddresses: service.supplier_operator_addresses,
      ownerAddress: undefined // Clear owner filter when selecting service
    }));
    setSearchQuery('');
    setSearchResults({ validators: [], services: [] });
  }, []);

  // Fetch performance data when filters change
  const fetchPerformance = useCallback(async () => {
    if (!filters.startDate || !filters.endDate) return;

    setLoading(true);
    try {
      const data = await api.getPerformance({
        owner_address: filters.ownerAddress,
        supplier_address: filters.supplierAddresses,
        chain: filters.chain,
        start_date: filters.startDate,
        end_date: filters.endDate,
        group_by: filters.groupBy,
        page: 1,
        limit: 1000
      });
      setPerformanceData(data);
    } catch (error) {
      console.error('Performance fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [filters, api]);

  React.useEffect(() => {
    fetchPerformance();
  }, [fetchPerformance]);

  return (
    <div className="validator-filter-modal">
      {/* Search Input */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search validators or services..."
        className="search-input"
      />

      {/* Search Results */}
      {searchResults.validators.length > 0 && (
        <div className="search-results">
          <h3>Validators</h3>
          {searchResults.validators.map((validator, idx) => (
            <div
              key={idx}
              onClick={() => handleValidatorSelect(validator)}
              className="result-item"
            >
              <div className="result-name">{validator.moniker || 'Unknown'}</div>
              <div className="result-address">{validator.validator_account_address}</div>
            </div>
          ))}
        </div>
      )}

      {searchResults.services.length > 0 && (
        <div className="search-results">
          <h3>Services</h3>
          {searchResults.services.map((service, idx) => (
            <div
              key={idx}
              onClick={() => handleServiceSelect(service)}
              className="result-item"
            >
              <div className="result-name">{service.service_id}</div>
              <div className="result-url">{service.json_rpc_url}</div>
              <div className="result-count">{service.supplier_count} suppliers</div>
            </div>
          ))}
        </div>
      )}

      {/* Active Filters Display */}
      <div className="active-filters">
        {filters.ownerAddress && (
          <span className="filter-tag">
            Owner: {filters.ownerAddress.slice(0, 10)}...
            <button onClick={() => setFilters(prev => ({ ...prev, ownerAddress: undefined }))}>
              ×
            </button>
          </span>
        )}
        {filters.supplierAddresses && filters.supplierAddresses.length > 0 && (
          <span className="filter-tag">
            {filters.supplierAddresses.length} Supplier(s)
            <button onClick={() => setFilters(prev => ({ ...prev, supplierAddresses: undefined }))}>
              ×
            </button>
          </span>
        )}
      </div>

      {/* Performance Data Display */}
      {performanceData && (
        <div className="performance-data">
          <h3>Performance Metrics</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Relays</th>
                <th>Compute Units</th>
                <th>Efficiency</th>
                <th>Reward/Relay</th>
              </tr>
            </thead>
            <tbody>
              {performanceData.data.map((point, idx) => (
                <tr key={idx}>
                  <td>{point.bucket ? new Date(point.bucket).toLocaleDateString() : 'Total'}</td>
                  <td>{point.total_relays.toLocaleString()}</td>
                  <td>{point.total_claimed_compute_units.toLocaleString()}</td>
                  <td>{point.avg_efficiency_percent}%</td>
                  <td>{point.avg_reward_per_relay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
```

### Integration Flow Diagram

```
┌─────────────────┐
│  User Types     │
│  Search Query   │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│  Frontend: Debounced Search  │
│  (300ms delay)               │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  GET /validators/search      │
│  ?q=ethereum&chain=...       │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Backend: Parallel Queries   │
│  - Validator search          │
│  - Service search            │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Return: {                  │
│    validators: [...],       │
│    services: [...]          │
│  }                          │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Frontend: Display Results  │
│  in Dropdown                │
└────────┬─────────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────┐
│ User   │ │ User     │
│ Selects│ │ Selects │
│Validator│ │ Service │
└───┬────┘ └────┬─────┘
    │           │
    │           │
    ▼           ▼
┌─────────────────────────────┐
│  Frontend: Set Filters      │
│  - owner_address (validator)│
│  - supplier_address[] (svc) │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  POST /validators/performance│
│  {                           │
│    owner_address: "...",     │
│    supplier_address: [...], │
│    start_date: "...",        │
│    end_date: "...",          │
│    group_by: "day"           │
│  }                           │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Backend: Aggregate        │
│  - Filter proof_submissions  │
│  - Join with suppliers/      │
│    validators                │
│  - Aggregate metrics         │
│  - Group by time bucket      │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Return: Performance Data    │
│  {                           │
│    data: [...],              │
│    meta: {...}               │
│  }                           │
└────────┬─────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│  Frontend: Display Charts    │
│  and Tables                  │
└─────────────────────────────┘
```

### Key Implementation Details

1. **Debouncing**: Implement 300ms debounce on search input to avoid excessive API calls
2. **Error Handling**: Handle network errors and display user-friendly messages
3. **Loading States**: Show loading indicators during API calls
4. **Caching**: Search results are cached for 300s on the backend, but frontend should still implement local caching for better UX
5. **URL Length**: Automatically use POST when query would exceed ~2000 characters
6. **Multiple Selections**: Support selecting multiple validators or services (combine their addresses)

### Best Practices

1. **Search UX**:
   - Show loading state while searching
   - Display "No results" message when appropriate
   - Highlight exact matches vs partial matches
   - Show validator moniker prominently, address as secondary

2. **Filter Management**:
   - Clear conflicting filters (e.g., clear supplier filter when selecting validator)
   - Show active filters as removable tags
   - Allow users to combine filters (e.g., owner_address + service_id)

3. **Performance Data Display**:
   - Use charts for time-series data (line/bar charts)
   - Show aggregated indicator when multiple suppliers are selected
   - Display "Aggregated" label when supplier-specific fields are null
   - Format large numbers with commas/thousand separators

4. **Error Handling**:
   - Handle 400 errors (invalid parameters) with user-friendly messages
   - Handle 500 errors with retry logic
   - Show network errors with retry button

---

## Data Sources

### Database Tables

1. **`validators`**: Cached validator metadata
   - `operator_address` (poktvaloper1...)
   - `account_address` (pokt1...) - converted from operator_address
   - `moniker` - validator display name
   - `chain` - chain identifier
   - `website_domain` - extracted domain from website URL

2. **`suppliers`**: Supplier information
   - `address` (operator_address, poktvaloper1...)
   - `owner_address` (pokt1...)
   - `chain` - chain identifier

3. **`supplier_service_configs`**: Service configurations per supplier
   - `supplier_address` (operator_address)
   - `service_id`
   - `endpoints` (TEXT[] array of JSON-RPC URLs)
   - `chain` - chain identifier

4. **`proof_submissions`**: Performance metrics
   - `supplier_operator_address`
   - `service_id`
   - `timestamp`
   - `num_relays`
   - `num_claimed_compute_units`
   - `num_estimated_compute_units`
   - `compute_unit_efficiency`
   - `reward_per_relay`
   - `application_address`
   - `chain`

### Indexes for Performance

The following indexes are created for optimal query performance:

- **Validator Search**:
  - Trigram index on `moniker` for fast text search
  - Indexes on `account_address`, `operator_address`, `chain`

- **Service Search**:
  - GIN index on `endpoints` array for fast array searches
  - Composite indexes on `service_id`, `chain`, `supplier_address`

- **Performance Queries**:
  - Covering index on `proof_submissions` with `supplier_operator_address`, `chain`, `timestamp`
  - Index on `suppliers` for owner_address lookups

---

## Implementation Status

✅ **Completed Features**:
- [x] Validator and service search endpoint
- [x] GET performance endpoint with comma-separated address support
- [x] POST performance endpoint with array support
- [x] Aggregation logic for multiple suppliers
- [x] Service endpoints with supplier/owner filtering
- [x] POST support for service endpoints
- [x] Database indexes for <500ms response times
- [x] Caching middleware (300s TTL for search)
- [x] Code refactoring (business logic in services layer)

---

## Testing Checklist

- [x] Search by validator moniker (exact match)
- [x] Search by validator moniker (partial match)
- [x] Search by validator account address (pokt1...)
- [x] Search by validator operator address (poktvaloper1...)
- [x] Search by service JSON-RPC URL (partial match)
- [x] Search by service JSON-RPC URL (full match)
- [x] Multiple results returned correctly
- [x] Results limited by `limit` parameter
- [x] Chain filtering works correctly
- [x] Empty query returns empty results
- [x] Invalid query handled gracefully
- [x] Performance API handles single supplier_address
- [x] Performance API handles comma-separated supplier_addresses (GET)
- [x] Performance API handles array supplier_addresses (POST)
- [x] Aggregation calculations are correct for multiple suppliers
- [x] Response times are acceptable (< 500ms for typical queries)
- [x] Service endpoints support supplier_address filtering
- [x] Service endpoints support owner_address filtering
- [x] POST endpoints work correctly for service queries

---

## Performance Considerations

1. **Search Performance**:
   - Uses PostgreSQL trigram indexes for fast moniker search
   - GIN indexes for array endpoint searches
   - Parallel query execution for validators and services
   - Results capped at 100 per category

2. **Performance Query Optimization**:
   - Covering indexes for common query patterns
   - Efficient JOINs with proper chain matching
   - Aggregation at database level (not in application code)
   - Pagination support to limit result sets

3. **Caching**:
   - Search endpoint cached for 300 seconds
   - Consider implementing client-side caching for frequently searched terms
   - Performance queries not cached (real-time data)

---

## Error Handling

### Common Errors

1. **400 Bad Request**: Invalid parameters
   - Missing required `q` parameter in search
   - Invalid date format
   - Invalid `group_by` value

2. **500 Internal Server Error**: Server/database errors
   - Database connection issues
   - Query execution errors
   - Always log these for debugging

### Frontend Error Handling

```typescript
try {
  const results = await api.search(query);
  // Handle success
} catch (error) {
  if (error instanceof Response) {
    if (error.status === 400) {
      // Show user-friendly validation error
      showError('Please enter a valid search query');
    } else if (error.status === 500) {
      // Show retry option
      showError('Server error. Please try again.', { retry: true });
    }
  } else {
    // Network error
    showError('Network error. Please check your connection.');
  }
}
```

---

## Additional Resources

- **Backend Service**: `server/services/performanceService.js`
- **Database Migrations**: `server/migrations/023-validator-search-indexes.sql`
- **API Server**: `server/api-server.js` (route declarations only)

---

## Changelog

### Version 1.0 (Current Implementation)
- ✅ Search endpoint with validator and service search
- ✅ Performance endpoint with GET/POST support
- ✅ Comma-separated address support in GET
- ✅ Array address support in POST
- ✅ Aggregation logic for multiple suppliers
- ✅ Service endpoints with supplier/owner filtering
- ✅ Database optimization with indexes
- ✅ Code refactoring to services layer
