#!/bin/bash

# Robust WebSocket Connection Test & Stability Analysis
# Comprehensive testing for all exchange adapters with real-time monitoring
# Combines connection testing, stability analysis, and performance metrics

set -euo pipefail

# Ensure we're running with bash for associative array support
if [ -z "${BASH_VERSION:-}" ]; then
    exec bash "$0" "$@"
fi

# Source common debug utilities
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../utils/debug-common.sh"
source "$SCRIPT_DIR/../utils/parse-logs.sh"
source "$SCRIPT_DIR/../utils/cleanup.sh"

# Set up cleanup handlers
setup_cleanup_handlers

echo "🚀 FTSO Robust WebSocket Test & Stability Analysis"
echo "=================================================="

# Configuration with options
DEFAULT_DURATION=90
QUICK_MODE=false
EXTENDED_MODE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --quick|-q)
            QUICK_MODE=true
            TEST_DURATION=60
            shift
            ;;
        --extended|-e)
            EXTENDED_MODE=true
            TEST_DURATION=300
            shift
            ;;
        --duration|-d)
            TEST_DURATION="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --quick, -q          Quick test (60 seconds)"
            echo "  --extended, -e       Extended test (5 minutes)"
            echo "  --duration, -d SEC   Custom duration in seconds"
            echo "  --help, -h           Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Set default duration if not specified
TEST_DURATION=${TEST_DURATION:-$DEFAULT_DURATION}

if [ "$QUICK_MODE" = true ]; then
    echo "⚡ Quick mode: ${TEST_DURATION}s test"
elif [ "$EXTENDED_MODE" = true ]; then
    echo "🔍 Extended mode: ${TEST_DURATION}s comprehensive analysis"
else
    echo "⏱️  Standard mode: ${TEST_DURATION}s stability test"
fi

echo "🎯 Testing all exchange adapters for connection stability"
echo ""

PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Set up logging using common utility
echo "📝 Starting robust WebSocket test..."
setup_debug_logging "websocket-robust"
LOG_FILE="$DEBUG_LOG_FILE"
echo ""

# Initialize comprehensive tracking using simple counters
# Define all exchanges to monitor
EXCHANGES=("binance" "coinbase" "kraken" "okx" "cryptocom" "ccxt-multi-exchange")

# Initialize global counters for tracking
TOTAL_EXCHANGE_DISCONNECTS=0
TOTAL_EXCHANGE_RECONNECTS=0

# Start the application
echo "🚀 Starting application..."
cd "$PROJECT_ROOT"
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register for cleanup
register_pid "$APP_PID"
register_port 3101

echo "📝 Application started with PID: $APP_PID"
echo "⏱️  Waiting for initialization (15 seconds)..."

# Wait for application to start
sleep 15

# Check if application is running
if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "❌ Application failed to start"
    echo "📋 Startup logs:"
    tail -20 "$LOG_FILE"
    exit 1
fi

echo "✅ Application is running"
echo "🔍 Starting real-time monitoring for $TEST_DURATION seconds..."
echo ""

# Real-time monitoring with progress updates
MONITOR_START=$(date +%s)
MONITOR_END=$((MONITOR_START + TEST_DURATION))
LAST_PROGRESS_TIME=$MONITOR_START
PROGRESS_INTERVAL=15

# For extended mode, show more frequent updates
if [ "$EXTENDED_MODE" = true ]; then
    PROGRESS_INTERVAL=30
fi

while [ $(date +%s) -lt $MONITOR_END ]; do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
        echo "❌ Application stopped unexpectedly"
        break
    fi
    
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - MONITOR_START))
    REMAINING=$((MONITOR_END - CURRENT_TIME))
    
    # Progress update
    if [ $((ELAPSED % PROGRESS_INTERVAL)) -eq 0 ] && [ $CURRENT_TIME -gt $LAST_PROGRESS_TIME ]; then
        echo "⏱️  Progress: ${ELAPSED}s elapsed, ${REMAINING}s remaining"
        
        # Show live connection status in extended mode
        if [ "$EXTENDED_MODE" = true ] && [ $ELAPSED -gt 30 ]; then
            echo "   📊 Live status: $(grep -c "Connected to\|WebSocket connected" "$LOG_FILE" || echo 0) connections, $(grep -c "WebSocket closed\|disconnected" "$LOG_FILE" || echo 0) disconnects"
        fi
        
        LAST_PROGRESS_TIME=$CURRENT_TIME
    fi
    
    # Analyze recent log entries for real-time tracking
    RECENT_LOGS=$(tail -n 150 "$LOG_FILE" 2>/dev/null || echo "")
    
    # Monitor for real-time events in recent logs
    for exchange in "${EXCHANGES[@]}"; do
        # Check for new disconnections
        if echo "$RECENT_LOGS" | grep -q "WebSocket closed.*$exchange\|disconnected.*$exchange"; then
            DISCONNECT_COUNT=$(echo "$RECENT_LOGS" | grep -c "WebSocket closed.*$exchange\|disconnected.*$exchange" || echo 0)
            if [ $DISCONNECT_COUNT -gt 0 ]; then
                echo "⚠️  $exchange: disconnect detected at $(date '+%H:%M:%S')"
                TOTAL_EXCHANGE_DISCONNECTS=$((TOTAL_EXCHANGE_DISCONNECTS + 1))
            fi
        fi
        
        # Check for successful reconnections
        if echo "$RECENT_LOGS" | grep -q "Successfully reconnected.*$exchange\|Reconnected to $exchange\|Connected to $exchange"; then
            RECONNECT_COUNT=$(echo "$RECENT_LOGS" | grep -c "Successfully reconnected.*$exchange\|Reconnected to $exchange\|Connected to $exchange" || echo 0)
            if [ $RECONNECT_COUNT -gt 0 ]; then
                echo "✅ $exchange: connection/reconnection detected at $(date '+%H:%M:%S')"
                TOTAL_EXCHANGE_RECONNECTS=$((TOTAL_EXCHANGE_RECONNECTS + 1))
            fi
        fi
        
        # Check for errors
        if echo "$RECENT_LOGS" | grep -q "WebSocket.*error.*$exchange\|Connection.*failed.*$exchange"; then
            echo "❌ $exchange: error detected at $(date '+%H:%M:%S')"
        fi
    done
    
    sleep 5
done

echo ""
echo "🛑 Stopping application for comprehensive analysis..."
stop_tracked_apps

echo ""
echo "📊 ROBUST WEBSOCKET TEST RESULTS"
echo "================================="
echo ""

# Comprehensive analysis
if [ -f "$LOG_FILE" ]; then
    # Overall statistics
    echo "🔗 Overall Connection Statistics:"
    echo "--------------------------------"
    
    TOTAL_CONNECTIONS=$(grep -c "WebSocket connected for\|Connected to" "$LOG_FILE" 2>/dev/null || echo 0)
    TOTAL_DISCONNECTS=$(grep -c "WebSocket closed\|WebSocket connection closed" "$LOG_FILE" 2>/dev/null || echo 0)
    TOTAL_RECONNECTS=$(grep -c "Successfully reconnected\|Reconnected to" "$LOG_FILE" 2>/dev/null || echo 0)
    TOTAL_ERRORS=$(grep -c "WebSocket.*error\|Connection.*failed" "$LOG_FILE" 2>/dev/null || echo 0)
    TOTAL_SUBSCRIPTIONS=$(grep -c "Subscribed.*symbols\|Started WebSocket watching" "$LOG_FILE" 2>/dev/null || echo 0)
    
    # Ensure all variables are numeric
    TOTAL_CONNECTIONS=$(echo "$TOTAL_CONNECTIONS" | head -1 | grep -E '^[0-9]+$' || echo 0)
    TOTAL_DISCONNECTS=$(echo "$TOTAL_DISCONNECTS" | head -1 | grep -E '^[0-9]+$' || echo 0)
    TOTAL_RECONNECTS=$(echo "$TOTAL_RECONNECTS" | head -1 | grep -E '^[0-9]+$' || echo 0)
    TOTAL_ERRORS=$(echo "$TOTAL_ERRORS" | head -1 | grep -E '^[0-9]+$' || echo 0)
    TOTAL_SUBSCRIPTIONS=$(echo "$TOTAL_SUBSCRIPTIONS" | head -1 | grep -E '^[0-9]+$' || echo 0)
    
    echo "✅ Total successful connections: $TOTAL_CONNECTIONS"
    echo "❌ Total disconnections: $TOTAL_DISCONNECTS"
    echo "🔄 Total reconnections: $TOTAL_RECONNECTS"
    echo "⚠️  Total errors: $TOTAL_ERRORS"
    echo "📊 Total subscriptions: $TOTAL_SUBSCRIPTIONS"
    
    echo ""
    echo "📋 Exchange-by-Exchange Analysis:"
    echo "---------------------------------"
    
    STABLE_EXCHANGES=0
    UNSTABLE_EXCHANGES=0
    
    for exchange in "${EXCHANGES[@]}"; do
        # Get final counts from log file with proper error handling
        CONNECTIONS=$(grep -c "Connected to $exchange\|WebSocket connected for $exchange" "$LOG_FILE" 2>/dev/null || echo 0)
        DISCONNECTS=$(grep -c "WebSocket closed.*$exchange\|WebSocket connection closed.*$exchange" "$LOG_FILE" 2>/dev/null || echo 0)
        RECONNECTS=$(grep -c "Successfully reconnected.*$exchange\|Connection restored.*$exchange" "$LOG_FILE" 2>/dev/null || echo 0)
        ERRORS=$(grep -c "WebSocket.*error.*$exchange\|Connection.*failed.*$exchange" "$LOG_FILE" 2>/dev/null || echo 0)
        
        # Ensure variables are numeric and handle any non-numeric values
        CONNECTIONS=$(echo "$CONNECTIONS" | head -1 | grep -E '^[0-9]+$' || echo 0)
        DISCONNECTS=$(echo "$DISCONNECTS" | head -1 | grep -E '^[0-9]+$' || echo 0)
        RECONNECTS=$(echo "$RECONNECTS" | head -1 | grep -E '^[0-9]+$' || echo 0)
        ERRORS=$(echo "$ERRORS" | head -1 | grep -E '^[0-9]+$' || echo 0)
        
        # Determine stability status with safe numeric comparisons
        if [[ "$CONNECTIONS" =~ ^[0-9]+$ ]] && [[ "$DISCONNECTS" =~ ^[0-9]+$ ]] && [[ "$ERRORS" =~ ^[0-9]+$ ]] && [[ "$RECONNECTS" =~ ^[0-9]+$ ]]; then
            if [ "$CONNECTIONS" -gt 0 ] && [ "$DISCONNECTS" -eq 0 ] && [ "$ERRORS" -eq 0 ]; then
                STATUS="✅ STABLE"
                STABLE_EXCHANGES=$((STABLE_EXCHANGES + 1))
            elif [ "$CONNECTIONS" -gt 0 ] && [ "$DISCONNECTS" -le 2 ] && [ "$RECONNECTS" -ge "$DISCONNECTS" ]; then
                STATUS="⚠️  RECOVERABLE"
            elif [ "$CONNECTIONS" -eq 0 ]; then
                STATUS="❓ NO CONNECTION"
                UNSTABLE_EXCHANGES=$((UNSTABLE_EXCHANGES + 1))
            else
                STATUS="❌ UNSTABLE"
                UNSTABLE_EXCHANGES=$((UNSTABLE_EXCHANGES + 1))
            fi
        else
            STATUS="❓ PARSE ERROR"
            UNSTABLE_EXCHANGES=$((UNSTABLE_EXCHANGES + 1))
        fi
        
        printf "%-20s %s (C:%s D:%s R:%s E:%s)\n" "$exchange:" "$STATUS" "$CONNECTIONS" "$DISCONNECTS" "$RECONNECTS" "$ERRORS"
    done
    
    echo ""
    echo "🎯 Stability Assessment:"
    echo "------------------------"
    if [ ${#EXCHANGES[@]} -gt 0 ]; then
        STABILITY_PERCENTAGE=$(( (STABLE_EXCHANGES * 100) / ${#EXCHANGES[@]} ))
    else
        STABILITY_PERCENTAGE=0
    fi
    echo "✅ Stable exchanges: $STABLE_EXCHANGES/${#EXCHANGES[@]} ($STABILITY_PERCENTAGE%)"
    echo "❌ Unstable exchanges: $UNSTABLE_EXCHANGES/${#EXCHANGES[@]}"
    
    echo ""
    echo "🔍 Detailed Issue Analysis:"
    echo "---------------------------"
    
    # WebSocket close codes
    echo "📋 WebSocket Close Codes:"
    CLOSE_CODES=$(grep -E "WebSocket closed.*code.*[0-9]{4}" "$LOG_FILE" | tail -5)
    if [ -n "$CLOSE_CODES" ]; then
        echo "$CLOSE_CODES"
    else
        echo "   No specific close codes found"
    fi
    
    echo ""
    echo "📋 Critical Errors:"
    CRITICAL_ERRORS=$(grep -iE "(timeout|econnreset|enotfound|network.*error)" "$LOG_FILE" | tail -3)
    if [ -n "$CRITICAL_ERRORS" ]; then
        echo "$CRITICAL_ERRORS"
    else
        echo "   No critical network errors found"
    fi
    
    echo ""
    echo "📋 Authentication Issues:"
    AUTH_ISSUES=$(grep -iE "(auth.*error|unauthorized|forbidden|api.*key)" "$LOG_FILE" | tail -3)
    if [ -n "$AUTH_ISSUES" ]; then
        echo "$AUTH_ISSUES"
    else
        echo "   No authentication issues found"
    fi
    
    echo ""
    echo "📈 Performance Metrics:"
    echo "----------------------"
    
    # Calculate rates
    EVENTS_PER_MINUTE=$(( (TOTAL_CONNECTIONS + TOTAL_DISCONNECTS + TOTAL_RECONNECTS) * 60 / TEST_DURATION ))
    echo "📊 Events per minute: $EVENTS_PER_MINUTE"
    
    if [[ "$TOTAL_DISCONNECTS" =~ ^[0-9]+$ ]] && [ $TOTAL_DISCONNECTS -gt 0 ]; then
        RECONNECT_SUCCESS_RATE=$(( TOTAL_RECONNECTS * 100 / TOTAL_DISCONNECTS ))
        echo "🔄 Reconnection success rate: $RECONNECT_SUCCESS_RATE%"
    else
        echo "🔄 Reconnection success rate: N/A (no disconnects)"
    fi
    
    # Heartbeat analysis
    HEARTBEAT_COUNT=$(grep -c "ping\|heartbeat\|pong" "$LOG_FILE" || echo 0)
    echo "💓 Heartbeat messages: $HEARTBEAT_COUNT"
    
    echo ""
    echo "🏁 Final Test Assessment:"
    echo "------------------------"
    
    # Determine overall result
    if [ $STABILITY_PERCENTAGE -ge 85 ] && [ $TOTAL_DISCONNECTS -le 2 ]; then
        echo "✅ EXCELLENT: All exchange adapters are highly stable"
        EXIT_CODE=0
    elif [ $STABILITY_PERCENTAGE -ge 70 ] && [ $TOTAL_RECONNECTS -ge $TOTAL_DISCONNECTS ]; then
        echo "✅ GOOD: Exchange adapters are stable with good recovery"
        EXIT_CODE=0
    elif [ $STABILITY_PERCENTAGE -ge 50 ]; then
        echo "⚠️  ACCEPTABLE: Some stability issues but system is functional"
        EXIT_CODE=0
    else
        echo "❌ POOR: Significant stability issues require attention"
        EXIT_CODE=1
    fi
    
    echo "   📊 Overall stability: $STABILITY_PERCENTAGE%"
    echo "   ⏱️  Test duration: ${TEST_DURATION}s"
    if [[ "$TOTAL_DISCONNECTS" =~ ^[0-9]+$ ]] && [ $TOTAL_DISCONNECTS -gt 0 ]; then
        RECOVERY_RATE=$(( TOTAL_RECONNECTS * 100 / TOTAL_DISCONNECTS ))
        echo "   🔄 Recovery capability: ${RECOVERY_RATE}%"
    else
        echo "   🔄 Recovery capability: N/A"
    fi
    
else
    echo "❌ No log file found at $LOG_FILE"
    EXIT_CODE=1
fi

# Show log summary
log_summary "$LOG_FILE" "websockets" "debug"

echo ""
echo "✨ Robust WebSocket test complete!"
echo "📁 Full logs available at: $LOG_FILE"

exit $EXIT_CODE