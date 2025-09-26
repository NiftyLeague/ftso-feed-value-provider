#!/bin/bash

echo "🚀 Starting FTSO Feed Value Provider for graceful shutdown test..."
echo "Testing graceful shutdown functionality"
echo "=========================================="

# Source common cleanup utilities
source "$(dirname "$0")/../utils/cleanup.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Initial cleanup
cleanup_ftso_ports

# Start the application with automatic cleanup registration
echo "🚀 Starting application..."
start_app_with_cleanup "npm run start:dev" 3101
APP_PID="${TRACKED_PIDS[-1]}"  # Get the last registered PID

# Wait for the app to start up and check if it's responding
echo "⏳ Waiting for application to start..."
sleep 10

# Check if the app is running and responding
APP_RUNNING=false
for i in {1..30}; do  # Increased attempts to 30 (1 minute total)
    if ps -p $APP_PID > /dev/null 2>&1; then
        # Try different health endpoints to see which one responds first
        for endpoint in "health/live" "health" "health/ready"; do
            if curl -s -f http://localhost:3101/$endpoint > /dev/null 2>&1; then
                APP_RUNNING=true
                echo "✅ Application started successfully (PID: $APP_PID) and responding on /$endpoint"
                break 2  # Break out of both loops
            fi
        done
    else
        echo "❌ Application process died unexpectedly"
        exit 1
    fi
    
    # Show progress every 10 attempts
    if [ $((i % 10)) -eq 0 ]; then
        echo "⏳ Still waiting for application to be ready... (attempt $i/60, ${i}0s elapsed)"
    fi
    sleep 2
done

if [ "$APP_RUNNING" = true ]; then
    echo "🛑 Sending SIGINT (Ctrl+C) signal to test graceful shutdown..."
    
    # Record start time for shutdown measurement
    SHUTDOWN_START=$(date +%s)
    
    # Send SIGINT signal to the main process
    kill -SIGINT $APP_PID
    
    # Wait for graceful shutdown with timeout
    echo "⏳ Waiting for graceful shutdown..."
    
    # Use timeout to prevent hanging (macOS compatible)
    WAIT_COUNT=0
    MAX_WAIT=30  # Increased timeout for graceful shutdown
    
    while kill -0 $APP_PID 2>/dev/null && [ $WAIT_COUNT -lt $MAX_WAIT ]; do
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
        if [ $((WAIT_COUNT % 5)) -eq 0 ]; then
            echo "⏳ Still shutting down... ($WAIT_COUNT/${MAX_WAIT}s)"
        fi
    done
    
    SHUTDOWN_END=$(date +%s)
    SHUTDOWN_TIME=$((SHUTDOWN_END - SHUTDOWN_START))
    
    if kill -0 $APP_PID 2>/dev/null; then
        echo "❌ Process is still running after ${MAX_WAIT} seconds - graceful shutdown failed"
        echo "🔄 Force killing process and any child processes..."
        
        # Kill the main process and any child processes
        pkill -P $APP_PID 2>/dev/null || true
        kill -9 $APP_PID 2>/dev/null || true
        
        # Clean up any remaining processes on port 3101
        lsof -ti:3101 | xargs kill -9 2>/dev/null || true
        
        exit 1
    fi
    
    echo "✅ Graceful shutdown completed successfully in ${SHUTDOWN_TIME} seconds!"
    
    # Verify port is freed
    if lsof -ti:3101 > /dev/null 2>&1; then
        echo "⚠️  Warning: Port 3101 is still in use after shutdown"
        lsof -ti:3101 | xargs kill -9 2>/dev/null || true
    else
        echo "✅ Port 3101 properly released"
    fi
    
else
    echo "❌ Application failed to start or become ready within 120 seconds"
    echo "🔍 Checking for any processes that might be running..."
    
    # Show some diagnostic information
    echo "📊 Process status:"
    if ps -p $APP_PID > /dev/null 2>&1; then
        echo "  - Main process (PID: $APP_PID) is still running"
        
        # Try to check if port is bound
        if lsof -ti:3101 > /dev/null 2>&1; then
            echo "  - Port 3101 is bound by process(es):"
            lsof -ti:3101 | while read pid; do
                echo "    - PID: $pid ($(ps -p $pid -o comm= 2>/dev/null || echo 'unknown'))"
            done
            
            # Try one more health check with verbose output
            echo "🔍 Final health check attempt:"
            curl -v http://localhost:3101/health 2>&1 | head -10 || echo "  - Health check failed"
        else
            echo "  - Port 3101 is not bound - application may not have started properly"
        fi
    else
        echo "  - Main process has died"
    fi
    
    # Clean up any processes that might be hanging
    if ps -p $APP_PID > /dev/null 2>&1; then
        echo "🔄 Killing hung startup process..."
        kill -9 $APP_PID 2>/dev/null || true
    fi
    
    # Clean up any processes on port 3101
    lsof -ti:3101 | xargs kill -9 2>/dev/null || true
    
    exit 1
fi

# Source enhanced log summary utilities
source "$(dirname "$0")/../utils/parse-logs.sh"

# Show test summary
log_summary "$LOG_FILE" "shutdown" "test"

echo "=========================================="
echo "✅ Graceful shutdown test completed successfully!"
