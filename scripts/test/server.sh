#!/bin/bash

# Robust server functionality test with detailed progress indicators

# Source common test utilities
source "$(dirname "$0")/../utils/test-common.sh"
source "$(dirname "$0")/../utils/parse-logs.sh"

echo "🚀 FTSO Server Functionality Test"
echo "================================="

# Set up cleanup handlers
setup_cleanup_handlers

# Set up logging using common utility
echo "📊 Starting comprehensive server test..."
setup_test_logging "server"
LOG_FILE="$TEST_LOG_FILE"

# Configuration - Increased for WebSocket initialization
STARTUP_TIMEOUT=90  # Increased to allow WebSocket connections to establish
TEST_TIMEOUT=15     # Increased for more reliable testing

echo "🚀 Starting comprehensive server test..." > "$LOG_FILE"
echo "📊 Startup timeout: ${STARTUP_TIMEOUT}s, Test timeout: ${TEST_TIMEOUT}s"

# Start the application using shared cleanup system
echo ""
echo "🚀 Starting FTSO application..."

# Initial cleanup
cleanup_ftso_ports

# Start the application manually and register it
echo "📝 Running: pnpm start:dev"
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo "📝 Application started with PID: $APP_PID"
echo "⏱️  Waiting for server to be ready (timeout: ${STARTUP_TIMEOUT}s)..."

# Wait for server to be ready with progress indicators
INTERVAL=3
ELAPSED=0

while [ $ELAPSED -lt $STARTUP_TIMEOUT ]; do
    # Check if process is still running
    if ! kill -0 $APP_PID 2>/dev/null; then
        echo ""
        echo "❌ Application stopped unexpectedly after ${ELAPSED}s"
        echo "📋 Last few log lines:"
        tail -5 "$LOG_FILE" 2>/dev/null || echo "No log available"
        exit 1
    fi
    
    # Test if server is ready
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3101/health 2>/dev/null || echo "000")
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "503" ]; then
        echo ""
        echo "✅ Server is ready and responding! (${ELAPSED}s) [HTTP: $HTTP_CODE]"
        break
    else
        printf "\r⏳ Starting... (${ELAPSED}s) [HTTP: $HTTP_CODE] [PID: $APP_PID]"
        sleep $INTERVAL
        ELAPSED=$((ELAPSED + INTERVAL))
    fi
done

if [ $ELAPSED -ge $STARTUP_TIMEOUT ]; then
    echo ""
    echo "⏰ Startup timeout reached (${STARTUP_TIMEOUT}s)"
    echo "📋 Application may still be starting. Last few log lines:"
    tail -10 "$LOG_FILE" 2>/dev/null || echo "No log available"
    echo "🛑 Killing application..."
    exit 1
fi

# Test 1: Health endpoint
echo ""
echo "🧪 Test 1: Health Endpoint"
echo "-------------------------"
echo "🔍 Testing GET /health..."
HEALTH_RESPONSE=$(curl -s --max-time $TEST_TIMEOUT http://localhost:3101/health 2>/dev/null)
HEALTH_EXIT_CODE=$?

if [ $HEALTH_EXIT_CODE -eq 0 ] && [ -n "$HEALTH_RESPONSE" ]; then
    STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status // "unknown"' 2>/dev/null || echo "unknown")
    echo "✅ Health endpoint: PASS (status: $STATUS)"
    echo "Health response: $HEALTH_RESPONSE" >> "$LOG_FILE"
else
    echo "❌ Health endpoint: FAIL (exit code: $HEALTH_EXIT_CODE)"
    echo "Health endpoint failed with exit code $HEALTH_EXIT_CODE" >> "$LOG_FILE"
fi

# Test 2: Metrics endpoint
echo ""
echo "🧪 Test 2: Metrics Endpoint"
echo "---------------------------"
echo "🔍 Testing GET /metrics..."
METRICS_RESPONSE=$(curl -s --max-time $TEST_TIMEOUT http://localhost:3101/metrics 2>/dev/null)
METRICS_EXIT_CODE=$?

if [ $METRICS_EXIT_CODE -eq 0 ] && [ -n "$METRICS_RESPONSE" ]; then
    RESPONSE_LENGTH=$(echo "$METRICS_RESPONSE" | wc -c)
    echo "✅ Metrics endpoint: PASS (${RESPONSE_LENGTH} chars)"
    echo "Metrics response length: $RESPONSE_LENGTH" >> "$LOG_FILE"
else
    echo "❌ Metrics endpoint: FAIL (exit code: $METRICS_EXIT_CODE)"
    echo "Metrics endpoint failed with exit code $METRICS_EXIT_CODE" >> "$LOG_FILE"
fi

# Test 3: Feed values endpoint
echo ""
echo "🧪 Test 3: Feed Values Endpoint"
echo "-------------------------------"
echo "🔍 Testing POST /feed-values..."
FEED_RESPONSE=$(curl -s --max-time $TEST_TIMEOUT -X POST \
    -H "Content-Type: application/json" \
    -d '{"feeds": [{"category": 1, "name": "BTC/USD"}, {"category": 1, "name": "ETH/USD"}]}' \
    http://localhost:3101/feed-values 2>/dev/null)
FEED_EXIT_CODE=$?

if [ $FEED_EXIT_CODE -eq 0 ] && [ -n "$FEED_RESPONSE" ]; then
    echo "✅ Feed values endpoint: PASS"
    echo "Feed response: $FEED_RESPONSE" >> "$LOG_FILE"
else
    echo "❌ Feed values endpoint: FAIL (exit code: $FEED_EXIT_CODE)"
    echo "Feed values endpoint failed with exit code $FEED_EXIT_CODE" >> "$LOG_FILE"
fi

# Stop the application using shared cleanup system
echo ""
echo "🛑 Stopping application..."
stop_tracked_apps

# Show test summary
log_summary "$LOG_FILE" "server" "test"

# Clean up old logs if in session mode
cleanup_old_test_logs "server"

echo ""
echo "✨ Server functionality test completed!"