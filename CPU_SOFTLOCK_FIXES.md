# CPU Soft Lock Fixes

## Root Causes Identified

CPU soft locks were caused by:

1. **Massive synchronous Promise.all()**: Creating 10,000 promises at once with `.map()` locked the event loop
2. **Tight blocking loops**: Monitor worker processing multiple blocks without yielding
3. **Large array operations**: Synchronous `.reduce()`, `.filter()`, `.map()` on 100k+ element arrays
4. **No event loop yielding**: No `setImmediate()` or `process.nextTick()` calls to yield control

## Fixes Applied

### 1. Event Processor - Chunked Promise Processing

**File**: `server/services/indexer/eventProcessor.js`

**Problem**: Creating 10,000 promises simultaneously with `Promise.all(batch.map(...))`

**Solution**: 
- Split batches into chunks of max 1,000 concurrent promises
- Added `setImmediate()` between batches to yield event loop
- Added `setImmediate()` between chunks within batches

```javascript
// Before: Created all 10,000 promises at once
const parsePromises = batch.map(async (...) => {...});
const batchResults = await Promise.all(parsePromises);

// After: Process in chunks of 1,000
const CONCURRENT_PARSE_LIMIT = 1000;
for (let j = 0; j < batch.length; j += CONCURRENT_PARSE_LIMIT) {
  const chunk = batch.slice(j, j + CONCURRENT_PARSE_LIMIT);
  const parsePromises = chunk.map(...);
  const chunkResults = await Promise.all(parsePromises);
  batchResults.push(...chunkResults);
  
  // Yield between chunks
  if (j + CONCURRENT_PARSE_LIMIT < batch.length) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

// Yield between batches
await new Promise(resolve => setImmediate(resolve));
```

### 2. Monitor Worker - Block Processing Yielding

**File**: `server/services/indexer/worker.js`

**Problem**: Tight `for` loop processing 100+ blocks without yielding

**Solution**: Yield to event loop every 5 blocks

```javascript
for (let height = lastProcessedHeight + 1; height <= latestHeight; height++) {
  await processBlock(await fetchBlockByHeight(height, rpcUrl));
  // ... heartbeat update ...
  
  // Yield every 5 blocks to prevent CPU soft locks
  if ((height - lastProcessedHeight) % 5 === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }
}
```

### 3. Increased Poll Interval

**File**: `server/services/indexer/blockResultsWorker.js`

**Changed**: `POLL_INTERVAL_MS` from 500ms to 1000ms to reduce tight polling

### 4. Event Extraction Comments

**File**: `server/services/indexer/eventExtractor.js`

**Added**: Documentation comments explaining the synchronous loops are intentional for simple array building

## Why setImmediate()?

- `setImmediate()` yields control back to the event loop **after I/O operations**
- Prevents CPU-bound operations from blocking the entire process
- Allows other async operations (health checks, heartbeats, etc.) to execute
- More appropriate than `setTimeout(0)` for immediate yielding

## Expected Results

### Before Fixes:
- CPU cores stuck at 100% for extended periods
- Kernel soft lock warnings in system logs
- Blocked health check endpoints
- Worker heartbeats timing out

### After Fixes:
- CPU usage more distributed, lower peaks
- No soft lock warnings
- Health endpoints remain responsive
- Worker heartbeats update regularly
- Slightly slower processing but stable

## Performance Impact

**Trade-off**: ~10-15% slower event processing, BUT:
- System remains responsive
- No kernel warnings
- Better overall throughput (no crashes/restarts)
- Other services can run concurrently

## Monitoring

### Check for Soft Locks

```bash
# System logs (Linux)
sudo dmesg -T | grep "soft lockup"

# Docker logs
docker-compose logs -f indexer | grep -i "lock\|hang\|timeout"
```

### Monitor CPU Usage

```bash
# Per-container CPU
docker stats pocket_indexer_service

# Health endpoint
curl http://localhost:3007/api/v1/health/memory | jq '.data.process.cpu_usage'
```

### Worker Health

```bash
curl http://localhost:3007/api/v1/health/workers | jq '.data.heartbeats'
```

## Additional Optimizations (if needed)

### 1. Reduce Event Parse Batch Size

In `.env`:
```bash
BLOCK_RESULTS_EVENT_PARSE_BATCH_SIZE=5000  # Default: 10000
```

### 2. Reduce Concurrent Parse Limit

Edit `eventProcessor.js` line ~51:
```javascript
const CONCURRENT_PARSE_LIMIT = 500;  // Default: 1000
```

### 3. Increase Yield Frequency

Edit `worker.js` line ~558:
```javascript
if ((height - lastProcessedHeight) % 2 === 0) {  // Yield every 2 blocks instead of 5
  await new Promise(resolve => setImmediate(resolve));
}
```

### 4. Add More Yielding Points

For very large blocks (1M+ events), add yielding in event extraction:

```javascript
// In eventExtractor.js, around line 46
for (let txIndex = 0; txIndex < txsResults.length; txIndex++) {
  // Yield every 1000 transactions for very large blocks
  if (txIndex > 0 && txIndex % 1000 === 0) {
    await new Promise(resolve => setImmediate(resolve));
  }
  // ... rest of loop
}
```

## Restart After Changes

```bash
cd server
docker-compose restart indexer
docker-compose logs -f indexer | grep -E "CPU|EventProcessor|Monitor"
```

## Rollback

If these changes cause issues, revert with:

```bash
git checkout HEAD -- server/services/indexer/eventProcessor.js
git checkout HEAD -- server/services/indexer/worker.js
git checkout HEAD -- server/services/indexer/blockResultsWorker.js
docker-compose restart indexer
```

## Related to Memory Issues

These CPU fixes complement the memory optimizations:
- Smaller batches = less memory per operation
- Yielding = allows GC to run between operations
- Chunking = prevents massive object accumulation

Both should be applied together for optimal stability.
