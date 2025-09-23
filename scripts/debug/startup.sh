#!/bin/bash

# Debug startup script for FTSO Feed Value Provider
# This script runs the app for a short period to analyze startup logs

echo "🚀 Starting FTSO Feed Value Provider in debug mode..."
echo "📊 Monitoring startup performance and identifying issues..."

# Set timeout for startup monitoring (60 seconds)
TIMEOUT=60

# Ensure logs directory exists
mkdir -p logs

# Start the application in background
pnpm start:dev > logs/startup.log 2>&1 &
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
if [ -f logs/startup.log ]; then
    echo "📊 Startup time analysis:"
    grep -E "(Starting|Found|application created|HTTP server started)" logs/startup.log | head -10
    
    echo ""
    echo "⚠️  Warnings and errors:"
    grep -E "(WARN|ERROR|Failed|failed)" logs/startup.log | head -10
    
    echo ""
    echo "🔧 Performance issues:"
    grep -E "(slow|timeout|delay|optimization)" logs/startup.log | head -10
    
    echo ""
    echo "📈 Memory usage:"
    grep -E "(Memory|memory|heap)" logs/startup.log | head -5
    
    echo ""
    echo "🌐 WebSocket connections:"
    grep -E "(WebSocket|connected|subscribed)" logs/startup.log | tail -10
    
    # Count total log lines
    TOTAL_LINES=$(wc -l < logs/startup.log)
    echo ""
    echo "📝 Total log lines: $TOTAL_LINES"
    
    # Show last few lines for final status
    echo ""
    echo "🏁 Final status:"
    tail -5 logs/startup.log
else
    echo "❌ No startup log found"
fi

echo ""
echo "✨ Analysis complete. Check logs/startup.log for full details."