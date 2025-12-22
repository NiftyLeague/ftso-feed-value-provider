#!/bin/bash

# Security & Rate Limiting Testing Script
# Tests API security, rate limiting, input validation, and access control

# Source common test utilities
source "$(dirname "$0")/../utils/test-common.sh"
source "$(dirname "$0")/../utils/websocket-detection.sh"

echo "🔒 FTSO Security & Rate Limiting Tester"
echo "======================================="

# Set up cleanup handlers
setup_cleanup_handlers

# Configuration - Increased timeout for full initialization
TIMEOUT=90  # Increased to allow for WebSocket connections

# Set up logging using common utility
setup_test_logging "security"
LOG_FILE="$TEST_LOG_FILE"
SECURITY_REPORT="$TEST_LOG_DIR/security-report.log"

echo "📝 Starting security testing..."

# Initialize security report
echo "FTSO Security Test Report - $(date)" > "$SECURITY_REPORT"
echo "====================================" >> "$SECURITY_REPORT"
echo "" >> "$SECURITY_REPORT"

# Source port manager utility
source "$(dirname "$0")/../utils/port-manager.sh"

# Set up dynamic port first
TEST_PORT=$(setup_test_port)
echo "📝 Using dynamic port: $TEST_PORT"

# Start the application with the dynamic port
APP_PORT=$TEST_PORT pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port "$TEST_PORT"

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Waiting for server to be ready..."

# Use smart system readiness detection with dynamic port
if ! check_system_readiness "$LOG_FILE" "false" "http://localhost:$TEST_PORT"; then
    echo "❌ System not ready for security testing"
    exit 1
fi

echo "✅ System ready for security testing"

echo ""
echo "🔒 Security Testing:"
echo "==================="

# Test results tracking
TESTS_PASSED=0
TESTS_FAILED=0
SECURITY_ISSUES=0

# Function to run security test
run_security_test() {
    local test_name=$1
    local test_command=$2
    local expected_result=$3
    
    echo "🧪 Testing: $test_name"
    
    local result
    result=$(eval "$test_command" 2>/dev/null)
    local exit_code=$?
    
    # For HTTP status code tests, check the actual status code
    if echo "$test_command" | grep -q "w '%{http_code}'"; then
        # This is an HTTP status code test
        if [ "$expected_result" = "success" ] && [ "$result" = "200" ]; then
            echo "  ✅ PASS: $test_name"
            TESTS_PASSED=$((TESTS_PASSED + 1))
            echo "PASS: $test_name" >> "$SECURITY_REPORT"
        elif [ "$expected_result" = "fail" ] && [ "$result" != "200" ] && [ "$result" != "000" ]; then
            echo "  ✅ PASS: $test_name (correctly rejected with HTTP $result)"
            TESTS_PASSED=$((TESTS_PASSED + 1))
            echo "PASS: $test_name (correctly rejected with HTTP $result)" >> "$SECURITY_REPORT"
        else
            echo "  ❌ FAIL: $test_name (HTTP $result)"
            TESTS_FAILED=$((TESTS_FAILED + 1))
            SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
            echo "FAIL: $test_name (HTTP $result)" >> "$SECURITY_REPORT"
        fi
    else
        # This is a response content test (like JSON validation)
        if [ "$expected_result" = "success" ] && [ $exit_code -eq 0 ]; then
            echo "  ✅ PASS: $test_name"
            TESTS_PASSED=$((TESTS_PASSED + 1))
            echo "PASS: $test_name" >> "$SECURITY_REPORT"
        elif [ "$expected_result" = "fail" ] && ([ $exit_code -ne 0 ] || echo "$result" | grep -q "error\|Error\|ERROR"); then
            echo "  ✅ PASS: $test_name (correctly rejected)"
            TESTS_PASSED=$((TESTS_PASSED + 1))
            echo "PASS: $test_name (correctly rejected)" >> "$SECURITY_REPORT"
        else
            echo "  ❌ FAIL: $test_name"
            TESTS_FAILED=$((TESTS_FAILED + 1))
            SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
            echo "FAIL: $test_name" >> "$SECURITY_REPORT"
        fi
    fi
    
    echo "    Result: $result" >> "$SECURITY_REPORT"
    echo "" >> "$SECURITY_REPORT"
}

echo "🔐 HTTP Security Headers Testing:"
echo "---------------------------------"

# Test security headers
echo "Testing security headers..."

HEADERS_TEST=$(curl -s -I http://localhost:$TEST_PORT/health/ready 2>/dev/null)

# Check for security headers
if echo "$HEADERS_TEST" | grep -qi "x-content-type-options"; then
    echo "  ✅ X-Content-Type-Options header present"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "  ❌ X-Content-Type-Options header missing"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
fi

if echo "$HEADERS_TEST" | grep -qi "x-frame-options"; then
    echo "  ✅ X-Frame-Options header present"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "  ❌ X-Frame-Options header missing"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
fi

if echo "$HEADERS_TEST" | grep -qi "content-security-policy"; then
    echo "  ✅ Content-Security-Policy header present"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "  ❌ Content-Security-Policy header missing"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
fi

echo ""
echo "🔍 Input Validation Testing:"
echo "----------------------------"

# Test input validation with malicious payloads
run_security_test "SQL Injection Test" \
    "curl -s -X POST http://localhost:$TEST_PORT/feed-values -H 'Content-Type: application/json' -d '{\"feeds\": [\"'; DROP TABLE users; --\"]}'" \
    "fail"

run_security_test "XSS Test" \
    "curl -s -X POST http://localhost:$TEST_PORT/feed-values -H 'Content-Type: application/json' -d '{\"feeds\": [\"<script>alert(1)</script>\"]}'" \
    "fail"

run_security_test "Large Payload Test" \
    "curl -s -X POST http://localhost:$TEST_PORT/feed-values -H 'Content-Type: application/json' -d '{\"feeds\": [\"$(printf 'A%.0s' {1..10000})\"]}'" \
    "fail"

run_security_test "Invalid JSON Test" \
    "curl -s -X POST http://localhost:$TEST_PORT/feed-values -H 'Content-Type: application/json' -d '{invalid json}'" \
    "fail"

echo ""
echo "🌐 CORS Testing:"
echo "---------------"

# Test CORS configuration
CORS_TEST=$(curl -s -I -H "Origin: http://malicious-site.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: Content-Type" -X OPTIONS http://localhost:$TEST_PORT/feed-values 2>/dev/null)

if echo "$CORS_TEST" | grep -qi "access-control-allow-origin"; then
    echo "  ✅ CORS headers present"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "  ❌ CORS headers missing"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
fi

echo ""
echo "🔒 Authentication Testing:"
echo "--------------------------"

# Test endpoints without authentication (should work for public API)
run_security_test "Public Health Endpoint" \
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/health/ready" \
    "success"

run_security_test "Public Metrics Endpoint" \
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/metrics" \
    "success"

# Test with invalid authentication headers
run_security_test "Invalid Auth Header" \
    "curl -s -X POST -H 'Authorization: Bearer invalid-token' -H 'Content-Type: application/json' -d '{\"feeds\":[{\"category\":1,\"name\":\"BTC/USD\"}]}' -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/feed-values" \
    "success"

echo ""
echo "🛡️  HTTP Method Testing:"
echo "-----------------------"

# Test unsupported HTTP methods
run_security_test "TRACE Method Test" \
    "curl -s -X TRACE -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/health/ready" \
    "fail"

run_security_test "DELETE Method Test" \
    "curl -s -X DELETE -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/health" \
    "fail"

run_security_test "PUT Method Test" \
    "curl -s -X PUT -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/health" \
    "fail"

echo ""
echo "📊 Content Type Testing:"
echo "------------------------"

# Test content type validation
run_security_test "XML Content Type" \
    "curl -s -X POST -H 'Content-Type: application/xml' -d '<xml>test</xml>' -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/feed-values" \
    "fail"

run_security_test "Plain Text Content Type" \
    "curl -s -X POST -H 'Content-Type: text/plain' -d 'plain text' -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/feed-values" \
    "fail"

echo ""
echo "🔍 Path Traversal Testing:"
echo "-------------------------"

# Test path traversal attempts
run_security_test "Path Traversal Test 1" \
    "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:$TEST_PORT/../../../etc/passwd'" \
    "fail"

run_security_test "Path Traversal Test 2" \
    "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:$TEST_PORT/health/../../config'" \
    "fail"

echo ""
echo "🌐 Host Header Testing:"
echo "-----------------------"

# Test host header injection
run_security_test "Host Header Injection" \
    "curl -s -H 'Host: malicious-host.com' -o /dev/null -w '%{http_code}' http://localhost:$TEST_PORT/health/live" \
    "success"

echo ""
echo "🚦 Rate Limiting Testing:"
echo "-------------------------"

# Test rate limiting
echo "Testing rate limiting..."

# In this repo, rate limiting is intentionally bypassed in development mode.
# Validate bypass behavior in dev, otherwise validate that rate limit headers are present and change.
HEADER_DUMP=$(curl -s -D - -o /dev/null http://localhost:$TEST_PORT/metrics 2>/dev/null | tr -d '\r')
BYPASS_HEADER=$(echo "$HEADER_DUMP" | awk -F': ' 'tolower($1)=="x-ratelimit-bypassed"{print $2}' | head -1)

if [ "$BYPASS_HEADER" = "development" ]; then
    echo "  ✅ Rate limiting bypassed in development (expected)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    # Validate headers exist and remaining decreases across a few requests.
    HEADER_1=$(curl -s -D - -o /dev/null http://localhost:$TEST_PORT/metrics 2>/dev/null | tr -d '\r')
    HEADER_2=$(curl -s -D - -o /dev/null http://localhost:$TEST_PORT/metrics 2>/dev/null | tr -d '\r')

    LIMIT_1=$(echo "$HEADER_1" | awk -F': ' 'tolower($1)=="x-ratelimit-limit"{print $2}' | head -1)
    REM_1=$(echo "$HEADER_1" | awk -F': ' 'tolower($1)=="x-ratelimit-remaining"{print $2}' | head -1)
    REM_2=$(echo "$HEADER_2" | awk -F': ' 'tolower($1)=="x-ratelimit-remaining"{print $2}' | head -1)

    if [ -n "$LIMIT_1" ] && [ -n "$REM_1" ] && [ -n "$REM_2" ] && [ "$REM_2" -lt "$REM_1" ] 2>/dev/null; then
        echo "  ✅ Rate limiting headers present and remaining decreases ($REM_1 -> $REM_2, limit=$LIMIT_1)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo "  ❌ Rate limiting validation failed (headers missing or not changing)"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
    fi
fi

echo ""
echo "📝 Response Analysis:"
echo "--------------------"

# Analyze responses for information disclosure
HEALTH_RESPONSE=$(curl -s http://localhost:$TEST_PORT/health/live 2>/dev/null)

if echo "$HEALTH_RESPONSE" | grep -qi "version\|build\|debug"; then
    echo "  ⚠️  Potential information disclosure in health endpoint"
    SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
else
    echo "  ✅ No obvious information disclosure"
    TESTS_PASSED=$((TESTS_PASSED + 1))
fi

# Stop the application with timeout protection
echo ""
echo "🛑 Stopping application..."
stop_tracked_apps

# Analyze application logs for security events
echo ""
echo "📊 Security Log Analysis:"
echo "========================="

if [ -f "$LOG_FILE" ]; then
    # Security-related log entries
    SECURITY_LOGS=$(grep -c "security\|Security\|auth\|Auth" "$LOG_FILE")
    echo "🔒 Security-related log entries: $SECURITY_LOGS"
    
    # Rate limiting logs
    RATE_LIMIT_LOGS=$(grep -c "rate.*limit\|Rate.*limit" "$LOG_FILE")
    echo "🚦 Rate limiting log entries: $RATE_LIMIT_LOGS"
    
    # Validation errors
    VALIDATION_ERRORS=$(grep -c "validation.*error\|Validation.*error" "$LOG_FILE")
    echo "🔍 Validation errors: $VALIDATION_ERRORS"
    
    # Suspicious activity
    SUSPICIOUS_ACTIVITY=$(grep -c "suspicious\|Suspicious\|malicious\|Malicious" "$LOG_FILE")
    echo "🚨 Suspicious activity logs: $SUSPICIOUS_ACTIVITY"
    
    if [ $SUSPICIOUS_ACTIVITY -gt 0 ]; then
        echo ""
        echo "Suspicious activity detected:"
        grep -E "(suspicious|Suspicious|malicious|Malicious)" "$LOG_FILE" | head -3
    fi
fi

# Generate final security report
echo ""
echo "📊 Security Test Summary:"
echo "========================="

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))

echo "📊 Total tests: $TOTAL_TESTS"
echo "✅ Tests passed: $TESTS_PASSED"
echo "❌ Tests failed: $TESTS_FAILED"
echo "🚨 Security issues: $SECURITY_ISSUES"

# Calculate security score
if [ $TOTAL_TESTS -gt 0 ]; then
    SECURITY_SCORE=$((TESTS_PASSED * 100 / TOTAL_TESTS))
    echo "📈 Security score: ${SECURITY_SCORE}%"
else
    SECURITY_SCORE=0
    echo "📈 Security score: Unable to calculate"
fi

# Log summary to report
echo "" >> "$SECURITY_REPORT"
echo "SUMMARY" >> "$SECURITY_REPORT"
echo "=======" >> "$SECURITY_REPORT"
echo "Total Tests: $TOTAL_TESTS" >> "$SECURITY_REPORT"
echo "Passed: $TESTS_PASSED" >> "$SECURITY_REPORT"
echo "Failed: $TESTS_FAILED" >> "$SECURITY_REPORT"
echo "Security Issues: $SECURITY_ISSUES" >> "$SECURITY_REPORT"
echo "Security Score: ${SECURITY_SCORE}%" >> "$SECURITY_REPORT"

# Security recommendations
echo ""
echo "🎯 Security Recommendations:"
echo "============================"

if [ $SECURITY_ISSUES -gt 5 ]; then
    echo "🔧 CRITICAL: Multiple security issues detected"
    echo "   - Review all failed security tests"
    echo "   - Implement missing security headers"
    echo "   - Strengthen input validation"
    echo "Status: CRITICAL" >> "$SECURITY_REPORT"
elif [ $SECURITY_ISSUES -gt 2 ]; then
    echo "🔧 HIGH: Some security issues detected"
    echo "   - Address failed security tests"
    echo "   - Review security configurations"
    echo "Status: NEEDS ATTENTION" >> "$SECURITY_REPORT"
elif [ $SECURITY_ISSUES -gt 0 ]; then
    echo "🔧 MEDIUM: Minor security issues detected"
    echo "   - Review and fix identified issues"
    echo "Status: MINOR ISSUES" >> "$SECURITY_REPORT"
else
    echo "🎉 EXCELLENT: No major security issues detected"
    echo "   - Continue monitoring security practices"
    echo "Status: SECURE" >> "$SECURITY_REPORT"
fi

# Overall security assessment
echo ""
echo "🛡️  Overall Security Assessment:"
echo "==============================="

if [ $SECURITY_SCORE -ge 90 ] && [ $SECURITY_ISSUES -eq 0 ]; then
    echo "🎉 EXCELLENT: Security posture is strong"
elif [ $SECURITY_SCORE -ge 80 ] && [ $SECURITY_ISSUES -le 2 ]; then
    echo "✅ GOOD: Security posture is acceptable"
elif [ $SECURITY_SCORE -ge 70 ]; then
    echo "⚠️  FAIR: Security posture needs improvement"
else
    echo "❌ POOR: Security posture requires immediate attention"
fi

# Source enhanced log summary utilities
source "$(dirname "$0")/../utils/parse-logs.sh"

# Show test summary
log_summary "$LOG_FILE" "security" "test"

echo ""
echo "✨ Security testing complete!"
echo "📁 Results available at:"
echo "   - Detailed logs: $LOG_FILE"
echo "   - Security report: $SECURITY_REPORT"