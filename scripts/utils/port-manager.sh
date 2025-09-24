#!/bin/bash

# Port Manager Utility
# Handles port conflicts and provides port management functionality

# Function to check if a port is in use
is_port_in_use() {
    local port=$1
    lsof -ti:$port >/dev/null 2>&1
}

# Function to kill process using a port
kill_port_process() {
    local port=$1
    local force=${2:-false}
    
    if is_port_in_use $port; then
        local pid=$(lsof -ti:$port)
        echo "🔍 Found process $pid using port $port"
        
        if [ "$force" = "true" ]; then
            echo "💀 Force killing process $pid on port $port"
            kill -9 $pid 2>/dev/null
        else
            echo "🛑 Gracefully stopping process $pid on port $port"
            kill -TERM $pid 2>/dev/null
            
            # Wait up to 5 seconds for graceful shutdown
            for i in {1..5}; do
                if ! is_port_in_use $port; then
                    echo "✅ Process stopped gracefully"
                    return 0
                fi
                sleep 1
            done
            
            # Force kill if still running
            if is_port_in_use $port; then
                echo "⚠️  Graceful shutdown failed, force killing..."
                kill -9 $pid 2>/dev/null
            fi
        fi
        
        # Verify port is free
        sleep 1
        if is_port_in_use $port; then
            echo "❌ Failed to free port $port"
            return 1
        else
            echo "✅ Port $port is now free"
            return 0
        fi
    else
        echo "✅ Port $port is already free"
        return 0
    fi
}

# Function to find next available port
find_available_port() {
    local start_port=$1
    local max_attempts=${2:-10}
    
    for ((i=0; i<max_attempts; i++)); do
        local port=$((start_port + i))
        if ! is_port_in_use $port; then
            echo $port
            return 0
        fi
    done
    
    return 1
}

# Function to cleanup all FTSO-related processes
cleanup_ftso_processes() {
    echo "🧹 Cleaning up FTSO-related processes..."
    
    # Kill processes by name pattern
    pkill -f "ftso-feed-value-provider" 2>/dev/null || true
    pkill -f "nest start" 2>/dev/null || true
    
    # Kill processes on common FTSO ports
    for port in 3101 3102 3103 9090; do
        if is_port_in_use $port; then
            echo "🔍 Checking port $port..."
            kill_port_process $port true
        fi
    done
    
    echo "✅ Cleanup completed"
}

# Main function
main() {
    local command=${1:-"help"}
    local port=${2:-3101}
    
    case $command in
        "check")
            if is_port_in_use $port; then
                echo "❌ Port $port is in use"
                lsof -i:$port
                exit 1
            else
                echo "✅ Port $port is available"
                exit 0
            fi
            ;;
        "kill")
            kill_port_process $port false
            ;;
        "force-kill")
            kill_port_process $port true
            ;;
        "find")
            available_port=$(find_available_port $port)
            if [ $? -eq 0 ]; then
                echo "✅ Available port: $available_port"
                exit 0
            else
                echo "❌ No available ports found starting from $port"
                exit 1
            fi
            ;;
        "cleanup")
            cleanup_ftso_processes
            ;;
        "help"|*)
            echo "Port Manager Utility"
            echo "===================="
            echo ""
            echo "Usage: $0 <command> [port]"
            echo ""
            echo "Commands:"
            echo "  check [port]      - Check if port is available (default: 3101)"
            echo "  kill [port]       - Gracefully kill process using port"
            echo "  force-kill [port] - Force kill process using port"
            echo "  find [port]       - Find next available port starting from given port"
            echo "  cleanup           - Cleanup all FTSO-related processes"
            echo "  help              - Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 check 3101"
            echo "  $0 kill 3101"
            echo "  $0 find 3101"
            echo "  $0 cleanup"
            ;;
    esac
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi