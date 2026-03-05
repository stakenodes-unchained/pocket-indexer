# Memory Optimization Guide

## Issues Identified

The indexer processes were consuming excessive memory due to:

1. **Large Block Results**: Processing 2-4GB block results with multiple workers in parallel
2. **High Concurrency**: Too many parallel operations holding large objects in memory
3. **Memory Leaks**: Large objects not being explicitly cleared for garbage collection
4. **JSON Stringify**: Attempting to stringify multi-GB objects for size calculation

## Changes Made

### 1. Reduced Concurrency Settings

**`.env` file:**
- `WORKER_CONCURRENCY`: 2 → 1 (fewer concurrent workers)
- `HISTORICAL_BATCH_SIZE`: 10 → 5 (smaller batches)

**`docker-compose.yml` (indexer service):**
- `HISTORICAL_BATCH_SIZE`: 20 → 5
- `BLOCK_RESULTS_BATCH_SIZE`: 20 → 3
- `BLOCK_RESULTS_PARALLEL_LIMIT`: 20 → 5
- `DB_POOL_SIZE`: 10 → 5

### 2. Code Optimizations

**Block Results Worker (`blockResultsWorker.js`):**

1. **Size Estimation**: Replaced `JSON.stringify()` with mathematical estimation to avoid stringifying multi-GB objects
2. **Explicit Cleanup**: Added `blockResultsData = null; blockData = null;` after processing to help garbage collector
3. **Chunked Processing**: Modified `processItemsWithConcurrency()` to process items in chunks rather than accumulating all promises in memory

### 3. Node.js Heap Configuration

Current heap limit in docker-compose.yml:
```yaml
NODE_HEAP_SIZE_MB: 32768  # 32GB
```

Consider reducing if you're running on limited hardware:
```bash
# For 16GB systems:
NODE_HEAP_SIZE_MB=8192  # 8GB

# For 8GB systems:
NODE_HEAP_SIZE_MB=4096  # 4GB
```

## Monitoring Memory Usage

### Check Current Memory Usage

```bash
# Via API endpoint
curl http://localhost:3007/api/v1/health/memory | jq

# Via Docker
docker stats pocket_indexer_service
```

### Health Endpoint Response
```json
{
  "data": {
    "memory": {
      "heap": {
        "used_mb": 1234,
        "total_mb": 2048,
        "limit_mb": 32768,
        "used_percent": 3
      },
      "rss_mb": 2500,
      "external_mb": 150
    },
    "warnings": {
      "rss_high": false,
      "rss_threshold_mb": 12288
    }
  }
}
```

## Further Optimizations (if needed)

### 1. Enable Garbage Collection Exposure

Add to `docker-compose.yml` indexer service environment:
```yaml
- NODE_OPTIONS=--max-old-space-size=${NODE_HEAP_SIZE_MB:-8192} --expose-gc
```

This enables manual `global.gc()` calls (already added in code).

### 2. Reduce Block Results Worker Count

In `pool.js`, line 18:
```javascript
this.blockResultsWorkerCount = configLoader.get('BLOCK_RESULTS_WORKER_COUNT', 1);  // Reduced from 2
```

Or add to `.env`:
```bash
BLOCK_RESULTS_WORKER_COUNT=1
```

### 3. Disable Async Event Processing

Add to `.env`:
```bash
BLOCK_RESULTS_ASYNC_EVENTS=false
```

This makes event processing synchronous, reducing memory but increasing processing time.

### 4. Increase Processing Delays

Add to `.env`:
```bash
BLOCK_RESULTS_POLL_INTERVAL_MS=1000  # Default: 500ms
PROCESSING_DELAY=200  # Default: 100ms
```

## Restart After Changes

```bash
cd server
docker-compose restart indexer
docker-compose logs -f indexer
```

## Expected Results

After these optimizations:
- RSS memory should stabilize below 8GB (down from 12GB+ threshold)
- Heap usage should be more consistent
- Processing throughput will be lower but more stable
- Fewer OOM (Out of Memory) errors/crashes

## Rollback Plan

If processing becomes too slow, incrementally increase:
1. `BLOCK_RESULTS_PARALLEL_LIMIT`: 5 → 8
2. `BLOCK_RESULTS_BATCH_SIZE`: 3 → 5
3. `WORKER_CONCURRENCY`: 1 → 2

Monitor memory after each change.
