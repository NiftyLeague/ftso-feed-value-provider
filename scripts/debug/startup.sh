#!/bin/bash

# Debug startup script for FTSO Feed Value Provider
# This script runs the app for a short period to analyze startup logs

# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"

echo "🚀 Starting FTSO Feed Value Provider in debug mode..."
echo "📊 Monitoring startup performance and identifying issues..."

# Set timeout for startup monitoring (60 seconds)
TIMEOUT=60

# Set up logging using common utility
setup_debug_logging "startup"
LOG_FILE="$DEBUG_LOG_FILE"

# Start the application in background
pnpm start:dev > "$LOG_FILE" 2>&1 &
APP_PID=$!

echo "📝 Application started with PID: $APP_PID"
echo "⏱️  Monitoring for $TIMEOUT seconds..."

# Monitor for the specified timeout
sleep $TIMEOUT

# Check if process is still running
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ Application is running successfully"
    echo "🛑 Stopping application for analysis..."
    kill $APP_PID 2>/dev/null
    wait $APP_PID 2>/dev/null
else
    echo "❌ Application stopped unexpectedly"
fi

echo ""
echo "📋 Startup Analysis:"
echo "===================="

# Analyze startup logs
if [ -f "$LOG_FILE" ]; then
    echo "📊 Startup time analysis:"
    grep -E "(Starting|Found|application created|HTTP server started)" "$LOG_FILE" | head -10
    
    echo ""
    echo "⚠️  Warnings and errors:"
    grep -E "(WARN|ERROR|Failed|failed)" "$LOG_FILE" | head -10
    
    echo ""
    echo "🔧 Performance issues:"
    grep -E "(slow|timeout|delay|optimization)" "$LOG_FILE" | head -10
    
    echo ""
    echo "📈 Memory usage:"
    grep -E "(Memory|memory|heap)" "$LOG_FILE" | head -5
    
    echo ""
    echo "🌐 WebSocket connections:"
    grep -E "(WebSocket|connected|subscribed)" "$LOG_FILE" | tail -10
    
    # Count total log lines
    TOTAL_LINES=$(wc -l < "$LOG_FILE")
    echo ""
    echo "📝 Total log lines: $TOTAL_LINES"
    
    # Show last few lines for final status
    echo ""
    echo "🏁 Final status:"
    tail -5 "$LOG_FILE"
else
    echo "❌ No startup log found at $LOG_FILE"
fi

# Show log summary
show_log_summary "$LOG_FILE" "startup"

# Clean up old logs if in session mode
cleanup_old_logs "startup"

echo ""
echo "✨ Analysis complete!"