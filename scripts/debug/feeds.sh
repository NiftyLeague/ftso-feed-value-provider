#!/bin/bash
# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"
source "$(dirname "$0")/../utils/cleanup-common.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Feed Data Quality and Validation Debugging Script
# Tests feed data accuracy, consensus, and validation processes

echo "📊 FTSO Feed Data Debugger"
echo "=========================="

# Ensure logs directory exists

# Configuration
TIMEOUT=60

# Set up logging using common utility
setup_debug_logging "feeds-debug"
LOG_FILE="$DEBUG_LOG_FILE"

echo "📝 Starting feed data analysis..."

# Start the application in background with clean output capture
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring feed data for $TIMEOUT seconds..."

# Wait for application to initialize
sleep $TIMEOUT

# Test feed endpoints if server is ready
echo "🧪 Testing feed endpoints..."

if curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/health 2>/dev/null | grep -q "200"; then
    echo "✅ Server is ready, testing feed endpoints..."
    
    # Test feed values endpoint
    echo "📊 Testing feed values..."
    curl -s -X POST http://localhost:3101/feed-values \
         -H "Content-Type: application/json" \
         -d '{"feeds": ["BTC/USD", "ETH/USD", "FLR/USD"]}' \
         > logs/feed-values-response.json 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Feed values endpoint responded"
    else
        echo "❌ Feed values endpoint failed"
    fi
    
    # Test volumes endpoint
    echo "📈 Testing volumes..."
    curl -s -X POST http://localhost:3101/volumes \
         -H "Content-Type: application/json" \
         -d '{"feeds": ["BTC/USD", "ETH/USD"]}' \
         > logs/volumes-response.json 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ Volumes endpoint responded"
    else
        echo "❌ Volumes endpoint failed"
    fi
else
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
    CONFIGURED_FEEDS=$(grep -c "Configured feed\|Subscribed to feed" "$LOG_FILE")
    echo "📊 Configured feeds: $CONFIGURED_FEEDS"
    
    # Show feed mapping
    echo ""
    echo "🗺️  Feed Mapping:"
    grep -E "Mapped feed.*to.*exchanges" "$LOG_FILE" | head -10
    
    echo ""
    echo "📈 Data Quality Metrics:"
    echo "-----------------------"
    
    # Consensus and validation
    CONSENSUS_EVENTS=$(grep -c "Consensus\|consensus" "$LOG_FILE")
    echo "🎯 Consensus events: $CONSENSUS_EVENTS"
    
    VALIDATION_EVENTS=$(grep -c "Validation\|validation\|validated" "$LOG_FILE")
    echo "✅ Validation events: $VALIDATION_EVENTS"
    
    # Data quality issues
    echo ""
    echo "⚠️  Data Quality Issues:"
    echo "-----------------------"
    
    OUTLIERS=$(grep -c "outlier\|Outlier" "$LOG_FILE")
    echo "📊 Outliers detected: $OUTLIERS"
    
    STALE_DATA=$(grep -c "stale\|Stale\|outdated" "$LOG_FILE")
    echo "⏰ Stale data warnings: $STALE_DATA"
    
    CONSENSUS_DEVIATIONS=$(grep -c "deviation\|Deviation" "$LOG_FILE")
    echo "📈 Consensus deviations: $CONSENSUS_DEVIATIONS"
    
    # Show specific quality issues
    grep -E "(outlier|stale|deviation)" "$LOG_FILE" | head -5
    
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
    
    # Alert events
    ALERTS=$(grep -c "Alert\|alert\|ALERT" "$LOG_FILE")
    echo "🚨 Alerts triggered: $ALERTS"
    
    # Show recent alerts
    grep -E "(Alert|alert|ALERT)" "$LOG_FILE" | tail -5
    
    echo ""
    echo "⚡ Performance Metrics:"
    echo "---------------------"
    
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
        FEED_COUNT=$(jq -r '.feeds | length' logs/feed-values-response.json 2>/dev/null || echo "0")
        echo "📊 Feeds returned: $FEED_COUNT"
        
        # Show sample data
        echo "📈 Sample feed data:"
        jq -r '.feeds[0:2] | .[] | "\(.symbol): $\(.price) (confidence: \(.confidence))"' logs/feed-values-response.json 2>/dev/null || echo "No feed data available"
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
        
        VOLUME_COUNT=$(jq -r '.volumes | length' logs/volumes-response.json 2>/dev/null || echo "0")
        echo "📊 Volumes returned: $VOLUME_COUNT"
    else
        echo "❌ Invalid JSON response"
    fi
fi

# Show log summary
show_log_summary "$LOG_FILE" "feeds"

# Clean up old logs if in session mode
cleanup_old_logs "feeds"

echo ""
echo "✨ Feed analysis complete!"
echo "   - Feed values: logs/feed-values-response.json"
echo "   - Volumes: logs/volumes-response.json"