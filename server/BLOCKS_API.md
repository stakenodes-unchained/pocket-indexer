# Blocks API Endpoints

This document describes the API endpoints for accessing blockchain block data.

## Base URL
All endpoints are prefixed with `/api/v1`

---

## Endpoints

### 1. Get Blocks (Paginated)

**GET** `/api/v1/blocks`

Retrieve blocks with pagination and optional filters.

**Query Parameters:**
- `chain` (string, optional): Filter by chain identifier (e.g., "mainnet", "testnet")
- `page` (integer, default: 1): Page number for pagination
- `limit` (integer, default: 100): Number of results per page (max recommended: 1000)
- `start_height` (integer, optional): Filter blocks from this height onwards
- `end_height` (integer, optional): Filter blocks up to this height
- `start_date` (datetime, optional): Filter blocks from this timestamp onwards (ISO 8601 format)
- `end_date` (datetime, optional): Filter blocks up to this timestamp (ISO 8601 format)

**Response Format:**
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
    },
    {
      "id": "mainnet:XYZ789...",
      "height": 482816,
      "hash": "XYZ789UVW012...",
      "timestamp": "2025-01-27T10:29:00Z",
      "proposer": "pokt1xyz...",
      "chain": "mainnet",
      "raw_block_size": 43210,
      "block_production_time": 14.987,
      "transaction_count": 38
    }
  ],
  "meta": {
    "total": 482817,
    "page": 1,
    "limit": 100,
    "totalPages": 4829
  }
}
```

**Response Fields:**
- `id`: Unique block identifier (format: `chain:hash`)
- `height`: Block height (integer)
- `hash`: Block hash (hex string)
- `timestamp`: Block timestamp (ISO 8601 format, UTC)
- `proposer`: Block proposer address
- `chain`: Chain identifier
- `raw_block_size`: Raw block size in bytes (serialized block size as received over the wire). This represents the binary length of the serialized block data. (integer, nullable)
- `block_production_time`: Time in seconds it took to produce this block (time difference between current and previous block). Calculated as the difference between the current block's timestamp and the previous block's timestamp. (numeric with 3 decimal places, nullable - null for genesis block or if previous block is not available)
- `transaction_count`: Number of transactions in this block (integer)

**Example Requests:**

```bash
# Get latest 100 blocks for mainnet
curl "http://localhost:3006/api/v1/blocks?chain=mainnet&page=1&limit=100"

# Get blocks for a specific height range
curl "http://localhost:3006/api/v1/blocks?chain=mainnet&start_height=482800&end_height=482817"

# Get blocks for a date range
curl "http://localhost:3006/api/v1/blocks?chain=mainnet&start_date=2025-01-27T00:00:00Z&end_date=2025-01-27T23:59:59Z"

# Get blocks with pagination
curl "http://localhost:3006/api/v1/blocks?chain=mainnet&page=2&limit=50"

# Get all blocks across all chains (no chain filter)
curl "http://localhost:3006/api/v1/blocks?page=1&limit=100"
```

**Frontend Usage:**

```javascript
// Fetch blocks with pagination
async function fetchBlocks(chain = 'mainnet', page = 1, limit = 100) {
  const response = await fetch(
    `/api/v1/blocks?chain=${chain}&page=${page}&limit=${limit}`
  );
  const result = await response.json();
  
  return {
    blocks: result.data,
    pagination: result.meta
  };
}

// Fetch blocks by height range
async function fetchBlocksByHeight(chain, startHeight, endHeight) {
  const response = await fetch(
    `/api/v1/blocks?chain=${chain}&start_height=${startHeight}&end_height=${endHeight}`
  );
  const result = await response.json();
  return result.data;
}

// Example: Pagination component
function BlockList({ chain }) {
  const [page, setPage] = useState(1);
  const [blocks, setBlocks] = useState([]);
  const [pagination, setPagination] = useState(null);
  
  useEffect(() => {
    fetchBlocks(chain, page, 100).then(({ blocks, pagination }) => {
      setBlocks(blocks);
      setPagination(pagination);
    });
  }, [chain, page]);
  
  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Height</th>
            <th>Hash</th>
            <th>Timestamp</th>
            <th>Proposer</th>
            <th>Size (Bytes)</th>
            <th>Production Time (s)</th>
            <th>Transactions</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map(block => (
            <tr key={block.id}>
              <td>{block.height}</td>
              <td>{block.hash.substring(0, 16)}...</td>
              <td>{new Date(block.timestamp).toLocaleString()}</td>
              <td>{block.proposer}</td>
              <td>{block.raw_block_size ? block.raw_block_size.toLocaleString() : 'N/A'}</td>
              <td>{block.block_production_time ? block.block_production_time.toFixed(3) : 'N/A'}</td>
              <td>{block.transaction_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {pagination && (
        <div className="pagination">
          <button 
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>Page {page} of {pagination.totalPages}</span>
          <button 
            disabled={page >= pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
```

---

### 2. Get Block by ID or Height

**GET** `/api/v1/blocks/:block_id`

Retrieve a specific block by its ID (hash) or height.

**Path Parameters:**
- `block_id` (string): Block ID (hash) or height (integer)

**Query Parameters:**
- `chain` (string, optional): Chain identifier (required if using height)

**Response Format:**
```json
{
  "data": {
    "id": "mainnet:ABC123...",
    "height": 482817,
    "hash": "ABC123DEF456...",
    "timestamp": "2025-01-27T10:30:00Z",
    "proposer": "pokt1abc...",
    "chain": "mainnet",
    "raw_block_size": 45678,
    "block_production_time": 15.234,
    "transaction_count": 42,
    "block_data": {
      "block_id": {
        "hash": "ABC123DEF456..."
      },
      "block": {
        "header": {
          "version": { "block": "11", "app": "0" },
          "chain_id": "mainnet",
          "height": "482817",
          "time": "2025-01-27T10:30:00Z",
          "proposer_address": "pokt1abc...",
          ...
        },
        "data": {
          "txs": [...]
        },
        ...
      }
    }
  }
}
```

**Response Fields:**
- All fields from the list endpoint, including:
- `raw_block_size`: Raw block size in bytes (serialized block size as received over the wire)
- `block_production_time`: Time in seconds it took to produce this block (time difference between current and previous block)
- `transaction_count`: Number of transactions in this block
- `block_data`: Complete block data from RPC API response stored as JSONB. This contains the full block information including header, transactions, evidence, and last_commit data. Available to avoid additional RPC calls when detailed block information is needed. (JSON object, nullable - null for blocks indexed before this feature was added)

**Example Requests:**

```bash
# Get block by hash/ID
curl "http://localhost:3006/api/v1/blocks/mainnet:ABC123DEF456..."

# Get block by height (requires chain parameter)
curl "http://localhost:3006/api/v1/blocks/482817?chain=mainnet"

# Get block by ID without chain
curl "http://localhost:3006/api/v1/blocks/mainnet:ABC123DEF456..."
```

**Frontend Usage:**

```javascript
// Fetch block by height
async function fetchBlockByHeight(chain, height) {
  const response = await fetch(
    `/api/v1/blocks/${height}?chain=${chain}`
  );
  const result = await response.json();
  
  if (response.status === 404) {
    throw new Error('Block not found');
  }
  
  return result.data;
}

// Fetch block by hash
async function fetchBlockByHash(blockId) {
  const response = await fetch(`/api/v1/blocks/${blockId}`);
  const result = await response.json();
  
  if (response.status === 404) {
    throw new Error('Block not found');
  }
  
  return result.data;
}

// Example: Block detail component
function BlockDetail({ blockId }) {
  const [block, setBlock] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    fetchBlockByHash(blockId)
      .then(setBlock)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [blockId]);
  
  if (loading) return <div>Loading...</div>;
  if (!block) return <div>Block not found</div>;
  
  return (
    <div>
      <h2>Block #{block.height}</h2>
      <p>Hash: {block.hash}</p>
      <p>Timestamp: {new Date(block.timestamp).toLocaleString()}</p>
      <p>Proposer: {block.proposer}</p>
      <p>Raw Block Size: {block.raw_block_size ? `${block.raw_block_size.toLocaleString()} bytes` : 'N/A'}</p>
      <p>Block Production Time: {block.block_production_time ? `${block.block_production_time.toFixed(3)} seconds` : 'N/A'}</p>
      <p>Transactions: {block.transaction_count}</p>
    </div>
  );
}
```

---

## Performance Notes

- Blocks are ordered by `height DESC, timestamp DESC` (newest first)
- Queries use indexes on `chain`, `height`, and `timestamp`
- For best performance, always specify `chain` when possible
- Large `limit` values (>1000) may be slower; recommended max is 1000

---

## Error Handling

All endpoints return errors in the following format:
```json
{
  "error": "Error message description"
}
```

**Common HTTP Status Codes:**
- `200`: Success
- `404`: Block not found (for single block endpoint)
- `500`: Server error

---

## Use Cases

### 1. Block Explorer
- Display latest blocks with pagination
- Show block details with transaction count
- Filter by chain and date ranges

### 2. Analytics Dashboard
- Track block production over time
- Monitor proposer distribution
- Analyze block heights and timestamps
- Monitor block sizes and production times
- Track network performance metrics (block production time trends)

### 3. Historical Analysis
- Query blocks by height range
- Filter by date ranges for time-based analysis
- Track blockchain progress across chains

---

## Notes

- All timestamps are in ISO 8601 format (UTC)
- Block IDs are in the format `chain:hash` for multi-chain support
- Height is unique per chain (enforced by database constraint)
- When querying by height, `chain` parameter is required to ensure correct block retrieval
- Transaction count is calculated on-demand from the transactions table
- `raw_block_size` represents the serialized block size in bytes (the same data the node receives over the wire)
- `block_production_time` is calculated as the time difference between the current block's timestamp and the previous block's timestamp
- `block_production_time` will be `null` for the genesis block (height 1) or if the previous block is not available in the database
- `raw_block_size` may be `null` for blocks indexed before this feature was added; these will be populated on re-indexing
- `block_data` contains the complete block JSON from the RPC API response, stored as JSONB for efficient querying without additional RPC calls
- `block_data` is only included in the detail endpoint (`GET /api/v1/blocks/:block_id`) to keep list responses lightweight
- `block_data` may be `null` for blocks indexed before this feature was added; these will be populated on re-indexing

