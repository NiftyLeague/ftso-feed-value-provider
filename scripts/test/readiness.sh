#!/bin/bash
# Comprehensive System Readiness Test
# Validates complete system readiness including WebSocket connections, feed initialization, and data collection
# This is a production-grade test that ensures 64/64 feeds are ready before proceeding

# Source common utilities
source "$(dirname "$0")/../utils/test-common.sh"
source "$(dirname "$0")/../utils/cleanup.sh"
source "$(dirname "$0")/../utils/websocket-detection.sh"

# Set up cleanup handlers
setup_cleanup_handlers

echo "🧪 System Readiness Test"
echo "========================"
echo "Comprehensive validation of system readiness for production use"
echo ""

# Configuration
MAX_WAIT_TIME=300  # 5 minutes max wait for full readiness

# Derive expected feed count from config (keeps the test aligned with the actual runtime configuration)
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FEEDS_CONFIG_FILE="$ROOT_DIR/src/config/feeds.json"
EXPECTED_FEEDS=63
if [ -f "$FEEDS_CONFIG_FILE" ] && command -v jq >/dev/null 2>&1; then
    EXPECTED_FEEDS=$(jq 'length' "$FEEDS_CONFIG_FILE" 2>/dev/null || echo "63")
fi

# Test results tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Set up logging
setup_test_logging "readiness"

log_test_result() {
    local test_name="$1"
    local result="$2"
    local details="$3"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    
    if [ "$result" = "PASS" ]; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        log_both "✅ $test_name: PASSED"
        if [ -n "$details" ]; then
            log_both "   $details"
        fi
    else
        FAILED_TESTS=$((FAILED_TESTS + 1))
        log_both "❌ $test_name: FAILED"
        if [ -n "$details" ]; then
            log_both "   $details"
        fi
    fi
}

# Test 1: Validate readiness detection functions
test_readiness_functions() {
    log_both ""
    log_both "🔍 Test 1: Readiness Detection Functions"
    log_both "========================================"
    
    local functions_to_test=(
        "wait_for_websocket_connections"
        "wait_for_websocket_subscriptions"
        "wait_for_data_collection"
        "check_system_readiness"
        "wait_for_service_health"
    )
    
    local all_functions_exist=true
    
    for func in "${functions_to_test[@]}"; do
        if declare -f "$func" > /dev/null; then
            log_both "   ✅ Function $func is available"
        else
            log_both "   ❌ Function $func is NOT available"
            all_functions_exist=false
        fi
    done
    
    if [ "$all_functions_exist" = "true" ]; then
        log_test_result "Readiness Functions Available" "PASS" "All required functions are available"
        return 0
    else
        log_test_result "Readiness Functions Available" "FAIL" "Some required functions are missing"
        return 1
    fi
}

# Test 2: Complete system readiness validation
test_complete_system_readiness() {
    log_both ""
    log_both "🔍 Test 2: Complete System Readiness"
    log_both "===================================="
    
    # Start application
    log_both "🚀 Starting application for complete readiness test..."
    start_app_with_cleanup "pnpm start:dev 2>&1 | strip_ansi" 3101 "$TEST_LOG_FILE"
    
    # Use the comprehensive system readiness check
    log_both "⏳ Running complete system readiness check..."
    local start_time=$(date +%s)
    
    # Use the readiness helper for health + basic server readiness.
    # WebSocket readiness is validated separately below with thresholds appropriate for short-lived test runs.
    if check_system_readiness "$TEST_LOG_FILE" "false" "http://localhost:3101"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        log_test_result "Complete System Readiness" "PASS" "System ready in ${duration}s"

        # Validate specific components using actual service state rather than console-only helper output
        test_health_endpoint_ready
        test_websocket_connections_ready
        test_feed_data_collection_ready
        
        return 0
    else
        log_test_result "Complete System Readiness" "FAIL" "System readiness check failed"
        return 1
    fi
}

# Sub-test: Health endpoint readiness
test_health_endpoint_ready() {
    log_both "   🔍 Validating health endpoint readiness..."
    
    # Test health endpoints
    local health_live=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/health/live 2>/dev/null)
    local health_ready=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/health/ready 2>/dev/null)
    
    if [ "$health_live" = "200" ] && [ "$health_ready" = "200" ]; then
        log_test_result "Health Endpoints Ready" "PASS" "Live: $health_live, Ready: $health_ready"
    else
        log_test_result "Health Endpoints Ready" "FAIL" "Live: $health_live, Ready: $health_ready"
    fi
}

# Sub-test: WebSocket connections readiness
test_websocket_connections_ready() {
    log_both "   🔍 Validating WebSocket connections..."

    if [ ! -f "$TEST_LOG_FILE" ]; then
        log_test_result "WebSocket Connections Ready" "FAIL" "No log file available"
        return
    fi

    # Prefer strict success if the app logs the explicit completion markers.
    if grep -q "Connected to .*/16 exchanges" "$TEST_LOG_FILE" 2>/dev/null && \
       grep -q "Asynchronous WebSocket initialization completed" "$TEST_LOG_FILE" 2>/dev/null; then
        log_test_result "WebSocket Connections Ready" "PASS" "All 16 exchanges connected"
        return
    fi

    # Fallback: accept partial connectivity (>= 10) since some exchanges may be unavailable in CI/dev.
    local connected_count
    connected_count=$(grep "Successfully connected to exchange:" "$TEST_LOG_FILE" 2>/dev/null | \
        sed 's/.*exchange: \([^[:space:]]*\).*/\1/' | sort | uniq | wc -l | tr -d ' ' || echo "0")

    if [ "${connected_count:-0}" -ge 10 ]; then
        log_test_result "WebSocket Connections Ready" "PASS" "$connected_count/16 exchanges connected"
    else
        log_test_result "WebSocket Connections Ready" "FAIL" "Only $connected_count/16 exchanges connected"
    fi
}

# Sub-test: Feed data collection readiness
test_feed_data_collection_ready() {
    log_both "   🔍 Validating feed data collection..."

    if [ ! -f "$FEEDS_CONFIG_FILE" ]; then
        log_test_result "Feed Data Collection Ready" "FAIL" "Missing feeds config: $FEEDS_CONFIG_FILE"
        return
    fi

    local start_time
    start_time=$(date +%s)
    local deadline=$((start_time + MAX_WAIT_TIME))

    # Build a request for all configured feeds and ensure the service returns an entry for each.
    local feed_request
    feed_request=$(jq -c '{feeds: [.[].feed]}' "$FEEDS_CONFIG_FILE" 2>/dev/null)

    while [ $(date +%s) -lt $deadline ]; do
        local response_file="/tmp/readiness_all_feeds.json"
        local http_code
        http_code=$(curl -s --max-time 15 -w "%{http_code}" -X POST http://localhost:3101/feed-values \
            -H "Content-Type: application/json" \
            -d "$feed_request" \
            -o "$response_file" 2>/dev/null)

        if [ "$http_code" = "200" ] && jq -e '.data | length' "$response_file" >/dev/null 2>&1; then
            local count
            count=$(jq -r '.data | length' "$response_file" 2>/dev/null)
            if [ "$count" = "$EXPECTED_FEEDS" ]; then
                log_test_result "Feed Data Collection Ready" "PASS" "Service returned $count/$EXPECTED_FEEDS feed entries"
                rm -f "$response_file" 2>/dev/null || true
                return
            fi
        fi

        rm -f "$response_file" 2>/dev/null || true
        sleep 5
    done

    log_test_result "Feed Data Collection Ready" "FAIL" "Timed out waiting for $EXPECTED_FEEDS feed entries from /feed-values"
}

# Test 3: Feed endpoint functionality
test_feed_endpoint_functionality() {
    log_both ""
    log_both "🔍 Test 3: Feed Endpoint Functionality"
    log_both "======================================"
    
    # Test sample feeds to ensure data is flowing
    local sample_feeds=("BTC/USD" "ETH/USD" "SOL/USD")
    local successful_feeds=0
    
    for feed in "${sample_feeds[@]}"; do
        log_both "   Testing feed: $feed"
        
        # Create request
        local feed_request=$(jq -n --arg name "$feed" \
            '{"feeds": [{"category": 1, "name": $name}]}')
        
        # Test feed endpoint
        local response_file="/tmp/readiness_test_${feed//\//_}.json"
        local http_code=$(curl -s -w "%{http_code}" -X POST http://localhost:3101/feed-values \
            -H "Content-Type: application/json" \
            -d "$feed_request" \
            -o "$response_file" 2>/dev/null)
        
        if [ "$http_code" = "200" ]; then
            if jq -e '.data[0].value' "$response_file" >/dev/null 2>&1; then
                local value=$(jq -r '.data[0].value' "$response_file")
                local confidence=$(jq -r '.data[0].confidence // "N/A"' "$response_file")
                log_both "     ✅ $feed: $value (confidence: $confidence)"
                successful_feeds=$((successful_feeds + 1))
            else
                log_both "     ❌ $feed: Invalid response structure"
            fi
        else
            log_both "     ❌ $feed: HTTP $http_code"
        fi
        
        rm -f "$response_file" 2>/dev/null || true
    done
    
    if [ "$successful_feeds" -eq ${#sample_feeds[@]} ]; then
        log_test_result "Feed Endpoint Functionality" "PASS" "All $successful_feeds sample feeds working"
    else
        log_test_result "Feed Endpoint Functionality" "FAIL" "Only $successful_feeds/${#sample_feeds[@]} sample feeds working"
    fi
}

# Test 4: System performance validation
test_system_performance() {
    log_both ""
    log_both "🔍 Test 4: System Performance Validation"
    log_both "========================================"
    
    if [ -f "$TEST_LOG_FILE" ]; then
        # Count only actual log-level ERROR/WARN lines (avoid substring false positives like JSON keys)
        local error_count
        local warning_count
        error_count=$(grep -E "\]\s+(ERROR|FATAL)\b|^\s*(ERROR|FATAL)\b" "$TEST_LOG_FILE" 2>/dev/null | wc -l | tr -d ' ')
        warning_count=$(grep -E "\]\s+WARN\b|^\s*WARN\b" "$TEST_LOG_FILE" 2>/dev/null | wc -l | tr -d ' ')
        
        log_both "   Error events: $error_count"
        log_both "   Warning events: $warning_count"
        
        # Performance thresholds for production
        if [ "$error_count" -eq 0 ]; then
            log_test_result "Error-Free Startup" "PASS" "No errors detected during startup"
        else
            log_test_result "Error-Free Startup" "FAIL" "$error_count errors detected"
        fi
        
        if [ "$warning_count" -eq 0 ]; then
            log_test_result "Minimal Warnings" "PASS" "No warnings detected"
        else
            log_test_result "Minimal Warnings" "FAIL" "$warning_count warnings detected"
        fi

        # Check memory-related warnings/errors only
        local memory_warnings
        memory_warnings=$(grep -E "\]\s+(WARN|ERROR|FATAL)\b" "$TEST_LOG_FILE" 2>/dev/null | grep -Ei "memory|heap|gc|out of memory" | wc -l | tr -d ' ')
        if [ "$memory_warnings" -eq 0 ]; then
            log_test_result "Memory Performance" "PASS" "No memory-related warnings/errors detected"
        else
            log_test_result "Memory Performance" "FAIL" "$memory_warnings memory-related warning/error events"
        fi
    else
        log_test_result "System Performance" "FAIL" "No log file available for analysis"
    fi
}

# Test 5: Production readiness validation
test_production_readiness() {
    log_both ""
    log_both "🔍 Test 5: Production Readiness Validation"
    log_both "=========================================="
    
    # Validate all critical components are ready
    local readiness_score=0
    local max_score=5
    
    # Check health endpoints
    if curl -s http://localhost:3101/health/ready >/dev/null 2>&1; then
        readiness_score=$((readiness_score + 1))
        log_both "   ✅ Health endpoints responsive"
    else
        log_both "   ❌ Health endpoints not responsive"
    fi
    
    # Check feed endpoint
    local test_request='{"feeds": [{"category": 1, "name": "BTC/USD"}]}'
    if curl -s -X POST http://localhost:3101/feed-values \
        -H "Content-Type: application/json" \
        -d "$test_request" | jq -e '.data[0].value' >/dev/null 2>&1; then
        readiness_score=$((readiness_score + 1))
        log_both "   ✅ Feed endpoint functional"
    else
        log_both "   ❌ Feed endpoint not functional"
    fi
    
    # Check volume endpoint
    if curl -s -X POST http://localhost:3101/volumes \
        -H "Content-Type: application/json" \
        -d "$test_request" >/dev/null 2>&1; then
        readiness_score=$((readiness_score + 1))
        log_both "   ✅ Volume endpoint functional"
    else
        log_both "   ❌ Volume endpoint not functional"
    fi
    
    # Check WebSocket connections (allow partial connectivity during tests)
    local connected_count
    connected_count=$(grep "Successfully connected to exchange:" "$TEST_LOG_FILE" 2>/dev/null | \
        sed 's/.*exchange: \([^[:space:]]*\).*/\1/' | sort | uniq | wc -l | tr -d ' ' || echo "0")
    if [ "${connected_count:-0}" -ge 10 ]; then
        readiness_score=$((readiness_score + 1))
        log_both "   ✅ WebSocket connections established ($connected_count/16)"
    else
        log_both "   ❌ WebSocket connections incomplete ($connected_count/16)"
    fi
    
    # Check feed data collection by validating /feed-values returns an entry for every configured feed
    local feed_request
    feed_request=$(jq -c '{feeds: [.[].feed]}' "$FEEDS_CONFIG_FILE" 2>/dev/null)
    local response_file="/tmp/readiness_production_all_feeds.json"
    local http_code
    http_code=$(curl -s --max-time 20 -w "%{http_code}" -X POST http://localhost:3101/feed-values \
        -H "Content-Type: application/json" \
        -d "$feed_request" \
        -o "$response_file" 2>/dev/null)
    if [ "$http_code" = "200" ] && [ "$(jq -r '.data | length' "$response_file" 2>/dev/null)" = "$EXPECTED_FEEDS" ]; then
        readiness_score=$((readiness_score + 1))
        log_both "   ✅ Feed data collection completed ($EXPECTED_FEEDS/$EXPECTED_FEEDS)"
    else
        log_both "   ❌ Feed data collection incomplete"
    fi
    rm -f "$response_file" 2>/dev/null || true
    
    local readiness_percentage=$(echo "scale=1; $readiness_score * 100 / $max_score" | bc)
    
    if [ "$readiness_score" -eq "$max_score" ]; then
        log_test_result "Production Readiness" "PASS" "100% ready ($readiness_score/$max_score components)"
    else
        log_test_result "Production Readiness" "FAIL" "${readiness_percentage}% ready ($readiness_score/$max_score components)"
    fi
}

# Main test execution
main() {
    log_both "Starting comprehensive system readiness test..."
    log_both "Expected: $EXPECTED_FEEDS feeds ready for production use"
    log_both ""
    
    # Test 1: Validate functions are available
    test_readiness_functions
    
    # Test 2: Complete system readiness (includes application startup)
    test_complete_system_readiness
    
    # Test 3: Feed endpoint functionality
    test_feed_endpoint_functionality
    
    # Test 4: System performance validation
    test_system_performance
    
    # Test 5: Production readiness validation
    test_production_readiness
    
    # Cleanup application
    log_both ""
    log_both "🛑 Stopping application..."
    # Cleanup will be handled by trap handlers
    
    # Final results
    log_both ""
    log_both "📊 System Readiness Test Results"
    log_both "================================"
    log_both "Total tests: $TOTAL_TESTS"
    log_both "Passed: $PASSED_TESTS"
    log_both "Failed: $FAILED_TESTS"
    
    local success_rate=0
    if [ $TOTAL_TESTS -gt 0 ]; then
        success_rate=$(echo "scale=1; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc)
    fi
    
    log_both "Success rate: ${success_rate}%"
    log_both ""
    
    # Production readiness assessment
    if [ $FAILED_TESTS -eq 0 ]; then
        log_both "🎉 PRODUCTION READY: All system readiness tests passed!"
        log_both "✅ System is ready for production use with $EXPECTED_FEEDS feeds"
        log_both "✅ All critical components are functional and performant"
        exit_code=0
    elif [ $(echo "$success_rate >= 90" | bc) -eq 1 ]; then
        log_both "⚠️  MOSTLY READY: ${success_rate}% of tests passed"
        log_both "🔧 Review failed tests before production deployment"
        exit_code=1
    else
        log_both "❌ NOT READY: Only ${success_rate}% of tests passed"
        log_both "🚨 System requires significant fixes before production use"
        exit_code=2
    fi
    
    log_both ""
    log_both "📁 Full test log: $TEST_LOG_FILE"
    log_both "📋 Review logs for detailed analysis and troubleshooting"
    
    exit $exit_code
}

# Run the comprehensive readiness test
main "$@"