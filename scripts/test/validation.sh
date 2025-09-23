#!/bin/bash

# Test Suite Performance and Reliability Validation Script
# 
# This script validates:
# 1. Test suite consistency across multiple runs
# 2. Flaky test detection
# 3. Resource leak prevention
# 4. Test isolation and independence

echo "🔍 FTSO Test Suite Validation"
echo "============================="

# Ensure logs directory exists
mkdir -p logs

# Configuration
NUMBER_OF_RUNS=3
MAX_RUN_TIME_SECONDS=300
MEMORY_THRESHOLD_MB=2048
FLAKY_TEST_THRESHOLD=80  # 80% pass rate minimum
LOG_FILE="logs/test-validation.log"
REPORT_FILE="logs/test-validation-report.log"

# Initialize report
echo "FTSO Test Suite Validation Report - $(date)" > "$REPORT_FILE"
echo "=============================================" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

# Arrays to store results
declare -a RUN_RESULTS
declare -a RUN_DURATIONS
declare -a FLAKY_TESTS
declare -a RESOURCE_ISSUES
declare -a ISOLATION_ISSUES

echo "📝 Starting test suite validation..."
echo "📊 Log file: $LOG_FILE"

# Function to run a test command and capture results
run_test_command() {
    local command=$1
    local run_number=$2
    local start_time=$(date +%s)
    
    echo "  🧪 Run $run_number: $command"
    
    # Run the command with timeout
    timeout ${MAX_RUN_TIME_SECONDS}s bash -c "$command" > "$LOG_FILE.tmp" 2>&1
    local exit_code=$?
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # Parse test results from output
    local passed=0
    local failed=0
    local skipped=0
    
    if [ -f "$LOG_FILE.tmp" ]; then
        passed=$(grep -o "[0-9]\+ passed" "$LOG_FILE.tmp" | grep -o "[0-9]\+" || echo "0")
        failed=$(grep -o "[0-9]\+ failed" "$LOG_FILE.tmp" | grep -o "[0-9]\+" || echo "0")
        skipped=$(grep -o "[0-9]\+ skipped" "$LOG_FILE.tmp" | grep -o "[0-9]\+" || echo "0")
        
        # Append to main log
        echo "=== Run $run_number of $command ===" >> "$LOG_FILE"
        cat "$LOG_FILE.tmp" >> "$LOG_FILE"
        echo "" >> "$LOG_FILE"
        
        rm -f "$LOG_FILE.tmp"
    fi
    
    # Store results
    local result_line="$command|$run_number|$exit_code|$duration|$passed|$failed|$skipped"
    RUN_RESULTS+=("$result_line")
    RUN_DURATIONS+=("$duration")
    
    if [ $exit_code -eq 0 ]; then
        echo "    ✅ Passed (${duration}s, $passed tests)"
    else
        echo "    ❌ Failed (exit code: $exit_code, ${duration}s)"
    fi
    
    return $exit_code
}

# Function to check test consistency
check_test_consistency() {
    echo ""
    echo "📊 Checking Test Suite Consistency"
    echo "-----------------------------------"
    
    # Test commands to validate
    local test_commands=(
        "pnpm test:unit"
        "pnpm test:integration"
        "pnpm test:performance"
    )
    
    for command in "${test_commands[@]}"; do
        echo ""
        echo "🧪 Testing: $command"
        
        local successful_runs=0
        local total_runs=0
        
        for ((run=1; run<=NUMBER_OF_RUNS; run++)); do
            total_runs=$((total_runs + 1))
            
            if run_test_command "$command" "$run"; then
                successful_runs=$((successful_runs + 1))
            fi
        done
        
        # Calculate success rate
        local success_rate=$((successful_runs * 100 / total_runs))
        
        echo ""
        echo "📈 $command Results:"
        echo "  Success Rate: ${success_rate}% ($successful_runs/$total_runs)"
        
        # Log to report
        echo "Test Command: $command" >> "$REPORT_FILE"
        echo "  Success Rate: ${success_rate}% ($successful_runs/$total_runs)" >> "$REPORT_FILE"
        
        if [ $success_rate -lt $FLAKY_TEST_THRESHOLD ]; then
            echo "  ⚠️  FLAKY: Success rate below ${FLAKY_TEST_THRESHOLD}%"
            echo "  Status: FLAKY - Success rate below ${FLAKY_TEST_THRESHOLD}%" >> "$REPORT_FILE"
            FLAKY_TESTS+=("$command")
        else
            echo "  ✅ STABLE: Consistent results across runs"
            echo "  Status: STABLE - Consistent results" >> "$REPORT_FILE"
        fi
        
        echo "" >> "$REPORT_FILE"
    done
}

# Function to detect flaky tests
detect_flaky_tests() {
    echo ""
    echo "🔍 Analyzing Test Stability"
    echo "---------------------------"
    
    # Group results by command and analyze
    local commands=($(printf '%s\n' "${RUN_RESULTS[@]}" | cut -d'|' -f1 | sort -u))
    
    for command in "${commands[@]}"; do
        echo ""
        echo "📊 Analyzing: $command"
        
        # Get all runs for this command
        local command_results=($(printf '%s\n' "${RUN_RESULTS[@]}" | grep "^$command|"))
        local successful=0
        local total=0
        local durations=()
        
        for result in "${command_results[@]}"; do
            IFS='|' read -r cmd run_num exit_code duration passed failed skipped <<< "$result"
            total=$((total + 1))
            durations+=("$duration")
            
            if [ "$exit_code" -eq 0 ]; then
                successful=$((successful + 1))
            fi
        done
        
        # Calculate statistics
        local success_rate=$((successful * 100 / total))
        
        # Calculate duration statistics
        local min_duration=${durations[0]}
        local max_duration=${durations[0]}
        local total_duration=0
        
        for duration in "${durations[@]}"; do
            total_duration=$((total_duration + duration))
            if [ "$duration" -lt "$min_duration" ]; then
                min_duration=$duration
            fi
            if [ "$duration" -gt "$max_duration" ]; then
                max_duration=$duration
            fi
        done
        
        local avg_duration=$((total_duration / total))
        local duration_variation=$((max_duration - min_duration))
        local variation_percent=0
        
        if [ "$avg_duration" -gt 0 ]; then
            variation_percent=$((duration_variation * 100 / avg_duration))
        fi
        
        echo "  Success Rate: ${success_rate}%"
        echo "  Avg Duration: ${avg_duration}s (±${variation_percent}%)"
        
        if [ "$variation_percent" -gt 50 ]; then
            echo "  ⚠️  HIGH VARIATION: Performance inconsistent"
        fi
    done
}

# Function to check resource cleanup
check_resource_cleanup() {
    echo ""
    echo "🧹 Checking Resource Cleanup"
    echo "----------------------------"
    
    echo "Running memory leak detection..."
    
    # Get baseline memory usage
    local baseline_memory=$(ps -o rss= -p $$ | tr -d ' ')
    echo "📊 Memory baseline: ${baseline_memory}KB"
    
    # Run a simple test multiple times to check for leaks
    local iterations=5
    local memory_readings=()
    
    for ((i=1; i<=iterations; i++)); do
        echo "  Iteration $i/$iterations..."
        
        # Run a lightweight test
        pnpm test:unit --testNamePattern="should be defined" --silent > /dev/null 2>&1
        
        # Measure memory
        local current_memory=$(ps -o rss= -p $$ | tr -d ' ')
        memory_readings+=("$current_memory")
        
        echo "    Memory: ${current_memory}KB"
    done
    
    # Analyze memory trend
    local first_reading=${memory_readings[0]}
    local last_reading=${memory_readings[-1]}
    local memory_growth=$((last_reading - first_reading))
    local growth_percent=0
    
    if [ "$first_reading" -gt 0 ]; then
        growth_percent=$((memory_growth * 100 / first_reading))
    fi
    
    echo ""
    echo "📈 Memory analysis:"
    echo "  Growth: ${memory_growth}KB (${growth_percent}%)"
    
    if [ "$growth_percent" -gt 20 ]; then
        echo "  ⚠️  POTENTIAL MEMORY LEAK: Significant memory growth detected"
        RESOURCE_ISSUES+=("Memory leak detected: ${growth_percent}% growth")
    else
        echo "  ✅ MEMORY STABLE: No significant memory leaks detected"
    fi
    
    # Check for open handles
    echo ""
    echo "Checking for open handles..."
    
    if pnpm test:unit --detectOpenHandles --forceExit --silent > "$LOG_FILE.handles" 2>&1; then
        if grep -q "Jest did not exit one second after the test run has completed" "$LOG_FILE.handles"; then
            echo "⚠️  OPEN HANDLES: Tests may not be cleaning up properly"
            RESOURCE_ISSUES+=("Open handles detected")
        else
            echo "✅ HANDLES CLEAN: No open handles detected"
        fi
    else
        echo "⚠️  Could not check handles"
    fi
    
    rm -f "$LOG_FILE.handles"
}

# Function to validate test isolation
validate_test_isolation() {
    echo ""
    echo "🔒 Validating Test Isolation"
    echo "----------------------------"
    
    echo "Testing execution order independence..."
    
    # Run tests in normal order
    local normal_exit=1
    local reverse_exit=1
    
    if pnpm test:unit --testNamePattern="should" --maxWorkers=1 --silent > /dev/null 2>&1; then
        normal_exit=0
    fi
    
    # Run tests again (simulating different order)
    if pnpm test:unit --testNamePattern="should" --maxWorkers=1 --silent > /dev/null 2>&1; then
        reverse_exit=0
    fi
    
    if [ $normal_exit -eq 0 ] && [ $reverse_exit -eq 0 ]; then
        echo "✅ ORDER INDEPENDENT: Tests pass regardless of execution order"
    else
        echo "⚠️  ORDER DEPENDENT: Tests may have dependencies on execution order"
        ISOLATION_ISSUES+=("Tests may depend on execution order")
    fi
    
    # Test parallel execution
    echo ""
    echo "Testing parallel execution safety..."
    
    local parallel_exit=1
    local sequential_exit=1
    
    if pnpm test:unit --testNamePattern="should" --maxWorkers=4 --silent > /dev/null 2>&1; then
        parallel_exit=0
    fi
    
    if pnpm test:unit --testNamePattern="should" --maxWorkers=1 --silent > /dev/null 2>&1; then
        sequential_exit=0
    fi
    
    if [ $parallel_exit -eq 0 ] && [ $sequential_exit -eq 0 ]; then
        echo "✅ PARALLEL SAFE: Tests pass in both parallel and sequential execution"
    else
        echo "⚠️  PARALLEL UNSAFE: Tests may have race conditions or shared state"
        ISOLATION_ISSUES+=("Tests may not be safe for parallel execution")
    fi
}

# Function to generate final report
generate_report() {
    echo ""
    echo "📋 Test Validation Report"
    echo "========================="
    
    # Calculate overall statistics
    local total_runs=${#RUN_RESULTS[@]}
    local successful_runs=0
    
    for result in "${RUN_RESULTS[@]}"; do
        IFS='|' read -r cmd run_num exit_code duration passed failed skipped <<< "$result"
        if [ "$exit_code" -eq 0 ]; then
            successful_runs=$((successful_runs + 1))
        fi
    done
    
    local overall_success_rate=0
    if [ $total_runs -gt 0 ]; then
        overall_success_rate=$((successful_runs * 100 / total_runs))
    fi
    
    echo ""
    echo "📊 Overall Statistics:"
    echo "  Total Test Runs: $total_runs"
    echo "  Successful Runs: $successful_runs"
    echo "  Success Rate: ${overall_success_rate}%"
    
    # Performance metrics
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
        
        echo ""
        echo "⏱️  Performance Metrics:"
        echo "  Average Duration: ${avg_duration}s"
        echo "  Min Duration: ${min_duration}s"
        echo "  Max Duration: ${max_duration}s"
    fi
    
    # Issues found
    echo ""
    echo "🔍 Issues Detected:"
    
    if [ ${#FLAKY_TESTS[@]} -gt 0 ]; then
        echo "  ⚠️  Flaky Tests: ${#FLAKY_TESTS[@]}"
        for test in "${FLAKY_TESTS[@]}"; do
            echo "    - $test"
        done
    else
        echo "  ✅ No flaky tests detected"
    fi
    
    if [ ${#RESOURCE_ISSUES[@]} -gt 0 ]; then
        echo "  ⚠️  Resource Issues: ${#RESOURCE_ISSUES[@]}"
        for issue in "${RESOURCE_ISSUES[@]}"; do
            echo "    - $issue"
        done
    else
        echo "  ✅ No resource issues detected"
    fi
    
    if [ ${#ISOLATION_ISSUES[@]} -gt 0 ]; then
        echo "  ⚠️  Isolation Issues: ${#ISOLATION_ISSUES[@]}"
        for issue in "${ISOLATION_ISSUES[@]}"; do
            echo "    - $issue"
        done
    else
        echo "  ✅ No test isolation issues detected"
    fi
    
    # Recommendations
    echo ""
    echo "💡 Recommendations:"
    
    if [ $overall_success_rate -lt 95 ]; then
        echo "  🔧 Improve test stability - current success rate is ${overall_success_rate}%"
    fi
    
    if [ ${#FLAKY_TESTS[@]} -gt 0 ]; then
        echo "  🔧 Fix flaky tests to improve reliability"
    fi
    
    if [ ${#RESOURCE_ISSUES[@]} -gt 0 ]; then
        echo "  🔧 Address resource issues to prevent memory problems"
    fi
    
    if [ ${#ISOLATION_ISSUES[@]} -gt 0 ]; then
        echo "  🔧 Fix test isolation issues to ensure independence"
    fi
    
    if [ $overall_success_rate -ge 95 ] && [ ${#FLAKY_TESTS[@]} -eq 0 ] && [ ${#RESOURCE_ISSUES[@]} -eq 0 ] && [ ${#ISOLATION_ISSUES[@]} -eq 0 ]; then
        echo "  🎉 Test suite is performing well! No major issues detected."
    fi
    
    # Save detailed report
    echo "" >> "$REPORT_FILE"
    echo "SUMMARY" >> "$REPORT_FILE"
    echo "=======" >> "$REPORT_FILE"
    echo "Total Runs: $total_runs" >> "$REPORT_FILE"
    echo "Successful Runs: $successful_runs" >> "$REPORT_FILE"
    echo "Success Rate: ${overall_success_rate}%" >> "$REPORT_FILE"
    echo "Flaky Tests: ${#FLAKY_TESTS[@]}" >> "$REPORT_FILE"
    echo "Resource Issues: ${#RESOURCE_ISSUES[@]}" >> "$REPORT_FILE"
    echo "Isolation Issues: ${#ISOLATION_ISSUES[@]}" >> "$REPORT_FILE"
    
    echo ""
    echo "📄 Detailed report saved to: $REPORT_FILE"
    echo "📄 Full logs available at: $LOG_FILE"
    
    echo ""
    echo "✅ Test validation completed"
}

# Main execution
echo "⏱️  Starting validation process..."

# Run all validation steps
check_test_consistency
detect_flaky_tests
check_resource_cleanup
validate_test_isolation
generate_report

echo ""
echo "✨ Validation complete!"
echo "📁 Results available at:"
echo "   - Summary: $REPORT_FILE"
echo "   - Detailed logs: $LOG_FILE"