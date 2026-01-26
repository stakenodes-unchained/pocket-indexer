# Supplier and Service Search API

## Overview

This document provides comprehensive documentation for the Supplier and Service Search API. The API enables users to search for suppliers by owner address and services by service URLs (from `supplier_service_configs.endpoints`).

## Base URL

```
http://localhost:3006/api/v1
```

---

## API Endpoints

### Supplier and Service Search

**GET** `/api/v1/suppliers/search`

Search for suppliers and services based on a query string. The search matches:
- Supplier owner address (pokt1...)
- Supplier operator address (poktvaloper1...)
- Service JSON-RPC URL from `supplier_service_configs.endpoints` (partial or full match)

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query string (owner address or service URL) |
| `chain` | string | No | - | Filter by blockchain chain identifier (e.g., "pocket-mainnet") |
| `limit` | integer | No | 20 | Maximum number of results per category (suppliers/services), capped at 100 |

#### Response Schema

```typescript
interface SupplierServiceSearchResponse {
  suppliers: SupplierSearchResult[];
  services: ServiceSearchResult[];
}

interface SupplierSearchResult {
  type: 'supplier';
  owner_address?: string;              // pokt1... address (owner address)
  supplier_operator_address: string;  // poktvaloper1... address (supplier operator address)
  chain: string;                      // Chain identifier
  status?: string;                    // Supplier status (e.g., 'staked', 'unstaked')
  staked_amount?: string;             // Staked amount as string
}

interface ServiceSearchResult {
  type: 'service';
  service_id: string;                 // Service ID
  service_url: string;                // Full JSON-RPC URL that matched
  owner_addresses: string[];          // Array of owner addresses for suppliers using this service
  supplier_operator_addresses: string[]; // Array of all supplier operator addresses using this service
  supplier_count: number;             // Number of suppliers using this service
}
```

#### Search Logic

1. **Supplier Search**:
   - Searches supplier owner address (pokt1...) - exact or partial match (ILIKE)
   - Searches supplier operator address (poktvaloper1...) - exact or partial match
   - Results ordered by relevance: exact address matches first, then partial matches
   - Returns the supplier's owner address and operator address

2. **Service Search**:
   - Searches in service JSON-RPC URLs stored in `supplier_service_configs.endpoints` array
   - Uses case-insensitive partial matching (ILIKE)
   - For each matching service endpoint, finds all suppliers using that service
   - Returns all supplier operator addresses and owner addresses that use the matched service
   - Results ordered by supplier count (descending), then by service ID

3. **Performance**:
   - Uses PostgreSQL GIN indexes for fast array searches (from migration 023)
   - Parallel query execution for suppliers and services
   - Cached with 300s TTL for improved performance

#### Example Request

```bash
GET /api/v1/suppliers/search?q=pokt1abc123&chain=pocket-mainnet&limit=10
```

#### Example Response

```json
{
  "suppliers": [
    {
      "type": "supplier",
      "owner_address": "pokt1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
      "supplier_operator_address": "poktvaloper1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
      "chain": "pocket-mainnet",
      "status": "staked",
      "staked_amount": "15000000000"
    }
  ],
  "services": [
    {
      "type": "service",
      "service_id": "ethereum-mainnet",
      "service_url": "https://eth-mainnet.gateway.pokt.network/v1/lb/ethereum-mainnet",
      "owner_addresses": [
        "pokt1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
        "pokt1def456ghi789jkl012mno345pqr678stu901vwx234yzabc123"
      ],
      "supplier_operator_addresses": [
        "poktvaloper1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
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

## Use Cases

### 1. Search by Owner Address

Find all suppliers owned by a specific address:

```bash
GET /api/v1/suppliers/search?q=pokt1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
```

Returns all suppliers where `owner_address` matches the query.

### 2. Search by Service URL

Find all suppliers using a specific service endpoint:

```bash
GET /api/v1/suppliers/search?q=https://eth-mainnet.gateway.pokt.network
```

Returns all suppliers that have this URL in their `supplier_service_configs.endpoints` array.

### 3. Search by Partial Owner Address

Find suppliers by partial owner address match:

```bash
GET /api/v1/suppliers/search?q=pokt1abc123
```

Returns all suppliers where `owner_address` contains the query string.

### 4. Filter by Chain

Limit search to a specific chain:

```bash
GET /api/v1/suppliers/search?q=ethereum&chain=pocket-mainnet
```

---

## Data Sources

### Database Tables

1. **`suppliers`**: Supplier information
   - `address` (operator_address, poktvaloper1...)
   - `owner_address` (pokt1...)
   - `chain` - chain identifier
   - `status` - supplier status
   - `staked_amount` - staked amount

2. **`supplier_service_configs`**: Service configurations per supplier
   - `supplier_address` (operator_address)
   - `service_id`
   - `endpoints` (TEXT[] array of JSON-RPC URLs)
   - `chain` - chain identifier

### Indexes for Performance

The following indexes are used for optimal query performance (from migration 023):

- **Supplier Search**:
  - Index on `owner_address` (`idx_suppliers_owner_address`)
  - Composite index on `address, chain` with `owner_address` included (`idx_suppliers_address_chain_owner`)

- **Service Search**:
  - GIN index on `endpoints` array for fast array searches (`idx_supplier_service_configs_endpoints_gin`)
  - Composite indexes on `service_id, chain` and `supplier_address, chain`

---

## Frontend Integration

### TypeScript Interfaces

```typescript
// Search API Types
interface SupplierSearchResult {
  type: 'supplier';
  owner_address?: string;
  supplier_operator_address: string;
  chain: string;
  status?: string;
  staked_amount?: string;
}

interface ServiceSearchResult {
  type: 'service';
  service_id: string;
  service_url: string;
  owner_addresses: string[];
  supplier_operator_addresses: string[];
  supplier_count: number;
}

interface SupplierSearchResponse {
  suppliers: SupplierSearchResult[];
  services: ServiceSearchResult[];
}
```

### API Client Implementation

```typescript
const API_BASE_URL = 'http://localhost:3006/api/v1';

class SupplierServiceAPI {
  /**
   * Search for suppliers and services
   */
  async search(query: string, chain?: string, limit: number = 20): Promise<SupplierSearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString()
    });
    if (chain) params.append('chain', chain);
    
    const response = await fetch(`${API_BASE_URL}/suppliers/search?${params}`);
    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }
    return response.json();
  }
}
```

### React Component Example

```typescript
import React, { useState, useCallback } from 'react';
import { useDebounce } from './hooks/useDebounce';

export const SupplierSearch: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SupplierSearchResponse>({
    suppliers: [],
    services: []
  });
  const [loading, setLoading] = useState(false);

  const debouncedQuery = useDebounce(searchQuery, 300);
  const api = new SupplierServiceAPI();

  // Search for suppliers and services
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults({ suppliers: [], services: [] });
      return;
    }

    setLoading(true);
    try {
      const results = await api.search(query);
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults({ suppliers: [], services: [] });
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Update search when debounced query changes
  React.useEffect(() => {
    handleSearch(debouncedQuery);
  }, [debouncedQuery, handleSearch]);

  return (
    <div className="supplier-search">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search by owner address or service URL..."
        className="search-input"
      />

      {loading && <div>Searching...</div>}

      {searchResults.suppliers.length > 0 && (
        <div className="search-results">
          <h3>Suppliers</h3>
          {searchResults.suppliers.map((supplier, idx) => (
            <div key={idx} className="result-item">
              <div className="result-owner">
                Owner: {supplier.owner_address || 'N/A'}
              </div>
              <div className="result-operator">
                Operator: {supplier.supplier_operator_address}
              </div>
              <div className="result-status">
                Status: {supplier.status || 'unknown'}
              </div>
            </div>
          ))}
        </div>
      )}

      {searchResults.services.length > 0 && (
        <div className="search-results">
          <h3>Services</h3>
          {searchResults.services.map((service, idx) => (
            <div key={idx} className="result-item">
              <div className="result-service">{service.service_id}</div>
              <div className="result-url">{service.service_url}</div>
              <div className="result-count">
                {service.supplier_count} supplier(s)
              </div>
              <div className="result-owners">
                Owner addresses: {service.owner_addresses.length}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

---

## Comparison with Validator Search

| Feature | Validator Search | Supplier Search |
|---------|-----------------|-----------------|
| **Endpoint** | `/api/v1/validators/search` | `/api/v1/suppliers/search` |
| **Search Fields** | Moniker, account_address, operator_address | owner_address, operator_address |
| **Service Search** | From `supplier_service_configs.endpoints` | From `supplier_service_configs.endpoints` |
| **Returns** | `validators[]`, `services[]` | `suppliers[]`, `services[]` |
| **Use Case** | Find validators by name/address | Find suppliers by owner address |

---

## Performance Considerations

1. **Search Performance**:
   - Uses PostgreSQL GIN indexes for fast array endpoint searches
   - Indexes on `owner_address` for fast owner lookups
   - Parallel query execution for suppliers and services
   - Results capped at 100 per category

2. **Caching**:
   - Search endpoint cached for 300 seconds
   - Consider implementing client-side caching for frequently searched terms

---

## Error Handling

### Common Errors

1. **400 Bad Request**: Invalid parameters
   - Missing required `q` parameter
   - Invalid `limit` value

2. **500 Internal Server Error**: Server/database errors
   - Database connection issues
   - Query execution errors

### Frontend Error Handling

```typescript
try {
  const results = await api.search(query);
  // Handle success
} catch (error) {
  if (error instanceof Response) {
    if (error.status === 400) {
      showError('Please enter a valid search query');
    } else if (error.status === 500) {
      showError('Server error. Please try again.', { retry: true });
    }
  } else {
    showError('Network error. Please check your connection.');
  }
}
```

---

## Testing Checklist

- [ ] Search by owner address (exact match)
- [ ] Search by owner address (partial match)
- [ ] Search by operator address (exact match)
- [ ] Search by operator address (partial match)
- [ ] Search by service URL (partial match)
- [ ] Search by service URL (full match)
- [ ] Multiple results returned correctly
- [ ] Results limited by `limit` parameter
- [ ] Chain filtering works correctly
- [ ] Empty query returns empty results
- [ ] Invalid query handled gracefully
- [ ] Response times are acceptable (< 500ms for typical queries)

---

## Additional Resources

- **Backend Service**: `server/services/performanceService.js`
- **API Server**: `server/api-server.js` (route declarations)
- **Database Migrations**: `server/migrations/023-validator-search-indexes.sql` (includes supplier indexes)

---

## Changelog

### Version 1.0 (Current Implementation)
- ✅ Supplier search endpoint with owner address and operator address search
- ✅ Service search endpoint with URL matching from `supplier_service_configs.endpoints`
- ✅ Database optimization with existing indexes
- ✅ Caching middleware (300s TTL)

