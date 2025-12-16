#!/bin/bash

echo "🚀 Starting FTSO Feed Value Provider for graceful shutdown test..."
echo "Testing graceful shutdown functionality"
echo "=========================================="

# Source common utilities
source "$(dirname "$0")/../utils/cleanup.sh"
source "$(dirname "$0")/../utils/test-common.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Set up logging
setup_test_logging "shutdown"
LOG_FILE="$TEST_LOG_FILE"

# Initial cleanup
cleanup_ftso_ports

# Start the application with automatic cleanup registration
echo "🚀 Starting application..."
# Get available port dynamically
AVAILABLE_PORT=$(node -e "
const net = require('net');
const server = net.createServer();
server.listen(0, () => {
  const port = server.address().port;
  server.close(() => console.log(port));
});
")

# Set environment variables for dynamic port
export APP_PORT=$AVAILABLE_PORT
export VALUE_PROVIDER_CLIENT_PORT=$AVAILABLE_PORT

echo "📝 Using port: $AVAILABLE_PORT" >> "$LOG_FILE"

# Build the application first to avoid watch mode issues
echo "📦 Building application for production test..." >> "$LOG_FILE"
pnpm build >> "$LOG_FILE" 2>&1

# Use production start instead of dev mode to avoid file watcher issues
start_app_with_cleanup "pnpm start:prod" "$AVAILABLE_PORT" "$LOG_FILE"
# Get the last registered PID safely
if [ ${#TRACKED_PIDS[@]} -gt 0 ]; then
    # Get the last element of the array more safely
    last_index=$((${#TRACKED_PIDS[@]} - 1))
    APP_PID="${TRACKED_PIDS[$last_index]}"
else
    echo "❌ Failed to get application PID"
    exit 1
fi

source "$(dirname "$0")/../utils/readiness-utils.sh"

# Wait for service to become ready (health endpoints)
if ! wait_for_service_health "http://localhost:$AVAILABLE_PORT" 60 1000 5000; then
    echo "❌ Service failed to become ready within timeout"
    stop_tracked_apps
    exit 1
fi

APP_RUNNING=true
echo "✅ Application started successfully (PID: $APP_PID) and responding on /health"

if [ "$APP_RUNNING" = true ]; then
    echo "🛑 Sending SIGINT (Ctrl+C) signal to test graceful shutdown..."
    
    # Record start time for shutdown measurement
    SHUTDOWN_START=$(date +%s)
    
    # Find the actual Node.js process running the application
    # The APP_PID might be npm/nest wrapper, we need the actual node process
    # Find the actual Node.js process - get the first match only
    NODE_PID=$(pgrep -f "node.*--max-old-space-size.*dist/src/main" | head -1)
    if [ -z "$NODE_PID" ]; then
        NODE_PID=$(pgrep -f "node.*dist/main" | head -1)
    fi
    if [ -z "$NODE_PID" ]; then
        NODE_PID=$(pgrep -f "node.*nest" | head -1)
    fi
    if [ -z "$NODE_PID" ]; then
        NODE_PID="$APP_PID"
    fi
    
    if [ "$NODE_PID" != "$APP_PID" ]; then
        echo "📝 Found Node.js process PID: $NODE_PID (wrapper PID: $APP_PID)"
    else
        echo "📝 Using original PID: $APP_PID"
    fi
    
    # Send SIGINT signal to the Node.js process
    echo "📝 Sending SIGINT to Node.js process $NODE_PID"
    kill -SIGINT $NODE_PID
    
    # Wait for graceful shutdown with timeout
    echo "⏳ Waiting for graceful shutdown..."
    
    # Use timeout to prevent hanging (macOS compatible)
    WAIT_COUNT=0
    MAX_WAIT=30  # Increased timeout for graceful shutdown
    
    while kill -0 $NODE_PID 2>/dev/null && [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        # Check if process is still responsive during shutdown
        # Only check health every few iterations during shutdown
        if [ $((WAIT_COUNT % 3)) -eq 0 ]; then
            if ! wait_for_service_health "http://localhost:$AVAILABLE_PORT" 1 1000 2000; then
                echo "⚠️  Service became unresponsive during shutdown"
            fi
        fi
        WAIT_COUNT=$((WAIT_COUNT + 1))
        if [ $((WAIT_COUNT % 5)) -eq 0 ]; then
            echo "⏳ Still shutting down... ($WAIT_COUNT/${MAX_WAIT}s)"
        fi
    done
    
    SHUTDOWN_END=$(date +%s)
    SHUTDOWN_TIME=$((SHUTDOWN_END - SHUTDOWN_START))
    
    if kill -0 $NODE_PID 2>/dev/null; then
        echo "❌ Process is still running after ${MAX_WAIT} seconds - graceful shutdown failed"
        echo "🔄 Force killing process and any child processes..."
        
        # Kill the Node.js process and any child processes
        pkill -P $NODE_PID 2>/dev/null || true
        kill -9 $NODE_PID 2>/dev/null || true
        
        # Also kill the wrapper process if different
        if [ "$NODE_PID" != "$APP_PID" ]; then
            pkill -P $APP_PID 2>/dev/null || true
            kill -9 $APP_PID 2>/dev/null || true
        fi
        
        # Clean up any remaining processes on the dynamic port
        lsof -ti:$AVAILABLE_PORT | xargs kill -9 2>/dev/null || true
        
        exit 1
    else
        echo "✅ Process $NODE_PID terminated successfully"
    fi
    
    echo "✅ Graceful shutdown completed successfully in ${SHUTDOWN_TIME} seconds!"
    
    # Give the OS a moment to release the port
    echo "⏳ Waiting for port cleanup..."
    sleep 2
    
    # Verify port is freed
    PORT_PIDS=$(lsof -ti:$AVAILABLE_PORT 2>/dev/null || echo "")
    if [ -n "$PORT_PIDS" ]; then
        echo "⚠️  Warning: Port $AVAILABLE_PORT is still in use after shutdown"
        echo "📝 Processes using port: $PORT_PIDS"
        
        # Check if these are our processes or something else
        for pid in $PORT_PIDS; do
            if ps -p $pid > /dev/null 2>&1; then
                PROCESS_INFO=$(ps -p $pid -o pid,ppid,comm,args 2>/dev/null || echo "Process info unavailable")
                echo "📝 PID $pid: $PROCESS_INFO"
            fi
        done
        
        # Only kill if they appear to be our processes
        echo $PORT_PIDS | xargs kill -9 2>/dev/null || true
    else
        echo "✅ Port $AVAILABLE_PORT properly released"
    fi
    
else
    echo "❌ Application failed to start or become ready within 120 seconds"
    echo "🔍 Checking for any processes that might be running..."
    
    # Show some diagnostic information
    echo "📊 Process status:"
    if ps -p $APP_PID > /dev/null 2>&1; then
        echo "  - Main process (PID: $APP_PID) is still running"
        
        # Try to check if port is bound
        if lsof -ti:$AVAILABLE_PORT > /dev/null 2>&1; then
            echo "  - Port $AVAILABLE_PORT is bound by process(es):"
            lsof -ti:$AVAILABLE_PORT | while read pid; do
                echo "    - PID: $pid ($(ps -p $pid -o comm= 2>/dev/null || echo 'unknown'))"
            done
            
            # Try one more health check with verbose output
            echo "🔍 Final health check attempt:"
            curl -v http://localhost:$AVAILABLE_PORT/health/ready 2>&1 | head -10 || echo "  - Health check failed"
        else
            echo "  - Port $AVAILABLE_PORT is not bound - application may not have started properly"
        fi
    else
        echo "  - Main process has died"
    fi
    
    # Clean up any processes that might be hanging
    if ps -p $APP_PID > /dev/null 2>&1; then
        echo "🔄 Killing hung startup process..."
        kill -9 $APP_PID 2>/dev/null || true
    fi
    
    # Clean up any processes on the dynamic port
    lsof -ti:$AVAILABLE_PORT | xargs kill -9 2>/dev/null || true
    
    exit 1
fi

# Source enhanced log summary utilities
source "$(dirname "$0")/../utils/parse-logs.sh"

# Show test summary
log_summary "$LOG_FILE" "shutdown" "test"

echo "=========================================="
echo "✅ Graceful shutdown test completed successfully!"
