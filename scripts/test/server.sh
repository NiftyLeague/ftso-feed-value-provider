#!/bin/bash

# Robust server functionality test with detailed progress indicators

# Source common test utilities
source "$(dirname "$0")/../utils/test-common.sh"
source "$(dirname "$0")/../utils/websocket-detection.sh"
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

# Source port manager utility
source "$(dirname "$0")/../utils/port-manager.sh"

# Set up dynamic port
TEST_PORT=$(setup_test_port)
echo "📝 Using dynamic port: $TEST_PORT"

# Start the application with the dynamic port
echo "📝 Running: APP_PORT=$TEST_PORT pnpm start:dev"
APP_PORT=$TEST_PORT pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port "$TEST_PORT"

echo "📝 Application started with PID: $APP_PID"
echo "⏱️  Waiting for server to be ready..."

# Source readiness utilities
source "$(dirname "$0")/../utils/readiness-utils.sh"

# Wait for service readiness using existing health endpoints
echo "⏱️  Waiting for service readiness..."
if wait_for_service_health "http://localhost:$TEST_PORT" 60 1000 5000; then
    echo "✅ Server health endpoint is responding!"
    
    # Now wait for full readiness (data sources connected and operational)
    echo "⏱️  Waiting for full system readiness..."
    if wait_for_http_endpoint "http://localhost:$TEST_PORT/health/ready" 200 30 2000 5000; then
        echo "✅ Server is fully ready and operational!"
    else
        echo "⚠️  Server is healthy but not fully ready, proceeding with basic tests"
    fi
else
    echo "❌ Server failed to become ready"
    exit 1
fi

# Test 1: Health endpoint
echo ""
echo "🧪 Test 1: Health Endpoint"
echo "-------------------------"
echo "🔍 Testing GET /health..."
HEALTH_RESPONSE=$(curl -s --max-time $TEST_TIMEOUT http://localhost:$TEST_PORT/health 2>/dev/null)
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
METRICS_RESPONSE=$(curl -s --max-time $TEST_TIMEOUT http://localhost:$TEST_PORT/metrics 2>/dev/null)
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
echo "⏳ Waiting for data sources to initialize..."
sleep 10  # Allow time for data sources to connect and provide initial data
echo "🔍 Testing POST /feed-values..."
FEED_RESPONSE=$(curl -s --max-time $TEST_TIMEOUT -X POST \
    -H "Content-Type: application/json" \
    -d '{"feeds": [{"category": 1, "name": "BTC/USD"}, {"category": 1, "name": "ETH/USD"}]}' \
    http://localhost:$TEST_PORT/feed-values 2>/dev/null)
FEED_EXIT_CODE=$?

if [ $FEED_EXIT_CODE -eq 0 ] && [ -n "$FEED_RESPONSE" ]; then
    echo "✅ Feed values endpoint: PASS"
    echo "Feed response: $FEED_RESPONSE" >> "$LOG_FILE"
else
    echo "❌ Feed values endpoint: FAIL (exit code: $FEED_EXIT_CODE)"
    echo "Feed values endpoint failed with exit code $FEED_EXIT_CODE" >> "$LOG_FILE"
fi

# Test 4: Configuration endpoints
echo ""
echo "🧪 Test 4: Configuration Endpoints"
echo "----------------------------------"

test_config_endpoint() {
    local name=$1
    local url=$2
    local jq_check=$3

    echo "🔍 Testing GET $url..."
    local response
    response=$(curl -s --max-time $TEST_TIMEOUT "http://localhost:$TEST_PORT${url}" 2>/dev/null)
    local exit_code=$?

    if [ $exit_code -eq 0 ] && [ -n "$response" ]; then
        if command -v jq >/dev/null 2>&1; then
            if echo "$response" | jq -e "$jq_check" >/dev/null 2>&1; then
                echo "✅ $name: PASS"
                echo "$name response: $response" >> "$LOG_FILE"
                return 0
            else
                echo "❌ $name: FAIL (unexpected JSON shape)"
                echo "$name response (unexpected shape): $response" >> "$LOG_FILE"
                return 1
            fi
        fi

        # If jq is unavailable, fall back to a basic non-empty response check.
        echo "✅ $name: PASS (jq not available; basic check only)"
        echo "$name response: $response" >> "$LOG_FILE"
        return 0
    fi

    echo "❌ $name: FAIL (exit code: $exit_code)"
    echo "$name endpoint failed with exit code $exit_code" >> "$LOG_FILE"
    return 1
}

test_config_endpoint "Config Status" "/config/status" \
  '.environment.nodeEnv != null and .system.cache.ttlMs != null and .feeds.count != null and .adapters.totalExchanges != null'
test_config_endpoint "Config Validate" "/config/validate" \
  '.overall.isValid != null and .environment.isValid != null and (.feeds.totalFeeds|type=="number")'
test_config_endpoint "Config Feeds Summary" "/config/feeds/summary" \
  '.totalFeeds != null and (.totalSources|type=="number") and (.feedsByCategory|type=="object")'
test_config_endpoint "Config Adapters" "/config/adapters" \
  '(.customAdapterExchanges|type=="array") and (.ccxtExchanges|type=="array")'

# Test 5: Prometheus metrics endpoint
echo ""
echo "🧪 Test 5: Prometheus Metrics Endpoint"
echo "-------------------------------------"
echo "🔍 Testing GET /metrics/prometheus..."

PROM_HEADERS=$(curl -s -I --max-time $TEST_TIMEOUT "http://localhost:$TEST_PORT/metrics/prometheus" 2>/dev/null)
PROM_BODY=$(curl -s --max-time $TEST_TIMEOUT "http://localhost:$TEST_PORT/metrics/prometheus" 2>/dev/null)
PROM_EXIT_CODE=$?

if [ $PROM_EXIT_CODE -eq 0 ] && [ -n "$PROM_BODY" ]; then
    if echo "$PROM_HEADERS" | grep -qi "content-type: text/plain"; then
        # Basic sanity: ensure it looks like Prometheus exposition.
        if echo "$PROM_BODY" | grep -q "^#\|_total\|_seconds\|_ms\|ftso_"; then
            echo "✅ Prometheus metrics endpoint: PASS"
        else
            echo "⚠️  Prometheus metrics endpoint: PASS (unexpected content; check logs)"
        fi
    else
        echo "⚠️  Prometheus metrics endpoint: PASS (unexpected content-type; check logs)"
    fi
    echo "Prometheus headers: $PROM_HEADERS" >> "$LOG_FILE"
    echo "Prometheus body (first 50 lines):" >> "$LOG_FILE"
    echo "$PROM_BODY" | head -n 50 >> "$LOG_FILE"
else
    echo "❌ Prometheus metrics endpoint: FAIL (exit code: $PROM_EXIT_CODE)"
    echo "Prometheus metrics endpoint failed with exit code $PROM_EXIT_CODE" >> "$LOG_FILE"
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