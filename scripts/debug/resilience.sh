#!/bin/bash
# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"
source "$(dirname "$0")/../utils/parse-logs.sh"
source "$(dirname "$0")/../utils/cleanup.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Circuit Breaker & Resilience Debugging Script
# Tests circuit breakers, failover mechanisms, retry patterns, and recovery

echo "🛡️  FTSO Resilience & Circuit Breaker Debugger"
echo "=============================================="

# Ensure logs directory exists

# Configuration
TIMEOUT=120

# Set up logging using common utility
setup_debug_logging "resilience-debug"
LOG_FILE="$DEBUG_LOG_FILE"

echo "📝 Starting resilience system analysis..."

# Start the application in background with clean output capture
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring resilience systems for $TIMEOUT seconds..."

# Monitor for the specified timeout
sleep $TIMEOUT

# Check if process is still running
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ Application is running"
    echo "🛑 Stopping application for analysis..."
    stop_tracked_apps
else
    echo "❌ Application stopped unexpectedly"
fi

echo ""
echo "🛡️  Resilience System Analysis:"
echo "==============================="

if [ -f "$LOG_FILE" ]; then
    echo "🚀 System Initialization:"
    echo "-------------------------"
    
    # Circuit breaker initialization
    CB_REGISTRATIONS=$(grep -c "Registering circuit breaker\|Circuit breaker.*registered" "$LOG_FILE")
    echo "⚡ Circuit breakers registered: $CB_REGISTRATIONS"
    
    # Failover manager initialization
    FAILOVER_INIT=$(grep -c "FailoverManager.*initialized\|Failover.*initialized" "$LOG_FILE")
    echo "🔄 Failover managers initialized: $FAILOVER_INIT"
    
    # Retry service initialization
    RETRY_INIT=$(grep -c "UniversalRetryService.*initialized\|Retry.*service.*initialized" "$LOG_FILE")
    echo "🔁 Retry services initialized: $RETRY_INIT"
    
    echo ""
    echo "⚡ Circuit Breaker Analysis:"
    echo "---------------------------"
    
    # Circuit breaker state changes
    CB_OPENED=$(grep -c "Circuit breaker.*OPENED\|Circuit breaker.*OPEN" "$LOG_FILE")
    CB_CLOSED=$(grep -c "Circuit breaker.*CLOSED" "$LOG_FILE")
    CB_HALF_OPEN=$(grep -c "Circuit breaker.*HALF-OPEN\|Circuit breaker.*HALF_OPEN" "$LOG_FILE")
    
    echo "🔴 Circuit breakers opened: $CB_OPENED"
    echo "🟢 Circuit breakers closed: $CB_CLOSED"
    echo "🟡 Circuit breakers half-open: $CB_HALF_OPEN"
    
    # Circuit breaker services
    echo ""
    echo "Circuit breaker services:"
    grep -E "(Registering circuit breaker for service)" "$LOG_FILE" | head -10
    
    # Recent circuit breaker events
    if [ $((CB_OPENED + CB_CLOSED + CB_HALF_OPEN)) -gt 0 ]; then
        echo ""
        echo "Recent circuit breaker events:"
        grep -E "(Circuit breaker.*OPEN|Circuit breaker.*CLOSED|Circuit breaker.*HALF)" "$LOG_FILE" | tail -10
    fi
    
    # Circuit breaker health assessment
    echo ""
    echo "📊 Circuit Breaker Health:"
    if [ $CB_OPENED -eq 0 ]; then
        echo "✅ STABLE: No circuit breakers opened"
    elif [ $CB_OPENED -le 2 ]; then
        echo "⚠️  MINOR: Few circuit breaker trips"
    else
        echo "❌ CRITICAL: Frequent circuit breaker trips"
    fi
    
    echo ""
    echo "🔄 Failover Analysis:"
    echo "--------------------"
    
    # Failover events - exclude configuration messages
    FAILOVER_EVENTS=$(grep -c "Triggering.*failover\|Failover completed\|Failover failed" "$LOG_FILE")
    FAILOVER_CONFIG_EVENTS=$(grep -c "Configuring failover group" "$LOG_FILE")
    echo "🔄 Actual failover events: $FAILOVER_EVENTS"
    echo "⚙️  Failover configuration events: $FAILOVER_CONFIG_EVENTS"
    
    # Failover triggers
    MANUAL_FAILOVERS=$(grep -c "Triggering manual failover\|manual failover.*triggered" "$LOG_FILE")
    AUTO_FAILOVERS=$(grep -c "Triggering.*failover.*Connection lost\|automatic.*failover" "$LOG_FILE")
    
    echo "🔧 Manual failovers: $MANUAL_FAILOVERS"
    echo "🤖 Automatic failovers: $AUTO_FAILOVERS"
    
    # Failover groups
    echo ""
    echo "Failover group configurations:"
    grep -E "(Configuring failover group|failover group.*configured)" "$LOG_FILE" | head -5
    
    # Recent failover events
    if [ $FAILOVER_EVENTS -gt 0 ]; then
        echo ""
        echo "Recent failover events:"
        grep -E "(Failover|failover)" "$LOG_FILE" | tail -5
    fi
    
    echo ""
    echo "🔁 Retry Pattern Analysis:"
    echo "-------------------------"
    
    # Retry attempts - only count actual retry operations
    RETRY_ATTEMPTS=$(grep -c "Retry operation\|attempt.*failed.*Retrying\|executeWithRetry.*attempt" "$LOG_FILE")
    echo "🔁 Actual retry attempts: $RETRY_ATTEMPTS"
    
    # Successful retries
    SUCCESSFUL_RETRIES=$(grep -c "Retry operation succeeded\|retry.*completed successfully" "$LOG_FILE")
    echo "✅ Successful retries: $SUCCESSFUL_RETRIES"
    
    # Failed retries
    FAILED_RETRIES=$(grep -c "record_retry_failure\|retry.*exhausted\|retry.*failed after" "$LOG_FILE")
    echo "❌ Failed retries: $FAILED_RETRIES"
    
    # Retry success rate
    if [ $RETRY_ATTEMPTS -gt 0 ]; then
        RETRY_SUCCESS_RATE=$((SUCCESSFUL_RETRIES * 100 / RETRY_ATTEMPTS))
        echo "📈 Retry success rate: ${RETRY_SUCCESS_RATE}%"
        
        if [ $RETRY_SUCCESS_RATE -ge 80 ]; then
            echo "✅ Excellent retry effectiveness"
        elif [ $RETRY_SUCCESS_RATE -ge 60 ]; then
            echo "⚠️  Good retry effectiveness"
        else
            echo "❌ Poor retry effectiveness"
        fi
    fi
    
    # Retry patterns by service
    echo ""
    echo "Retry patterns by service:"
    grep -E "(retry.*service|Retry.*service)" "$LOG_FILE" | head -5
    
    echo ""
    echo "🔗 Connection Recovery Analysis:"
    echo "-------------------------------"
    
    # Connection recovery events
    CONNECTION_LOST=$(grep -c "Connection lost\|connection.*lost\|Connection.*failed" "$LOG_FILE")
    CONNECTION_RESTORED=$(grep -c "Connection restored\|connection.*restored\|Connection.*recovered" "$LOG_FILE")
    
    echo "📉 Connections lost: $CONNECTION_LOST"
    echo "📈 Connections restored: $CONNECTION_RESTORED"
    
    # Recovery success rate
    if [ $CONNECTION_LOST -gt 0 ]; then
        RECOVERY_RATE=$((CONNECTION_RESTORED * 100 / CONNECTION_LOST))
        echo "🔄 Recovery success rate: ${RECOVERY_RATE}%"
        
        if [ $RECOVERY_RATE -ge 90 ]; then
            echo "✅ Excellent recovery capability"
        elif [ $RECOVERY_RATE -ge 70 ]; then
            echo "⚠️  Good recovery capability"
        else
            echo "❌ Poor recovery capability"
        fi
    fi
    
    # Recovery timing
    echo ""
    echo "Connection recovery events:"
    grep -E "(Connection.*lost|Connection.*restored)" "$LOG_FILE" | tail -10
    
    echo ""
    echo "🏥 Health Check Analysis:"
    echo "------------------------"
    
    # Health check events
    HEALTH_CHECKS=$(grep -c "health.*check\|Health.*check" "$LOG_FILE")
    echo "🏥 Health checks performed: $HEALTH_CHECKS"
    
    # Health check failures
    HEALTH_FAILURES=$(grep -c "health.*check.*failed\|Health.*check.*failed" "$LOG_FILE")
    echo "❌ Health check failures: $HEALTH_FAILURES"
    
    # Health check success rate
    if [ $HEALTH_CHECKS -gt 0 ]; then
        HEALTH_SUCCESS_RATE=$(((HEALTH_CHECKS - HEALTH_FAILURES) * 100 / HEALTH_CHECKS))
        echo "📈 Health check success rate: ${HEALTH_SUCCESS_RATE}%"
    fi
    
    echo ""
    echo "🔧 Service Degradation Analysis:"
    echo "-------------------------------"
    
    # Degradation events
    DEGRADATION_EVENTS=$(grep -c "degradation\|Degradation\|degraded\|Degraded" "$LOG_FILE")
    echo "📉 Service degradation events: $DEGRADATION_EVENTS"
    
    # Graceful degradation
    GRACEFUL_DEGRADATION=$(grep -c "graceful.*degradation\|Graceful.*degradation" "$LOG_FILE")
    echo "🎯 Graceful degradation events: $GRACEFUL_DEGRADATION"
    
    if [ $DEGRADATION_EVENTS -gt 0 ]; then
        echo ""
        echo "Recent degradation events:"
        grep -E "(degradation|Degradation)" "$LOG_FILE" | tail -5
    fi
    
    echo ""
    echo "⏱️  Timeout Analysis:"
    echo "--------------------"
    
    # Timeout events
    TIMEOUT_EVENTS=$(grep -c "timeout\|Timeout\|timed out" "$LOG_FILE")
    echo "⏱️  Timeout events: $TIMEOUT_EVENTS"
    
    # Timeout types
    HTTP_TIMEOUTS=$(grep -c "http.*timeout\|HTTP.*timeout" "$LOG_FILE")
    WS_TIMEOUTS=$(grep -c "websocket.*timeout\|WebSocket.*timeout" "$LOG_FILE")
    DB_TIMEOUTS=$(grep -c "database.*timeout\|db.*timeout" "$LOG_FILE")
    
    echo "🌐 HTTP timeouts: $HTTP_TIMEOUTS"
    echo "🔌 WebSocket timeouts: $WS_TIMEOUTS"
    echo "💾 Database timeouts: $DB_TIMEOUTS"
    
    if [ $TIMEOUT_EVENTS -gt 0 ]; then
        echo ""
        echo "Recent timeout events:"
        grep -E "(timeout|Timeout)" "$LOG_FILE" | tail -5
    fi
    
    echo ""
    echo "🎯 Resilience Recommendations:"
    echo "=============================="
    
    # Provide recommendations based on analysis
    if [ $CB_OPENED -gt 5 ]; then
        echo "🔧 CIRCUIT BREAKER: High number of circuit breaker trips"
        echo "   - Review failure thresholds"
        echo "   - Check service dependencies"
        echo "   - Consider increasing timeout values"
    fi
    
    if [ $FAILOVER_EVENTS -gt 5 ]; then
        echo "🔧 FAILOVER: Frequent actual failover events"
        echo "   - Review primary service stability"
        echo "   - Check failover trigger sensitivity"
        echo "   - Validate backup service capacity"
    elif [ $FAILOVER_EVENTS -gt 2 ]; then
        echo "⚠️  FAILOVER: Some failover events detected"
        echo "   - Monitor primary service health"
        echo "   - Consider failover threshold tuning"
    elif [ $FAILOVER_CONFIG_EVENTS -gt 50 ]; then
        echo "ℹ️  INFO: Many failover groups configured (normal during startup)"
    fi
    
    if [ $RETRY_ATTEMPTS -gt 0 ] && [ $RETRY_SUCCESS_RATE -lt 60 ]; then
        echo "🔧 RETRY: Low retry success rate"
        echo "   - Review retry intervals and backoff"
        echo "   - Check underlying service issues"
        echo "   - Consider adaptive retry strategies"
    fi
    
    if [ $CONNECTION_LOST -gt 0 ] && [ $RECOVERY_RATE -lt 80 ]; then
        echo "🔧 RECOVERY: Poor connection recovery"
        echo "   - Review connection recovery logic"
        echo "   - Check network stability"
        echo "   - Validate recovery timeouts"
    fi
    
    if [ $TIMEOUT_EVENTS -gt 20 ]; then
        echo "🔧 TIMEOUTS: High number of timeout events"
        echo "   - Review timeout configurations"
        echo "   - Check network latency"
        echo "   - Consider increasing timeout values"
    fi
    
    if [ $HEALTH_FAILURES -gt 0 ] && [ $HEALTH_SUCCESS_RATE -lt 95 ]; then
        echo "🔧 HEALTH: Health check issues"
        echo "   - Review health check logic"
        echo "   - Check service availability"
        echo "   - Validate health check timeouts"
    fi
    
    # Overall resilience assessment
    echo ""
    echo "📊 Overall Resilience Health:"
    echo "============================"
    
    resilience_score=100
    
    if [ $CB_OPENED -gt 5 ]; then
        resilience_score=$((resilience_score - 20))
    fi
    
    if [ $FAILOVER_EVENTS -gt 5 ]; then
        resilience_score=$((resilience_score - 15))
    elif [ $FAILOVER_EVENTS -gt 2 ]; then
        resilience_score=$((resilience_score - 5))
    fi
    
    if [ $RETRY_ATTEMPTS -gt 0 ] && [ $RETRY_SUCCESS_RATE -lt 60 ]; then
        resilience_score=$((resilience_score - 15))
    fi
    
    if [ $TIMEOUT_EVENTS -gt 20 ]; then
        resilience_score=$((resilience_score - 10))
    fi
    
    if [ $resilience_score -ge 90 ]; then
        echo "🎉 EXCELLENT: Resilience systems are performing optimally (Score: $resilience_score/100)"
    elif [ $resilience_score -ge 75 ]; then
        echo "✅ GOOD: Resilience systems are performing well (Score: $resilience_score/100)"
    elif [ $resilience_score -ge 60 ]; then
        echo "⚠️  FAIR: Resilience systems need some attention (Score: $resilience_score/100)"
    else
        echo "❌ POOR: Resilience systems require immediate attention (Score: $resilience_score/100)"
    fi
    
else
    echo "❌ No log file found"
fi

# Show log summary
log_summary "$LOG_FILE" "resilience" "debug"

echo ""
echo "✨ Resilience analysis complete!"
echo "📁 Detailed logs available at: $LOG_FILE"