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
    
    # Kill common test-related processes
    pkill -f "pnpm start" 2>/dev/null || true
    pkill -f "nest start" 2>/dev/null || true
    pkill -f "node.*dist/main" 2>/dev/null || true
    pkill -f "jest" 2>/dev/null || true
    
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