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
        "shutdown") output_name="shutdown" ;;
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



# Import shared cleanup system
SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
if [ -f "$SCRIPT_DIR/cleanup.sh" ]; then
    source "$SCRIPT_DIR/cleanup.sh"
fi


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
