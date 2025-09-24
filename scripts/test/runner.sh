#!/bin/bash

# =============================================================================
# FTSO Unified Test Runner
# =============================================================================
# Combines the best features from all test scripts:
# - Organized test execution (from test-runner.ts)
# - Cleanup and port management (from run-clean-test.sh)
# - Reliability validation and logging (from validation.sh)
# - Cross-platform compatibility and error handling
# =============================================================================

# Source common utilities
source "$(dirname "$0")/../utils/test-common.sh"
source "$(dirname "$0")/../utils/port-manager.sh"

# =============================================================================
# CONFIGURATION
# =============================================================================

# Test execution parameters
TEST_TYPE=${1:-"unit"}  # unit, integration, accuracy, performance, endurance, all
VALIDATE=${2:-"false"}  # true/false - run multiple times for validation
CLEANUP_BEFORE=${3:-"true"}
CLEANUP_AFTER=${4:-"true"}
VERBOSE_LOGS=${5:-"false"}  # true/false - show detailed logs

# Validation mode settings
VALIDATION_RUNS=3
VALIDATION_TIMEOUT=300
RELIABILITY_THRESHOLD=80

# Results tracking (using files for compatibility)
RESULTS_DIR="/tmp/ftso_test_results_$$"
mkdir -p "$RESULTS_DIR"

# =============================================================================
# LOGGING FUNCTIONS
# =============================================================================

# log_both function is now in test-common.sh

# =============================================================================
# CLEANUP FUNCTIONS
# =============================================================================

perform_cleanup() {
    local when=$1
    if [ "$when" = "before" ] && [ "$CLEANUP_BEFORE" = "true" ]; then
        verbose_log "🧹 Performing pre-test cleanup..."
        cleanup_ftso_processes
        verbose_log "✅ Pre-test cleanup completed"
    elif [ "$when" = "after" ] && [ "$CLEANUP_AFTER" = "true" ]; then
        verbose_log "🧹 Performing post-test cleanup..."
        cleanup_ftso_processes
        verbose_log "✅ Post-test cleanup completed"
    fi
}

# =============================================================================
# TEST EXECUTION FUNCTIONS
# =============================================================================

run_single_test() {
    local test_type=$1
    local index=$2
    local total=$3
    local start_time=$(date +%s)
    
    # Build header title with optional index
    local header_title="Running $test_type tests"
    if [ -n "$index" ] && [ -n "$total" ]; then
        header_title="$header_title ($index/$total)"
    fi
    
    print_header "$header_title" "$(get_test_description "$test_type")"
    
    local test_pattern=$(get_test_pattern "$test_type")
    if [ -z "$test_pattern" ]; then
        echo "❌ Unknown test type: $test_type"
        echo "Available types: unit integration accuracy performance endurance all"
        return 1
    fi
    
    # Conditionally add verbose flag based on test type
    # Use global TEST_TYPE to check if we're running all tests
    local verbose_flag=""
    if [ "$TEST_TYPE" != "all" ]; then
        verbose_flag="--verbose"
    fi
    
    verbose_log "🚀 Executing: pnpm jest --colors $verbose_flag --passWithNoTests $test_pattern"
    verbose_log ""
    
    # Run the test with proper signal handling and timeout
    local jest_cmd="pnpm jest --colors $verbose_flag --passWithNoTests --forceExit --detectOpenHandles --runInBand $test_pattern"
    local exit_code=0
    local jest_pid=""
    
    # Create a function to handle output - show colors in terminal, strip for log
    handle_jest_output() {
        while IFS= read -r line; do
            echo "$line"  # Show with colors in terminal
            echo "$line" | strip_ansi >> "$TEST_LOG_FILE"  # Strip colors for log
        done
    }
    
    # Function to cleanup jest process on signal
    cleanup_jest() {
        if [ -n "$jest_pid" ] && kill -0 "$jest_pid" 2>/dev/null; then
            echo ""
            echo "🛑 Stopping Jest process (PID: $jest_pid)..."
            kill -TERM "$jest_pid" 2>/dev/null
            sleep 2
            if kill -0 "$jest_pid" 2>/dev/null; then
                echo "💀 Force killing Jest process..."
                kill -KILL "$jest_pid" 2>/dev/null
            fi
        fi
        # Also cleanup any remaining jest processes
        pkill -f "jest" 2>/dev/null || true
    }
    
    # Set up signal handler for this test run
    trap cleanup_jest INT TERM
    
    # Run Jest in background to capture PID
    if command -v gtimeout >/dev/null 2>&1; then
        gtimeout "${VALIDATION_TIMEOUT}s" $jest_cmd 2>&1 | handle_jest_output &
        jest_pid=$!
    elif command -v timeout >/dev/null 2>&1; then
        timeout "${VALIDATION_TIMEOUT}s" $jest_cmd 2>&1 | handle_jest_output &
        jest_pid=$!
    else
        $jest_cmd 2>&1 | handle_jest_output &
        jest_pid=$!
    fi
    
    # Wait for Jest to complete
    wait $jest_pid 2>/dev/null
    exit_code=$?
    
    # Clear the trap
    trap - INT TERM
    
    return $exit_code
}

run_test_categories() {
    local total_passed=0
    local total_failed=0
    local start_time=$(date +%s)
    
    local categories=(unit integration accuracy performance endurance)
    local total_categories=${#categories[@]}
    local index=1
    
    for category in "${categories[@]}"; do
        if run_single_test "$category" "$index" "$total_categories"; then
            echo "PASSED" > "$RESULTS_DIR/category_$category"
            total_passed=$((total_passed + 1))
        else
            echo "FAILED" > "$RESULTS_DIR/category_$category"
            total_failed=$((total_failed + 1))
        fi
        
        # Small delay between categories
        sleep 2
        index=$((index + 1))
    done
    
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    
    # Print summary
    print_section "Test Categories Summary"
    echo "📊 Results:"
    for category in unit integration accuracy performance endurance; do
        local status="SKIPPED"
        if [ -f "$RESULTS_DIR/category_$category" ]; then
            status=$(cat "$RESULTS_DIR/category_$category")
        fi
        if [ "$status" = "PASSED" ]; then
            echo "  ✅ $category: $status"
        else
            echo "  ❌ $category: $status"
        fi
    done
    
    echo ""
    echo "📈 Overall Statistics:"
    echo "  Total Categories: 5"
    echo "  Passed: $total_passed"
    echo "  Failed: $total_failed"
    echo "  Success Rate: $(( total_passed * 100 / 5 ))%"
    echo "  Total Duration: ${total_duration}s"
    
    return $total_failed
}

run_validation_mode() {
    local test_type=$1
    
    print_header "Test Reliability Validation - $test_type"
    
    verbose_log "📝 Configuration:"
    verbose_log "  Test Type: $test_type"
    verbose_log "  Validation Runs: $VALIDATION_RUNS"
    verbose_log "  Timeout per run: ${VALIDATION_TIMEOUT}s"
    verbose_log "  Success Threshold: ${RELIABILITY_THRESHOLD}%"
    verbose_log ""
    
    local successful_runs=0
    local total_runs=0
    
    for ((run=1; run<=VALIDATION_RUNS; run++)); do
        total_runs=$((total_runs + 1))
        
        echo "🧪 Validation Run $run/$VALIDATION_RUNS"
        
        if run_single_test "$test_type"; then
            successful_runs=$((successful_runs + 1))
            echo "PASSED" > "$RESULTS_DIR/validation_run_$run"
        else
            echo "FAILED" > "$RESULTS_DIR/validation_run_$run"
        fi
        
        # Small delay between runs
        if [ $run -lt $VALIDATION_RUNS ]; then
            echo "⏳ Waiting 5 seconds before next run..."
            sleep 5
        fi
    done
    
    # Calculate reliability
    local success_rate=0
    if [ $total_runs -gt 0 ]; then
        success_rate=$((successful_runs * 100 / total_runs))
    fi
    
    # Print validation summary
    print_section "Reliability Validation Results"
    echo "📊 Run Results:"
    for ((run=1; run<=VALIDATION_RUNS; run++)); do
        local status="UNKNOWN"
        if [ -f "$RESULTS_DIR/validation_run_$run" ]; then
            status=$(cat "$RESULTS_DIR/validation_run_$run")
        fi
        if [ "$status" = "PASSED" ]; then
            echo "  ✅ Run $run: $status"
        else
            echo "  ❌ Run $run: $status"
        fi
    done
    
    echo ""
    echo "📈 Reliability Analysis:"
    echo "  Total Runs: $total_runs"
    echo "  Successful Runs: $successful_runs"
    echo "  Success Rate: ${success_rate}%"
    echo "  Threshold: ${RELIABILITY_THRESHOLD}%"
    
    # Assessment
    echo ""
    echo "🎯 Assessment:"
    if [ $success_rate -ge 95 ]; then
        echo "🎉 EXCELLENT: Test suite is highly reliable (${success_rate}%)"
    elif [ $success_rate -ge $RELIABILITY_THRESHOLD ]; then
        echo "✅ GOOD: Test suite is acceptably reliable (${success_rate}%)"
    elif [ $success_rate -ge 60 ]; then
        echo "⚠️  FAIR: Test suite has some reliability issues (${success_rate}%)"
    else
        echo "❌ POOR: Test suite has significant reliability issues (${success_rate}%)"
    fi
    
    # Return success if meets threshold
    [ $success_rate -ge $RELIABILITY_THRESHOLD ]
}

# =============================================================================
# LOGGING FUNCTIONS
# =============================================================================

setup_logging() {
    local mode=$1
    local test_type=$2
    
    # Construct log name, avoiding double underscores
    local log_name="$mode"
    if [ -n "$test_type" ]; then
        log_name="${mode}_${test_type}"
    fi
    
    setup_test_logging "$log_name"
    
    verbose_log "📁 Logging Configuration:"
    verbose_log "  Log Directory: $TEST_LOG_DIR"
    verbose_log "  Log File: $TEST_LOG_FILE"
    verbose_log ""
}

# =============================================================================
# MAIN EXECUTION
# =============================================================================

show_help() {
    echo "FTSO Test Runner"
    echo "======================="
    echo ""
    echo "Usage: $0 [test_type] [validate] [cleanup_before] [cleanup_after] [verbose_logs]"
    echo ""
    echo "Test Types:"
    echo "  unit        - Unit tests (default)"
    echo "  integration - Integration tests"
    echo "  accuracy    - Accuracy tests"
    echo "  performance - Performance tests"
    echo "  endurance   - Endurance tests"
    echo "  all         - All test categories in sequence"
    echo ""
    echo "Validation:"
    echo "  true        - Run multiple times to validate reliability"
    echo "  false       - Run once (default)"
    echo ""
    echo "Cleanup Options:"
    echo "  true/false  - Enable/disable cleanup before/after tests (default: true)"
    echo ""
    echo "Verbose Logs:"
    echo "  true/false  - Show detailed configuration and cleanup logs (default: false)"
    echo ""
    echo "Examples:"
    echo "  $0                           # Run unit tests once with cleanup"
    echo "  $0 integration               # Run integration tests once"
    echo "  $0 unit true                 # Validate unit test reliability"
    echo "  $0 all                       # Run all test categories once"
    echo "  $0 all true                  # Validate all test categories"
    echo "  $0 unit false false false    # Run unit tests without cleanup"
    echo "  $0 all false true true true  # Run all tests with verbose logs"
    echo ""
}

main() {
    # Handle help request
    if [[ "$1" == "--help" || "$1" == "-h" ]]; then
        show_help
        exit 0
    fi
    
    # Set up cleanup handlers
    setup_cleanup_handlers
    
    # Setup logging
    local log_prefix="$TEST_TYPE"
    if [ "$VALIDATE" = "true" ]; then
        log_prefix="${TEST_TYPE}_validate"
    fi
    setup_logging "$log_prefix" ""
    
    verbose_log "📝 Configuration:"
    verbose_log "  Test Type: $TEST_TYPE"
    verbose_log "  Validate: $VALIDATE"
    verbose_log "  Cleanup Before: $CLEANUP_BEFORE"
    verbose_log "  Cleanup After: $CLEANUP_AFTER"
    verbose_log "  Verbose Logs: $VERBOSE_LOGS"
    verbose_log ""
    
    # Pre-test cleanup
    perform_cleanup "before"
    
    # Execute based on test type and validation flag
    local exit_code=0
    
    if [ "$TEST_TYPE" = "all" ]; then
        # Run all test categories
        if [ "$VALIDATE" = "true" ]; then
            # Run validation on all categories
            for category in unit integration accuracy performance endurance; do
                echo ""
                if ! run_validation_mode "$category"; then
                    exit_code=1
                fi
            done
        else
            # Run all categories once
            if ! run_test_categories; then
                exit_code=1
            fi
        fi
    else
        # Run specific test type
        if [ "$VALIDATE" = "true" ]; then
            if ! run_validation_mode "$TEST_TYPE"; then
                exit_code=1
            fi
        else
            if ! run_single_test "$TEST_TYPE"; then
                exit_code=1
            fi
        fi
    fi
    
    # Post-test cleanup
    echo ""
    perform_cleanup "after"
    
    # Final status
    if [ $exit_code -eq 0 ]; then
        echo ""
        log_both "🎉 Test execution completed successfully!"
    else
        echo ""
        log_both "❌ Test execution completed with failures."
    fi
    
    log_both "📁 Logs available at: $TEST_LOG_FILE"
    echo ""
    
    # Cleanup results directory
    rm -rf "$RESULTS_DIR"
    
    exit $exit_code
}

# Run main function
main "$@"