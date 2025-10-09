#!/bin/bash

# Cache System Debugging Script
# Tests cache performance, hit rates, warming effectiveness, and memory usage

# Source common utilities
source "$(dirname "$0")/../utils/debug-common.sh"
source "$(dirname "$0")/../utils/parse-logs.sh"
source "$(dirname "$0")/../utils/cleanup.sh"

# Set up cleanup handlers
setup_cleanup_handlers

echo "💾 FTSO Cache System Debugger"
echo "============================="

# Configuration

# Set up logging using common utility

setup_debug_logging "cache-debug"
LOG_FILE="$DEBUG_LOG_FILE"


# Start the application using shared cleanup system
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo "🚀 Application started with PID: $APP_PID"

# Wait for service to become ready
source "$(dirname "$0")/../utils/readiness-utils.sh"

if wait_for_debug_service_readiness; then
    # Service is ready, proceed with cache testing
    :
else
    stop_tracked_apps
    exit 1
fi

# Make comprehensive test requests to generate cache activity
echo "🧪 Generating cache activity with comprehensive test requests..."

# Test 1: Initial requests (cache misses expected)
echo "📊 Phase 1: Initial requests (cache misses expected)"
for i in {1..3}; do
    echo "Making initial request $i..."
    if curl -X POST http://localhost:3101/feed-values \
         -H "Content-Type: application/json" \
         -d '{"feeds":[{"category":1,"name":"BTC/USD"},{"category":1,"name":"ETH/USD"}]}' \
         --max-time 10 --silent > /dev/null 2>&1; then
        echo "✅ Initial request $i succeeded"
    else
        echo "❌ Initial request $i failed"
    fi
    # Brief pause between requests
    sleep 0.5
done

# Test 2: Rapid repeated requests (cache hits expected)
echo "📊 Phase 2: Rapid repeated requests (cache hits expected)"
for i in {1..5}; do
    echo "Making rapid request $i..."
    if curl -X POST http://localhost:3101/feed-values \
         -H "Content-Type: application/json" \
         -d '{"feeds":[{"category":1,"name":"BTC/USD"},{"category":1,"name":"ETH/USD"}]}' \
         --max-time 10 --silent > /dev/null 2>&1; then
        echo "✅ Rapid request $i succeeded"
    else
        echo "❌ Rapid request $i failed"
    fi
    # Very short delay to test cache hits - use minimal wait
    if ! wait_for_service_health "http://localhost:3101" 1 500 500; then
        echo "⚠️  Service health check failed during rapid requests"
    fi
done

# Test 3: Different feeds (new cache entries)
echo "📊 Phase 3: Different feeds (new cache entries)"
for i in {1..2}; do
    echo "Making different feeds request $i..."
    if curl -X POST http://localhost:3101/feed-values \
         -H "Content-Type: application/json" \
         -d '{"feeds":[{"category":1,"name":"ADA/USD"},{"category":1,"name":"DOT/USD"}]}' \
         --max-time 10 --silent > /dev/null 2>&1; then
        echo "✅ Different feeds request $i succeeded"
    else
        echo "❌ Different feeds request $i failed"
    fi
    # Brief pause between different feed requests
    sleep 0.5
done

# Test 4: Cache expiration test
echo "📊 Phase 4: Cache expiration test (wait for TTL)"
echo "Waiting for cache TTL to expire..."
# Wait for cache to expire by checking if responses change
wait_count=0
max_wait=8
while [ $wait_count -lt $max_wait ]; do
    if check_service_json_response "http://localhost:3101/metrics" 1000; then
        echo "Cache should have expired after ${wait_count} seconds"
        break
    fi
    sleep 1
    wait_count=$((wait_count + 1))
done

echo "Making post-expiration request..."
if curl -X POST http://localhost:3101/feed-values \
     -H "Content-Type: application/json" \
     -d '{"feeds":[{"category":1,"name":"BTC/USD"},{"category":1,"name":"ETH/USD"}]}' \
     --max-time 10 --silent > /dev/null 2>&1; then
    echo "✅ Post-expiration request succeeded"
else
    echo "❌ Post-expiration request failed"
fi

# Continue monitoring for remaining time
STARTUP_TIME=45  # 15 initial + up to 30 for readiness check + 10 for requests
REMAINING_TIME=$((TIMEOUT - STARTUP_TIME))
if [ $REMAINING_TIME -gt 0 ]; then
    echo "⏱️  Continuing cache analysis..."
    # Monitor service health during remaining time
    monitor_count=0
    while [ $monitor_count -lt $REMAINING_TIME ]; do
        # Just sleep, no need for health checks during monitoring
        sleep 1
        monitor_count=$((monitor_count + 1))
    done
fi

# Check if process is still running
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ Application is running"
    echo "🛑 Stopping application for analysis..."
    stop_tracked_apps
else
    echo "❌ Application stopped unexpectedly"
fi

echo ""
echo "💾 Cache System Analysis:"
echo "========================="

if [ -f "$LOG_FILE" ]; then
    echo "🚀 Cache Initialization:"
    echo "------------------------"
    
    # Cache service startup
    CACHE_INIT=$(grep -c "RealTimeCacheService.*initialized\|Cache.*initialized" "$LOG_FILE")
    echo "✅ Cache services initialized: $CACHE_INIT"
    
    # Cache configuration
    echo ""
    echo "⚙️  Cache Configuration:"
    echo "-----------------------"
    grep -E "(Cache.*configuration|ttl:|maxSize:|evictionPolicy:)" "$LOG_FILE" | head -10
    
    echo ""
    echo "📊 Cache Performance Metrics:"
    echo "-----------------------------"
    
    # Cache hit rates - look for actual cache operations and API activity
    CACHE_HITS=$(grep -c "Cache hit for\|cache hit\|Cache.*hit\|source.*cache" "$LOG_FILE")
    CACHE_MISSES=$(grep -c "cache miss\|Cache.*miss\|fresh aggregated price\|Aggregated price for\|source.*aggregated\|source.*fallback" "$LOG_FILE")
    API_REQUESTS=$(grep -c "POST.*feed-values\|feed-values.*POST\|getCurrentFeedValues\|Processing.*feeds" "$LOG_FILE")
    FEED_PROCESSING=$(grep -c "Processed.*feeds\|feed.*succeeded\|feed.*failed" "$LOG_FILE")
    TOTAL_CACHE_REQUESTS=$((CACHE_HITS + CACHE_MISSES))
    
    echo "🎯 Cache hits: $CACHE_HITS"
    echo "❌ Cache misses: $CACHE_MISSES"
    echo "📊 Total cache operations: $TOTAL_CACHE_REQUESTS"
    echo "🌐 API requests processed: $API_REQUESTS"
    echo "🔄 Feed processing events: $FEED_PROCESSING"
    
    # Initialize HIT_RATE to avoid unary operator errors
    HIT_RATE=0
    
    if [ $TOTAL_CACHE_REQUESTS -gt 0 ]; then
        HIT_RATE=$((CACHE_HITS * 100 / TOTAL_CACHE_REQUESTS))
        echo "📈 Hit rate: ${HIT_RATE}%"
        
        if [ $HIT_RATE -ge 90 ]; then
            echo "✅ Excellent cache performance"
        elif [ $HIT_RATE -ge 70 ]; then
            echo "⚠️  Good cache performance"
        else
            echo "❌ Poor cache performance - needs optimization"
        fi
    else
        echo "⚠️  No cache metrics available"
    fi
    
    echo ""
    echo "🔥 Cache Warming Analysis:"
    echo "-------------------------"
    
    # Cache warming events
    WARMING_EVENTS=$(grep -c "Cache.*warming\|warming.*cache\|Cache.*warmer" "$LOG_FILE")
    echo "🔥 Cache warming events: $WARMING_EVENTS"
    
    # Warming strategies
    echo ""
    echo "Cache warming strategies:"
    grep -E "(warming.*strategy|Cache.*strategy)" "$LOG_FILE" | head -5
    
    # Warming effectiveness
    AGGRESSIVE_WARMING=$(grep -c "aggressive.*warming\|Aggressive.*warming" "$LOG_FILE")
    PREDICTIVE_WARMING=$(grep -c "predictive.*warming\|Predictive.*warming" "$LOG_FILE")
    MAINTENANCE_WARMING=$(grep -c "maintenance.*warming\|Maintenance.*warming" "$LOG_FILE")
    
    echo ""
    echo "📊 Warming strategy usage:"
    echo "  🔥 Aggressive: $AGGRESSIVE_WARMING events"
    echo "  🔮 Predictive: $PREDICTIVE_WARMING events"
    echo "  🔧 Maintenance: $MAINTENANCE_WARMING events"
    
    echo ""
    echo "💾 Memory Usage Analysis:"
    echo "------------------------"
    
    # Cache memory usage
    grep -E "(cache.*memory|Cache.*memory|cache.*size|Cache.*size)" "$LOG_FILE" | head -5
    
    # Cache size optimizations
    SIZE_OPTIMIZATIONS=$(grep -c "cache.*size.*optimized\|Cache.*size.*optimized\|Increased cache size" "$LOG_FILE")
    echo "📈 Cache size optimizations: $SIZE_OPTIMIZATIONS"
    
    if [ $SIZE_OPTIMIZATIONS -gt 10 ]; then
        echo "⚠️  Frequent cache resizing - may indicate suboptimal initial sizing"
    elif [ $SIZE_OPTIMIZATIONS -gt 0 ]; then
        echo "✅ Adaptive cache sizing working"
    else
        echo "📊 Static cache sizing"
    fi
    
    echo ""
    echo "🗑️  Cache Eviction Analysis:"
    echo "----------------------------"
    
    # Eviction events
    EVICTION_EVENTS=$(grep -c "evict\|Evict\|eviction\|Eviction" "$LOG_FILE")
    echo "🗑️  Eviction events: $EVICTION_EVENTS"
    
    # Eviction reasons
    echo ""
    echo "Eviction patterns:"
    grep -E "(evict|Evict)" "$LOG_FILE" | head -3
    
    if [ $EVICTION_EVENTS -gt 100 ]; then
        echo "⚠️  High eviction rate - consider increasing cache size"
    elif [ $EVICTION_EVENTS -gt 0 ]; then
        echo "✅ Normal eviction activity"
    else
        echo "📊 No evictions detected"
    fi
    
    echo ""
    echo "⚡ Cache Performance Optimization:"
    echo "--------------------------------"
    
    # Performance optimization events
    PERF_OPTIMIZATIONS=$(grep -c "Cache.*optimized\|cache.*optimized\|efficiency score" "$LOG_FILE")
    echo "⚡ Performance optimizations: $PERF_OPTIMIZATIONS"
    
    # Show recent optimizations
    echo ""
    echo "Recent optimizations:"
    grep -E "(Cache.*optimized|efficiency score)" "$LOG_FILE" | tail -5
    
    echo ""
    echo "🔍 Cache Issues & Warnings:"
    echo "--------------------------"
    
    # Cache-related errors
    CACHE_ERRORS=$(grep -c "cache.*error\|Cache.*error\|cache.*failed\|Cache.*failed" "$LOG_FILE")
    echo "❌ Cache errors: $CACHE_ERRORS"
    
    # Cache warnings
    CACHE_WARNINGS=$(grep -c "cache.*warn\|Cache.*warn" "$LOG_FILE")
    echo "⚠️  Cache warnings: $CACHE_WARNINGS"
    
    if [ $CACHE_ERRORS -gt 0 ]; then
        echo ""
        echo "Recent cache errors:"
        grep -E "(cache.*error|Cache.*error)" "$LOG_FILE" | tail -3
    fi
    
    echo ""
    echo "📈 Cache Efficiency Trends:"
    echo "--------------------------"
    
    # Extract efficiency scores
    echo "Efficiency score progression:"
    grep -o "efficiency score: [0-9.]*%" "$LOG_FILE" | tail -10
    
    echo ""
    echo "🎯 Cache Recommendations:"
    echo "========================"
    
    # Check for data source health issues
    UNHEALTHY_SOURCES=$(grep -c "marked as unhealthy\|is unhealthy" "$LOG_FILE")
    CIRCUIT_BREAKER_OPENS=$(grep -c "Circuit breaker OPENED" "$LOG_FILE")
    
    if [ $UNHEALTHY_SOURCES -gt 0 ]; then
        echo "🔧 CRITICAL: Data source health issues detected"
        echo "   - $UNHEALTHY_SOURCES data sources marked as unhealthy"
        echo "   - $CIRCUIT_BREAKER_OPENS circuit breakers opened"
        echo "   - This prevents cache activity - fix data pipeline first"
        echo "   - Check WebSocket connections and data flow"
        echo "   - Review data source update intervals"
    fi
    
    # Provide recommendations based on analysis
    if [ $HIT_RATE -lt 70 ] && [ $TOTAL_CACHE_REQUESTS -gt 0 ]; then
        echo "🔧 RECOMMENDATION: Improve cache hit rate"
        echo "   - Consider increasing cache TTL"
        echo "   - Review cache warming strategies"
        echo "   - Analyze access patterns"
    elif [ $TOTAL_CACHE_REQUESTS -eq 0 ] && [ $UNHEALTHY_SOURCES -eq 0 ]; then
        echo "🔧 RECOMMENDATION: Generate cache activity"
        echo "   - Make API requests to test cache functionality"
        echo "   - Verify application endpoints are accessible"
        echo "   - Check if cache warming is working"
    fi
    
    if [ $SIZE_OPTIMIZATIONS -gt 20 ]; then
        echo "🔧 RECOMMENDATION: Optimize initial cache sizing"
        echo "   - Increase initial cache size"
        echo "   - Review memory allocation"
    fi
    
    if [ $EVICTION_EVENTS -gt 200 ]; then
        echo "🔧 RECOMMENDATION: Reduce cache pressure"
        echo "   - Increase cache size limits"
        echo "   - Optimize eviction policies"
        echo "   - Review data retention policies"
    fi
    
    if [ $CACHE_ERRORS -gt 0 ]; then
        echo "🔧 RECOMMENDATION: Address cache errors"
        echo "   - Review error logs above"
        echo "   - Check memory availability"
        echo "   - Validate cache configuration"
    fi
    
    if [ $PERF_OPTIMIZATIONS -eq 0 ]; then
        echo "🔧 RECOMMENDATION: Enable performance monitoring"
        echo "   - Verify performance optimization is enabled"
        echo "   - Check monitoring intervals"
    fi
    
    # Overall assessment
    echo ""
    echo "📊 Overall Cache Health:"
    echo "======================="
    
    issues=0
    
    # Check for critical data source issues first
    if [ $UNHEALTHY_SOURCES -gt 0 ]; then
        echo "❌ CRITICAL: Data pipeline issues preventing cache operation"
        echo "   - Fix data source health issues before evaluating cache performance"
        echo "   - $UNHEALTHY_SOURCES unhealthy data sources detected"
        echo "   - Cache cannot function properly without healthy data sources"
    else
    
    if [ $HIT_RATE -lt 70 ] && [ $TOTAL_CACHE_REQUESTS -gt 0 ]; then
        issues=$((issues + 1))
    fi
    
    if [ $CACHE_ERRORS -gt 0 ]; then
        issues=$((issues + 1))
    fi
    
    if [ $SIZE_OPTIMIZATIONS -gt 20 ]; then
        issues=$((issues + 1))
    fi
    
    # Special case: no cache activity but no data source issues
    if [ $TOTAL_CACHE_REQUESTS -eq 0 ] && [ $CACHE_REQUESTS -gt 0 ]; then
        echo "⚠️  FAIR: Cache system ready but no activity detected"
        echo "   - Application processed $CACHE_REQUESTS API requests"
        echo "   - Cache infrastructure is healthy but unused"
        echo "   - Consider testing with actual API calls"
    elif [ $TOTAL_CACHE_REQUESTS -eq 0 ] && [ $CACHE_REQUESTS -eq 0 ]; then
        echo "⚠️  FAIR: Cache system idle - no requests processed"
        echo "   - Cache infrastructure appears healthy"
        echo "   - No API requests detected during monitoring period"
        echo "   - Test with actual API calls to verify functionality"
    elif [ $issues -eq 0 ]; then
        echo "🎉 EXCELLENT: Cache system is performing optimally"
    elif [ $issues -eq 1 ]; then
        echo "✅ GOOD: Cache system is performing well with minor issues"
    elif [ $issues -eq 2 ]; then
        echo "⚠️  FAIR: Cache system needs some optimization"
    else
        echo "❌ POOR: Cache system requires immediate attention"
    fi
    fi
    
else
    echo "❌ No log file found"
fi

# Clean up old logs if in session mode
cleanup_old_logs "cache"

# Show log summary
log_summary "$LOG_FILE" "cache" "debug"

echo ""
echo "✨ Cache analysis complete!"