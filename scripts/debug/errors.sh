#!/bin/bash
# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"
source "$(dirname "$0")/../utils/parse-logs.sh"
source "$(dirname "$0")/../utils/cleanup.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Error Analysis and Circuit Breaker Debugging Script
# Analyzes error patterns, circuit breaker behavior, and failure recovery

echo "🚨 FTSO Error Analysis & Circuit Breaker Debugger"
echo "================================================="

# Clean up any existing processes on port 3101
echo "🧹 Cleaning up any existing processes on port 3101..."
PORT_PID=$(lsof -ti :3101 2>/dev/null)
if [ ! -z "$PORT_PID" ]; then
    echo "   Found process $PORT_PID using port 3101, terminating..."
    kill $PORT_PID 2>/dev/null
    sleep 2
    # Force kill if still running
    if kill -0 $PORT_PID 2>/dev/null; then
        kill -9 $PORT_PID 2>/dev/null
    fi
    echo "   Port 3101 cleaned up"
fi

# Configuration
TIMEOUT=90

# Set up logging using common utility
echo "📝 Starting error analysis..."
setup_debug_logging "error-debug"
LOG_FILE="$DEBUG_LOG_FILE"

ERROR_SUMMARY="$DEBUG_LOG_DIR/error-summary.log"
echo "📊 Error summary: $ERROR_SUMMARY"
echo ""

# Start the application in background with clean output capture
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring for errors and circuit breaker events for $TIMEOUT seconds..."

# Monitor for the specified timeout
sleep $TIMEOUT

# Stop the application
if kill -0 $APP_PID 2>/dev/null; then
    echo "🛑 Stopping application..."
    stop_tracked_apps
fi

echo ""
echo "🔍 Error Analysis:"
echo "=================="

# Initialize error summary
echo "FTSO Error Analysis Report - $(date)" > "$ERROR_SUMMARY"
echo "=======================================" >> "$ERROR_SUMMARY"
echo "" >> "$ERROR_SUMMARY"

if [ -f "$LOG_FILE" ]; then
    echo "📊 Error Statistics:"
    echo "-------------------"
    
    # Count different types of errors (only actual log levels, not content)
    FATAL_ERRORS=$(grep -c "\] *FATAL " "$LOG_FILE")
    ERROR_LOGS=$(grep -c "\] *ERROR " "$LOG_FILE")
    WARNINGS=$(grep -c "\] *WARN " "$LOG_FILE")
    
    echo "💀 Fatal errors: $FATAL_ERRORS"
    echo "❌ Errors: $ERROR_LOGS"
    echo "⚠️  Warnings: $WARNINGS"
    
    # Log to summary
    echo "Error Statistics:" >> "$ERROR_SUMMARY"
    echo "- Fatal errors: $FATAL_ERRORS" >> "$ERROR_SUMMARY"
    echo "- Errors: $ERROR_LOGS" >> "$ERROR_SUMMARY"
    echo "- Warnings: $WARNINGS" >> "$ERROR_SUMMARY"
    echo "" >> "$ERROR_SUMMARY"
    
    echo ""
    echo "🔌 Connection Errors:"
    echo "--------------------"
    
    # WebSocket connection errors
    WS_ERRORS=$(grep -c "WebSocket.*error\|WebSocket.*failed\|WebSocket.*closed.*[0-9]{4}" "$LOG_FILE")
    echo "🌐 WebSocket errors: $WS_ERRORS"
    
    # Connection recovery events
    RECOVERY_EVENTS=$(grep -c "Connection lost\|Connection.*failed\|Reconnecting" "$LOG_FILE")
    echo "🔄 Recovery events: $RECOVERY_EVENTS"
    
    # Show recent connection errors
    echo ""
    echo "Recent connection errors:"
    grep -E "(WebSocket.*error|Connection.*failed|WebSocket closed.*[0-9]{4})" "$LOG_FILE" | tail -5
    
    # Log to summary
    echo "Connection Errors:" >> "$ERROR_SUMMARY"
    echo "- WebSocket errors: $WS_ERRORS" >> "$ERROR_SUMMARY"
    echo "- Recovery events: $RECOVERY_EVENTS" >> "$ERROR_SUMMARY"
    echo "" >> "$ERROR_SUMMARY"
    
    echo ""
    echo "⚡ Circuit Breaker Analysis:"
    echo "---------------------------"
    
    # Circuit breaker state changes
    CB_OPENED=$(grep -c "Circuit breaker.*OPENED\|Circuit breaker.*OPEN" "$LOG_FILE")
    CB_CLOSED=$(grep -c "Circuit breaker.*CLOSED" "$LOG_FILE")
    CB_HALF_OPEN=$(grep -c "Circuit breaker.*HALF-OPEN" "$LOG_FILE")
    
    echo "🔴 Circuit breakers opened: $CB_OPENED"
    echo "🟢 Circuit breakers closed: $CB_CLOSED"
    echo "🟡 Circuit breakers half-open: $CB_HALF_OPEN"
    
    # Show circuit breaker events
    echo ""
    echo "Circuit breaker events:"
    grep -E "(Circuit breaker.*OPEN|Circuit breaker.*CLOSED|Circuit breaker.*HALF)" "$LOG_FILE" | head -10
    
    # Log to summary
    echo "Circuit Breaker Events:" >> "$ERROR_SUMMARY"
    echo "- Opened: $CB_OPENED" >> "$ERROR_SUMMARY"
    echo "- Closed: $CB_CLOSED" >> "$ERROR_SUMMARY"
    echo "- Half-open: $CB_HALF_OPEN" >> "$ERROR_SUMMARY"
    echo "" >> "$ERROR_SUMMARY"
    
    echo ""
    echo "🏥 Failover Events:"
    echo "------------------"
    
    # Failover manager events
    FAILOVER_EVENTS=$(grep -c "Failover\|failover\|Triggering.*failover" "$LOG_FILE")
    echo "🔄 Failover events: $FAILOVER_EVENTS"
    
    # Show failover events
    grep -E "(Failover|failover|Triggering.*failover)" "$LOG_FILE" | head -5
    
    echo ""
    echo "📊 Exchange-Specific Errors:"
    echo "----------------------------"
    
    # Analyze errors by exchange
    EXCHANGES=("binance" "coinbase" "kraken" "okx" "cryptocom" "ccxt-multi-exchange")
    
    for exchange in "${EXCHANGES[@]}"; do
        EXCHANGE_ERRORS=$(grep -c "error.*$exchange\|$exchange.*error\|failed.*$exchange" "$LOG_FILE")
        if [ $EXCHANGE_ERRORS -gt 0 ]; then
            echo "❌ $exchange: $EXCHANGE_ERRORS errors"
        else
            echo "✅ $exchange: No errors"
        fi
    done
    
    # Log to summary
    echo "Exchange-Specific Errors:" >> "$ERROR_SUMMARY"
    for exchange in "${EXCHANGES[@]}"; do
        EXCHANGE_ERRORS=$(grep -c "error.*$exchange\|$exchange.*error\|failed.*$exchange" "$LOG_FILE")
        echo "- $exchange: $EXCHANGE_ERRORS errors" >> "$ERROR_SUMMARY"
    done
    echo "" >> "$ERROR_SUMMARY"
    
    echo ""
    echo "🔍 Error Patterns:"
    echo "-----------------"
    
    # Most common error messages (only actual log levels)
    echo "Most common error patterns:"
    grep -E "\] *(ERROR |WARN )" "$LOG_FILE" | \
        sed 's/\[[0-9:]*\s*[AP]M\]//g' | \
        sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}.*[AP]M//g' | \
        sort | uniq -c | sort -nr | head -5
    
    echo ""
    echo "🕐 Error Timeline:"
    echo "-----------------"
    
    # Show error timeline (first and last few errors, only actual log levels)
    echo "First errors:"
    grep -E "\] *(ERROR |WARN )" "$LOG_FILE" | head -3
    
    echo ""
    echo "Recent errors:"
    grep -E "\] *(ERROR |WARN )" "$LOG_FILE" | tail -3
    
    echo ""
    echo "🧪 Data Validation Errors:"
    echo "-------------------------"
    
    # Validation and data quality errors
    VALIDATION_ERRORS=$(grep -c "validation.*error\|invalid.*data\|failed.*validation" "$LOG_FILE")
    echo "📊 Validation errors: $VALIDATION_ERRORS"
    
    OUTLIER_WARNINGS=$(grep -c "outlier\|Outlier" "$LOG_FILE")
    echo "📈 Outlier warnings: $OUTLIER_WARNINGS"
    
    CONSENSUS_ISSUES=$(grep -c "consensus.*deviation\|consensus.*error" "$LOG_FILE")
    echo "🎯 Consensus issues: $CONSENSUS_ISSUES"
    
    # Show validation errors
    grep -E "(validation.*error|invalid.*data|outlier)" "$LOG_FILE" | head -3
    
    echo ""
    echo "💾 System Resource Errors:"
    echo "-------------------------"
    
    # Memory and performance errors
    MEMORY_WARNINGS=$(grep -c "memory.*warning\|Memory.*high\|out of memory" "$LOG_FILE")
    echo "🧠 Memory warnings: $MEMORY_WARNINGS"
    
    TIMEOUT_ERRORS=$(grep -c "timeout\|Timeout\|timed out" "$LOG_FILE")
    echo "⏰ Timeout errors: $TIMEOUT_ERRORS"
    
    # Show resource errors
    grep -E "(memory.*warning|timeout|Timeout)" "$LOG_FILE" | head -3
    
    # Final summary to file
    echo "Summary:" >> "$ERROR_SUMMARY"
    echo "- Total issues found: $((FATAL_ERRORS + ERROR_LOGS + WARNINGS))" >> "$ERROR_SUMMARY"
    echo "- Most critical: $([ $FATAL_ERRORS -gt 0 ] && echo "Fatal errors present" || echo "No fatal errors")" >> "$ERROR_SUMMARY"
    echo "- Connection stability: $([ $WS_ERRORS -lt 5 ] && echo "Good" || echo "Needs attention")" >> "$ERROR_SUMMARY"
    echo "- Circuit breaker health: $([ $CB_OPENED -lt 3 ] && echo "Stable" || echo "Frequent trips")" >> "$ERROR_SUMMARY"
    
else
    echo "❌ No log file found"
fi

echo ""
echo "🔧 Recovery Recommendations:"
echo "============================"

if [ -f "$LOG_FILE" ]; then
    # Provide recommendations based on error patterns
    if [ $WS_ERRORS -gt 5 ]; then
        echo "🌐 WebSocket Issues Detected:"
        echo "   - Consider increasing reconnection delays"
        echo "   - Check network connectivity"
        echo "   - Review exchange API limits"
    fi
    
    if [ $CB_OPENED -gt 2 ]; then
        echo "⚡ Circuit Breaker Issues:"
        echo "   - Review failure thresholds"
        echo "   - Check service dependencies"
        echo "   - Consider increasing timeout values"
    fi
    
    if [ $MEMORY_WARNINGS -gt 0 ]; then
        echo "🧠 Memory Issues:"
        echo "   - Monitor memory usage patterns"
        echo "   - Consider reducing cache sizes"
        echo "   - Check for memory leaks"
    fi
    
    if [ $TIMEOUT_ERRORS -gt 3 ]; then
        echo "⏰ Timeout Issues:"
        echo "   - Increase timeout configurations"
        echo "   - Check network latency"
        echo "   - Review service performance"
    fi
    
    if [ $((FATAL_ERRORS + ERROR_LOGS + WARNINGS)) -eq 0 ]; then
        echo "✅ No significant issues detected!"
        echo "   - System appears to be running smoothly"
        echo "   - Continue monitoring for any emerging patterns"
    fi
fi

# Show log summary
log_summary "$LOG_FILE" "errors" "debug"

echo ""
echo "✨ Error analysis complete!"
echo "📁 Reports available at:"
echo "   - Detailed log: $LOG_FILE"
echo "   - Error summary: $ERROR_SUMMARY"