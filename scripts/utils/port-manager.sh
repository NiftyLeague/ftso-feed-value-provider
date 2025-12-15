#!/bin/bash

# Port Manager Utility
# Provides dynamic port allocation for test scripts

# Get an available port
get_available_port() {
    local port
    port=$(node -e "
        const net = require('net');
        const server = net.createServer();
        server.listen(0, () => {
            const port = server.address().port;
            server.close(() => console.log(port));
        });
    " 2>/dev/null)
    
    if [ -z "$port" ] || [ "$port" = "null" ]; then
        # Fallback to random port in safe range
        port=$((3200 + RANDOM % 800))
    fi
    
    echo "$port"
}

# Set up dynamic port for current test session
setup_test_port() {
    local port
    port=$(get_available_port)
    
    # Export for current session
    export TEST_PORT="$port"
    export APP_PORT="$port"
    export VALUE_PROVIDER_CLIENT_PORT="$port"
    
    echo "$port"
}

# Check if port is available
is_port_available() {
    local port="$1"
    ! lsof -ti:"$port" > /dev/null 2>&1
}

# Kill processes on specific port
kill_port_processes() {
    local port="$1"
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null)
    
    if [ -n "$pids" ]; then
        local kill_pids=""
        local skipped_pids=""

        for pid in $pids; do
            local command
            command=$(ps -p "$pid" -o command= 2>/dev/null || true)

            # Never kill Docker Desktop / vpnkit / docker-proxy processes.
            # Some tests use dynamic ports, but still call cleanup on the default port (3101).
            # Killing Docker-owned listeners can take Docker down and break subsequent docker-based tests.
            if echo "$command" | grep -qiE "com\\.docker|Docker Desktop|vpnkit|docker-proxy"; then
                skipped_pids="$skipped_pids $pid"
                continue
            fi

            kill_pids="$kill_pids $pid"
        done

        if [ -n "$skipped_pids" ]; then
            echo "⚠️  Skipping Docker-related process(es) on port $port:$skipped_pids"
        fi

        if [ -n "$kill_pids" ]; then
            echo "🛑 Killing processes on port $port:$kill_pids"
            echo "$kill_pids" | xargs kill -9 2>/dev/null || true
            sleep 1
        fi
    fi
}

# Wait for port to be available
wait_for_port_available() {
    local port="$1"
    local timeout="${2:-30}"
    local count=0
    
    while ! is_port_available "$port" && [ $count -lt $timeout ]; do
        sleep 1
        count=$((count + 1))
    done
    
    is_port_available "$port"
}