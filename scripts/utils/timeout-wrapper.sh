#!/bin/bash

# Timeout wrapper for test scripts to prevent hanging
# Usage: ./timeout-wrapper.sh <script_name> <timeout_seconds>

SCRIPT_NAME=$1
TIMEOUT_SECONDS=${2:-300}  # Default 5 minutes

if [ -z "$SCRIPT_NAME" ]; then
    echo "Usage: $0 <script_name> [timeout_seconds]"
    echo "Example: $0 server.sh 120"
    exit 1
fi

SCRIPT_PATH="scripts/test/$SCRIPT_NAME"

if [ ! -f "$SCRIPT_PATH" ]; then
    echo "❌ Script not found: $SCRIPT_PATH"
    exit 1
fi

echo "🕐 Running $SCRIPT_NAME with ${TIMEOUT_SECONDS}s timeout..."

# Run the script with timeout and cleanup
timeout $TIMEOUT_SECONDS bash "$SCRIPT_PATH" || {
    EXIT_CODE=$?
    if [ $EXIT_CODE -eq 124 ]; then
        echo "⏰ Test script timed out after ${TIMEOUT_SECONDS} seconds"
        
        # Kill any remaining processes
        echo "🧹 Cleaning up processes..."
        pkill -f "pnpm start" 2>/dev/null || true
        pkill -f "nest start" 2>/dev/null || true
        pkill -f "node.*dist/main" 2>/dev/null || true
        
        # Wait a moment for cleanup
        sleep 2
        
        echo "❌ Test failed due to timeout"
        exit 124
    else
        echo "❌ Test failed with exit code: $EXIT_CODE"
        exit $EXIT_CODE
    fi
}

echo "✅ Test completed successfully"