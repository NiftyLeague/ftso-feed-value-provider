#!/bin/bash

# Common utilities for test scripts
# This file provides shared functions for consistent logging behavior

# Function to set up logging directories and files
setup_test_logging() {
    local script_name=$1
    
    # Map script names to consistent output names (matching session directory naming)
    local output_name
    case "$script_name" in
        "server") output_name="server" ;;
        "security") output_name="security" ;;
        "load") output_name="load" ;;
        "validation") output_name="validation" ;;
        "graceful-shutdown") output_name="graceful-shutdown" ;;
        *) output_name="$script_name" ;;  # fallback to original name
    esac
    
    # Always use logs/test directory
    TEST_LOG_DIR="logs/test"
    
    # Ensure log directory exists
    mkdir -p "$TEST_LOG_DIR"
    
    # Set up log file path with consistent _output naming
    TEST_LOG_FILE="$TEST_LOG_DIR/${output_name}_output.log"
    
    # Clear the log file at the start of each run (don't append)
    > "$TEST_LOG_FILE"
    
    # Export for use in calling script
    export TEST_LOG_DIR
    export TEST_LOG_FILE
    
    echo "📁 Log file: $TEST_LOG_FILE"
}

# Function to clean up old individual logs (only when running in session mode)
cleanup_old_test_logs() {
    local script_name=$1
    
    # Only clean up if we're in session mode (to avoid removing logs from individual runs)
    if [ "$TEST_SESSION_MODE" = "true" ]; then
        local old_logs=(
            "logs/${script_name}.log"
            "logs/${script_name}-test.log"
            "logs/${script_name}-report.log"
        )
        
        for log_file in "${old_logs[@]}"; do
            if [ -f "$log_file" ]; then
                echo "🧹 Cleaning up old log: $log_file"
                rm -f "$log_file"
            fi
        done
    fi
}

# Function to display log summary
show_test_log_summary() {
    local log_file=$1
    local script_name=$2
    
    if [ -f "$log_file" ]; then
        echo ""
        echo "📊 Test Summary for $script_name:"
        echo "================================"
        echo "📝 Total lines: $(wc -l < "$log_file")"
        echo "⚠️  Warnings: $(grep -c "WARN\|Warning\|warning" "$log_file" 2>/dev/null || echo "0")"
        echo "❌ Errors: $(grep -c "ERROR\|Error\|error" "$log_file" 2>/dev/null || echo "0")"
        echo "✅ Passed: $(grep -c "PASS\|✅\|SUCCESS" "$log_file" 2>/dev/null || echo "0")"
        echo "❌ Failed: $(grep -c "FAIL\|❌\|FAILED" "$log_file" 2>/dev/null || echo "0")"
        echo "📁 Full log: $log_file"
    else
        echo "❌ No log file found at $log_file"
    fi
}

# Function to cleanup hanging processes
cleanup_test_processes() {
    echo "🧹 Cleaning up test processes..."
    
    # Kill common test-related processes (more comprehensive)
    pkill -f "pnpm.*jest" 2>/dev/null || true
    pkill -f "pnpm start" 2>/dev/null || true
    pkill -f "nest start" 2>/dev/null || true
    pkill -f "node.*dist/main" 2>/dev/null || true
    pkill -f "jest" 2>/dev/null || true
    pkill -f "ts-jest" 2>/dev/null || true
    
    # Kill any Node.js processes that might be hanging
    pkill -f "node.*jest" 2>/dev/null || true
    
    # Kill any processes using the test port
    lsof -ti:3101 | xargs -r kill -9 2>/dev/null || true
    
    # Wait for cleanup
    sleep 2
    
    echo "✅ Process cleanup completed"
}

# Function to setup signal handlers for cleanup
setup_cleanup_handlers() {
    # Trap signals to ensure cleanup on exit
    trap cleanup_test_processes EXIT INT TERM
}

# =============================================================================
# TEST UTILITY FUNCTIONS
# =============================================================================

# Function to get Jest test pattern for different test types
get_test_pattern() {
    case $1 in
        "unit") echo "--testPathIgnorePatterns=/(accuracy|endurance|integration|performance)/" ;;
        "integration") echo "--testPathPatterns=integration" ;;
        "accuracy") echo "--testPathPatterns=accuracy" ;;
        "performance") echo "--testPathPatterns=performance" ;;
        "endurance") echo "--testPathPatterns=endurance" ;;
        "all") echo "" ;;  # Run all tests (no pattern filters)
        *) echo "" ;;
    esac
}

# Function to get test description for different test types
get_test_description() {
    case $1 in
        "unit") echo "Fast unit tests for utilities, services, and components" ;;
        "integration") echo "Integration tests for service interactions" ;;
        "accuracy") echo "Accuracy and backtesting validation" ;;
        "performance") echo "Performance and load testing" ;;
        "endurance") echo "Long-running endurance tests" ;;
        "all") echo "All test categories in sequence" ;;
        *) echo "Unknown test type" ;;
    esac
}

# Function to print formatted headers
print_header() {
    local title=$1
    local description=$2
    
    log_both ""
    log_both "================================================================================"
    log_both "🧪 $title"
    if [ -n "$description" ]; then
        log_both "📝 $description"
    fi
    log_both "================================================================================"
    log_both ""
}

# Function to print formatted sections
print_section() {
    local title=$1
    
    log_both ""
    log_both "------------------------------------------------------------"
    log_both "📋 $title"
    log_both "------------------------------------------------------------"
}

# Function for verbose logging (requires VERBOSE_LOGS variable)
verbose_log() {
    if [ "$VERBOSE_LOGS" = "true" ]; then
        log_both "$@"
    fi
}

# Function to format duration in human-readable format
format_duration() {
    local ms=$1
    if [ $ms -lt 1000 ]; then
        echo "${ms}ms"
    elif [ $ms -lt 60000 ]; then
        echo "$(echo "scale=1; $ms/1000" | bc)s"
    else
        echo "$(echo "scale=1; $ms/60000" | bc)m"
    fi
}

# Function to strip ANSI color codes and terminal control sequences
strip_ansi() {
    sed -E '
        s/\x1b\[[0-9;]*[mGKHfABCDsuJhlp]//g
        s/\x1b\[[?][0-9;]*[hlc]//g
        s/\[[0-9;]*[ABCDGHKJF]//g
        s/\[2J\[3J\[H//g
        s/\[2J//g
        s/\[3J//g
        s/\[H//g
        s/\[[0-9]+m//g
        s/\[[0-9;]+m//g
        s/\[38;5;[0-9]+m//g
        s/\[90m//g
        s/\[39m//g
        s/\[32m//g
        s/\[0m//g
    '
}

# Function to log both to console and file
log_both() {
    echo "$@"
    if [ -n "$TEST_LOG_FILE" ]; then
        echo "$@" | strip_ansi >> "$TEST_LOG_FILE"
    fi
}