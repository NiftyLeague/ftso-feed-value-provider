#!/bin/bash
# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"
source "$(dirname "$0")/../utils/parse-logs.sh"
source "$(dirname "$0")/../utils/cleanup.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Feed Data Quality and Validation Debugging Script
# Tests feed data accuracy, consensus, and validation processes

echo "📊 FTSO Feed Data Debugger"
echo "=========================="

# Ensure logs directory exists

# Configuration
TIMEOUT=90  # Reduced timeout to prevent memory issues

# Set up logging using common utility
echo "📝 Starting feed data analysis..."
setup_debug_logging "feeds-debug"
LOG_FILE="$DEBUG_LOG_FILE"


# Start the application in background with clean output capture
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring feed data for $TIMEOUT seconds..."

# Wait for application to initialize with proper health checks
echo "⏳ Waiting for server to be ready..."
READY=false
WEBSOCKETS_READY=false

# First wait for basic server health
for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/health 2>/dev/null | grep -q "200"; then
        echo "✅ Server health endpoint ready after ${i} seconds"
        READY=true
        break
    fi
    sleep 2
done

# Test feed endpoints immediately after server is ready
if [ "$READY" = true ]; then
    echo "🧪 Testing feed endpoints..."
    echo "✅ Server is ready, testing feed endpoints..."
    
    # Test feed values endpoint
    echo "📊 Testing feed values..."
    HTTP_CODE=$(curl -s -w "%{http_code}" -X POST http://localhost:3101/feed-values \
         -H "Content-Type: application/json" \
         -d '{"feeds": [{"category": 1, "name": "BTC/USD"}, {"category": 1, "name": "ETH/USD"}, {"category": 1, "name": "FLR/USD"}]}' \
         -o logs/feed-values-response.json 2>/dev/null)
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo "✅ Feed values endpoint responded (HTTP $HTTP_CODE)"
        FEED_VALUES_SUCCESS=true
    else
        echo "❌ Feed values endpoint failed (HTTP $HTTP_CODE)"
        FEED_VALUES_SUCCESS=false
    fi
    
    # Test volumes endpoint
    echo "📈 Testing volumes..."
    HTTP_CODE=$(curl -s -w "%{http_code}" -X POST http://localhost:3101/volumes \
         -H "Content-Type: application/json" \
         -d '{"feeds": [{"category": 1, "name": "BTC/USD"}, {"category": 1, "name": "ETH/USD"}]}' \
         -o logs/volumes-response.json 2>/dev/null)
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        echo "✅ Volumes endpoint responded (HTTP $HTTP_CODE)"
        VOLUMES_SUCCESS=true
    else
        echo "❌ Volumes endpoint failed (HTTP $HTTP_CODE)"
        VOLUMES_SUCCESS=false
    fi
    
    # Only wait for WebSocket connections if API endpoints failed
    if [ "$FEED_VALUES_SUCCESS" = true ] && [ "$VOLUMES_SUCCESS" = true ]; then
        echo "✅ API endpoints working - system is fully operational"
        WEBSOCKETS_READY=true
    else
        echo "⚠️  API endpoints not fully working - system may still be initializing"
        echo "⏳ Continuing with monitoring to gather available data..."
        WEBSOCKETS_READY=false
    fi
else
    echo "⚠️  Server not ready after 60 seconds, continuing with monitoring..."
    sleep $((TIMEOUT - 60))
    echo "⚠️  Server not ready for endpoint testing"
fi

# Stop the application
if kill -0 $APP_PID 2>/dev/null; then
    echo "🛑 Stopping application..."
    stop_tracked_apps
fi

echo ""
echo "📊 Feed Data Analysis:"
echo "====================="

if [ -f "$LOG_FILE" ]; then
    echo "🎯 Feed Configuration:"
    echo "---------------------"
    
    # Count configured feeds
    CONFIGURED_FEEDS=$(grep -o "Built feed mapping: [0-9]* feeds" "$LOG_FILE" | grep -o "[0-9]*" | head -1)
    if [ -z "$CONFIGURED_FEEDS" ]; then
        CONFIGURED_FEEDS=$(grep -c "Configured sources for feed" "$LOG_FILE")
    fi
    echo "📊 Configured feeds: ${CONFIGURED_FEEDS:-0}"
    
    # Show feed mapping
    echo ""
    echo "🗺️  Feed Mapping:"
    grep -E "Built feed mapping|Configured sources for feed" "$LOG_FILE" | head -10
    
    echo ""
    echo "📈 Data Quality Metrics:"
    echo "-----------------------"
    
    # Consensus and validation
    CONSENSUS_EVENTS=$(grep -c "Consensus\|consensus" "$LOG_FILE")
    echo "🎯 Consensus events: $CONSENSUS_EVENTS"
    
    VALIDATION_EVENTS=$(grep -c "Validation\|validation\|validated" "$LOG_FILE")
    echo "✅ Validation events: $VALIDATION_EVENTS"
    
    # Data quality issues (exclude configuration definitions)
    echo ""
    echo "⚠️  Data Quality Issues:"
    echo "-----------------------"
    
    OUTLIERS=$(grep -c "outlier.*detected\|Outlier.*detected" "$LOG_FILE")
    echo "📊 Outliers detected: $OUTLIERS"
    
    STALE_DATA=$(grep -c "stale.*data\|Stale.*data\|data.*outdated" "$LOG_FILE")
    echo "⏰ Stale data warnings: $STALE_DATA"
    
    CONSENSUS_DEVIATIONS=$(grep -c "deviation.*exceeded\|Deviation.*exceeded" "$LOG_FILE")
    echo "📈 Consensus deviations: $CONSENSUS_DEVIATIONS"
    
    # Show specific quality issues (exclude alert rule definitions)
    ACTUAL_ISSUES=$(grep -E "(outlier.*detected|stale.*data|deviation.*exceeded)" "$LOG_FILE" | head -5)
    if [ -n "$ACTUAL_ISSUES" ]; then
        echo "$ACTUAL_ISSUES"
    fi
    
    if [ "$OUTLIERS" -eq 0 ] && [ "$STALE_DATA" -eq 0 ] && [ "$CONSENSUS_DEVIATIONS" -eq 0 ]; then
        echo "✅ No data quality issues detected"
    fi
    
    # Check for data source health warnings
    HEALTH_WARNINGS=$(grep -c "is unhealthy" "$LOG_FILE")
    if [ "$HEALTH_WARNINGS" -gt 0 ]; then
        echo "ℹ️  Data source health warnings: $HEALTH_WARNINGS"
    fi
    
    # Check for critical errors
    HEALTH_ERRORS=$(grep -c "Readiness check failed\|Health check failed" "$LOG_FILE")
    if [ "$HEALTH_ERRORS" -gt 0 ]; then
        echo "🚨 Health check failures: $HEALTH_ERRORS (likely due to memory pressure)"
    fi
    
    echo ""
    echo "🔄 Aggregation Process:"
    echo "----------------------"
    
    # Aggregation events
    AGGREGATION_EVENTS=$(grep -c "Aggregation\|aggregation\|aggregated" "$LOG_FILE")
    echo "🔄 Aggregation events: $AGGREGATION_EVENTS"
    
    # Weight updates
    WEIGHT_UPDATES=$(grep -c "weight.*update\|Weight.*update" "$LOG_FILE")
    echo "⚖️  Weight updates: $WEIGHT_UPDATES"
    
    echo ""
    echo "📊 Exchange Data Sources:"
    echo "------------------------"
    
    # Count data from each exchange
    EXCHANGES=("binance" "coinbase" "kraken" "okx" "cryptocom")
    
    for exchange in "${EXCHANGES[@]}"; do
        DATA_COUNT=$(grep -c "price.*$exchange\|data.*$exchange" "$LOG_FILE")
        echo "📈 $exchange: $DATA_COUNT data points"
    done
    
    echo ""
    echo "🚨 Alerts and Warnings:"
    echo "----------------------"
    
    # Alert events (exclude configuration)
    ALERTS=$(grep -c "Alert.*triggered\|alert.*fired\|ALERT.*raised" "$LOG_FILE")
    echo "🚨 Alerts triggered: $ALERTS"
    
    # Show recent alerts (exclude configuration)
    ACTUAL_ALERTS=$(grep -E "(Alert.*triggered|alert.*fired|ALERT.*raised)" "$LOG_FILE" | tail -5)
    if [ -n "$ACTUAL_ALERTS" ]; then
        echo "$ACTUAL_ALERTS"
    else
        echo "✅ No alerts triggered during monitoring period"
    fi
    
    echo ""
    echo "⚡ Performance Metrics:"
    echo "---------------------"
    
    # Memory usage
    MEMORY_CRITICAL=$(grep -c "Memory usage is dangerously high\|CRITICAL.*Memory" "$LOG_FILE")
    if [ "$MEMORY_CRITICAL" -gt 0 ]; then
        echo "🚨 Critical memory issues: $MEMORY_CRITICAL"
        echo "📊 Memory details:"
        grep -E "Memory usage is dangerously high|CRITICAL.*Memory" "$LOG_FILE" | tail -3
    else
        echo "✅ No critical memory issues detected"
    fi
    
    # Response times
    grep -E "(response.*time|latency|Response.*time)" "$LOG_FILE" | head -3
    
    # Cache performance
    CACHE_HITS=$(grep -c "cache.*hit\|Cache.*hit" "$LOG_FILE")
    echo "💾 Cache hits: $CACHE_HITS"
    
else
    echo "❌ No log file found"
fi

# Analyze API responses if available
echo ""
echo "🧪 API Response Analysis:"
echo "========================"

if [ -f "logs/feed-values-response.json" ]; then
    echo "📊 Feed Values Response:"
    echo "-----------------------"
    
    # Check if response is valid JSON
    if jq empty logs/feed-values-response.json 2>/dev/null; then
        echo "✅ Valid JSON response"
        
        # Count feeds in response
        FEED_COUNT=$(jq -r '.data | length' logs/feed-values-response.json 2>/dev/null || echo "0")
        echo "📊 Feeds returned: $FEED_COUNT"
        
        # Show sample data
        echo "📈 Sample feed data:"
        jq -r '.data[0:2] | .[] | "\(.feed.name): $\(.value) (confidence: \(.confidence))"' logs/feed-values-response.json 2>/dev/null || echo "No feed data available"
    else
        echo "❌ Invalid JSON response"
        head -3 logs/feed-values-response.json
    fi
else
    echo "❌ No feed values response available"
fi

if [ -f "logs/volumes-response.json" ]; then
    echo ""
    echo "📈 Volumes Response:"
    echo "-------------------"
    
    if jq empty logs/volumes-response.json 2>/dev/null; then
        echo "✅ Valid JSON response"
        
        VOLUME_COUNT=$(jq -r '.data | length' logs/volumes-response.json 2>/dev/null || echo "0")
        echo "📊 Volumes returned: $VOLUME_COUNT"
    else
        echo "❌ Invalid JSON response"
    fi
fi

# Clean up old logs if in session mode
cleanup_old_logs "feeds"

# Show log summary
log_summary "$LOG_FILE" "feeds" "debug"

echo ""
echo "✨ Feed analysis complete!"
echo "   - Feed values: logs/feed-values-response.json"
echo "   - Volumes: logs/volumes-response.json"