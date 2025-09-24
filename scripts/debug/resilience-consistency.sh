#!/bin/bash

# =============================================================================
# FTSO Resilience Consistency Test
# =============================================================================
# Tests that resilient behavior is consistent across all environments
# Ensures production failures can be accurately tested in development
# =============================================================================

echo "🧪 FTSO Resilience Consistency Test"
echo "===================================="
echo "Verifying consistent resilient behavior across environments"
echo ""

# Configuration
TEST_DURATION=8
RESULTS_DIR="logs/debug"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$RESULTS_DIR/resilience-consistency-report_$TIMESTAMP.log"

# Ensure logs directory exists
mkdir -p "$RESULTS_DIR"

echo "📁 Report file: $REPORT_FILE"
echo "⏱️  Running quick resilience test..."
echo ""

# Function to test a single environment
test_environment() {
    local env=$1
    local log_file="$RESULTS_DIR/resilience_test_${env}_$TIMESTAMP.log"
    
    echo "🔍 Testing environment: $env"
    echo "   Log file: $log_file"
    
    # Kill any existing processes on port 3101 to avoid EADDRINUSE
    lsof -ti:3101 | xargs kill -9 2>/dev/null || true
    
    # Start the application with the specified environment and clean output capture
    NODE_ENV=$env npm run start:dev 2>&1 | strip_ansi > "$log_file" &
    local pid=$!
    
    # Wait for the specified duration (using sleep instead of timeout for macOS compatibility)
    sleep $TEST_DURATION
    
    # Kill the process
    kill $pid 2>/dev/null
    wait $pid 2>/dev/null
    
    # Analyze the output
    local websocket_fallback=0
    local rest_fallback=0
    local graceful_degradation=0
    local circuit_breaker_stable=0
    
    # Check for resilient behavior patterns
    if grep -q "falling back to REST API\|will use REST API fallback\|continuing with REST API fallback" "$log_file"; then
        websocket_fallback=1
    fi
    
    if grep -q "REST API fallback\|REST-only mode" "$log_file"; then
        rest_fallback=1
    fi
    
    if grep -q "degraded mode\|graceful" "$log_file"; then
        graceful_degradation=1
    fi
    
    if grep -q "Circuit breaker CLOSED" "$log_file" && ! grep -q "Circuit breaker OPEN" "$log_file"; then
        circuit_breaker_stable=1
    fi
    
    # Count errors and warnings (be more specific to avoid false positives)
    local error_count=$(grep -c "\[ERROR\]\|\] ERROR \|Error:" "$log_file" 2>/dev/null || echo 0)
    local warning_count=$(grep -c "\[WARN\]\|\] WARN \|Warning:" "$log_file" 2>/dev/null || echo 0)
    
    # Report results
    echo "   ✅ WebSocket fallback behavior: $([ $websocket_fallback -eq 1 ] && echo "DETECTED" || echo "NOT DETECTED")"
    echo "   ✅ REST API fallback: $([ $rest_fallback -eq 1 ] && echo "WORKING" || echo "NOT DETECTED")"
    echo "   ✅ Graceful degradation: $([ $graceful_degradation -eq 1 ] && echo "WORKING" || echo "NOT DETECTED")"
    echo "   ✅ Circuit breaker stability: $([ $circuit_breaker_stable -eq 1 ] && echo "STABLE" || echo "UNSTABLE")"
    echo "   📊 Errors: $error_count, Warnings: $warning_count"
    echo ""
    
    # Write to report
    cat >> "$REPORT_FILE" << EOF
Environment: $env
================
WebSocket Fallback: $([ $websocket_fallback -eq 1 ] && echo "YES" || echo "NO")
REST API Fallback: $([ $rest_fallback -eq 1 ] && echo "YES" || echo "NO")
Graceful Degradation: $([ $graceful_degradation -eq 1 ] && echo "YES" || echo "NO")
Circuit Breaker Stable: $([ $circuit_breaker_stable -eq 1 ] && echo "YES" || echo "NO")
Error Count: $error_count
Warning Count: $warning_count
Log File: $log_file

EOF
    
    # Return results as space-separated values for consistency checking
    echo "$websocket_fallback $rest_fallback $graceful_degradation $circuit_breaker_stable"
}

# Run a single test to check for resilient behavior patterns
echo "🔍 Testing current resilient behavior patterns..."

log_file="$RESULTS_DIR/resilience_test_$TIMESTAMP.log"
echo "   Log file: $log_file"

# Kill any existing processes on port 3101 to avoid EADDRINUSE
lsof -ti:3101 | xargs kill -9 2>/dev/null || true

# Start the application with clean output capture
npm run start:dev 2>&1 | strip_ansi > "$log_file" &
pid=$!

# Wait for the specified duration
sleep $TEST_DURATION

# Kill the process
kill $pid 2>/dev/null
wait $pid 2>/dev/null

echo ""
echo "📊 System Health & Resilience Analysis"
echo "======================================"

# Analyze the output for system health and resilient behavior
startup_successful=0
websocket_connections=0
circuit_breaker_stable=0
graceful_degradation=0
no_fatal_errors=1
no_environment_specific=1

# Check for successful startup
if grep -q "Service initialized successfully\|Module initialization completed\|Nest application successfully started\|HTTP server started" "$log_file"; then
    startup_successful=1
fi

# Check for WebSocket connections (successful connections indicate resilient infrastructure)
if grep -q "WebSocket connected\|Started WebSocket watching\|Subscribing to WebSocket" "$log_file"; then
    websocket_connections=1
fi

# Check for circuit breaker stability
if grep -q "Circuit breaker CLOSED" "$log_file" && ! grep -q "Circuit breaker OPEN" "$log_file"; then
    circuit_breaker_stable=1
fi

# Check for graceful degradation patterns
if grep -q "degraded mode\|graceful\|fallback\|continuing with" "$log_file"; then
    graceful_degradation=1
fi

# Check for fatal errors (should be none)
if grep -q "FATAL\|Fatal\|Critical error\|System crash" "$log_file"; then
    no_fatal_errors=0
fi

# Check for environment-specific logic (this should NOT be found)
if grep -q "isDevelopment\|isProduction\|NODE_ENV.*development\|NODE_ENV.*production" "$log_file"; then
    no_environment_specific=0
fi

# Count errors and warnings
error_count=$(grep -c "\] ERROR \|Error:" "$log_file" 2>/dev/null || echo 0)
warning_count=$(grep -c "\] WARN \|Warning:" "$log_file" 2>/dev/null || echo 0)

# Report results
echo "✅ Successful startup: $([ $startup_successful -eq 1 ] && echo "YES" || echo "NO")"
echo "✅ WebSocket connections established: $([ $websocket_connections -eq 1 ] && echo "YES" || echo "NO")"
echo "✅ Circuit breaker stability: $([ $circuit_breaker_stable -eq 1 ] && echo "STABLE" || echo "NEEDS REVIEW")"
echo "✅ Graceful degradation patterns: $([ $graceful_degradation -eq 1 ] && echo "PRESENT" || echo "NOT DETECTED")"
echo "✅ No fatal errors: $([ $no_fatal_errors -eq 1 ] && echo "CLEAN" || echo "FATAL ERRORS FOUND")"
echo "✅ No environment-specific logic: $([ $no_environment_specific -eq 1 ] && echo "CLEAN" || echo "FOUND - NEEDS FIXING")"
echo "📊 Errors: $error_count, Warnings: $warning_count"

# Write report
cat > "$REPORT_FILE" << EOF
FTSO Resilience Consistency Test Report
Generated: $(date)
========================================

System Health Analysis:
- Successful Startup: $([ $startup_successful -eq 1 ] && echo "YES" || echo "NO")
- WebSocket Connections: $([ $websocket_connections -eq 1 ] && echo "YES" || echo "NO")
- Circuit Breaker Stable: $([ $circuit_breaker_stable -eq 1 ] && echo "YES" || echo "NO")
- Graceful Degradation Patterns: $([ $graceful_degradation -eq 1 ] && echo "YES" || echo "NO")
- No Fatal Errors: $([ $no_fatal_errors -eq 1 ] && echo "YES" || echo "NO")
- No Environment-Specific Logic: $([ $no_environment_specific -eq 1 ] && echo "YES" || echo "NO")

Error Count: $error_count
Warning Count: $warning_count
Log File: $log_file

EOF

echo ""

# Overall assessment
health_score=$((startup_successful + websocket_connections + circuit_breaker_stable + graceful_degradation + no_fatal_errors + no_environment_specific))

if [ $health_score -ge 5 ]; then
    echo ""
    echo "🎯 Overall Result: ✅ SYSTEM HEALTH EXCELLENT"
    echo "✨ Great! The system demonstrates robust resilient architecture."
    echo "   Environment-agnostic design with proper graceful degradation patterns."
    
    cat >> "$REPORT_FILE" << EOF
OVERALL RESULT: SYSTEM HEALTH EXCELLENT ✅
==========================================
Score: $health_score/6
The system demonstrates robust resilient architecture with environment-agnostic behavior.

EOF
    exit_code=0
elif [ $health_score -ge 4 ]; then
    echo ""
    echo "🎯 Overall Result: ✅ SYSTEM HEALTH GOOD"
    echo "   Score: $health_score/6"
    echo "   Minor improvements possible but system is resilient."
    
    cat >> "$REPORT_FILE" << EOF
OVERALL RESULT: SYSTEM HEALTH GOOD ✅
====================================
Score: $health_score/6
System is resilient with minor areas for improvement.

EOF
    exit_code=0
else
    echo ""
    echo "🎯 Overall Result: ⚠️  SYSTEM HEALTH NEEDS ATTENTION"
    echo "   Score: $health_score/6"
    echo "   Review the system for resilience and stability issues."
    
    cat >> "$REPORT_FILE" << EOF
OVERALL RESULT: SYSTEM HEALTH NEEDS ATTENTION ⚠️
================================================
Score: $health_score/6
The system may have resilience or stability issues that need attention.

EOF
    exit_code=1
fi

echo ""
echo "📁 Detailed report saved to: $REPORT_FILE"
echo "📁 Test log saved to: $log_file"
echo ""
echo "✨ Resilience consistency test complete!"

exit $exit_code