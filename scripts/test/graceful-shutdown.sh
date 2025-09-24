#!/bin/bash

echo "🚀 Starting FTSO Feed Value Provider for graceful shutdown test..."
echo "Press Ctrl+C to test graceful shutdown"
echo "=========================================="

# Start the application in the background
pnpm start &
APP_PID=$!

# Wait for the app to start up - Reduced timeout
echo "⏳ Waiting for application to start..."
sleep 5  # Reduced from 10

# Check if the app is running
if ps -p $APP_PID > /dev/null; then
    echo "✅ Application started successfully (PID: $APP_PID)"
    echo "🛑 Sending SIGINT (Ctrl+C) signal to test graceful shutdown..."
    
    # Send SIGINT signal
    kill -SIGINT $APP_PID
    
    # Wait for graceful shutdown with timeout
    echo "⏳ Waiting for graceful shutdown..."
    
    # Use timeout to prevent hanging (macOS compatible)
    WAIT_COUNT=0
    while kill -0 $APP_PID 2>/dev/null && [ $WAIT_COUNT -lt 10 ]; do
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
    done
    
    if kill -0 $APP_PID 2>/dev/null; then
        echo "❌ Process is still running after 10 seconds - graceful shutdown may have failed"
        echo "🔄 Force killing process..."
        kill -9 $APP_PID 2>/dev/null || true
        exit 1
    }
    
    echo "✅ Graceful shutdown completed successfully!"
else
    echo "❌ Application failed to start"
    exit 1
fi

echo "=========================================="
echo "Test completed"
