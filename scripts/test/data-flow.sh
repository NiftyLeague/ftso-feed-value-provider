#!/bin/bash

# Data Flow Verification Script
# This script monitors the system over time to determine if errors are truly startup-related
# or if there's a fundamental data flow issue

# Source common test utilities
source "$(dirname "$0")/../utils/test-common.sh"
source "$(dirname "$0")/../utils/port-manager.sh"
source "$(dirname "$0")/../utils/readiness-utils.sh"

echo "🔍 FTSO Data Flow Verification"
echo "=============================="

# Set up cleanup handlers
setup_cleanup_handlers

# Configuration
MONITORING_DURATION=180  # 3 minutes total monitoring
STARTUP_GRACE_PERIOD=45  # 45 seconds startup grace period
CHECK_INTERVAL=10        # Check every 10 seconds
LOG_FILE="logs/test/data_flow_verification.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

echo "📊 Monitoring Configuration:"
echo "   - Total Duration: ${MONITORING_DURATION}s"
echo "   - Startup Grace Period: ${STARTUP_GRACE_PERIOD}s"
echo "   - Check Interval: ${CHECK_INTERVAL}s"
echo "   - Log File: $LOG_FILE"
echo ""

# Start the application
echo "🚀 Starting FTSO application..."
cleanup_ftso_ports

TEST_PORT=$(setup_test_port)
echo "📝 Using dynamic port: $TEST_PORT"

# Start application and capture output
echo "📝 Running: APP_PORT=$TEST_PORT pnpm start:dev"
APP_PORT=$TEST_PORT pnpm start:dev > "$LOG_FILE" 2>&1 &
APP_PID=$!

register_pid "$APP_PID"
register_port "$TEST_PORT"

echo "📝 Application started with PID: $APP_PID"

# Wait for service to become ready using standard readiness utility
if wait_for_debug_service_readiness "http://localhost:$TEST_PORT"; then
    # Service is ready, proceed with data flow verification
    :
else
    stop_tracked_apps
    exit 1
fi

# Initialize tracking variables
STARTUP_ERRORS=0
POST_STARTUP_ERRORS=0
STARTUP_WARNINGS=0
POST_STARTUP_WARNINGS=0
SUCCESSFUL_REQUESTS=0
FAILED_REQUESTS=0
DATA_FLOW_DETECTED="false"
WEBSOCKET_CONNECTIONS=0

echo ""
echo "🔍 Starting data flow monitoring..."
echo "=================================="

START_TIME=$(date +%s)
STARTUP_END_TIME=$((START_TIME + STARTUP_GRACE_PERIOD))

# Function to test feed values endpoint
test_feed_endpoint() {
    local timestamp=$(date +%s)
    local is_startup_period=$((timestamp < STARTUP_END_TIME))
    
    echo "📊 [$(date +'%H:%M:%S')] Testing feed endpoint..."
    
    # Test the feed values endpoint
    RESPONSE=$(curl -s --max-time 10 -X POST \
        -H "Content-Type: application/json" \
        -d '{"feeds": [{"category": 1, "name": "BTC/USD"}, {"category": 1, "name": "ETH/USD"}]}' \
        http://localhost:$TEST_PORT/feed-values 2>/dev/null)
    
    CURL_EXIT_CODE=$?
    
    if [ $CURL_EXIT_CODE -eq 0 ] && [ -n "$RESPONSE" ]; then
        # Check if response contains actual data or error
        if echo "$RESPONSE" | grep -q '"success":false'; then
            echo "   ❌ Feed endpoint returned error response"
            if [ $is_startup_period -eq 1 ]; then
                STARTUP_ERRORS=$((STARTUP_ERRORS + 1))
            else
                POST_STARTUP_ERRORS=$((POST_STARTUP_ERRORS + 1))
            fi
            FAILED_REQUESTS=$((FAILED_REQUESTS + 1))
        else
            echo "   ✅ Feed endpoint returned successful response"
            SUCCESSFUL_REQUESTS=$((SUCCESSFUL_REQUESTS + 1))
            DATA_FLOW_DETECTED="true"
        fi
    else
        echo "   ❌ Feed endpoint request failed (curl exit: $CURL_EXIT_CODE)"
        if [ $is_startup_period -eq 1 ]; then
            STARTUP_ERRORS=$((STARTUP_ERRORS + 1))
        else
            POST_STARTUP_ERRORS=$((POST_STARTUP_ERRORS + 1))
        fi
        FAILED_REQUESTS=$((FAILED_REQUESTS + 1))
    fi
}

# Function to analyze log file for errors and warnings
analyze_logs() {
    local timestamp=$(date +%s)
    local is_startup_period=$((timestamp < STARTUP_END_TIME))
    
    # Count recent errors and warnings (last 30 seconds)
    local recent_errors="0"
    local recent_warnings="0"
    if [ -f "$LOG_FILE" ]; then
        # grep -c prints "0" even when it exits 1 (no matches). Avoid appending a second "0" via `|| echo 0`.
        recent_errors=$(tail -n 100 "$LOG_FILE" 2>/dev/null | grep -c "ERROR" 2>/dev/null || true)
        recent_warnings=$(tail -n 100 "$LOG_FILE" 2>/dev/null | grep -c "WARN" 2>/dev/null || true)
    fi
    
    # Ensure variables are clean integers
    recent_errors=$(echo "${recent_errors:-0}" | tr -d '[:space:]')
    recent_warnings=$(echo "${recent_warnings:-0}" | tr -d '[:space:]')
    
    # Check for WebSocket connections
    local ws_connections=$(tail -n 100 "$LOG_FILE" 2>/dev/null | grep -c "WebSocket.*connected\|Subscribed to.*symbols" 2>/dev/null || true)
    ws_connections=$(echo "${ws_connections:-0}" | tr -d '[:space:]')
    if [ "$ws_connections" -gt 0 ]; then
        WEBSOCKET_CONNECTIONS=$((WEBSOCKET_CONNECTIONS + ws_connections))
    fi
    
    # Check for price aggregation activity
    local price_aggregations=$(tail -n 100 "$LOG_FILE" 2>/dev/null | grep -c "Price aggregated\|aggregated price" 2>/dev/null || true)
    price_aggregations=$(echo "${price_aggregations:-0}" | tr -d '[:space:]')
    if [ "$price_aggregations" -gt 0 ]; then
        echo "   📈 Price aggregation activity detected: $price_aggregations events"
        DATA_FLOW_DETECTED="true"
    fi
    
    echo "   📊 Recent log activity: ${recent_errors:-0} errors, ${recent_warnings:-0} warnings"
    
    if [ $is_startup_period -eq 1 ]; then
        echo "   ⏰ Still in startup grace period"
    else
        echo "   ✅ Past startup grace period"
    fi
}

# Main monitoring loop
ITERATION=0
while [ $(($(date +%s) - START_TIME)) -lt $MONITORING_DURATION ]; do
    ITERATION=$((ITERATION + 1))
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    
    echo ""
    echo "🔍 Check #$ITERATION (${ELAPSED}s elapsed)"
    echo "----------------------------------------"
    
    # Check if process is still running
    if ! kill -0 $APP_PID 2>/dev/null; then
        echo "❌ Application process died unexpectedly"
        break
    fi
    
    # Test the endpoint
    test_feed_endpoint
    
    # Analyze logs
    analyze_logs
    
    # Sleep until next check
    sleep $CHECK_INTERVAL
done

# Final analysis
echo ""
echo "📊 FINAL ANALYSIS"
echo "================="
echo "⏱️  Total monitoring time: $(($(date +%s) - START_TIME))s"
echo "🚀 Startup grace period: ${STARTUP_GRACE_PERIOD}s"
echo ""
echo "📈 Request Results:"
echo "   ✅ Successful requests: $SUCCESSFUL_REQUESTS"
echo "   ❌ Failed requests: $FAILED_REQUESTS"
echo ""
echo "🚨 Error Analysis:"
echo "   ⏰ Startup period errors: $STARTUP_ERRORS"
echo "   🔄 Post-startup errors: $POST_STARTUP_ERRORS"
echo ""
echo "⚠️  Warning Analysis:"
echo "   ⏰ Startup period warnings: $STARTUP_WARNINGS"
echo "   🔄 Post-startup warnings: $POST_STARTUP_WARNINGS"
echo ""
echo "🔌 Connection Status:"
echo "   📡 WebSocket connections detected: $WEBSOCKET_CONNECTIONS"
echo "   📊 Data flow detected: $DATA_FLOW_DETECTED"

# Determine the verdict
echo ""
echo "🎯 VERDICT"
echo "=========="

if [ "$DATA_FLOW_DETECTED" = "true" ] && [ $SUCCESSFUL_REQUESTS -gt 0 ]; then
    echo "✅ STARTUP ISSUE CONFIRMED"
    echo "   - Data flow was established after startup period"
    echo "   - System is working correctly once initialized"
    echo "   - Errors during startup are expected and acceptable"
elif [ $POST_STARTUP_ERRORS -gt 0 ] && [ $SUCCESSFUL_REQUESTS -eq 0 ]; then
    echo "❌ CORE DATA FLOW ISSUE DETECTED"
    echo "   - Errors persist after startup grace period"
    echo "   - No successful data retrieval observed"
    echo "   - System may have fundamental connectivity issues"
elif [ $WEBSOCKET_CONNECTIONS -eq 0 ]; then
    echo "⚠️  CONNECTIVITY ISSUE DETECTED"
    echo "   - No WebSocket connections established"
    echo "   - Data sources may not be connecting properly"
    echo "   - Check network connectivity and exchange APIs"
else
    echo "🤔 INCONCLUSIVE RESULTS"
    echo "   - Mixed signals detected"
    echo "   - May need longer monitoring period"
    echo "   - Check logs for more details"
fi

# Show recent log excerpt
echo ""
echo "📋 Recent Log Excerpt (last 20 lines):"
echo "======================================"
tail -n 20 "$LOG_FILE"

# Cleanup
echo ""
echo "🛑 Stopping application..."
stop_tracked_apps

echo ""
echo "✨ Data flow verification completed!"
echo "📁 Full log available at: $LOG_FILE"