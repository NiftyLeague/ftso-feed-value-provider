#!/bin/bash

# Security & Rate Limiting Testing Script
# Tests API security, rate limiting, input validation, and access control

# Source common test utilities
source "$(dirname "$0")/../utils/test-common.sh"

echo "🔒 FTSO Security & Rate Limiting Tester"
echo "======================================="

# Set up cleanup handlers
setup_cleanup_handlers

# Configuration - Reduced timeout
TIMEOUT=45  # Reduced from 90

# Set up logging using common utility
setup_test_logging "security"
LOG_FILE="$TEST_LOG_FILE"
SECURITY_REPORT="$TEST_LOG_DIR/security-report.log"

echo "📝 Starting security testing..."

# Initialize security report
echo "FTSO Security Test Report - $(date)" > "$SECURITY_REPORT"
echo "====================================" >> "$SECURITY_REPORT"
echo "" >> "$SECURITY_REPORT"

# Start the application using shared cleanup system
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Waiting for server to be ready..."

# Wait for server to be ready - Reduced timeout
READY_TIMEOUT=30  # Reduced from 60
ELAPSED=0

while [ $ELAPSED -lt $READY_TIMEOUT ]; do
    if ! kill -0 $APP_PID 2>/dev/null; then
        echo "❌ Application stopped unexpectedly"
        exit 1
    fi
    
    # Test if server is ready with timeout
    if curl -s --max-time 3 -o /dev/null -w "%{http_code}" http://localhost:3101/health 2>/dev/null | grep -q "200\|503"; then
        echo "✅ Server is ready for testing"
        break
    fi
    
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $READY_TIMEOUT ]; then
    echo "⏰ Server readiness timeout"
    exit 1
fi

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
    
    if [ "$expected_result" = "success" ] && [ $exit_code -eq 0 ]; then
        echo "  ✅ PASS: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "PASS: $test_name" >> "$SECURITY_REPORT"
    elif [ "$expected_result" = "fail" ] && [ $exit_code -ne 0 ]; then
        echo "  ✅ PASS: $test_name (correctly rejected)"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo "PASS: $test_name (correctly rejected)" >> "$SECURITY_REPORT"
    else
        echo "  ❌ FAIL: $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        SECURITY_ISSUES=$((SECURITY_ISSUES + 1))
        echo "FAIL: $test_name" >> "$SECURITY_REPORT"
    fi
    
    echo "    Result: $result" >> "$SECURITY_REPORT"
    echo "" >> "$SECURITY_REPORT"
}

echo "🔐 HTTP Security Headers Testing:"
echo "---------------------------------"

# Test security headers
echo "Testing security headers..."

HEADERS_TEST=$(curl -s -I http://localhost:3101/health 2>/dev/null)

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
echo "🚦 Rate Limiting Testing:"
echo "-------------------------"

# Test rate limiting
echo "Testing rate limiting..."

# Make multiple rapid requests to test rate limiting
RATE_LIMIT_REQUESTS=20
RATE_LIMITED=0

for i in $(seq 1 $RATE_LIMIT_REQUESTS); do
    RESPONSE=$(curl -s -w "%{http_code}" -o /dev/null http://localhost:3101/health 2>/dev/null)
    if [ "$RESPONSE" = "429" ]; then
        RATE_LIMITED=$((RATE_LIMITED + 1))
    fi
    sleep 0.1
done

if [ $RATE_LIMITED -gt 0 ]; then
    echo "  ✅ Rate limiting is working ($RATE_LIMITED/20 requests limited)"
    TESTS_PASSED=$((TESTS_PASSED + 1))
else
    echo "  ⚠️  Rate limiting not triggered (may need more requests)"
    TESTS_FAILED=$((TESTS_FAILED + 1))
fi

echo ""
echo "🔍 Input Validation Testing:"
echo "----------------------------"

# Test input validation with malicious payloads
run_security_test "SQL Injection Test" \
    "curl -s -X POST http://localhost:3101/feed-values -H 'Content-Type: application/json' -d '{\"feeds\": [\"'; DROP TABLE users; --\"]}'" \
    "fail"

run_security_test "XSS Test" \
    "curl -s -X POST http://localhost:3101/feed-values -H 'Content-Type: application/json' -d '{\"feeds\": [\"<script>alert(1)</script>\"]}'" \
    "fail"

run_security_test "Large Payload Test" \
    "curl -s -X POST http://localhost:3101/feed-values -H 'Content-Type: application/json' -d '{\"feeds\": [\"$(printf 'A%.0s' {1..10000})\"]}'" \
    "fail"

run_security_test "Invalid JSON Test" \
    "curl -s -X POST http://localhost:3101/feed-values -H 'Content-Type: application/json' -d '{invalid json}'" \
    "fail"

echo ""
echo "🌐 CORS Testing:"
echo "---------------"

# Test CORS configuration
CORS_TEST=$(curl -s -H "Origin: http://malicious-site.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: Content-Type" -X OPTIONS http://localhost:3101/feed-values 2>/dev/null)

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
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:3101/health" \
    "success"

run_security_test "Public Metrics Endpoint" \
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:3101/metrics" \
    "success"

# Test with invalid authentication headers
run_security_test "Invalid Auth Header" \
    "curl -s -H 'Authorization: Bearer invalid-token' -o /dev/null -w '%{http_code}' http://localhost:3101/feed-values" \
    "success"

echo ""
echo "🛡️  HTTP Method Testing:"
echo "-----------------------"

# Test unsupported HTTP methods
run_security_test "TRACE Method Test" \
    "curl -s -X TRACE -o /dev/null -w '%{http_code}' http://localhost:3101/health" \
    "fail"

run_security_test "DELETE Method Test" \
    "curl -s -X DELETE -o /dev/null -w '%{http_code}' http://localhost:3101/health" \
    "fail"

run_security_test "PUT Method Test" \
    "curl -s -X PUT -o /dev/null -w '%{http_code}' http://localhost:3101/health" \
    "fail"

echo ""
echo "📊 Content Type Testing:"
echo "------------------------"

# Test content type validation
run_security_test "XML Content Type" \
    "curl -s -X POST -H 'Content-Type: application/xml' -d '<xml>test</xml>' -o /dev/null -w '%{http_code}' http://localhost:3101/feed-values" \
    "fail"

run_security_test "Plain Text Content Type" \
    "curl -s -X POST -H 'Content-Type: text/plain' -d 'plain text' -o /dev/null -w '%{http_code}' http://localhost:3101/feed-values" \
    "fail"

echo ""
echo "🔍 Path Traversal Testing:"
echo "-------------------------"

# Test path traversal attempts
run_security_test "Path Traversal Test 1" \
    "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3101/../../../etc/passwd'" \
    "fail"

run_security_test "Path Traversal Test 2" \
    "curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3101/health/../../config'" \
    "fail"

echo ""
echo "🌐 Host Header Testing:"
echo "-----------------------"

# Test host header injection
run_security_test "Host Header Injection" \
    "curl -s -H 'Host: malicious-host.com' -o /dev/null -w '%{http_code}' http://localhost:3101/health" \
    "success"

echo ""
echo "📝 Response Analysis:"
echo "--------------------"

# Analyze responses for information disclosure
HEALTH_RESPONSE=$(curl -s http://localhost:3101/health 2>/dev/null)

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

echo ""
echo "✨ Security testing complete!"
echo "📁 Results available at:"
echo "   - Detailed logs: $LOG_FILE"
echo "   - Security report: $SECURITY_REPORT"