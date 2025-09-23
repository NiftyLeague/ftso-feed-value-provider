#!/bin/bash

echo "🚀 Starting FTSO Feed Value Provider for graceful shutdown test..."
echo "Press Ctrl+C to test graceful shutdown"
echo "=========================================="

# Start the application in the background
pnpm start &
APP_PID=$!

# Wait for the app to start up
echo "⏳ Waiting for application to start..."
sleep 10

# Check if the app is running
if ps -p $APP_PID > /dev/null; then
    echo "✅ Application started successfully (PID: $APP_PID)"
    echo "🛑 Sending SIGINT (Ctrl+C) signal to test graceful shutdown..."
    
    # Send SIGINT signal
    kill -SIGINT $APP_PID
    
    # Wait for graceful shutdown
    echo "⏳ Waiting for graceful shutdown..."
    sleep 5
    
    # Check if the process is still running
    if ps -p $APP_PID > /dev/null; then
        echo "❌ Process is still running after 5 seconds - graceful shutdown may have failed"
        echo "🔄 Force killing process..."
        kill -9 $APP_PID
    else
        echo "✅ Graceful shutdown completed successfully!"
    fi
else
    echo "❌ Application failed to start"
    exit 1
fi

echo "=========================================="
echo "Test completed"
