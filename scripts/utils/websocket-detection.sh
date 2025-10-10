#!/bin/bash

# Source readiness utilities for health checks
source "$(dirname "${BASH_SOURCE[0]}")/readiness-utils.sh"

# WebSocket Connection Detection Utilities
# Provides smart detection of when all WebSocket connections are ready
# and feeds system is initialized using periodic progress logging
#
# Key Functions:
# - wait_for_websocket_connections: Waits for WebSocket connections to establish
# - wait_for_websocket_subscriptions: Waits for WebSocket subscription phase to complete
# - wait_for_data_collection: ENHANCED - Uses periodic progress logging for accurate feed tracking
# - check_system_readiness: ENHANCED - Complete system readiness check including health endpoint, WebSockets, and feeds
#
# Enhanced functions use periodic progress messages from PriceAggregationCoordinatorService:
# - "Feed initialization progress: X/Y (Z%) after Ns (avg: As/feed) - recent: [...]"
# - "Data collection phase completed: X/Y feeds"

# Wait for all WebSocket connections to be established
wait_for_websocket_connections() {
    local log_file="$1"
    local max_wait_seconds="${2:-300}"  # Default 5 minutes
    local check_interval="${3:-5}"     # Check every 5 seconds
    
    # Wait for WebSocket connections to establish
    
    local wait_count=0
    local max_checks=$((max_wait_seconds / check_interval))
    
    while [ $wait_count -lt $max_checks ]; do
        # Check if we should exit (for interrupt handling)
        if [ "${CONTINUE_PROCESSING:-true}" = "false" ]; then
            echo "🛑 WebSocket detection interrupted"
            return 1
        fi
        if [ -f "$log_file" ]; then
            # Check for the specific completion message
            if grep -q "Connected to .*/18 exchanges" "$log_file" 2>/dev/null; then
                if grep -q "Asynchronous WebSocket initialization completed" "$log_file" 2>/dev/null; then
                    echo "✅ All WebSocket connections established ($((wait_count * check_interval))s)"
                    return 0
                fi
            fi
            
            # Show progress - count unique exchanges connected
            local connected_count=$(grep "Successfully connected to exchange:" "$log_file" 2>/dev/null | sed 's/.*exchange: \([^[:space:]]*\).*/\1/' | sort | uniq | wc -l | tr -d ' ' || echo "0")
            echo "   WebSocket connections: $connected_count/18 ($((wait_count * check_interval))s)"
        else
            echo "   Waiting for log file... ($((wait_count * check_interval))s)"
        fi
        
        wait_count=$((wait_count + 1))
        sleep $check_interval
    done
    
    echo "❌ WebSocket connections not ready within $max_wait_seconds seconds"
    return 1
}

# Wait for WebSocket subscription phase to complete
wait_for_websocket_subscriptions() {
    local log_file="$1"
    local max_wait_seconds="${2:-60}"   # Default 1 minute
    local check_interval="${3:-5}"      # Check every 5 seconds
    
    echo "⏳ Waiting for WebSocket subscription phase..."
    
    local wait_count=0
    local max_checks=$((max_wait_seconds / check_interval))
    
    while [ $wait_count -lt $max_checks ]; do
        # Check if we should exit (for interrupt handling)
        if [ "${CONTINUE_PROCESSING:-true}" = "false" ]; then
            echo "🛑 WebSocket subscription detection interrupted"
            return 1
        fi
        
        if [ -f "$log_file" ]; then
            # Check for subscription completion
            local subscription_completed=$(grep -c "WebSocket subscription phase completed" "$log_file" 2>/dev/null | head -1 || echo "0")
            
            if [ "$subscription_completed" -gt 0 ]; then
                echo "✅ WebSocket subscription phase completed"
                return 0
            else
                echo "   Waiting for subscription completion... ($((wait_count * check_interval))s)"
            fi
        else
            echo "   Waiting for log file... ($((wait_count * check_interval))s)"
        fi
        
        wait_count=$((wait_count + 1))
        sleep $check_interval
    done
    
    echo "⚠️  WebSocket subscription phase not completed within $max_wait_seconds seconds"
    return 1
}

# Wait for feed data collection using periodic progress logging
wait_for_data_collection() {
    local log_file="$1"
    local max_wait_seconds="${2:-120}"  # Default 2 minutes
    local check_interval="${3:-5}"      # Check every 5 seconds
    
    echo "⏳ Waiting for feed data collection using periodic progress logging..."
    
    local wait_count=0
    local max_checks=$((max_wait_seconds / check_interval))
    local last_progress_count=0
    local last_percentage=0
    local start_time=$(date +%s)  # Track actual elapsed time
    
    while [ $wait_count -lt $max_checks ]; do
        # Check if we should exit (for interrupt handling)
        if [ "${CONTINUE_PROCESSING:-true}" = "false" ]; then
            echo "🛑 Data collection detection interrupted"
            return 1
        fi
        
        if [ -f "$log_file" ]; then
            # Check for final data collection completion
            local data_collection_completed=$(grep -c "Data collection phase completed:" "$log_file" 2>/dev/null | head -1 || echo "0")
            
            if [ "$data_collection_completed" -gt 0 ]; then
                # Extract the final completion details
                local completion_line=$(grep "Data collection phase completed:" "$log_file" 2>/dev/null | tail -1)
                local feeds_ready=$(echo "$completion_line" | sed -n 's/.*Data collection phase completed: \([0-9]*\/[0-9]*\) feeds.*/\1/p')
                
                if [ -n "$feeds_ready" ]; then
                    echo "✅ Data collection completed: $feeds_ready feeds initialized"
                else
                    echo "✅ Data collection completed"
                fi
                return 0
            else
                # Show progress using periodic progress logging
                local latest_progress=$(grep "Feed initialization progress:" "$log_file" 2>/dev/null | tail -1)
                
                # Calculate actual elapsed time since start
                local current_time=$(date +%s)
                local elapsed_time=$((current_time - start_time))
                
                if [ -n "$latest_progress" ]; then
                    # Extract progress information from the log message
                    # Format: "Feed initialization progress: X/Y (Z%) after Ns (avg: As/feed) - recent: [...]"
                    local progress_info=$(echo "$latest_progress" | sed -n 's/.*Feed initialization progress: \([0-9]*\/[0-9]* ([0-9]*%)\).*/\1/p')
                    local avg_info=$(echo "$latest_progress" | sed -n 's/.*(avg: \([0-9.]*s\/feed\)).*/\1/p')
                    
                    if [ -n "$progress_info" ]; then
                        # Extract current count and percentage to detect meaningful changes
                        local current_count=$(echo "$progress_info" | sed 's/\([0-9]*\)\/.*/\1/')
                        local current_percentage=$(echo "$progress_info" | sed -n 's/.*(\([0-9]*\)%).*/\1/p')
                        
                        # Show progress if it has changed significantly or every 2 iterations (every 10 seconds)
                        local count_changed=$((current_count != last_progress_count))
                        local percentage_changed=$((current_percentage != last_percentage))
                        local periodic_update=$((wait_count % 2 == 0))  # Every 10 seconds
                        
                        if [ $count_changed -eq 1 ] || [ $percentage_changed -eq 1 ] || [ $periodic_update -eq 1 ]; then
                            if [ -n "$avg_info" ]; then
                                echo "   Feed initialization progress: $progress_info after ${elapsed_time}s (avg: $avg_info)"
                            else
                                echo "   Feed initialization progress: $progress_info after ${elapsed_time}s"
                            fi
                            last_progress_count="$current_count"
                            last_percentage="$current_percentage"
                        fi
                    else
                        # Fallback to counting operations if progress parsing fails
                        local aggregation_count=$(grep -c "Price aggregated:\|Aggregated price for\|Cache hit for\|getAggregatedPrice" "$log_file" 2>/dev/null | head -1 || echo "0")
                        echo "   Waiting for data collection completion... ($aggregation_count operations, ${elapsed_time}s)"
                    fi
                else
                    # Fallback to counting operations if no progress messages found
                    local aggregation_count=$(grep -c "Price aggregated:\|Aggregated price for\|Cache hit for\|getAggregatedPrice" "$log_file" 2>/dev/null | head -1 || echo "0")
                    echo "   Waiting for data collection completion... ($aggregation_count operations, ${elapsed_time}s)"
                fi
            fi
        else
            local current_time=$(date +%s)
            local elapsed_time=$((current_time - start_time))
            echo "   Waiting for log file... (${elapsed_time}s)"
        fi
        
        wait_count=$((wait_count + 1))
        sleep $check_interval
    done
    
    # Check if we have partial readiness
    if [ -f "$log_file" ]; then
        local latest_progress=$(grep "Feed initialization progress:" "$log_file" 2>/dev/null | tail -1)
        if [ -n "$latest_progress" ]; then
            local progress_info=$(echo "$latest_progress" | sed -n 's/.*Feed initialization progress: \([0-9]*\/[0-9]* ([0-9]*%)\).*/\1/p')
            if [ -n "$progress_info" ]; then
                echo "⚠️  Partial data collection detected: $progress_info after $max_wait_seconds seconds"
                echo "   System may be ready for testing with available feeds"
                return 0  # Don't fail, allow testing with partial readiness
            fi
        fi
    fi
    
    echo "⚠️  Limited data collection detected within $max_wait_seconds seconds"
    return 0  # Don't fail, just warn
}



# Check if system is ready for testing
check_system_readiness() {
    local log_file="$1"
    local require_websockets="${2:-true}"  # Default to requiring WebSockets
    local base_url="http://localhost:3101"  # Standard service URL
    
    echo "🔍 Checking system readiness..."
    
    # Step 1: Wait for service health endpoint to be ready
    echo "⏳ Waiting for service health endpoint..."
    if ! wait_for_service_health "$base_url" 30 2000 5000; then
        echo "❌ Service health endpoint not ready"
        return 1
    fi
    echo "✅ Service health endpoint ready"
    
    if [ "$require_websockets" = "true" ]; then
        # Step 2: Check WebSocket connections
        if ! wait_for_websocket_connections "$log_file" 30 5; then
            return 1
        fi
        
        # Step 3: Wait for WebSocket subscription phase
        if ! wait_for_websocket_subscriptions "$log_file" 30 5; then
            echo "⚠️  WebSocket subscriptions not completed, but continuing..."
        fi
        
        # Step 4: Wait for feed data collection using periodic progress logging
        wait_for_data_collection "$log_file" 60 5
    else
        # Just wait for basic server readiness
        echo "⏳ Waiting for basic server readiness..."
        local wait_count=0
        local max_checks=18  # 90 seconds max
        
        while [ $wait_count -lt $max_checks ]; do
            if [ -f "$log_file" ]; then
                # Look for server startup indicators (both dev and prod modes)
                if grep -q "Application started\|Server started\|Listening on\|NestApplication successfully started" "$log_file" 2>/dev/null; then
                    echo "✅ Server started"
                    return 0
                fi
            fi
            
            wait_count=$((wait_count + 1))
            sleep 5
        done
        
        echo "⚠️  Server startup not detected in logs, but continuing..."
    fi
    
    echo "✅ System is ready for testing"
    return 0
}