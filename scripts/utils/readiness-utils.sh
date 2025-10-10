#!/bin/bash

# Readiness Utilities - Eliminates time-based assumptions in test scripts
# Provides proper service readiness determination based on actual service state

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEFAULT_MAX_ATTEMPTS=60
DEFAULT_CHECK_INTERVAL=1000  # milliseconds
DEFAULT_TIMEOUT=5000        # milliseconds per check
DEFAULT_STARTUP_DELAY=35    # seconds to wait before first health check (optimized based on timing tests)

# Logging function
log_readiness() {
    local level=$1
    local message=$2
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        "INFO")
            echo -e "${BLUE}[${timestamp}] INFO: ${message}${NC}"
            ;;
        "WARN")
            echo -e "${YELLOW}[${timestamp}] WARN: ${message}${NC}"
            ;;
        "ERROR")
            echo -e "${RED}[${timestamp}] ERROR: ${message}${NC}"
            ;;
        "SUCCESS")
            echo -e "${GREEN}[${timestamp}] SUCCESS: ${message}${NC}"
            ;;
        *)
            echo "[${timestamp}] ${message}"
            ;;
    esac
}

# Check if HTTP endpoint is ready
check_http_endpoint() {
    local url=$1
    local expected_status=${2:-200}
    local timeout=${3:-$DEFAULT_TIMEOUT}
    
    local response
    local status_code
    
    # Use timeout command if available, otherwise rely on curl timeout
    if command -v gtimeout >/dev/null 2>&1; then
        response=$(gtimeout $((timeout / 1000))s curl -s -w "%{http_code}" --max-time $((timeout / 1000)) "$url" 2>/dev/null)
    elif command -v timeout >/dev/null 2>&1; then
        response=$(timeout $((timeout / 1000))s curl -s -w "%{http_code}" --max-time $((timeout / 1000)) "$url" 2>/dev/null)
    else
        response=$(curl -s -w "%{http_code}" --max-time $((timeout / 1000)) "$url" 2>/dev/null)
    fi
    
    if [ $? -eq 0 ] && [ -n "$response" ]; then
        status_code=$(echo "$response" | tail -c 4)
        [ "$status_code" = "$expected_status" ]
    else
        return 1
    fi
}

# Check if service health endpoint is ready
check_service_health() {
    local base_url=$1
    local timeout=${2:-$DEFAULT_TIMEOUT}
    
    # Try multiple health endpoints in order of preference
    local health_endpoints=("health/ready" "health" "health/live" "healthz" "ready")
    
    for endpoint in "${health_endpoints[@]}"; do
        local url="${base_url}/${endpoint}"
        if check_http_endpoint "$url" 200 "$timeout"; then
            log_readiness "INFO" "Health check passed: $url"
            return 0
        fi
    done
    
    return 1
}

# Check if service is responding with valid JSON
check_service_json_response() {
    local url=$1
    local timeout=${2:-$DEFAULT_TIMEOUT}
    
    local response
    if command -v gtimeout >/dev/null 2>&1; then
        response=$(gtimeout $((timeout / 1000))s curl -s --max-time $((timeout / 1000)) -H "Accept: application/json" "$url" 2>/dev/null)
    elif command -v timeout >/dev/null 2>&1; then
        response=$(timeout $((timeout / 1000))s curl -s --max-time $((timeout / 1000)) -H "Accept: application/json" "$url" 2>/dev/null)
    else
        response=$(curl -s --max-time $((timeout / 1000)) -H "Accept: application/json" "$url" 2>/dev/null)
    fi
    
    if [ $? -eq 0 ] && [ -n "$response" ]; then
        # Check if response is valid JSON
        echo "$response" | jq . >/dev/null 2>&1
        return $?
    else
        return 1
    fi
}

# Check if process is running and responsive
check_process_readiness() {
    local pid=$1
    local port=$2
    local timeout=${3:-$DEFAULT_TIMEOUT}
    
    # Check if process is still running
    if ! kill -0 "$pid" 2>/dev/null; then
        log_readiness "ERROR" "Process $pid is not running"
        return 1
    fi
    
    # Check if port is listening
    if ! lsof -ti:$port >/dev/null 2>&1; then
        log_readiness "WARN" "Port $port is not listening"
        return 1
    fi
    
    # Check if service responds to health checks
    if check_service_health "http://localhost:$port" "$timeout"; then
        return 0
    else
        log_readiness "WARN" "Service on port $port is not responding to health checks"
        return 1
    fi
}

# Wait for service to become ready
wait_for_service_readiness() {
    local service_name=$1
    local check_function=$2
    local max_attempts=${3:-$DEFAULT_MAX_ATTEMPTS}
    local check_interval=${4:-$DEFAULT_CHECK_INTERVAL}
    
    shift 4  # Remove the first 4 arguments, rest are passed to check function
    local check_args=("$@")
    
    log_readiness "INFO" "Waiting for $service_name to become ready..."
    log_readiness "INFO" "Max attempts: $max_attempts, Check interval: ${check_interval}ms"
    
    local attempt=0
    local start_time=$(date +%s)
    
    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))
        
        # Execute the check function with provided arguments
        if $check_function "${check_args[@]}"; then
            local end_time=$(date +%s)
            local duration=$((end_time - start_time))
            log_readiness "SUCCESS" "$service_name is ready after $attempt attempts (${duration}s)"
            return 0
        fi
        
        # Show progress every 10 attempts
        if [ $((attempt % 10)) -eq 0 ]; then
            local elapsed=$(($(date +%s) - start_time))
            log_readiness "INFO" "Still waiting for $service_name... (attempt $attempt/$max_attempts, ${elapsed}s elapsed)"
        fi
        
        # Wait before next check
        sleep $(echo "scale=3; $check_interval / 1000" | bc -l 2>/dev/null || echo "1")
    done
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    log_readiness "ERROR" "$service_name failed to become ready after $attempt attempts (${duration}s)"
    return 1
}

# Wait for HTTP endpoint to become ready
wait_for_http_endpoint() {
    local url=$1
    local expected_status=${2:-200}
    local max_attempts=${3:-$DEFAULT_MAX_ATTEMPTS}
    local check_interval=${4:-$DEFAULT_CHECK_INTERVAL}
    local timeout=${5:-$DEFAULT_TIMEOUT}
    
    wait_for_service_readiness "HTTP endpoint ($url)" check_http_endpoint "$max_attempts" "$check_interval" "$url" "$expected_status" "$timeout"
}

# Wait for service health to become ready
wait_for_service_health() {
    local base_url=$1
    local max_attempts=${2:-$DEFAULT_MAX_ATTEMPTS}
    local check_interval=${3:-$DEFAULT_CHECK_INTERVAL}
    local timeout=${4:-$DEFAULT_TIMEOUT}
    
    wait_for_service_readiness "Service health ($base_url)" check_service_health "$max_attempts" "$check_interval" "$base_url" "$timeout"
}

# Wait for process to become ready
wait_for_process_readiness() {
    local pid=$1
    local port=$2
    local max_attempts=${3:-$DEFAULT_MAX_ATTEMPTS}
    local check_interval=${4:-$DEFAULT_CHECK_INTERVAL}
    local timeout=${5:-$DEFAULT_TIMEOUT}
    
    wait_for_service_readiness "Process ($pid) on port $port" check_process_readiness "$max_attempts" "$check_interval" "$pid" "$port" "$timeout"
}

# Check multiple services in parallel
wait_for_multiple_services() {
    local -a service_configs=("$@")
    local all_ready=true
    local pids=()
    
    log_readiness "INFO" "Checking multiple services in parallel..."
    
    # Start background checks for each service
    for config in "${service_configs[@]}"; do
        # Parse config: "name:function:arg1:arg2:..."
        IFS=':' read -ra parts <<< "$config"
        local name="${parts[0]}"
        local func="${parts[1]}"
        local args=("${parts[@]:2}")
        
        (
            if wait_for_service_readiness "$name" "$func" "$DEFAULT_MAX_ATTEMPTS" "$DEFAULT_CHECK_INTERVAL" "${args[@]}"; then
                exit 0
            else
                exit 1
            fi
        ) &
        pids+=($!)
    done
    
    # Wait for all background checks to complete
    for pid in "${pids[@]}"; do
        if ! wait $pid; then
            all_ready=false
        fi
    done
    
    if $all_ready; then
        log_readiness "SUCCESS" "All services are ready"
        return 0
    else
        log_readiness "ERROR" "Some services failed to become ready"
        return 1
    fi
}

# Check if data sources are providing fresh data
check_data_freshness() {
    local base_url=$1
    local max_age_seconds=${2:-60}
    local timeout=${3:-$DEFAULT_TIMEOUT}
    
    local response
    if command -v gtimeout >/dev/null 2>&1; then
        response=$(gtimeout $((timeout / 1000))s curl -s --max-time $((timeout / 1000)) "$base_url/metrics" 2>/dev/null)
    elif command -v timeout >/dev/null 2>&1; then
        response=$(timeout $((timeout / 1000))s curl -s --max-time $((timeout / 1000)) "$base_url/metrics" 2>/dev/null)
    else
        response=$(curl -s --max-time $((timeout / 1000)) "$base_url/metrics" 2>/dev/null)
    fi
    
    if [ $? -eq 0 ] && [ -n "$response" ]; then
        # Check if we can parse the response and find recent data
        local current_time=$(date +%s)
        local has_fresh_data=false
        
        # Look for timestamp patterns in the response
        while IFS= read -r line; do
            if echo "$line" | grep -q "timestamp.*[0-9]\{10,\}"; then
                local timestamp=$(echo "$line" | grep -o '[0-9]\{10,\}' | head -1)
                if [ -n "$timestamp" ]; then
                    local age=$((current_time - timestamp / 1000))  # Convert ms to seconds
                    if [ $age -le $max_age_seconds ]; then
                        has_fresh_data=true
                        break
                    fi
                fi
            fi
        done <<< "$response"
        
        $has_fresh_data
    else
        return 1
    fi
}

# Wait for data sources to provide fresh data
wait_for_fresh_data() {
    local base_url=$1
    local max_age_seconds=${2:-60}
    local max_attempts=${3:-$DEFAULT_MAX_ATTEMPTS}
    local check_interval=${4:-$DEFAULT_CHECK_INTERVAL}
    local timeout=${5:-$DEFAULT_TIMEOUT}
    
    wait_for_service_readiness "Fresh data from $base_url" check_data_freshness "$max_attempts" "$check_interval" "$base_url" "$max_age_seconds" "$timeout"
}

# Comprehensive service readiness check
check_comprehensive_readiness() {
    local base_url=$1
    local pid=$2
    local port=$3
    local timeout=${4:-$DEFAULT_TIMEOUT}
    
    log_readiness "INFO" "Performing comprehensive readiness check for $base_url"
    
    # Check 1: Process is running
    if ! kill -0 "$pid" 2>/dev/null; then
        log_readiness "ERROR" "Process $pid is not running"
        return 1
    fi
    
    # Check 2: Port is listening
    if ! lsof -ti:$port >/dev/null 2>&1; then
        log_readiness "ERROR" "Port $port is not listening"
        return 1
    fi
    
    # Check 3: Health endpoints respond
    if ! check_service_health "$base_url" "$timeout"; then
        log_readiness "ERROR" "Health endpoints are not responding"
        return 1
    fi
    
    # Check 4: Service returns valid JSON responses
    if ! check_service_json_response "$base_url/metrics" "$timeout"; then
        log_readiness "WARN" "Metrics endpoint not returning valid JSON (non-critical)"
    fi
    
    # Check 5: Data freshness (if applicable)
    if check_data_freshness "$base_url" 60 "$timeout"; then
        log_readiness "INFO" "Data sources are providing fresh data"
    else
        log_readiness "WARN" "Data sources may not be providing fresh data (non-critical for basic readiness)"
    fi
    
    log_readiness "SUCCESS" "Comprehensive readiness check passed"
    return 0
}

# Wait for comprehensive service readiness
wait_for_comprehensive_readiness() {
    local base_url=$1
    local pid=$2
    local port=$3
    local max_attempts=${4:-$DEFAULT_MAX_ATTEMPTS}
    local check_interval=${5:-$DEFAULT_CHECK_INTERVAL}
    local timeout=${6:-$DEFAULT_TIMEOUT}
    
    wait_for_service_readiness "Comprehensive service ($base_url)" check_comprehensive_readiness "$max_attempts" "$check_interval" "$base_url" "$pid" "$port" "$timeout"
}

# Standardized function for debug scripts - waits for service readiness with minimal log pollution
wait_for_debug_service_readiness() {
    local base_url=${1:-"http://localhost:3101"}
    local startup_delay=${2:-$DEFAULT_STARTUP_DELAY}
    local max_attempts=${3:-20}
    local description=${4:-"Service"}
    
    echo "⏳ Waiting for $description to become ready..."
    
    # Brief delay to avoid hitting the server during early startup (reduces error log pollution)
    if [ "$startup_delay" -gt 0 ]; then
        echo "⏱️  Allowing ${startup_delay}s for initial startup..."
        sleep "$startup_delay"
    fi
    
    # Now check for readiness with more patient settings
    if wait_for_service_health "$base_url" "$max_attempts" 2000 5000; then
        echo "✅ $description is ready! Proceeding with testing..."
        return 0
    else
        echo "❌ $description failed to become ready within timeout"
        return 1
    fi
}

# Export functions for use in other scripts
export -f log_readiness
export -f check_http_endpoint
export -f check_service_health
export -f check_service_json_response
export -f check_process_readiness
export -f wait_for_service_readiness
export -f wait_for_http_endpoint
export -f wait_for_service_health
export -f wait_for_process_readiness
export -f wait_for_multiple_services
export -f check_data_freshness
export -f wait_for_fresh_data
export -f check_comprehensive_readiness
export -f wait_for_comprehensive_readiness
export -f wait_for_debug_service_readiness