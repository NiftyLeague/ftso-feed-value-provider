#!/bin/bash

# Configuration & Environment Debugging Script
# Tests environment variables, configuration validation, and settings consistency

# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"

echo "⚙️  FTSO Configuration & Environment Debugger"
echo "============================================="

# Configuration
TIMEOUT=60

# Set up logging using common utility
setup_debug_logging "config-debug"
LOG_FILE="$DEBUG_LOG_FILE"
CONFIG_REPORT="$DEBUG_LOG_DIR/config-report.log"

echo "📝 Starting configuration analysis..."

# Initialize config report
echo "FTSO Configuration Analysis Report - $(date)" > "$CONFIG_REPORT"
echo "=============================================" >> "$CONFIG_REPORT"
echo "" >> "$CONFIG_REPORT"

# Start the application in background with clean output capture
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring configuration for $TIMEOUT seconds..."

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
echo "⚙️  Configuration Analysis:"
echo "=========================="

# Analyze .env file
echo "📄 Environment File Analysis:"
echo "-----------------------------"

if [ -f ".env" ]; then
    ENV_VARS=$(grep -c "^[A-Z]" .env)
    echo "📊 Environment variables defined: $ENV_VARS"
    
    # Log to report
    echo "Environment Variables: $ENV_VARS" >> "$CONFIG_REPORT"
    echo "" >> "$CONFIG_REPORT"
    
    # Check for common configuration categories
    PERFORMANCE_VARS=$(grep -c "PERFORMANCE\|MONITORING\|CACHE" .env)
    WEBSOCKET_VARS=$(grep -c "WEBSOCKET" .env)
    TIMEOUT_VARS=$(grep -c "TIMEOUT\|INTERVAL" .env)
    LOGGING_VARS=$(grep -c "LOG\|DEBUG" .env)
    
    echo "  🚀 Performance variables: $PERFORMANCE_VARS"
    echo "  🌐 WebSocket variables: $WEBSOCKET_VARS"
    echo "  ⏱️  Timeout variables: $TIMEOUT_VARS"
    echo "  📝 Logging variables: $LOGGING_VARS"
    
    # Check for empty or default values
    echo ""
    echo "🔍 Configuration Validation:"
    EMPTY_VARS=$(grep -c "=$" .env)
    echo "  ⚠️  Empty variables: $EMPTY_VARS"
    
    if [ $EMPTY_VARS -gt 0 ]; then
        echo "  Empty variables found:"
        grep "=$" .env | head -5
    fi
    
    # Check for API keys
    echo ""
    echo "🔑 API Key Configuration:"
    API_KEYS=$(grep -c "API_KEY\|SECRET" .env)
    echo "  🔑 API key variables: $API_KEYS"
    
    EMPTY_API_KEYS=$(grep -E "(API_KEY|SECRET)=$" .env | wc -l)
    echo "  ⚠️  Empty API keys: $EMPTY_API_KEYS"
    
    if [ $EMPTY_API_KEYS -gt 0 ]; then
        echo "  Note: Empty API keys will use public endpoints"
    fi
    
else
    echo "❌ No .env file found"
    echo "Environment File: NOT FOUND" >> "$CONFIG_REPORT"
fi

# Analyze application logs for configuration issues
if [ -f "$LOG_FILE" ]; then
    echo ""
    echo "📊 Application Configuration Analysis:"
    echo "------------------------------------"
    
    # Configuration loading
    CONFIG_LOADED=$(grep -c "Configuration.*loaded\|Config.*loaded" "$LOG_FILE" 2>/dev/null)
    CONFIG_LOADED=${CONFIG_LOADED:-0}
    echo "✅ Configuration loading events: $CONFIG_LOADED"
    
    # Configuration updates
    CONFIG_UPDATES=$(grep -c "Configuration updated successfully" "$LOG_FILE" 2>/dev/null)
    CONFIG_UPDATES=${CONFIG_UPDATES:-0}
    echo "🔄 Configuration updates: $CONFIG_UPDATES"
    
    # Environment validation
    ENV_VALIDATION=$(grep -c "Environment validation passed" "$LOG_FILE" 2>/dev/null)
    ENV_VALIDATION=${ENV_VALIDATION:-0}
    echo "✅ Environment validation: $ENV_VALIDATION"
    
    if [ $ENV_VALIDATION -eq 0 ]; then
        echo "⚠️  No environment validation detected"
    fi
    
    # Log to report
    echo "Configuration Events:" >> "$CONFIG_REPORT"
    echo "- Loading events: $CONFIG_LOADED" >> "$CONFIG_REPORT"
    echo "- Updates: $CONFIG_UPDATES" >> "$CONFIG_REPORT"
    echo "- Validation: $ENV_VALIDATION" >> "$CONFIG_REPORT"
    echo "" >> "$CONFIG_REPORT"
    
    echo ""
    echo "🔧 Service Configuration Analysis:"
    echo "---------------------------------"
    
    # Service configuration updates
    SERVICES=("RateLimiterService" "RealTimeCacheService" "ConsensusAggregator" "CircuitBreakerService" "AlertingService")
    
    for service in "${SERVICES[@]}"; do
        SERVICE_CONFIG=$(grep -c "$service.*Configuration updated successfully" "$LOG_FILE" 2>/dev/null)
        SERVICE_CONFIG=${SERVICE_CONFIG:-0}
        if [ "$SERVICE_CONFIG" -gt 0 ]; then
            echo "  ✅ $service: $SERVICE_CONFIG updates"
        else
            echo "  ❌ $service: No configuration updates"
        fi
    done
    
    echo ""
    echo "📏 Configuration Values Analysis:"
    echo "--------------------------------"
    
    # Extract configuration values from logs
    echo "Key configuration values detected:"
    
    # Cache configuration
    CACHE_TTL=$(grep -o "ttl: [0-9]*" "$LOG_FILE" | head -1)
    CACHE_SIZE=$(grep -o "maxSize: [0-9]*" "$LOG_FILE" | head -1)
    
    if [ -n "$CACHE_TTL" ]; then
        echo "  💾 Cache $CACHE_TTL"
    fi
    
    if [ -n "$CACHE_SIZE" ]; then
        echo "  💾 Cache $CACHE_SIZE"
    fi
    
    # WebSocket configuration
    WS_PING=$(grep -o "pingInterval: [0-9]*" "$LOG_FILE" | head -1)
    WS_TIMEOUT=$(grep -o "pongTimeout: [0-9]*" "$LOG_FILE" | head -1)
    
    if [ -n "$WS_PING" ]; then
        echo "  🌐 WebSocket $WS_PING"
    fi
    
    if [ -n "$WS_TIMEOUT" ]; then
        echo "  🌐 WebSocket $WS_TIMEOUT"
    fi
    
    # Performance configuration
    PERF_INTERVAL=$(grep -o "optimizationInterval: [0-9]*" "$LOG_FILE" | head -1)
    MONITORING_INTERVAL=$(grep -o "monitoringInterval: [0-9]*" "$LOG_FILE" | head -1)
    
    if [ -n "$PERF_INTERVAL" ]; then
        echo "  📈 Performance $PERF_INTERVAL"
    fi
    
    if [ -n "$MONITORING_INTERVAL" ]; then
        echo "  📊 Monitoring $MONITORING_INTERVAL"
    fi
    
    echo ""
    echo "⚠️  Configuration Warnings & Errors:"
    echo "-----------------------------------"
    
    # Configuration warnings
    CONFIG_WARNINGS=$(grep -c "configuration.*warning\|Configuration.*warning\|config.*warn" "$LOG_FILE" 2>/dev/null)
    CONFIG_WARNINGS=${CONFIG_WARNINGS:-0}
    echo "⚠️  Configuration warnings: $CONFIG_WARNINGS"
    
    # Configuration errors
    CONFIG_ERRORS=$(grep -c "configuration.*error\|Configuration.*error\|config.*error" "$LOG_FILE" 2>/dev/null)
    CONFIG_ERRORS=${CONFIG_ERRORS:-0}
    echo "❌ Configuration errors: $CONFIG_ERRORS"
    
    # Value validation issues
    VALUE_ISSUES=$(grep -c "above maximum\|below minimum\|invalid.*value" "$LOG_FILE" 2>/dev/null)
    VALUE_ISSUES=${VALUE_ISSUES:-0}
    echo "📏 Value validation issues: $VALUE_ISSUES"
    
    if [ $VALUE_ISSUES -gt 0 ]; then
        echo ""
        echo "Value validation issues found:"
        grep -E "(above maximum|below minimum|invalid.*value)" "$LOG_FILE" | head -5
    fi
    
    # Missing configuration
    MISSING_CONFIG=$(grep -c "missing.*config\|Missing.*config\|config.*not.*found" "$LOG_FILE" 2>/dev/null)
    MISSING_CONFIG=${MISSING_CONFIG:-0}
    echo "❓ Missing configuration: $MISSING_CONFIG"
    
    if [ $CONFIG_WARNINGS -gt 0 ] || [ $CONFIG_ERRORS -gt 0 ]; then
        echo ""
        echo "Recent configuration issues:"
        grep -E "(configuration.*warning|Configuration.*error|config.*error)" "$LOG_FILE" | tail -5
    fi
    
    echo ""
    echo "🔍 Feed Configuration Analysis:"
    echo "------------------------------"
    
    # Feed configuration loading
    FEED_CONFIG=$(grep -c "feed.*configuration\|Feed.*configuration" "$LOG_FILE" 2>/dev/null)
    FEED_CONFIG=${FEED_CONFIG:-0}
    echo "📊 Feed configuration events: $FEED_CONFIG"
    
    # Feed validation
    FEED_VALIDATION=$(grep -c "feed.*validation\|Feed.*validation" "$LOG_FILE" 2>/dev/null)
    FEED_VALIDATION=${FEED_VALIDATION:-0}
    echo "✅ Feed validation events: $FEED_VALIDATION"
    
    # Feed count
    CONFIGURED_FEEDS=$(grep -o "Found [0-9]* feed configurations" "$LOG_FILE" 2>/dev/null | grep -o "[0-9]*" | head -1)
    CONFIGURED_FEEDS=${CONFIGURED_FEEDS:-0}
    if [ "$CONFIGURED_FEEDS" -gt 0 ]; then
        echo "📊 Configured feeds: $CONFIGURED_FEEDS"
    fi
    
    # Feed mapping
    FEED_MAPPING=$(grep -c "Mapped feed.*to.*exchanges" "$LOG_FILE" 2>/dev/null)
    FEED_MAPPING=${FEED_MAPPING:-0}
    echo "🗺️  Feed mappings: $FEED_MAPPING"
    
    echo ""
    echo "🔌 Exchange Configuration Analysis:"
    echo "----------------------------------"
    
    # Exchange adapter verification
    ADAPTER_VERIFICATION=$(grep -c "Exchange adapter.*available" "$LOG_FILE" 2>/dev/null)
    ADAPTER_VERIFICATION=${ADAPTER_VERIFICATION:-0}
    echo "🔌 Exchange adapters verified: $ADAPTER_VERIFICATION"
    
    # Exchange initialization
    EXCHANGE_INIT=$(grep -c "Successfully initialized.*exchange" "$LOG_FILE" 2>/dev/null)
    EXCHANGE_INIT=${EXCHANGE_INIT:-0}
    echo "✅ Exchange initializations: $EXCHANGE_INIT"
    
    # Exchange configuration issues
    EXCHANGE_ISSUES=$(grep -c "exchange.*configuration.*error\|Exchange.*configuration.*error" "$LOG_FILE" 2>/dev/null)
    EXCHANGE_ISSUES=${EXCHANGE_ISSUES:-0}
    echo "❌ Exchange configuration issues: $EXCHANGE_ISSUES"
    
    if [ $EXCHANGE_ISSUES -gt 0 ]; then
        echo ""
        echo "Exchange configuration issues:"
        grep -E "(exchange.*configuration.*error|Exchange.*configuration.*error)" "$LOG_FILE" | head -3
    fi
    
    echo ""
    echo "🎯 Configuration Recommendations:"
    echo "================================"
    
    # Provide recommendations based on analysis
    if [ $CONFIG_ERRORS -gt 0 ]; then
        echo "🔧 ERRORS: Configuration errors detected"
        echo "   - Review error messages above"
        echo "   - Validate configuration files"
        echo "   - Check environment variable syntax"
    fi
    
    if [ $VALUE_ISSUES -gt 0 ]; then
        echo "🔧 VALUES: Configuration value issues"
        echo "   - Review min/max value constraints"
        echo "   - Check environment variable types"
        echo "   - Validate numeric configurations"
    fi
    
    if [ $EMPTY_API_KEYS -gt 5 ]; then
        echo "🔧 API KEYS: Many empty API keys"
        echo "   - Consider adding API keys for better rate limits"
        echo "   - Review exchange API documentation"
        echo "   - Test with public endpoints first"
    fi
    
    if [ $ENV_VALIDATION -eq 0 ]; then
        echo "🔧 VALIDATION: No environment validation detected"
        echo "   - Verify environment validation is enabled"
        echo "   - Check validation service initialization"
        echo "   - Review startup sequence"
    fi
    
    if [ "$CONFIGURED_FEEDS" -lt 10 ] && [ "$CONFIGURED_FEEDS" -gt 0 ]; then
        echo "🔧 FEEDS: Low number of configured feeds"
        echo "   - Review feeds.json configuration"
        echo "   - Verify feed definitions"
        echo "   - Check feed validation logic"
    fi
    
    if [ "$EXCHANGE_INIT" -lt 5 ]; then
        echo "🔧 EXCHANGES: Few exchanges initialized"
        echo "   - Review exchange adapter configuration"
        echo "   - Check exchange connectivity"
        echo "   - Validate exchange credentials"
    fi
    
    # Overall configuration assessment
    echo ""
    echo "📊 Overall Configuration Health:"
    echo "==============================="
    
    config_score=100
    
    if [ "$CONFIG_ERRORS" -gt 0 ]; then
        config_score=$((config_score - 30))
    fi
    
    if [ "$VALUE_ISSUES" -gt 0 ]; then
        config_score=$((config_score - 20))
    fi
    
    if [ "$CONFIG_WARNINGS" -gt 5 ]; then
        config_score=$((config_score - 15))
    fi
    
    if [ "$ENV_VALIDATION" -eq 0 ]; then
        config_score=$((config_score - 10))
    fi
    
    if [ "$EXCHANGE_ISSUES" -gt 0 ]; then
        config_score=$((config_score - 15))
    fi
    
    # Log final assessment to report
    echo "ASSESSMENT" >> "$CONFIG_REPORT"
    echo "==========" >> "$CONFIG_REPORT"
    echo "Configuration Score: $config_score/100" >> "$CONFIG_REPORT"
    echo "Errors: $CONFIG_ERRORS" >> "$CONFIG_REPORT"
    echo "Warnings: $CONFIG_WARNINGS" >> "$CONFIG_REPORT"
    echo "Value Issues: $VALUE_ISSUES" >> "$CONFIG_REPORT"
    echo "Exchange Issues: $EXCHANGE_ISSUES" >> "$CONFIG_REPORT"
    
    if [ "$config_score" -ge 90 ]; then
        echo "🎉 EXCELLENT: Configuration is optimal (Score: $config_score/100)"
        echo "Status: EXCELLENT" >> "$CONFIG_REPORT"
    elif [ "$config_score" -ge 75 ]; then
        echo "✅ GOOD: Configuration is well set up (Score: $config_score/100)"
        echo "Status: GOOD" >> "$CONFIG_REPORT"
    elif [ "$config_score" -ge 60 ]; then
        echo "⚠️  FAIR: Configuration needs some attention (Score: $config_score/100)"
        echo "Status: NEEDS ATTENTION" >> "$CONFIG_REPORT"
    else
        echo "❌ POOR: Configuration requires immediate attention (Score: $config_score/100)"
        echo "Status: CRITICAL" >> "$CONFIG_REPORT"
    fi
    
else
    echo "❌ No application log file found"
fi

echo ""
echo "✨ Configuration analysis complete!"
echo "📁 Results available at:"
echo "   - Detailed logs: $LOG_FILE"
echo "   - Configuration report: $CONFIG_REPORT"