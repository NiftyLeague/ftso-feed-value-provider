#!/bin/bash

# Test Suite Performance and Reliability Validation Script
# 
# This script validates the test suite by running our comprehensive test:all
# multiple times and analyzing the results for consistency and reliability

# Source common test utilities
source "$(dirname "$0")/../utils/test-common.sh"

echo "🔍 FTSO Test Suite Validation"
echo "============================="

# Set up cleanup handlers
setup_cleanup_handlers

# Configuration - Simplified approach
NUMBER_OF_RUNS=2
MAX_RUN_TIME_SECONDS=300  # 5 minutes per test:all run
FLAKY_TEST_THRESHOLD=80   # 80% pass rate minimum

# Set up logging using common utility
setup_test_logging "validation"
LOG_FILE="$TEST_LOG_FILE"
REPORT_FILE="$TEST_LOG_DIR/test-validation-report.log"

# Arrays to store results
declare -a RUN_RESULTS
declare -a RUN_DURATIONS

echo "📝 Starting test suite validation using pnpm test:all..."
echo "📁 Log file: $LOG_FILE"
echo "📊 Report file: $REPORT_FILE"

# Initialize report
echo "FTSO Test Suite Validation Report - $(date)" > "$REPORT_FILE"
echo "=============================================" >> "$REPORT_FILE"
echo "Method: Running pnpm test:all multiple times" >> "$REPORT_FILE"
echo "Runs: $NUMBER_OF_RUNS" >> "$REPORT_FILE"
echo "Timeout per run: ${MAX_RUN_TIME_SECONDS}s" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Function to run test:all and capture results
run_test_all() {
    local run_number=$1
    local start_time=$(date +%s)
    
    echo ""
    echo "🧪 Run $run_number/$NUMBER_OF_RUNS: Running pnpm test:all"
    echo "⏰ Timeout: ${MAX_RUN_TIME_SECONDS}s"
    
    # Create temporary log file for this run
    local run_log="$TEST_LOG_DIR/validation_run_${run_number}.log"
    
    # Run test:all with timeout
    if timeout "${MAX_RUN_TIME_SECONDS}s" pnpm test:all > "$run_log" 2>&1; then
        local exit_code=0
        echo "  ✅ Run $run_number: PASSED"
    else
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo "  ⏰ Run $run_number: TIMED OUT after ${MAX_RUN_TIME_SECONDS}s"
        else
            echo "  ❌ Run $run_number: FAILED (exit code: $exit_code)"
        fi
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Parse test results from output
    local tests_run=0
    local tests_passed=0
    local tests_failed=0
    
    if [ -f "$run_log" ]; then
        # Extract Jest test results
        tests_run=$(grep -o "Tests:.*" "$run_log" | head -1 | grep -o "[0-9]\+ total" | grep -o "[0-9]\+" || echo "0")
        tests_passed=$(grep -o "[0-9]\+ passed" "$run_log" | head -1 | grep -o "[0-9]\+" || echo "0")
        tests_failed=$(grep -o "[0-9]\+ failed" "$run_log" | head -1 | grep -o "[0-9]\+" || echo "0")
        
        # If no Jest output, try to count test files
        if [ "$tests_run" -eq 0 ]; then
            tests_run=$(grep -c "\.spec\.ts" "$run_log" || echo "0")
        fi
        
        # Append run log to main log
        echo "=== Run $run_number ===" >> "$LOG_FILE"
        cat "$run_log" >> "$LOG_FILE"
        echo "" >> "$LOG_FILE"
    fi
    
    # Store results
    local result_line="$run_number|$exit_code|$duration|$tests_run|$tests_passed|$tests_failed"
    RUN_RESULTS+=("$result_line")
    RUN_DURATIONS+=("$duration")
    
    echo "  📊 Duration: ${duration}s"
    echo "  📈 Tests: $tests_run total, $tests_passed passed, $tests_failed failed"
    
    # Log to report
    echo "Run $run_number:" >> "$REPORT_FILE"
    echo "  Exit Code: $exit_code" >> "$REPORT_FILE"
    echo "  Duration: ${duration}s" >> "$REPORT_FILE"
    echo "  Tests Run: $tests_run" >> "$REPORT_FILE"
    echo "  Tests Passed: $tests_passed" >> "$REPORT_FILE"
    echo "  Tests Failed: $tests_failed" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
    
    return $exit_code
}

# Run the test suite multiple times
echo ""
echo "🚀 Running Test Suite Validation"
echo "================================="

successful_runs=0
total_runs=0

for ((run=1; run<=NUMBER_OF_RUNS; run++)); do
    total_runs=$((total_runs + 1))
    
    if run_test_all "$run"; then
        successful_runs=$((successful_runs + 1))
    fi
    
    # Small delay between runs
    if [ $run -lt $NUMBER_OF_RUNS ]; then
        echo "⏳ Waiting 5 seconds before next run..."
        sleep 5
    fi
done

# Analyze results
echo ""
echo "📊 Test Suite Analysis"
echo "======================"

# Calculate success rate
local success_rate=0
if [ $total_runs -gt 0 ]; then
    success_rate=$((successful_runs * 100 / total_runs))
fi

echo "📈 Overall Results:"
echo "  Total Runs: $total_runs"
echo "  Successful Runs: $successful_runs"
echo "  Success Rate: ${success_rate}%"

# Performance analysis
if [ ${#RUN_DURATIONS[@]} -gt 0 ]; then
    local total_duration=0
    local min_duration=${RUN_DURATIONS[0]}
    local max_duration=${RUN_DURATIONS[0]}
    
    for duration in "${RUN_DURATIONS[@]}"; do
        total_duration=$((total_duration + duration))
        if [ "$duration" -lt "$min_duration" ]; then
            min_duration=$duration
        fi
        if [ "$duration" -gt "$max_duration" ]; then
            max_duration=$duration
        fi
    done
    
    local avg_duration=$((total_duration / ${#RUN_DURATIONS[@]}))
    local duration_variation=$((max_duration - min_duration))
    local variation_percent=0
    
    if [ "$avg_duration" -gt 0 ]; then
        variation_percent=$((duration_variation * 100 / avg_duration))
    fi
    
    echo ""
    echo "⏱️  Performance Metrics:"
    echo "  Average Duration: ${avg_duration}s"
    echo "  Min Duration: ${min_duration}s"
    echo "  Max Duration: ${max_duration}s"
    echo "  Duration Variation: ${variation_percent}%"
    
    # Log performance to report
    echo "PERFORMANCE ANALYSIS" >> "$REPORT_FILE"
    echo "===================" >> "$REPORT_FILE"
    echo "Success Rate: ${success_rate}%" >> "$REPORT_FILE"
    echo "Average Duration: ${avg_duration}s" >> "$REPORT_FILE"
    echo "Min Duration: ${min_duration}s" >> "$REPORT_FILE"
    echo "Max Duration: ${max_duration}s" >> "$REPORT_FILE"
    echo "Duration Variation: ${variation_percent}%" >> "$REPORT_FILE"
    echo "" >> "$REPORT_FILE"
fi

# Assessment
echo ""
echo "🎯 Test Suite Assessment:"
echo "========================="

if [ $success_rate -ge 95 ]; then
    echo "🎉 EXCELLENT: Test suite is highly reliable (${success_rate}%)"
    echo "Assessment: EXCELLENT" >> "$REPORT_FILE"
elif [ $success_rate -ge 80 ]; then
    echo "✅ GOOD: Test suite is acceptably reliable (${success_rate}%)"
    echo "Assessment: GOOD" >> "$REPORT_FILE"
elif [ $success_rate -ge 60 ]; then
    echo "⚠️  FAIR: Test suite has some reliability issues (${success_rate}%)"
    echo "Assessment: NEEDS IMPROVEMENT" >> "$REPORT_FILE"
else
    echo "❌ POOR: Test suite has significant reliability issues (${success_rate}%)"
    echo "Assessment: CRITICAL" >> "$REPORT_FILE"
fi

# Recommendations
echo ""
echo "💡 Recommendations:"
echo "=================="

if [ $success_rate -lt 95 ]; then
    echo "� Improv e test reliability - current success rate is ${success_rate}%"
    echo "RECOMMENDATION: Investigate failing tests and improve stability" >> "$REPORT_FILE"
fi

if [ "$variation_percent" -gt 50 ]; then
    echo "🔧 High performance variation detected (${variation_percent}%)"
    echo "   - Consider optimizing slow tests"
    echo "   - Check for resource contention"
    echo "RECOMMENDATION: Optimize test performance consistency" >> "$REPORT_FILE"
fi

if [ $success_rate -ge 95 ] && [ "$variation_percent" -le 30 ]; then
    echo "🎉 Test suite is performing excellently!"
    echo "   - Consistent performance"
    echo "   - High reliability"
    echo "   - Continue current practices"
fi

# Cleanup temporary files
rm -f "$TEST_LOG_DIR"/validation_run_*.log

echo ""
echo "✅ Test suite validation completed!"
echo "📁 Results available at:"
echo "   - Summary report: $REPORT_FILE"
echo "   - Detailed logs: $LOG_FILE"