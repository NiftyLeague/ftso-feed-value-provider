#!/bin/bash

# Source common utilities
source "$(dirname "$0")/../utils/debug-common.sh"
source "$(dirname "$0")/../utils/cleanup-common.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Performance Monitoring and Analysis Script
# Monitors system performance, memory usage, and response times

echo "📈 FTSO Performance Monitor"
echo "=========================="

# Ensure logs directory exists

# Configuration
TIMEOUT=120

# Set up logging using common utility
setup_debug_logging "performance-debug"
LOG_FILE="$DEBUG_LOG_FILE"
METRICS_FILE="$DEBUG_LOG_DIR/performance-metrics.log"

echo "📝 Starting performance monitoring..."
echo "📊 Main log: $LOG_FILE"
echo "📊 Metrics log: $METRICS_FILE"

# Start the application manually and register it
pnpm start:dev 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring performance for $TIMEOUT seconds..."

# Initialize metrics log
echo "timestamp,cpu_percent,memory_mb,memory_percent,response_time_ms" > "$METRICS_FILE"

# Monitor system metrics
MONITOR_INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    if ! kill -0 $APP_PID 2>/dev/null; then
        echo "❌ Application stopped unexpectedly"
        break
    fi
    
    # Get system metrics
    TIMESTAMP=$(date +%s)
    
    # CPU usage (macOS compatible)
    CPU_PERCENT=$(ps -p $APP_PID -o %cpu= 2>/dev/null | tr -d ' ' || echo "0")
    
    # Memory usage (macOS compatible)
    MEMORY_KB=$(ps -p $APP_PID -o rss= 2>/dev/null | tr -d ' ' || echo "0")
    MEMORY_MB=$((MEMORY_KB / 1024))
    
    # System memory percentage (approximate)
    TOTAL_MEMORY_MB=$(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024/1024)}' || echo "8192")
    MEMORY_PERCENT=$(echo "scale=2; $MEMORY_MB * 100 / $TOTAL_MEMORY_MB" | bc -l 2>/dev/null || echo "0")
    
    # Test response time (if server is ready)
    RESPONSE_TIME="0"
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/health 2>/dev/null | grep -q "200\|503"; then
        RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" http://localhost:3101/health 2>/dev/null | awk '{print int($1*1000)}' || echo "0")
    fi
    
    # Log metrics
    echo "$TIMESTAMP,$CPU_PERCENT,$MEMORY_MB,$MEMORY_PERCENT,$RESPONSE_TIME" >> "$METRICS_FILE"
    
    echo "📊 CPU: ${CPU_PERCENT}% | Memory: ${MEMORY_MB}MB (${MEMORY_PERCENT}%) | Response: ${RESPONSE_TIME}ms"
    
    sleep $MONITOR_INTERVAL
    ELAPSED=$((ELAPSED + MONITOR_INTERVAL))
done

# Stop the application using shared cleanup system
echo "🛑 Stopping application..."
stop_tracked_apps

echo ""
echo "📊 Performance Analysis:"
echo "========================"

if [ -f "$LOG_FILE" ]; then
    echo "🚀 Startup Performance:"
    echo "----------------------"
    
    # Startup time analysis
    COMPILATION_TIME=$(grep "Found.*errors" "$LOG_FILE" | head -1 | grep -o '\[[0-9:]*\s*[AP]M\]' || echo "Unknown")
    APP_START_TIME=$(grep "Starting Nest application" "$LOG_FILE" | head -1 | grep -o '\[[0-9:]*\s*[AP]M\]' || echo "Unknown")
    
    echo "⏱️  Compilation completed: $COMPILATION_TIME"
    echo "⏱️  Application started: $APP_START_TIME"
    
    # Count initialization steps
    SERVICES_INITIALIZED=$(grep -c "Service initialized successfully\|initialized successfully" "$LOG_FILE")
    echo "🔧 Services initialized: $SERVICES_INITIALIZED"
    
    echo ""
    echo "🧠 Memory Analysis:"
    echo "------------------"
    
    # Memory warnings
    MEMORY_WARNINGS=$(grep -c "Memory.*warning\|memory.*high\|Memory usage" "$LOG_FILE")
    echo "⚠️  Memory warnings: $MEMORY_WARNINGS"
    
    # Show memory-related logs
    grep -E "(Memory|memory|heap)" "$LOG_FILE" | head -5
    
    echo ""
    echo "⚡ Performance Issues:"
    echo "--------------------"
    
    # Performance optimization logs
    OPTIMIZATION_COUNT=$(grep -c "Performance optimization\|Cache.*optimized" "$LOG_FILE")
    echo "🔧 Performance optimizations: $OPTIMIZATION_COUNT"
    
    # Slow operations
    grep -E "(slow|timeout|delay.*ms|took.*ms)" "$LOG_FILE" | head -5
    
    echo ""
    echo "📈 Cache Performance:"
    echo "-------------------"
    
    # Cache hit rates and optimizations
    grep -E "(Cache.*hit|cache.*optimized|efficiency score)" "$LOG_FILE" | tail -5
    
    echo ""
    echo "🔄 Circuit Breaker Events:"
    echo "-------------------------"
    
    # Circuit breaker state changes
    CIRCUIT_EVENTS=$(grep -c "Circuit breaker.*OPEN\|Circuit breaker.*CLOSED\|Circuit breaker.*HALF-OPEN" "$LOG_FILE")
    echo "⚡ Circuit breaker events: $CIRCUIT_EVENTS"
    
    grep -E "(Circuit breaker.*OPEN|Circuit breaker.*CLOSED)" "$LOG_FILE" | head -5
    
else
    echo "❌ No main log file found"
fi

# Analyze metrics if available
if [ -f "$METRICS_FILE" ] && [ $(wc -l < "$METRICS_FILE") -gt 1 ]; then
    echo ""
    echo "📊 System Metrics Summary:"
    echo "==========================="
    
    # Calculate averages (skip header line)
    tail -n +2 "$METRICS_FILE" | awk -F',' '
    BEGIN { 
        cpu_sum=0; mem_sum=0; resp_sum=0; count=0;
        cpu_max=0; mem_max=0; resp_max=0;
    }
    {
        if (NF >= 5) {
            cpu_sum += $2; mem_sum += $3; resp_sum += $5; count++;
            if ($2 > cpu_max) cpu_max = $2;
            if ($3 > mem_max) mem_max = $3;
            if ($5 > resp_max) resp_max = $5;
        }
    }
    END {
        if (count > 0) {
            printf "📊 Average CPU: %.1f%% (Peak: %.1f%%)\n", cpu_sum/count, cpu_max;
            printf "🧠 Average Memory: %.0fMB (Peak: %.0fMB)\n", mem_sum/count, mem_max;
            printf "⚡ Average Response: %.0fms (Peak: %.0fms)\n", resp_sum/count, resp_max;
            printf "📈 Total samples: %d\n", count;
        }
    }'
else
    echo "❌ No metrics data available"
fi

echo ""
echo "✨ Performance analysis complete!"
echo "📁 Logs available at:"
echo "   - Main log: $LOG_FILE"
echo "   - Metrics: $METRICS_FILE"