#!/bin/bash

# Monitor Block Results Workers Performance
# Fetches health endpoint every 15 seconds and tracks metrics
# Usage: ./monitor_block_results_workers.sh [duration_minutes]

API_URL="https://explorer.pocket.network/api/v1/health/block-results-workers"
INTERVAL=15  # seconds
DURATION=${1:-5}  # minutes (default: 5)
MAX_ITERATIONS=$((DURATION * 60 / INTERVAL))
OUTPUT_DIR="monitoring_data"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="${OUTPUT_DIR}/workers_monitor_${TIMESTAMP}.json"
SUMMARY_FILE="${OUTPUT_DIR}/workers_summary_${TIMESTAMP}.txt"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "=========================================="
echo "Block Results Workers Monitor"
echo "=========================================="
echo "API: $API_URL"
echo "Interval: ${INTERVAL}s"
echo "Duration: ${DURATION} minutes (${MAX_ITERATIONS} iterations)"
echo "Output: $OUTPUT_FILE"
echo "Summary: $SUMMARY_FILE"
echo "=========================================="
echo ""

# Initialize summary file
cat > "$SUMMARY_FILE" << EOF
Block Results Workers Performance Monitor
==========================================
Started: $(date)
Duration: ${DURATION} minutes
Interval: ${INTERVAL} seconds
Total iterations: ${MAX_ITERATIONS}
==========================================

EOF

# Array to store snapshots
declare -a snapshots

# Function to fetch and parse data
fetch_data() {
    local iteration=$1
    local timestamp=$(date +%s)
    local datetime=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo "[$datetime] Fetching iteration $iteration/$MAX_ITERATIONS..."
    
    # Fetch data
    local response=$(curl -s "$API_URL")
    
    if [ $? -ne 0 ] || [ -z "$response" ]; then
        echo "  ERROR: Failed to fetch data"
        return 1
    fi
    
    # Save raw JSON
    echo "$response" | jq ". + {\"timestamp\": $timestamp, \"datetime\": \"$datetime\", \"iteration\": $iteration}" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"  # Add newline between entries
    
    # Extract key metrics
    local mainnet_queue=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .queue_size')
    local mainnet_processed=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .processed_count')
    local mainnet_processing=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .processing_items')
    local mainnet_status=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .status')
    local mainnet_current=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .current_block_height // "null"')
    local mainnet_last=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .last_processed_block_height // "null"')
    local mainnet_avg_time=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-mainnet") | .avg_processing_time_ms // "null"')
    
    local testnet_queue=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-testnet-beta") | .queue_size')
    local testnet_processed=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-testnet-beta") | .processed_count')
    local testnet_processing=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-testnet-beta") | .processing_items')
    local testnet_status=$(echo "$response" | jq -r '.data.workers[] | select(.rpc_name == "pocket-testnet-beta") | .status')
    
    # Store snapshot
    snapshots[$iteration]="$timestamp|$mainnet_queue|$mainnet_processed|$mainnet_processing|$mainnet_status|$mainnet_current|$mainnet_last|$mainnet_avg_time|$testnet_queue|$testnet_processed|$testnet_processing|$testnet_status"
    
    # Display current status
    printf "  MAINNET:  queue=%5s  processed=%4s  processing=%s  status=%-8s  current=%s  avg_time=%s\n" \
        "$mainnet_queue" "$mainnet_processed" "$mainnet_processing" "$mainnet_status" "$mainnet_current" "$mainnet_avg_time"
    printf "  TESTNET:  queue=%5s  processed=%4s  processing=%s  status=%-8s\n" \
        "$testnet_queue" "$testnet_processed" "$testnet_processing" "$testnet_status"
    
    # Append to summary
    {
        echo "[$datetime] Iteration $iteration"
        echo "  MAINNET:  queue=$mainnet_queue  processed=$mainnet_processed  processing=$mainnet_processing  status=$mainnet_status  current=$mainnet_current  last=$mainnet_last  avg_time=$mainnet_avg_time"
        echo "  TESTNET:  queue=$testnet_queue  processed=$testnet_processed  processing=$testnet_processing  status=$testnet_status"
        echo ""
    } >> "$SUMMARY_FILE"
    
    return 0
}

# Initialize output file
echo "[" > "$OUTPUT_FILE"

# Main monitoring loop
for i in $(seq 1 $MAX_ITERATIONS); do
    if [ $i -gt 1 ]; then
        # Add comma separator for JSON array (except first entry)
        echo "," >> "$OUTPUT_FILE"
    fi
    
    fetch_data $i
    
    # Wait before next iteration (except last)
    if [ $i -lt $MAX_ITERATIONS ]; then
        sleep $INTERVAL
    fi
done

# Close JSON array
echo "]" >> "$OUTPUT_FILE"

# Calculate statistics
echo ""
echo "=========================================="
echo "Calculating Statistics..."
echo "=========================================="

# Calculate changes
if [ ${#snapshots[@]} -ge 2 ]; then
    first_snapshot=${snapshots[1]}
    last_snapshot=${snapshots[$MAX_ITERATIONS]}
    
    IFS='|' read -r -a first <<< "$first_snapshot"
    IFS='|' read -r -a last <<< "$last_snapshot"
    
    mainnet_queue_start=${first[1]}
    mainnet_processed_start=${first[2]}
    mainnet_queue_end=${last[1]}
    mainnet_processed_end=${last[2]}
    
    mainnet_queue_change=$((mainnet_queue_end - mainnet_queue_start))
    mainnet_processed_change=$((mainnet_processed_end - mainnet_processed_start))
    
    time_elapsed=$((MAX_ITERATIONS * INTERVAL))
    time_minutes=$((time_elapsed / 60))
    
    if [ $time_elapsed -gt 0 ]; then
        blocks_per_minute=$(echo "scale=2; $mainnet_processed_change * 60 / $time_elapsed" | bc)
        queue_change_per_minute=$(echo "scale=2; $mainnet_queue_change * 60 / $time_elapsed" | bc)
    else
        blocks_per_minute=0
        queue_change_per_minute=0
    fi
    
    {
        echo ""
        echo "=========================================="
        echo "Statistics Summary"
        echo "=========================================="
        echo "Monitoring duration: ${time_minutes} minutes (${time_elapsed} seconds)"
        echo ""
        echo "MAINNET Changes:"
        echo "  Queue start:     $mainnet_queue_start"
        echo "  Queue end:       $mainnet_queue_end"
        echo "  Queue change:    $mainnet_queue_change ($queue_change_per_minute per minute)"
        echo "  Processed start: $mainnet_processed_start"
        echo "  Processed end:   $mainnet_processed_end"
        echo "  Processed change: $mainnet_processed_change blocks"
        echo "  Processing rate: $blocks_per_minute blocks/minute"
        echo ""
        
        if [ $mainnet_queue_change -lt 0 ]; then
            echo "  ✓ Queue is decreasing (good!)"
        elif [ $mainnet_queue_change -eq 0 ]; then
            echo "  ⚠ Queue is not changing"
        else
            echo "  ✗ Queue is increasing (bad!)"
        fi
        
        if [ $mainnet_processed_change -gt 0 ]; then
            echo "  ✓ Blocks are being processed"
        else
            echo "  ✗ No blocks processed"
        fi
    } >> "$SUMMARY_FILE"
    
    echo "Statistics saved to $SUMMARY_FILE"
fi

echo ""
echo "=========================================="
echo "Monitoring Complete!"
echo "=========================================="
echo "Raw data: $OUTPUT_FILE"
echo "Summary:  $SUMMARY_FILE"
echo ""
echo "To analyze the data:"
echo "  cat $SUMMARY_FILE"
echo "  jq '.[] | select(.data.workers[].rpc_name == \"pocket-mainnet\")' $OUTPUT_FILE"
echo ""

