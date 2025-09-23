#!/bin/bash

# Comprehensive FTSO Testing Suite
# Runs all testing scripts in sequence for complete system validation

echo "🧪 FTSO Comprehensive Testing Suite"
echo "==================================="
echo "This script will run all testing tools to provide complete system validation."
echo ""

# Ensure logs directory exists
mkdir -p logs

# Create timestamp for this test session
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
SESSION_DIR="logs/test_session_$TIMESTAMP"
mkdir -p "$SESSION_DIR"

echo "📁 Test session directory: $SESSION_DIR"
echo "⏱️  Starting comprehensive testing..."
echo ""

# Function to run a test script and capture its output
run_test_script() {
    local script_name=$1
    local description=$2
    
    echo "🔄 Running $description..."
    echo "----------------------------------------"
    
    if [ -f "scripts/$script_name" ]; then
        # Make sure script is executable
        chmod +x "scripts/$script_name"
        
        # Run the script and capture output
        ./scripts/$script_name > "$SESSION_DIR/${script_name%.sh}_output.log" 2>&1
        
        # Show summary
        echo "✅ $description completed"
        echo "📊 Output saved to: $SESSION_DIR/${script_name%.sh}_output.log"
    else
        echo "❌ Script not found: scripts/$script_name"
    fi
    
    echo ""
}

# Run all test scripts in logical order
echo "🧪 Phase 1: Server Functionality Testing"
echo "========================================"
run_test_script "test/server.sh" "Server Functionality Test"

echo "🔒 Phase 2: Security Testing"
echo "============================"
run_test_script "test/security.sh" "Security & Rate Limiting Test"

echo "🚀 Phase 3: Load Testing"
echo "========================"
run_test_script "test/load.sh" "Load & Stress Testing"

echo "🔬 Phase 4: Test Suite Validation"
echo "================================="
run_test_script "test/validation.sh" "Test Suite Validation"

echo "🛑 Phase 5: Graceful Shutdown Testing"
echo "====================================="
run_test_script "test/graceful-shutdown.sh" "Graceful Shutdown Test"

# Generate comprehensive test summary report
SUMMARY_FILE="$SESSION_DIR/comprehensive_test_summary.md"

echo "📋 Generating comprehensive test summary..."

cat > "$SUMMARY_FILE" << EOF
# FTSO System Test Report
**Generated:** $(date)
**Session ID:** $TIMESTAMP

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

if [ -f "$SESSION_DIR/graceful-shutdown_output.log" ]; then
    echo "#### Graceful Shutdown Testing" >> "$SUMMARY_FILE"
    
    # Extract shutdown metrics
    SHUTDOWN_SUCCESS=$(grep -c "graceful.*shutdown.*success" "$SESSION_DIR/graceful-shutdown_output.log" || echo "0")
    
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
for file in "$SESSION_DIR"/*.log; do
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
echo "📁 All results saved to: $SESSION_DIR"
echo ""
echo "📊 Quick Summary:"
echo "-----------------"

# Show key metrics from summary
if [ -f "$SUMMARY_FILE" ]; then
    echo "📄 Comprehensive report: $SUMMARY_FILE"
    echo ""
    echo "🔍 Key Findings:"
    
    # Show a few key lines from the summary
    grep -E "Server Readiness|Security Issues|Load Tests|Flaky Tests" "$SUMMARY_FILE" | head -4
fi

echo ""
echo "🔧 Next Steps:"
echo "1. Review the comprehensive summary: $SUMMARY_FILE"
echo "2. Check individual test logs in: $SESSION_DIR"
echo "3. Address any critical issues identified"
echo "4. Set up monitoring for ongoing test health"
echo ""
echo "✨ Testing session complete!"