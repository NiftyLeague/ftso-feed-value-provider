#!/bin/bash

# Comprehensive FTSO Testing Suite
# Runs all testing scripts in sequence for complete system validation

# Source common cleanup utilities
source "$(dirname "$0")/../utils/cleanup.sh"

# Set up cleanup handlers
setup_cleanup_handlers

echo "🧪 FTSO Comprehensive Testing Suite"
echo "==================================="
echo "This script will run all testing tools to provide complete system validation."
echo ""

# Create test directory
TEST_DIR="logs/test"
mkdir -p "$TEST_DIR"

echo "📁 Test directory: $TEST_DIR"
echo "⏱️  Starting comprehensive testing..."
echo ""

# Function to run a test script with timeout support
run_test_script() {
    local script_name=$1
    local description=$2
    local timeout_seconds=${3:-300}  # Default 5 minutes
    
    echo "🔄 Running $description..."
    echo "⏰ Timeout: ${timeout_seconds}s"
    echo "----------------------------------------"
    
    if [ -f "scripts/$script_name" ]; then
        # Make sure script is executable
        chmod +x "scripts/$script_name"
        
        # Extract just the filename without directory and extension
        local base_name=$(basename "$script_name" .sh)
        
        # Run the script in background to allow proper signal handling
        ./scripts/$script_name &
        local test_pid=$!
        
        # Wait for completion with timeout
        local count=0
        while [ $count -lt $timeout_seconds ]; do
            if ! kill -0 $test_pid 2>/dev/null; then
                # Process finished, get exit code
                wait $test_pid 2>/dev/null
                local exit_code=$?
                if [ $exit_code -eq 0 ]; then
                    echo "✅ $description completed"
                    echo "📊 Output: $TEST_DIR/${base_name}_output.log"
                else
                    echo "❌ $description failed with exit code: $exit_code"
                    # Cleanup processes after failure using shared cleanup (quietly)
                    cleanup_ftso_processes >/dev/null 2>&1
                    cleanup_ftso_ports >/dev/null 2>&1
                fi
                return $exit_code
            fi
            sleep 1
            count=$((count + 1))
        done
        
        # Timeout reached, kill the process
        echo "⏰ $description timed out after ${timeout_seconds}s"
        kill -TERM $test_pid 2>/dev/null
        sleep 2
        if kill -0 $test_pid 2>/dev/null; then
            kill -KILL $test_pid 2>/dev/null
        fi
        
        # Cleanup after timeout
        cleanup_ftso_processes >/dev/null 2>&1
        cleanup_ftso_ports >/dev/null 2>&1
        return 124
    else
        echo "❌ Script not found: scripts/$script_name"
    fi
    
    echo ""
}

# Run all test scripts in logical order
echo "🧪 Phase 1: Server Functionality Testing"
echo "========================================"
run_test_script "test/server.sh" "Server Functionality Test" 120
if [ $? -eq 130 ]; then exit 130; fi

echo "🔒 Phase 2: Security Testing"
echo "============================"
run_test_script "test/security.sh" "Security & Rate Limiting Test" 180
if [ $? -eq 130 ]; then exit 130; fi

echo "🚀 Phase 3: Load Testing"
echo "========================"
run_test_script "test/load.sh" "Load & Stress Testing" 300
if [ $? -eq 130 ]; then exit 130; fi

echo "🛑 Phase 4: Graceful Shutdown Testing"
echo "====================================="
run_test_script "test/shutdown.sh" "Graceful Shutdown Test" 60
if [ $? -eq 130 ]; then exit 130; fi

echo "🔬 Phase 5: Comprehensive Test Suite"
echo "========================================="
run_test_script "test/runner.sh all" "Comprehensive Test Suite" 600
if [ $? -eq 130 ]; then exit 130; fi

# Generate comprehensive test summary report
SUMMARY_FILE="$TEST_DIR/comprehensive_test_summary.md"

echo "📋 Generating comprehensive test summary..."

cat > "$SUMMARY_FILE" << EOF
# FTSO System Test Report
**Generated:** $(date)

## Executive Summary

This report provides a comprehensive testing analysis of the FTSO Feed Value Provider system across multiple dimensions:

### Testing Coverage
- ✅ Server Functionality
- ✅ Security & Rate Limiting
- ✅ Load & Stress Testing
- ✅ Test Suite Validation
- ✅ Graceful Shutdown

### Key Findings

EOF

# Analyze each component and add to summary
if [ -f "$SESSION_DIR/server_output.log" ]; then
    echo "#### Server Functionality Testing" >> "$SUMMARY_FILE"
    
    # Extract key metrics from server test log
    SERVER_READY=$(grep -c "Server is ready" "$SESSION_DIR/server_output.log" || echo "0")
    ENDPOINTS_TESTED=$(grep -c "Testing.*endpoint" "$SESSION_DIR/server_output.log" || echo "0")
    
    echo "- **Server Readiness:** $([ $SERVER_READY -gt 0 ] && echo "✅ Ready" || echo "❌ Not Ready")" >> "$SUMMARY_FILE"
    echo "- **Endpoints Tested:** $ENDPOINTS_TESTED" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

if [ -f "$SESSION_DIR/security_output.log" ]; then
    echo "#### Security Testing" >> "$SUMMARY_FILE"
    
    # Extract security metrics
    TESTS_PASSED=$(grep -c "Tests passed:" "$SESSION_DIR/security_output.log" | head -1 || echo "0")
    SECURITY_ISSUES=$(grep -c "Security issues:" "$SESSION_DIR/security_output.log" | head -1 || echo "0")
    
    echo "- **Security Tests Passed:** $TESTS_PASSED" >> "$SUMMARY_FILE"
    echo "- **Security Issues Found:** $SECURITY_ISSUES" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

if [ -f "$SESSION_DIR/load_output.log" ]; then
    echo "#### Load Testing" >> "$SUMMARY_FILE"
    
    # Extract load test metrics
    LOAD_TESTS=$(grep -c "Load Test:" "$SESSION_DIR/load_output.log" || echo "0")
    STRESS_TESTS=$(grep -c "Stress Test" "$SESSION_DIR/load_output.log" || echo "0")
    
    echo "- **Load Tests Executed:** $LOAD_TESTS" >> "$SUMMARY_FILE"
    echo "- **Stress Tests Executed:** $STRESS_TESTS" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

if [ -f "$SESSION_DIR/validation_output.log" ]; then
    echo "#### Test Suite Validation" >> "$SUMMARY_FILE"
    
    # Extract validation metrics
    VALIDATION_RUNS=$(grep -c "Run.*:" "$SESSION_DIR/validation_output.log" || echo "0")
    FLAKY_TESTS=$(grep -c "FLAKY" "$SESSION_DIR/validation_output.log" || echo "0")
    
    echo "- **Validation Runs:** $VALIDATION_RUNS" >> "$SUMMARY_FILE"
    echo "- **Flaky Tests Detected:** $FLAKY_TESTS" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

if [ -f "$SESSION_DIR/shutdown_output.log" ]; then
    echo "#### Graceful Shutdown Testing" >> "$SUMMARY_FILE"
    
    # Extract shutdown metrics
    SHUTDOWN_SUCCESS=$(grep -c "graceful.*shutdown.*success" "$SESSION_DIR/shutdown_output.log" || echo "0")
    
    echo "- **Graceful Shutdown:** $([ $SHUTDOWN_SUCCESS -gt 0 ] && echo "✅ Successful" || echo "❌ Issues Detected")" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

# Add recommendations section
cat >> "$SUMMARY_FILE" << EOF
## Recommendations

### Immediate Actions
- Review any failed tests or security issues
- Address any performance bottlenecks identified in load testing
- Fix any flaky tests detected in validation

### Performance Optimization
- Monitor memory usage patterns from load testing
- Review response time metrics for optimization opportunities
- Consider scaling strategies based on load test results

### Security Hardening
- Address any security vulnerabilities found
- Review and strengthen input validation
- Ensure all security headers are properly configured

### Reliability Improvements
- Fix any graceful shutdown issues
- Address test suite reliability problems
- Implement monitoring for identified weak points

## Files Generated
EOF

# List all generated files
for file in "$TEST_DIR"/*_output.log; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        echo "- \`$filename\`" >> "$SUMMARY_FILE"
    fi
done

echo "" >> "$SUMMARY_FILE"
echo "---" >> "$SUMMARY_FILE"
echo "*Report generated by FTSO Testing Suite*" >> "$SUMMARY_FILE"

# Display final summary
echo "📋 Comprehensive Testing Complete!"
echo "=================================="
echo ""
echo "📁 All results saved to: $TEST_DIR"

echo ""
echo "📄 Comprehensive report: $SUMMARY_FILE"
echo ""
echo "🔧 Next Steps:"
echo "1. Review the enhanced log analysis above for critical issues"
echo "2. Check the comprehensive summary: $SUMMARY_FILE"
echo "3. Check individual test logs in: $TEST_DIR"
echo "4. Address any critical issues identified"
echo "5. Set up monitoring for ongoing test health"
echo ""
echo "✨ Testing session complete!"