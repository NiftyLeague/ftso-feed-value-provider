#!/bin/bash

# Common utilities for debug scripts
# This file provides shared functions for consistent logging behavior

# Function to set up logging directories and files
setup_debug_logging() {
    local script_name=$1
    
    # Map script names to consistent output names (matching session directory naming)
    local output_name
    case "$script_name" in
        "startup") output_name="startup" ;;
        "websocket-debug") output_name="websockets" ;;
        "cache-debug") output_name="cache" ;;
        "config-debug") output_name="config" ;;
        "error-debug") output_name="errors" ;;
        "feeds-debug") output_name="feeds" ;;
        "performance-debug") output_name="performance" ;;
        "resilience-debug") output_name="resilience" ;;
        "data-aggregation") output_name="data-aggregation" ;;
        "integration-debug") output_name="integration" ;;
        *) output_name="$script_name" ;;  # fallback to original name
    esac
    
    # Always use logs/debug directory
    DEBUG_LOG_DIR="logs/debug"
    
    # Ensure log directory exists
    mkdir -p "$DEBUG_LOG_DIR"
    
    # Set up log file path with consistent _output naming
    DEBUG_LOG_FILE="$DEBUG_LOG_DIR/${output_name}_output.log"
    
    # Export for use in calling script
    export DEBUG_LOG_DIR
    export DEBUG_LOG_FILE
    
    echo "📁 Log file: $DEBUG_LOG_FILE"
}

# Function to clean up old individual logs (only when running in session mode)
cleanup_old_logs() {
    local script_name=$1
    
    # Only clean up if we're in session mode (to avoid removing logs from individual runs)
    if [ "$DEBUG_SESSION_MODE" = "true" ]; then
        local old_logs=(
            "logs/${script_name}.log"
            "logs/${script_name}-debug.log"
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

# Function to capture output with ANSI stripping
capture_clean_output() {
    local command="$1"
    local log_file="$2"
    
    # Run command and strip ANSI codes before writing to log
    eval "$command" 2>&1 | strip_ansi > "$log_file"
}

