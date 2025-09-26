#!/bin/bash

# Debug startup script for FTSO Feed Value Provider
# This script runs the app for a short period to analyze startup logs

# Source common utilities
source "$(dirname "$0")/../utils/debug-common.sh"
source "$(dirname "$0")/../utils/parse-logs.sh"
source "$(dirname "$0")/../utils/cleanup.sh"

# Set up cleanup handlers
setup_cleanup_handlers

echo "🚀 Starting FTSO Feed Value Provider in debug mode..."
echo "📊 Monitoring startup performance and identifying issues..."

# Set timeout for startup monitoring (60 seconds)
TIMEOUT=60

# Initial cleanup
cleanup_ftso_ports

# Set up logging using common utility
setup_debug_logging "startup"
LOG_FILE="$DEBUG_LOG_FILE"

# Start the application with automatic cleanup registration
start_app_with_cleanup "npm run start:dev" 3101 "$LOG_FILE"
# Get the last registered PID safely
if [ ${#TRACKED_PIDS[@]} -gt 0 ]; then
    APP_PID="${TRACKED_PIDS[-1]}"
else
    echo "❌ Failed to get application PID"
    exit 1
fi

echo "⏱️  Monitoring for $TIMEOUT seconds..."

# Monitor for the specified timeout
sleep $TIMEOUT

# Check if process is still running
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ Application is running successfully"
    echo "🛑 Stopping application for analysis..."
    
    # Use the shared graceful stop function
    stop_tracked_apps
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
    # Only match actual WARN and ERROR log levels from NestJS, not configuration values
    grep -E "\[Nest\].*\s+(WARN|ERROR)\s+" "$LOG_FILE" | head -10
    
    echo ""
    echo "🔧 Performance issues:"
    # Look for actual performance problems, not configuration values
    grep -E "(slow query|high latency|performance degraded|timeout exceeded|connection timeout)" "$LOG_FILE" | head -10
    
    echo ""
    echo "📈 Memory usage:"
    # Look for actual memory issues, not configuration values
    grep -E "(memory leak|out of memory|heap overflow|memory pressure|GC pressure)" "$LOG_FILE" | head -5
    
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

# Clean up old logs if in session mode
cleanup_old_logs "startup"

# Show log summary
log_summary "$LOG_FILE" "startup" "debug"

echo ""
echo "✨ Analysis complete!"