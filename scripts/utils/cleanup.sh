#!/bin/bash

# Common Cleanup Utilities
# Provides shared cleanup functions for all test and debug scripts

# Source port manager for port-related cleanup
SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
source "$SCRIPT_DIR/port-manager.sh"

# Global variables to track processes and resources
declare -a TRACKED_PIDS=()
declare -a TRACKED_PORTS=()
declare -a TEMP_FILES=()

# Function to register a PID for cleanup
register_pid() {
    local pid=$1
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        TRACKED_PIDS+=("$pid")
        echo "📝 Registered PID $pid for cleanup"
    fi
}

# Function to register a port for cleanup
register_port() {
    local port=$1
    if [ -n "$port" ]; then
        TRACKED_PORTS+=("$port")
        echo "📝 Registered port $port for cleanup"
    fi
}

# Function to register a temporary file for cleanup
register_temp_file() {
    local file=$1
    if [ -n "$file" ]; then
        TEMP_FILES+=("$file")
        echo "📝 Registered temp file $file for cleanup"
    fi
}

# Function to cleanup tracked PIDs
cleanup_tracked_pids() {
    if [ ${#TRACKED_PIDS[@]} -eq 0 ]; then
        return 0
    fi
    
    for pid in "${TRACKED_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            # Try graceful shutdown first
            kill -TERM "$pid" 2>/dev/null
            
            # Wait up to 5 seconds for graceful shutdown
            local count=0
            while kill -0 "$pid" 2>/dev/null && [ $count -lt 5 ]; do
                sleep 1
                count=$((count + 1))
            done
            
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null
                
                # Also kill any child processes
                pkill -P "$pid" 2>/dev/null || true
            fi
        fi
    done
    
    # Clear the array
    TRACKED_PIDS=()
}

# Function to cleanup tracked ports
cleanup_tracked_ports() {
    if [ ${#TRACKED_PORTS[@]} -eq 0 ]; then
        return 0
    fi
    
    for port in "${TRACKED_PORTS[@]}"; do
        if is_port_in_use "$port"; then
            kill_port_process "$port" true  # Force kill for cleanup
        fi
    done
    
    # Clear the array
    TRACKED_PORTS=()
}

# Function to cleanup temporary files
cleanup_temp_files() {
    if [ ${#TEMP_FILES[@]} -eq 0 ]; then
        return 0
    fi
    
    for file in "${TEMP_FILES[@]}"; do
        if [ -f "$file" ]; then
            rm -f "$file"
        fi
    done
    
    # Clear the array
    TEMP_FILES=()
}

# Function to cleanup FTSO-related processes by pattern
cleanup_ftso_processes() {
    # Common FTSO process patterns
    local patterns=(
        "ftso-feed-value-provider"
        "nest start"
        "npm.*start"
        "node.*dist/main"
        "pnpm.*start"
        "jest"
        "ts-jest"
        "node.*jest"
    )
    
    for pattern in "${patterns[@]}"; do
        pkill -f "$pattern" 2>/dev/null || true
    done
    
    # Wait for processes to die
    sleep 2
    
    # Force kill any remaining processes
    for pattern in "${patterns[@]}"; do
        pkill -9 -f "$pattern" 2>/dev/null || true
    done
}

# Function to cleanup common FTSO ports
cleanup_ftso_ports() {
    local ports=(3101 3102 3103 9090 8080)
    
    for port in "${ports[@]}"; do
        if is_port_in_use "$port"; then
            kill_port_process "$port" true
        fi
    done
}

# Global flag to prevent duplicate cleanup execution
CLEANUP_EXECUTED=${CLEANUP_EXECUTED:-false}

# Comprehensive cleanup function
cleanup_all() {
    # Prevent duplicate cleanup
    if [ "$CLEANUP_EXECUTED" = "true" ]; then
        return 0
    fi
    
    # Mark as executed to prevent duplicates
    CLEANUP_EXECUTED=true
    export CLEANUP_EXECUTED
    
    # Only show cleanup message if there's actually something to clean up
    local has_cleanup=false
    
    # Check if there are tracked processes or ports
    if [ ${#TRACKED_PIDS[@]} -gt 0 ] || [ ${#TRACKED_PORTS[@]} -gt 0 ]; then
        has_cleanup=true
    fi
    
    # Check if there are FTSO processes running
    if pgrep -f "ftso-feed-value-provider\|nest start\|pnpm.*start\|node.*dist/main" >/dev/null 2>&1; then
        has_cleanup=true
    fi
    
    # Check if FTSO ports are in use
    for port in 3101 3102 3103; do
        if is_port_in_use "$port"; then
            has_cleanup=true
            break
        fi
    done
    
    if [ "$has_cleanup" = "true" ]; then
        echo "🧹 Cleaning up..."
        
        # Cleanup in order of importance (quietly)
        cleanup_tracked_pids >/dev/null 2>&1
        cleanup_tracked_ports >/dev/null 2>&1
        cleanup_ftso_processes >/dev/null 2>&1
        cleanup_ftso_ports >/dev/null 2>&1
        cleanup_temp_files >/dev/null 2>&1
        
        echo "✅ Cleanup completed"
    fi
}

# Global flag to prevent duplicate cleanup handler setup
CLEANUP_HANDLERS_SETUP=${CLEANUP_HANDLERS_SETUP:-false}

# Function to setup cleanup handlers for a script
setup_cleanup_handlers() {
    if [ "$CLEANUP_HANDLERS_SETUP" = "true" ]; then
        echo "📝 Cleanup handlers already registered"
        return 0
    fi
    
    # Set up signal handlers to ensure cleanup on exit
    trap cleanup_all EXIT INT TERM QUIT
    echo "📝 Cleanup handlers registered (EXIT, INT, TERM, QUIT)"
    
    # Mark as setup to prevent duplicates
    CLEANUP_HANDLERS_SETUP=true
    export CLEANUP_HANDLERS_SETUP
}

# Function to start an application with automatic cleanup registration
start_app_with_cleanup() {
    local command="$1"
    local port="${2:-3101}"
    local log_file="$3"
    
    echo "🚀 Starting application: $command"
    
    # Register port for cleanup
    register_port "$port"
    
    # Start the application
    if [ -n "$log_file" ]; then
        eval "$command" > "$log_file" 2>&1 &
    else
        eval "$command" &
    fi
    
    local pid=$!
    
    # Register PID for cleanup
    register_pid "$pid"
    
    echo "📝 Application started with PID: $pid"
    return 0
}

# Function to wait for application to be ready with cleanup on failure
wait_for_app_ready() {
    local port="${1:-3101}"
    local timeout="${2:-120}"
    local health_endpoints=("health/live" "health" "health/ready")
    
    echo "⏳ Waiting for application to be ready on port $port..."
    
    local count=0
    while [ $count -lt $timeout ]; do
        # Check if any tracked processes died
        for pid in "${TRACKED_PIDS[@]}"; do
            if ! kill -0 "$pid" 2>/dev/null; then
                echo "❌ Application process $pid died unexpectedly"
                return 1
            fi
        done
        
        # Try health endpoints
        for endpoint in "${health_endpoints[@]}"; do
            if curl -s -f "http://localhost:$port/$endpoint" > /dev/null 2>&1; then
                echo "✅ Application is ready and responding on /$endpoint"
                return 0
            fi
        done
        
        # Show progress every 10 seconds
        if [ $((count % 10)) -eq 0 ] && [ $count -gt 0 ]; then
            echo "⏳ Still waiting... (${count}s elapsed)"
        fi
        
        sleep 2
        count=$((count + 2))
    done
    
    echo "❌ Application failed to become ready within ${timeout}s"
    return 1
}

# Function to gracefully stop tracked applications
stop_tracked_apps() {
    echo "🛑 Gracefully stopping tracked applications..."
    
    for pid in "${TRACKED_PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            echo "🛑 Sending SIGTERM to PID $pid..."
            kill -TERM "$pid" 2>/dev/null
        fi
    done
    
    # Wait for graceful shutdown
    local timeout=10
    local count=0
    local all_stopped=false
    
    while [ $count -lt $timeout ] && [ "$all_stopped" = false ]; do
        all_stopped=true
        for pid in "${TRACKED_PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                all_stopped=false
                break
            fi
        done
        
        if [ "$all_stopped" = false ]; then
            sleep 1
            count=$((count + 1))
        fi
    done
    
    if [ "$all_stopped" = true ]; then
        echo "✅ All applications stopped gracefully"
        TRACKED_PIDS=()
        return 0
    else
        echo "⚠️  Some applications didn't stop gracefully, will force kill during cleanup"
        return 1
    fi
}

# Export functions for use in other scripts
export -f register_pid register_port register_temp_file
export -f cleanup_tracked_pids cleanup_tracked_ports cleanup_temp_files
export -f cleanup_ftso_processes cleanup_ftso_ports cleanup_all
export -f setup_cleanup_handlers start_app_with_cleanup wait_for_app_ready stop_tracked_apps