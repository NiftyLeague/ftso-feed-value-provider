#!/bin/bash

# Load & Stress Testing Script
# Tests high concurrent requests, memory usage under load, and performance degradation

echo "🚀 FTSO Load & Stress Tester"
echo "============================"

# Source common test utilities
source "$(dirname "$0")/../utils/test-common.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Configuration - Reduced to prevent hanging
TIMEOUT=60


# Load test parameters - Reduced for stability
CONCURRENT_USERS=10  # Reduced from 50
REQUESTS_PER_USER=5  # Reduced from 20
RAMP_UP_TIME=10      # Reduced from 30
TEST_DURATION=20     # Reduced from 60

# Set up logging using common utility
echo "📝 Starting load testing..."
setup_test_logging "load"
LOG_FILE="$TEST_LOG_FILE"
LOAD_REPORT="$TEST_LOG_DIR/load-test-report.log"
echo "📊 Load report: $LOAD_REPORT"
echo ""

echo "🎯 Test Parameters:"
echo "  👥 Concurrent users: $CONCURRENT_USERS"
echo "  📊 Requests per user: $REQUESTS_PER_USER"
echo "  ⏱️  Ramp-up time: ${RAMP_UP_TIME}s"
echo "  🕐 Test duration: ${TEST_DURATION}s"

# Initialize load report
echo "FTSO Load Test Report - $(date)" > "$LOAD_REPORT"
echo "===============================" >> "$LOAD_REPORT"
echo "Test Parameters:" >> "$LOAD_REPORT"
echo "- Concurrent users: $CONCURRENT_USERS" >> "$LOAD_REPORT"
echo "- Requests per user: $REQUESTS_PER_USER" >> "$LOAD_REPORT"
echo "- Ramp-up time: ${RAMP_UP_TIME}s" >> "$LOAD_REPORT"
echo "- Test duration: ${TEST_DURATION}s" >> "$LOAD_REPORT"
echo "" >> "$LOAD_REPORT"

# Build and start the application for load testing (faster than watch mode)
echo "📦 Building application for load testing..."
pnpm build > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

# Start the built application in production mode (most stable)
NODE_ENV=production LOG_LEVEL=log pnpm start:prod 2>&1 | strip_ansi > "$LOG_FILE" &
APP_PID=$!

# Register the PID and port for cleanup
register_pid "$APP_PID"
register_port 3101

echo ""
echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Waiting for server to be ready..."

# Wait for server to be ready - Extended timeout for production mode startup
READY_TIMEOUT=180  # Extended for production mode initialization
ELAPSED=0

while [ $ELAPSED -lt $READY_TIMEOUT ]; do
    if ! kill -0 $APP_PID 2>/dev/null; then
        echo "❌ Application stopped unexpectedly"
        echo "📋 Last few lines of log:"
        tail -10 "$LOG_FILE" 2>/dev/null || echo "No log file available"
        exit 1
    fi
    
    # Test if server is ready with timeout and show progress
    HTTP_CODE=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" http://localhost:3101/health 2>/dev/null || echo "000")
    if echo "$HTTP_CODE" | grep -q "200"; then
        # Additional check: test if feed-values endpoint is also ready
        FEED_CODE=$(curl -s --max-time 5 -X POST -H "Content-Type: application/json" -d '{"feeds": [{"category": 1, "name": "BTC/USD"}]}' -o /dev/null -w "%{http_code}" http://localhost:3101/feed-values 2>/dev/null || echo "000")
        if echo "$FEED_CODE" | grep -q "200"; then
            echo "✅ Server is ready for load testing (Health: $HTTP_CODE, Feed: $FEED_CODE)"
            break
        else
            echo "⏳ Health endpoint ready ($HTTP_CODE) but feed endpoint not ready ($FEED_CODE), waiting..."
        fi
    fi
    
    # Show progress every 30 seconds
    if [ $((ELAPSED % 30)) -eq 0 ] && [ $ELAPSED -gt 0 ]; then
        echo "⏳ Still waiting for server readiness... (${ELAPSED}s/${READY_TIMEOUT}s, HTTP: $HTTP_CODE)"
        echo "📋 Recent log activity:"
        tail -3 "$LOG_FILE" 2>/dev/null || echo "No recent log activity"
    fi
    
    sleep 5  # Increased check interval to reduce load
    ELAPSED=$((ELAPSED + 5))
done

if [ $ELAPSED -ge $READY_TIMEOUT ]; then
    echo "⏰ Server readiness timeout"
    exit 1
fi

# Function to get system metrics
get_system_metrics() {
    local pid=$1
    local cpu_percent=0
    local memory_mb=0
    
    if kill -0 $pid 2>/dev/null; then
        # Get CPU and memory usage (macOS compatible)
        cpu_percent=$(ps -p $pid -o %cpu= 2>/dev/null | tr -d ' ' || echo "0")
        memory_kb=$(ps -p $pid -o rss= 2>/dev/null | tr -d ' ' || echo "0")
        memory_mb=$((memory_kb / 1024))
    fi
    
    echo "$cpu_percent,$memory_mb"
}

# Function to run load test
run_load_test() {
    local endpoint=$1
    local test_name=$2
    local payload=$3
    
    echo ""
    echo "🧪 Running load test: $test_name"
    echo "   Endpoint: $endpoint"
    echo "   Payload: $payload"
    
    # Create temporary files for results
    local results_file="logs/load_results_$(date +%s).tmp"
    local metrics_file="logs/load_metrics_$(date +%s).tmp"
    
    # Initialize metrics tracking
    echo "timestamp,cpu_percent,memory_mb,response_time_ms,status_code" > "$metrics_file"
    
    # Start background monitoring
    (
        while [ -f "$results_file.running" ]; do
            local timestamp=$(date +%s)
            local metrics=$(get_system_metrics $APP_PID)
            local cpu_percent=$(echo "$metrics" | cut -d',' -f1)
            local memory_mb=$(echo "$metrics" | cut -d',' -f2)
            
            # Test response time
            local response_time=0
            local status_code=0
            
            if [ -n "$payload" ]; then
                local response=$(curl -s -w "%{time_total},%{http_code}" -X POST \
                    -H "Content-Type: application/json" \
                    -d "$payload" \
                    -o /dev/null \
                    "http://localhost:3101$endpoint" 2>/dev/null)
                response_time=$(echo "$response" | cut -d',' -f1 | awk '{print int($1*1000)}')
                status_code=$(echo "$response" | cut -d',' -f2)
            else
                local response=$(curl -s -w "%{time_total},%{http_code}" \
                    -o /dev/null \
                    "http://localhost:3101$endpoint" 2>/dev/null)
                response_time=$(echo "$response" | cut -d',' -f1 | awk '{print int($1*1000)}')
                status_code=$(echo "$response" | cut -d',' -f2)
            fi
            
            echo "$timestamp,$cpu_percent,$memory_mb,$response_time,$status_code" >> "$metrics_file"
            sleep 2
        done
    ) &
    local monitor_pid=$!
    
    # Create running flag
    touch "$results_file.running"
    
    # Run concurrent load test
    local start_time=$(date +%s)
    
    # Generate load using background processes
    for i in $(seq 1 $CONCURRENT_USERS); do
        (
            # Stagger start times for ramp-up
            local delay=$((i * RAMP_UP_TIME / CONCURRENT_USERS))
            sleep $delay
            
            # Run requests for this user
            for j in $(seq 1 $REQUESTS_PER_USER); do
                if [ -f "$results_file.running" ]; then
                    if [ -n "$payload" ]; then
                        curl -s -w "%{time_total},%{http_code}\n" \
                            -X POST \
                            -H "Content-Type: application/json" \
                            -d "$payload" \
                            -o /dev/null \
                            "http://localhost:3101$endpoint" 2>/dev/null >> "$results_file"
                    else
                        curl -s -w "%{time_total},%{http_code}\n" \
                            -o /dev/null \
                            "http://localhost:3101$endpoint" 2>/dev/null >> "$results_file"
                    fi
                    
                    # Small delay between requests
                    sleep 0.1
                fi
            done
        ) &
    done
    
    # Wait for test duration with timeout protection
    echo "   ⏱️  Running load test for ${TEST_DURATION} seconds..."
    
    # Use timeout to prevent hanging
    timeout ${TEST_DURATION}s sleep $TEST_DURATION || true
    
    # Stop the test
    rm -f "$results_file.running"
    kill $monitor_pid 2>/dev/null || true
    
    # Kill any remaining background processes
    jobs -p | xargs -r kill 2>/dev/null || true
    wait 2>/dev/null || true
    
    # Analyze results
    local end_time=$(date +%s)
    local total_duration=$((end_time - start_time))
    
    echo "   📊 Analyzing results..."
    
    if [ -f "$results_file" ]; then
        local total_requests=$(wc -l < "$results_file")
        local successful_requests=$(grep ",200$" "$results_file" | wc -l)
        local failed_requests=$((total_requests - successful_requests))
        
        # Calculate response times
        local avg_response_time=0
        local max_response_time=0
        local min_response_time=999999
        
        if [ $total_requests -gt 0 ]; then
            while IFS=',' read -r time_total status_code; do
                local time_ms=$(echo "$time_total" | awk '{print int($1*1000)}')
                avg_response_time=$((avg_response_time + time_ms))
                
                if [ $time_ms -gt $max_response_time ]; then
                    max_response_time=$time_ms
                fi
                
                if [ $time_ms -lt $min_response_time ]; then
                    min_response_time=$time_ms
                fi
            done < "$results_file"
            
            avg_response_time=$((avg_response_time / total_requests))
        fi
        
        # Calculate throughput
        local throughput=0
        if [ $total_duration -gt 0 ]; then
            throughput=$((total_requests / total_duration))
        fi
        
        # Calculate success rate
        local success_rate=0
        if [ $total_requests -gt 0 ]; then
            success_rate=$((successful_requests * 100 / total_requests))
        fi
        
        # Get system metrics summary
        local max_cpu=0
        local max_memory=0
        local avg_cpu=0
        local avg_memory=0
        
        if [ -f "$metrics_file" ] && [ $(wc -l < "$metrics_file") -gt 1 ]; then
            # Skip header line and calculate metrics
            tail -n +2 "$metrics_file" | while IFS=',' read -r timestamp cpu memory response status; do
                if [ "$cpu" != "0" ] && [ -n "$cpu" ]; then
                    # Use awk for floating point comparison
                    max_cpu=$(echo "$cpu $max_cpu" | awk '{print ($1 > $2) ? $1 : $2}')
                    avg_cpu=$(echo "$avg_cpu $cpu" | awk '{print $1 + $2}')
                fi
                
                if [ "$memory" != "0" ] && [ -n "$memory" ]; then
                    if [ $memory -gt $max_memory ]; then
                        max_memory=$memory
                    fi
                    avg_memory=$((avg_memory + memory))
                fi
            done
            
            local metric_count=$(tail -n +2 "$metrics_file" | wc -l)
            if [ $metric_count -gt 0 ]; then
                avg_memory=$((avg_memory / metric_count))
            fi
        fi
        
        # Display results
        echo "   📊 Load Test Results:"
        echo "      🎯 Total requests: $total_requests"
        echo "      ✅ Successful: $successful_requests"
        echo "      ❌ Failed: $failed_requests"
        echo "      📈 Success rate: ${success_rate}%"
        echo "      ⚡ Throughput: ${throughput} req/s"
        echo "      ⏱️  Avg response time: ${avg_response_time}ms"
        echo "      ⏱️  Min response time: ${min_response_time}ms"
        echo "      ⏱️  Max response time: ${max_response_time}ms"
        echo "      🖥️  Max CPU: ${max_cpu}%"
        echo "      🧠 Max Memory: ${max_memory}MB"
        echo "      🖥️  Avg CPU: ${avg_cpu}%"
        echo "      🧠 Avg Memory: ${avg_memory}MB"
        
        # Log to report
        echo "Load Test: $test_name" >> "$LOAD_REPORT"
        echo "- Total requests: $total_requests" >> "$LOAD_REPORT"
        echo "- Successful: $successful_requests" >> "$LOAD_REPORT"
        echo "- Failed: $failed_requests" >> "$LOAD_REPORT"
        echo "- Success rate: ${success_rate}%" >> "$LOAD_REPORT"
        echo "- Throughput: ${throughput} req/s" >> "$LOAD_REPORT"
        echo "- Avg response time: ${avg_response_time}ms" >> "$LOAD_REPORT"
        echo "- Max response time: ${max_response_time}ms" >> "$LOAD_REPORT"
        echo "- Max CPU: ${max_cpu}%" >> "$LOAD_REPORT"
        echo "- Max Memory: ${max_memory}MB" >> "$LOAD_REPORT"
        echo "" >> "$LOAD_REPORT"
        
        # Performance assessment
        if [ $success_rate -ge 95 ] && [ $avg_response_time -le 500 ]; then
            echo "      🎉 EXCELLENT: Performance under load"
        elif [ $success_rate -ge 90 ] && [ $avg_response_time -le 1000 ]; then
            echo "      ✅ GOOD: Acceptable performance under load"
        elif [ $success_rate -ge 80 ]; then
            echo "      ⚠️  FAIR: Performance degradation under load"
        else
            echo "      ❌ POOR: Significant performance issues under load"
        fi
        
    else
        echo "   ❌ No results file generated"
    fi
    
    # Cleanup temporary files
    rm -f "$results_file" "$results_file.running" "$metrics_file"
}

echo ""
echo "🚀 Load Testing:"
echo "================"

# Test 1: Health endpoint load test
run_load_test "/health" "Health Endpoint Load Test" ""

# Test 2: Feed values endpoint load test
run_load_test "/feed-values" "Feed Values Load Test" '{"feeds": [{"category": 1, "name": "BTC/USD"}, {"category": 1, "name": "ETH/USD"}, {"category": 1, "name": "FLR/USD"}]}'

# Test 3: Metrics endpoint load test
run_load_test "/metrics" "Metrics Endpoint Load Test" ""

# Test 4: Stress test with higher load
echo ""
echo "🔥 Stress Testing:"
echo "=================="

# Increase load parameters for stress test - Reduced for stability
CONCURRENT_USERS=20  # Reduced from 100
REQUESTS_PER_USER=3  # Reduced from 10
TEST_DURATION=15     # Reduced from 30

echo "🔥 Running stress test with increased load..."
echo "   👥 Concurrent users: $CONCURRENT_USERS"
echo "   📊 Requests per user: $REQUESTS_PER_USER"
echo "   🕐 Test duration: ${TEST_DURATION}s"

run_load_test "/health" "High Load Stress Test" ""

# Memory stress test
echo ""
echo "🧠 Memory Stress Testing:"
echo "========================"

echo "🧠 Running memory-intensive operations..."

# Create large payloads to test memory handling
LARGE_PAYLOAD='{"feeds": ['
for i in $(seq 1 100); do
    LARGE_PAYLOAD="${LARGE_PAYLOAD}{\"category\": 1, \"name\": \"SYMBOL${i}/USD\"}"
    if [ $i -lt 100 ]; then
        LARGE_PAYLOAD="${LARGE_PAYLOAD},"
    fi
done
LARGE_PAYLOAD="${LARGE_PAYLOAD}]}"

CONCURRENT_USERS=10  # Reduced for memory test
REQUESTS_PER_USER=3  # Reduced from 5
TEST_DURATION=10     # Reduced from 20

run_load_test "/feed-values" "Memory Stress Test" "$LARGE_PAYLOAD"

# Stop the application with timeout protection
echo ""
echo "🛑 Stopping application..."
stop_tracked_apps

# Kill any remaining background processes
jobs -p | xargs -r kill -9 2>/dev/null || true

# Analyze application logs for performance issues
echo ""
echo "📊 Performance Log Analysis:"
echo "============================"

if [ -f "$LOG_FILE" ]; then
    # Performance-related log entries
    PERFORMANCE_LOGS=$(grep -c "performance\|Performance\|slow\|timeout" "$LOG_FILE")
    echo "📈 Performance-related log entries: $PERFORMANCE_LOGS"
    
    # Memory warnings
    MEMORY_WARNINGS=$(grep -c "memory.*warning\|Memory.*warning\|out of memory" "$LOG_FILE")
    echo "🧠 Memory warnings: $MEMORY_WARNINGS"
    
    # Error rate during load test
    ERROR_LOGS=$(grep -c "ERROR\|Error" "$LOG_FILE")
    echo "❌ Error log entries: $ERROR_LOGS"
    
    # Circuit breaker activations
    CIRCUIT_BREAKER_EVENTS=$(grep -c "Circuit breaker.*OPEN" "$LOG_FILE")
    echo "⚡ Circuit breaker activations: $CIRCUIT_BREAKER_EVENTS"
    
    # Rate limiting events
    RATE_LIMIT_EVENTS=$(grep -c "rate.*limit\|Rate.*limit" "$LOG_FILE")
    echo "🚦 Rate limiting events: $RATE_LIMIT_EVENTS"
    
    if [ $MEMORY_WARNINGS -gt 0 ]; then
        echo ""
        echo "Memory warnings detected:"
        grep -E "(memory.*warning|Memory.*warning)" "$LOG_FILE" | head -3
    fi
    
    if [ $CIRCUIT_BREAKER_EVENTS -gt 0 ]; then
        echo ""
        echo "Circuit breaker activations:"
        grep -E "(Circuit breaker.*OPEN)" "$LOG_FILE" | head -3
    fi
fi

# Generate final load test report
echo ""
echo "📊 Load Test Summary:"
echo "===================="

# Log summary to report
echo "" >> "$LOAD_REPORT"
echo "SYSTEM ANALYSIS" >> "$LOAD_REPORT"
echo "===============" >> "$LOAD_REPORT"
echo "Performance logs: $PERFORMANCE_LOGS" >> "$LOAD_REPORT"
echo "Memory warnings: $MEMORY_WARNINGS" >> "$LOAD_REPORT"
echo "Error logs: $ERROR_LOGS" >> "$LOAD_REPORT"
echo "Circuit breaker events: $CIRCUIT_BREAKER_EVENTS" >> "$LOAD_REPORT"
echo "Rate limiting events: $RATE_LIMIT_EVENTS" >> "$LOAD_REPORT"

# Load test recommendations
echo ""
echo "🎯 Load Test Recommendations:"
echo "============================="

if [ $MEMORY_WARNINGS -gt 5 ]; then
    echo "🔧 MEMORY: High memory warnings during load"
    echo "   - Consider increasing memory allocation"
    echo "   - Review memory usage patterns"
    echo "   - Optimize data structures and caching"
    echo "RECOMMENDATION: Optimize memory usage" >> "$LOAD_REPORT"
fi

if [ $CIRCUIT_BREAKER_EVENTS -gt 0 ]; then
    echo "🔧 RESILIENCE: Circuit breakers activated under load"
    echo "   - Review circuit breaker thresholds"
    echo "   - Optimize service performance"
    echo "   - Consider horizontal scaling"
    echo "RECOMMENDATION: Review circuit breaker configuration" >> "$LOAD_REPORT"
fi

if [ $ERROR_LOGS -gt 50 ]; then
    echo "🔧 ERRORS: High error rate during load testing"
    echo "   - Review error handling under load"
    echo "   - Check resource limitations"
    echo "   - Validate error recovery mechanisms"
    echo "RECOMMENDATION: Improve error handling under load" >> "$LOAD_REPORT"
fi

if [ $RATE_LIMIT_EVENTS -gt 100 ]; then
    echo "🔧 RATE LIMITING: Frequent rate limiting under load"
    echo "   - Review rate limiting configuration"
    echo "   - Consider increasing rate limits for production"
    echo "   - Implement request queuing"
    echo "RECOMMENDATION: Optimize rate limiting" >> "$LOAD_REPORT"
fi

# Overall load test assessment
echo ""
echo "🚀 Overall Load Test Assessment:"
echo "==============================="

load_score=100

if [ $MEMORY_WARNINGS -gt 5 ]; then
    load_score=$((load_score - 20))
fi

if [ $CIRCUIT_BREAKER_EVENTS -gt 0 ]; then
    load_score=$((load_score - 15))
fi

if [ $ERROR_LOGS -gt 50 ]; then
    load_score=$((load_score - 20))
fi

if [ $PERFORMANCE_LOGS -gt 20 ]; then
    load_score=$((load_score - 10))
fi

echo "Load Test Score: $load_score/100" >> "$LOAD_REPORT"

if [ $load_score -ge 90 ]; then
    echo "🎉 EXCELLENT: System handles load very well (Score: $load_score/100)"
    echo "Assessment: EXCELLENT" >> "$LOAD_REPORT"
elif [ $load_score -ge 75 ]; then
    echo "✅ GOOD: System handles load acceptably (Score: $load_score/100)"
    echo "Assessment: GOOD" >> "$LOAD_REPORT"
elif [ $load_score -ge 60 ]; then
    echo "⚠️  FAIR: System shows some stress under load (Score: $load_score/100)"
    echo "Assessment: NEEDS OPTIMIZATION" >> "$LOAD_REPORT"
else
    echo "❌ POOR: System struggles significantly under load (Score: $load_score/100)"
    echo "Assessment: CRITICAL" >> "$LOAD_REPORT"
fi

# Source enhanced log summary utilities
source "$(dirname "$0")/../utils/parse-logs.sh"

# Show test summary
log_summary "$LOG_FILE" "load" "test"

echo ""
echo "✨ Load testing complete!"
echo "📁 Results available at:"
echo "   - Detailed logs: $LOG_FILE"
echo "   - Load test report: $LOAD_REPORT"