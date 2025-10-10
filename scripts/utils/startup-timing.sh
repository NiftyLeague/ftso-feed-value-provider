#!/bin/bash

# Startup Timing Test Script
# Tests actual application startup times to optimize grace periods

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Configuration
PORT=3101
MAX_TESTS=3
HEALTH_ENDPOINTS=("health/live" "health" "health/ready")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "🚀 Starting Application Startup Timing Tests"
echo "=============================================="

# Function to kill any existing processes
cleanup_processes() {
    echo "🧹 Cleaning up any existing processes..." >&2
    
    # Kill processes on port
    if lsof -ti:$PORT >/dev/null 2>&1; then
        echo "  Killing processes on port $PORT..." >&2
        lsof -ti:$PORT | xargs kill -9 2>/dev/null || true
        sleep 2
    fi
    
    # Kill any nest processes
    pkill -f "nest start" 2>/dev/null || true
    pkill -f "node.*nest" 2>/dev/null || true
    sleep 1
}

# Function to test startup time
test_startup_time() {
    local test_num=$1
    
    # Clean up before test
    cleanup_processes >&2
    
    # Start timing
    local start_time=$(date +%s)
    echo "⏱️  Starting application at $(date)" >&2
    
    # Start the application in background
    cd "$PROJECT_ROOT"
    timeout 120s pnpm start:dev > "/tmp/startup_test_$test_num.log" 2>&1 &
    local app_pid=$!
    
    echo "🔄 Application PID: $app_pid" >&2
    
    # Source readiness utilities
    source "$(dirname "$0")/../utils/readiness-utils.sh"
    
    echo "⏱️  Waiting for service readiness..." >&2
    
    # Use a custom readiness check with no initial delay for accurate timing
    local attempt=0
    local max_attempts=60
    
    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))
        
        # Check if process is still running
        if ! kill -0 $app_pid 2>/dev/null; then
            echo -e "${RED}❌ Application process died unexpectedly${NC}" >&2
            cat "/tmp/startup_test_$test_num.log" | tail -20 >&2
            return 1
        fi
        
        # Check if service is ready using our standard health check
        if check_service_health "http://localhost:$PORT" 3000 >/dev/null 2>&1; then
            ready_time=$(date +%s)
            local startup_duration=$((ready_time - start_time))
            echo -e "${GREEN}✅ Application fully ready after ${startup_duration}s${NC}" >&2
            
            # Kill the application
            kill $app_pid 2>/dev/null || true
            wait $app_pid 2>/dev/null || true
            
            # Clean up log
            rm -f "/tmp/startup_test_$test_num.log"
            
            echo "$startup_duration"
            return 0
        else
            # Still starting up
            if [ $((attempt % 10)) -eq 0 ]; then
                local current_time=$(date +%s)
                local elapsed=$((current_time - start_time))
                printf "⏳ Still starting up... (%ds elapsed, attempt %d/%d)\n" "$elapsed" "$attempt" "$max_attempts" >&2
            fi
        fi
        
        sleep 2
    done
    
    # Timeout reached
    echo -e "${RED}❌ Application failed to start within 120 seconds${NC}" >&2
    kill $app_pid 2>/dev/null || true
    
    # Show last few lines of log for debugging
    echo "📋 Last 20 lines of startup log:" >&2
    cat "/tmp/startup_test_$test_num.log" | tail -20 >&2
    rm -f "/tmp/startup_test_$test_num.log"
    
    return 1
}

# Function to calculate statistics
calculate_stats() {
    local times=("$@")
    local count=${#times[@]}
    
    if [ $count -eq 0 ]; then
        echo "No successful startups to analyze"
        return 1
    fi
    
    # Calculate sum and find min/max
    local sum=0
    local min=${times[0]}
    local max=${times[0]}
    
    for time in "${times[@]}"; do
        sum=$((sum + time))
        if [ $time -lt $min ]; then
            min=$time
        fi
        if [ $time -gt $max ]; then
            max=$time
        fi
    done
    
    local avg=$((sum / count))
    
    echo ""
    echo "📈 Startup Time Statistics"
    echo "========================="
    printf "Tests completed: %d\n" "$count"
    printf "Average time: %ds\n" "$avg"
    printf "Minimum time: %ds\n" "$min"
    printf "Maximum time: %ds\n" "$max"
    
    # Recommendations
    echo ""
    echo "💡 Recommendations"
    echo "=================="
    
    local recommended_grace=$((max + 15))  # Add 15s buffer
    local recommended_timeout=$((max * 2))
    
    printf "Recommended STARTUP_GRACE_PERIOD_MS: %ds (%dms)\n" "$recommended_grace" "$((recommended_grace * 1000))"
    printf "Recommended test timeout: %ds\n" "$recommended_timeout"
    
    # Current vs recommended
    echo ""
    echo "🔧 Current Configuration Analysis"
    echo "================================"
    echo "Current STARTUP_GRACE_PERIOD_MS: 45000ms (45s)"
    echo "Current test timeout: 120s"
    
    if [ $recommended_grace -le 45 ]; then
        echo -e "${GREEN}✅ Current grace period is adequate${NC}"
    else
        echo -e "${YELLOW}⚠️  Consider increasing grace period to ${recommended_grace}s${NC}"
    fi
    
    if [ $recommended_timeout -le 120 ]; then
        echo -e "${GREEN}✅ Current test timeout is adequate${NC}"
    else
        echo -e "${YELLOW}⚠️  Consider increasing test timeout to ${recommended_timeout}s${NC}"
    fi
}

# Main execution
main() {
    echo "🔧 Configuration:"
    echo "  Port: $PORT"
    echo "  Max tests: $MAX_TESTS"
    echo "  Health endpoints: ${HEALTH_ENDPOINTS[*]}"
    
    # Check dependencies
    
    if ! command -v curl >/dev/null 2>&1; then
        echo -e "${RED}❌ 'curl' command not found. Please install it for health checks.${NC}"
        exit 1
    fi
    
    # Initial cleanup
    cleanup_processes
    
    # Run tests
    local startup_times=()
    local successful_tests=0
    
    for i in $(seq 1 $MAX_TESTS); do
        echo ""
        echo -e "${BLUE}📊 Test $i: Measuring startup time${NC}"
        echo "----------------------------------------"
        
        if startup_time=$(test_startup_time $i 2>&1 | tail -1); then
            # Validate that we got a number
            if [[ "$startup_time" =~ ^[0-9]+$ ]]; then
                startup_times+=("$startup_time")
                successful_tests=$((successful_tests + 1))
                echo -e "${GREEN}✅ Test $i completed: ${startup_time}s${NC}"
            else
                echo -e "${RED}❌ Test $i failed - invalid result: $startup_time${NC}"
            fi
        else
            echo -e "${RED}❌ Test $i failed${NC}"
        fi
        
        # Wait between tests
        if [ $i -lt $MAX_TESTS ]; then
            echo "⏸️  Waiting 5 seconds before next test..."
            sleep 5
        fi
    done
    
    # Final cleanup
    cleanup_processes
    
    # Calculate and display statistics
    if [ $successful_tests -gt 0 ]; then
        calculate_stats "${startup_times[@]}"
        echo ""
        echo -e "${GREEN}🎉 Startup timing analysis complete!${NC}"
        exit 0
    else
        echo -e "${RED}❌ All startup tests failed${NC}"
        exit 1
    fi
}

# Handle interrupts
trap cleanup_processes EXIT INT TERM

# Run main function
main "$@"