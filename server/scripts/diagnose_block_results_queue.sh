#!/bin/bash

# Diagnose why block results workers are not processing
# Checks queue state, worker roles, and range issues

API_URL="https://explorer.pocket.network/api/v1/health/block-results-workers"

echo "=========================================="
echo "Block Results Queue Diagnostic"
echo "=========================================="
echo ""

# Fetch current status
response=$(curl -s "$API_URL")

if [ $? -ne 0 ] || [ -z "$response" ]; then
    echo "ERROR: Failed to fetch health endpoint"
    exit 1
fi

echo "=== MAINNET ==="
mainnet_queue=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .queue_size')
mainnet_processing=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .processing_items')
mainnet_max=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .max_processed_height')
mainnet_current=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .current_block_height // "null"')
mainnet_last=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .last_processed_block_height // "null"')
mainnet_last_update=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .last_update')

echo "Queue size: $mainnet_queue"
echo "Processing items: $mainnet_processing"
echo "Max processed height: $mainnet_max"
echo "Current block height: $mainnet_current"
echo "Last processed: $mainnet_last"
echo "Last update: $(date -r $((mainnet_last_update / 1000)) 2>/dev/null || echo 'unknown')"
echo ""

# Calculate gap
if [ "$mainnet_current" != "null" ] && [ "$mainnet_max" != "null" ]; then
    gap=$((mainnet_max - mainnet_current))
    echo "Gap from current to max: $gap blocks"
    
    # Check if gap is within window
    window=2000
    if [ $gap -gt $window ]; then
        echo "⚠️  WARNING: Gap ($gap) exceeds window ($window)"
        echo "   'current' workers can only process blocks within $window of latest"
        echo "   Blocks older than (latest - $window) need 'historical' workers"
    fi
fi

echo ""
echo "=== TESTNET ==="
testnet_queue=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-testnet-beta") | .queue_size')
testnet_processing=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-testnet-beta") | .processing_items')
testnet_max=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-testnet-beta") | .max_processed_height')
testnet_current=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-testnet-beta") | .current_block_height // "null"')

echo "Queue size: $testnet_queue"
echo "Processing items: $testnet_processing"
echo "Max processed height: $testnet_max"
echo "Current block height: $testnet_current"
echo ""

echo "=== DIAGNOSIS ==="
echo ""

# Check if workers are processing
if [ "$mainnet_processing" = "0" ] && [ "$mainnet_queue" -gt 0 ]; then
    echo "❌ MAINNET: Queue has $mainnet_queue items but 0 processing"
    echo "   Possible causes:"
    echo "   1. Workers can't fetch latest height (RPC issue)"
    echo "   2. All queued blocks are outside processing window"
    echo "   3. Workers are stuck in lease scan"
    echo "   4. Processing locks are stale"
    echo ""
fi

if [ "$testnet_processing" = "0" ] && [ "$testnet_queue" -gt 0 ]; then
    echo "❌ TESTNET: Queue has $testnet_queue items but 0 processing"
    echo "   Same possible causes as mainnet"
    echo ""
fi

# Check worker roles
echo "Worker Role Distribution (from code):"
echo "  - Workers 0, 3: 'current' role (process blocks within 2000 of latest)"
echo "  - Workers 1, 2, 4, 5: 'historical' role (process blocks older than latest - 2000)"
echo ""

# Recommendations
echo "=== RECOMMENDATIONS ==="
echo ""
echo "1. Check Docker logs for errors:"
echo "   docker logs pocket_indexer_service --tail 100 | grep -i 'pocket-mainnet'"
echo ""
echo "2. Check if workers can fetch latest height:"
echo "   Look for 'Could not fetch latest height' in logs"
echo ""
echo "3. Check for 'Queue has X items but none dequeued' messages:"
echo "   This indicates range/window issues"
echo ""
echo "4. If latest height fetch is failing, workers can't determine range"
echo "   Fix: Ensure RPC endpoint is accessible"
echo ""
echo "5. If all blocks are outside window, increase window or process manually:"
echo "   BLOCK_RESULTS_CURRENT_WINDOW_BLOCKS=5000"
echo ""

