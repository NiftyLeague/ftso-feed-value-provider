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

# Function to display log summary
show_log_summary() {
    local log_file=$1
    local script_name=$2
    
    if [ -f "$log_file" ]; then
        echo ""
        echo "📊 Log Summary for $script_name:"
        echo "================================"
        echo "📝 Total lines: $(wc -l < "$log_file")"
        echo "⚠️  Warnings: $(grep -c "WARN\|Warning\|warning" "$log_file" 2>/dev/null || echo "0")"
        echo "❌ Errors: $(grep -c "ERROR\|Error\|error" "$log_file" 2>/dev/null || echo "0")"
        echo "📁 Full log: $log_file"
    else
        echo "❌ No log file found at $log_file"
    fi
}