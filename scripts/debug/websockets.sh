#!/bin/bash

# WebSocket Connection Debugging Script
# Tests WebSocket connections for all exchanges and monitors their health

# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"

echo "🌐 FTSO WebSocket Connection Debugger"
echo "====================================="

# Configuration
TIMEOUT=90

# Set up logging using common utility
setup_debug_logging "websocket-debug"
LOG_FILE="$DEBUG_LOG_FILE"

echo "📝 Starting WebSocket connection analysis..."
echo "📁 Log file: $LOG_FILE"

# Start the application in background
pnpm start:dev > "$LOG_FILE" 2>&1 &
APP_PID=$!

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring WebSocket connections for $TIMEOUT seconds..."

# Monitor for the specified timeout
sleep $TIMEOUT

# Check if process is still running
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ Application is running"
    echo "🛑 Stopping application for analysis..."
    kill $APP_PID 2>/dev/null
    wait $APP_PID 2>/dev/null
else
    echo "❌ Application stopped unexpectedly"
fi

echo ""
echo "🔍 WebSocket Connection Analysis:"
echo "================================="

if [ -f "$LOG_FILE" ]; then
    echo "📊 Connection Summary:"
    echo "----------------------"
    
    # Count successful connections
    SUCCESSFUL_CONNECTIONS=$(grep -c "WebSocket connected for\|Connected to" "$LOG_FILE")
    echo "✅ Successful connections: $SUCCESSFUL_CONNECTIONS"
    
    # Count failed connections
    FAILED_CONNECTIONS=$(grep -c "WebSocket.*failed\|Connection.*failed\|WebSocket.*error" "$LOG_FILE")
    echo "❌ Failed connections: $FAILED_CONNECTIONS"
    
    # Count WebSocket closures
    CLOSED_CONNECTIONS=$(grep -c "WebSocket closed\|WebSocket connection closed" "$LOG_FILE")
    echo "🔌 Closed connections: $CLOSED_CONNECTIONS"
    
    echo ""
    echo "📋 Exchange Connection Status:"
    echo "------------------------------"
    
    # Check each exchange
    EXCHANGES=("binance" "coinbase" "kraken" "okx" "cryptocom" "ccxt-multi-exchange")
    
    for exchange in "${EXCHANGES[@]}"; do
        if grep -q "Connected to $exchange\|WebSocket connected for $exchange" "$LOG_FILE"; then
            echo "✅ $exchange: Connected"
        elif grep -q "WebSocket.*error.*$exchange\|Connection.*failed.*$exchange" "$LOG_FILE"; then
            echo "❌ $exchange: Failed"
        else
            echo "⚠️  $exchange: Unknown status"
        fi
    done
    
    echo ""
    echo "⚠️  Connection Issues:"
    echo "---------------------"
    grep -E "(WebSocket.*error|Connection.*failed|WebSocket closed.*[0-9]{4})" "$LOG_FILE" | head -10
    
    echo ""
    echo "📈 Subscription Status:"
    echo "----------------------"
    grep -E "(Subscribed.*symbols|Started WebSocket watching)" "$LOG_FILE" | tail -10
    
    echo ""
    echo "🔧 Performance Metrics:"
    echo "----------------------"
    
    # Count total subscriptions
    TOTAL_SUBSCRIPTIONS=$(grep -c "Subscribed.*to.*symbols" "$LOG_FILE")
    echo "📊 Total symbol subscriptions: $TOTAL_SUBSCRIPTIONS"
    
    # Check for reconnection attempts
    RECONNECT_ATTEMPTS=$(grep -c "Reconnecting\|reconnect\|Attempting to reconnect" "$LOG_FILE")
    echo "🔄 Reconnection attempts: $RECONNECT_ATTEMPTS"
    
    # Show timing information
    echo ""
    echo "⏱️  Connection Timing:"
    echo "---------------------"
    grep -E "(Requesting connection|Successfully connected)" "$LOG_FILE" | head -10
    
    echo ""
    echo "🏁 Final WebSocket Status:"
    echo "-------------------------"
    tail -10 "$LOG_FILE" | grep -E "(WebSocket|connected|subscribed)"
    
else
    echo "❌ No log file found at $LOG_FILE"
fi

echo ""
echo "✨ WebSocket analysis complete. Full logs available at: $LOG_FILE"