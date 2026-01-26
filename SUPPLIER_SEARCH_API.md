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

Search for suppliers based on a query string. The search supports two modes:

1. **Address Search**: If the query starts with `pokt1` or `poktvaloper1`, searches for:
   - Supplier owner address (pokt1...)
   - Supplier operator address (poktvaloper1...)

2. **Service URL Search**: Otherwise, searches for:
   - Service JSON-RPC URL from `supplier_service_configs.endpoints` (partial or full match)
   - Returns all suppliers that have service URLs containing the search query

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query string (owner address or service URL) |
| `chain` | string | No | - | Filter by blockchain chain identifier (e.g., "pocket-mainnet") |
| `status` | string | No | "staked" | Filter by supplier status: "staked", "unstaked", "unstake_requested", or "all" (returns all statuses) |
| `limit` | integer | No | 20 | Maximum number of results per category (suppliers/services), capped at 100 |

#### Response Schema

```typescript
interface SupplierServiceSearchResponse {
  owner_addresses: string[];              // Unique owner addresses (pokt1...) for suppliers matching the search
  supplier_operator_addresses: string[]; // Unique supplier operator addresses (poktvaloper1...) matching the search
}
```

**Response Format:**
- `owner_addresses`: Array of unique owner addresses for suppliers that have service URLs containing the search query. Allows selecting an owner to view all operators for that owner.
- `supplier_operator_addresses`: Array of unique supplier operator addresses that have service URLs containing the search query. Allows filtering between specific suppliers.

#### Search Logic

1. **Address Search** (when query starts with `pokt`):
   - Searches suppliers table for owner_address or operator_address (address field)
   - Uses case-insensitive partial matching (ILIKE) and exact matching
   - Filters by supplier status (default: 'staked', use 'all' to return all statuses)
   - Returns unique owner addresses and unique supplier operator addresses that match
   - Supports both exact and partial address matches

2. **Service URL Search** (when query is not an address):
   - Searches in service JSON-RPC URLs stored in `supplier_service_configs.endpoints` array
   - Uses case-insensitive partial matching (ILIKE) - matches URLs containing the search query
   - Filters by supplier status (default: 'staked', use 'all' to return all statuses)
   - Finds all suppliers that have at least one service endpoint matching the search
   - Returns unique owner addresses and unique supplier operator addresses for all matching suppliers

3. **Use Cases**:
   - **Search by owner address**: Query with `pokt1...` to find all suppliers owned by that address
   - **Search by operator address**: Query with `poktvaloper1...` to find specific suppliers
   - **Search by service URL**: Query with domain/URL (e.g., `stakenodes.org`) to find all suppliers using that service
   - **Select owner_address**: Use the `owner_addresses` array to select an owner and view all operators for that owner
   - **Filter by supplier**: Use the `supplier_operator_addresses` array to filter between specific suppliers

4. **Performance**:
   - Uses PostgreSQL GIN indexes for fast array searches (from migration 023)
   - Indexes on owner_address and address for fast address lookups
   - Optimized queries with CTEs for efficient processing
   - Cached with 300s TTL for improved performance

#### Example Request

```bash
# Search with default status (staked)
GET /api/v1/suppliers/search?q=pokt1abc123&chain=pocket-mainnet&limit=10

# Search with specific status
GET /api/v1/suppliers/search?q=stakenodes.org&chain=pocket-mainnet&status=staked

# Search unstaked suppliers
GET /api/v1/suppliers/search?q=pokt1abc123&status=unstaked

# Search all suppliers regardless of status
GET /api/v1/suppliers/search?q=stakenodes.org&status=all
```

#### Example Response

```json
{
  "owner_addresses": [
    "pokt1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
    "pokt1def456ghi789jkl012mno345pqr678stu901vwx234yzabc123"
  ],
  "supplier_operator_addresses": [
    "poktvaloper1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz",
    "poktvaloper1def456ghi789jkl012mno345pqr678stu901vwx234yzabc123",
    "poktvaloper1ghi789jkl012mno345pqr678stu901vwx234yzabc123def456"
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
GET /api/v1/suppliers/search?q=pokt1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz&chain=pocket-mainnet
```

Returns unique owner addresses and supplier operator addresses for suppliers where the owner_address matches.

### 2. Search by Operator Address

Find a specific supplier by operator address:

```bash
GET /api/v1/suppliers/search?q=poktvaloper1abc123def456ghi789jkl012mno345pqr678stu901vwx234yz
```

Returns the owner address and operator address for the matching supplier.

### 3. Search by Partial Address

Find suppliers by partial address match:

```bash
GET /api/v1/suppliers/search?q=pokt1abc123
```

Returns all suppliers where owner_address or operator_address contains the query.

### 4. Search by Service URL Domain

Find all suppliers and owners that use services with a specific domain:

```bash
GET /api/v1/suppliers/search?q=stakenodes.org&chain=pocket-mainnet
```

Returns unique owner addresses and supplier operator addresses for all suppliers that have service URLs containing "stakenodes.org".

### 5. Search by Service URL Path

Find suppliers by service URL path:

```bash
GET /api/v1/suppliers/search?q=/v1/lb/ethereum-mainnet
```

Returns all suppliers that have this path in their service endpoints.

### 6. Filter by Chain

Limit search to a specific chain:

```bash
GET /api/v1/suppliers/search?q=gateway.pokt.network&chain=pocket-mainnet
```

### 7. Using the Results

**Select Owner Address:**
- Use `owner_addresses` array to get all unique owners
- Select an owner to view all operators for that owner in other endpoints

**Filter by Supplier:**
- Use `supplier_operator_addresses` array to get all unique suppliers
- Use these addresses to filter performance data or other queries

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
interface SupplierSearchResponse {
  owner_addresses: string[];              // Unique owner addresses (pokt1...)
  supplier_operator_addresses: string[]; // Unique supplier operator addresses (poktvaloper1...)
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

  // Handle owner address selection
  const handleOwnerSelect = useCallback((ownerAddress: string) => {
    // Use owner address to filter other queries
    console.log('Selected owner:', ownerAddress);
    // Example: Fetch all suppliers for this owner
  }, []);

  // Handle supplier selection
  const handleSupplierSelect = useCallback((supplierAddress: string) => {
    // Use supplier address to filter performance data
    console.log('Selected supplier:', supplierAddress);
    // Example: Fetch performance data for this supplier
  }, []);

  return (
    <div className="supplier-search">
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search by service URL (e.g., stakenodes.org)..."
        className="search-input"
      />

      {loading && <div>Searching...</div>}

      {searchResults.owner_addresses.length > 0 && (
        <div className="search-results">
          <h3>Owner Addresses ({searchResults.owner_addresses.length})</h3>
          {searchResults.owner_addresses.map((ownerAddress, idx) => (
            <div 
              key={idx} 
              className="result-item"
              onClick={() => handleOwnerSelect(ownerAddress)}
            >
              <div className="result-owner">{ownerAddress}</div>
              <div className="result-hint">Click to view all operators for this owner</div>
            </div>
          ))}
        </div>
      )}

      {searchResults.supplier_operator_addresses.length > 0 && (
        <div className="search-results">
          <h3>Supplier Operators ({searchResults.supplier_operator_addresses.length})</h3>
          {searchResults.supplier_operator_addresses.map((supplierAddress, idx) => (
            <div 
              key={idx} 
              className="result-item"
              onClick={() => handleSupplierSelect(supplierAddress)}
            >
              <div className="result-operator">{supplierAddress}</div>
              <div className="result-hint">Click to filter by this supplier</div>
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

