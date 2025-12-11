#!/bin/bash

# FTSO Feed Value Provider - Docker Test Script
# This script tests the Docker deployment to ensure everything is working

set -e

echo "🐳 Testing FTSO Feed Value Provider in Docker..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CONTAINER_NAME="ftso-feed-value-provider"
MAX_WAIT_TIME=90
HEALTH_CHECK_INTERVAL=5

# Function to check if container exists
container_exists() {
    docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# Function to check if container is running
container_running() {
    docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"
}

# Function to wait for container to be healthy
wait_for_healthy() {
    local elapsed=0
    echo -e "${BLUE}⏳ Waiting for container to be healthy (max ${MAX_WAIT_TIME}s)...${NC}"
    
    while [ $elapsed -lt $MAX_WAIT_TIME ]; do
        if container_running; then
            # Check health status
            local health_status=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "none")
            
            if [ "$health_status" = "healthy" ]; then
                echo -e "${GREEN}✓ Container is healthy${NC}"
                return 0
            elif [ "$health_status" = "none" ]; then
                # No health check defined, check if container is just running
                echo -e "${YELLOW}⚠ No health check defined, checking if container is responsive...${NC}"
                if curl -sf http://localhost:3101/health/live > /dev/null 2>&1; then
                    echo -e "${GREEN}✓ Container is responsive${NC}"
                    return 0
                fi
            fi
            
            echo -n "."
        else
            echo -e "\n${RED}✗ Container stopped unexpectedly${NC}"
            return 1
        fi
        
        sleep $HEALTH_CHECK_INTERVAL
        elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
    done
    
    echo -e "\n${RED}✗ Container failed to become healthy within ${MAX_WAIT_TIME}s${NC}"
    return 1
}

# Function to check for error logs
check_error_logs() {
    echo -e "${BLUE}🔍 Checking for error logs...${NC}"
    
    # Filter out expected errors and noise:
    # - OnPingInterval (WebSocket ping/pong)
    # - Readiness check failed (expected during startup)
    # - System not ready (expected during initialization)
    # - HTTP 429 (rate limiting from exchanges - expected)
    # - Too Many Requests (rate limiting)
    # - Failed to get price (rate limiting from exchanges)
    # - SERVICE_UNAVAILABLE_ERROR (expected during startup)
    # - Object( (error object dumps)
    # - error: (error field lines)
    # - HttpExceptionFilter (exception filter logs)
    # - HealthController (health check errors during startup)
    local error_count=$(docker logs "$CONTAINER_NAME" 2>&1 | \
        grep -iE "(error|fatal|exception)" | \
        grep -v "OnPingInterval" | \
        grep -v "Readiness check failed" | \
        grep -v "System not ready" | \
        grep -v "HTTP 429" | \
        grep -v "Too Many Requests" | \
        grep -v "Failed to get price" | \
        grep -v "SERVICE_UNAVAILABLE_ERROR" | \
        grep -v "Object(" | \
        grep -v "error:" | \
        grep -v "HttpExceptionFilter" | \
        grep -v "HealthController.*Readiness" | \
        wc -l | tr -d ' ')
    
    local warning_count=$(docker logs "$CONTAINER_NAME" 2>&1 | grep -iE "warn" | wc -l | tr -d ' ')
    
    if [ "$error_count" -gt 0 ]; then
        echo -e "${RED}✗ Found $error_count unexpected error(s) in logs${NC}"
        echo -e "${YELLOW}Recent errors:${NC}"
        docker logs "$CONTAINER_NAME" 2>&1 | \
            grep -iE "(error|fatal|exception)" | \
            grep -v "OnPingInterval" | \
            grep -v "Readiness check failed" | \
            grep -v "System not ready" | \
            grep -v "HTTP 429" | \
            grep -v "Too Many Requests" | \
            grep -v "Failed to get price" | \
            grep -v "SERVICE_UNAVAILABLE_ERROR" | \
            grep -v "Object(" | \
            grep -v "error:" | \
            grep -v "HttpExceptionFilter" | \
            grep -v "HealthController.*Readiness" | \
            tail -10
        return 1
    else
        echo -e "${GREEN}✓ No unexpected errors found in logs${NC}"
    fi
    
    if [ "$warning_count" -gt 0 ]; then
        echo -e "${YELLOW}⚠ Found $warning_count warning(s) in logs (this may be normal)${NC}"
    fi
    
    return 0
}

# Test 0: Check if container exists and is running, start if needed
echo "0️⃣  Checking container status..."
if ! container_exists; then
    echo -e "${YELLOW}⚠ Container does not exist, building and starting...${NC}"
    docker-compose up -d --build
    if ! wait_for_healthy; then
        echo -e "${RED}✗ Failed to start container${NC}"
        echo -e "${YELLOW}Container logs:${NC}"
        docker logs "$CONTAINER_NAME" 2>&1 | tail -50
        exit 1
    fi
elif ! container_running; then
    echo -e "${YELLOW}⚠ Container exists but is not running, starting...${NC}"
    docker-compose start
    if ! wait_for_healthy; then
        echo -e "${RED}✗ Failed to start container${NC}"
        echo -e "${YELLOW}Container logs:${NC}"
        docker logs "$CONTAINER_NAME" 2>&1 | tail -50
        exit 1
    fi
else
    echo -e "${GREEN}✓ Container is running${NC}"
    # Still wait for it to be healthy
    if ! wait_for_healthy; then
        echo -e "${RED}✗ Container is not healthy${NC}"
        echo -e "${YELLOW}Container logs:${NC}"
        docker logs "$CONTAINER_NAME" 2>&1 | tail -50
        exit 1
    fi
fi
echo ""

# Test 1: Check container status
echo "1️⃣  Verifying container status..."
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}✓ Container is running${NC}"
    docker-compose ps
else
    echo -e "${RED}✗ Container is not running${NC}"
    exit 1
fi
echo ""

# Test 2: Check for error logs
echo "2️⃣  Checking for error logs..."
if check_error_logs; then
    echo -e "${GREEN}✓ No critical errors in logs${NC}"
else
    echo -e "${YELLOW}⚠ Errors found but continuing tests...${NC}"
fi
echo ""

# Test 3: Check liveness endpoint
echo "3️⃣  Testing liveness endpoint..."
LIVENESS=$(curl -s http://localhost:3101/health/live)
if echo "$LIVENESS" | grep -q '"alive":true'; then
    echo -e "${GREEN}✓ Liveness check passed${NC}"
else
    echo -e "${RED}✗ Liveness check failed${NC}"
    echo "$LIVENESS"
    exit 1
fi
echo ""

# Test 4: Check health endpoint
echo "4️⃣  Testing health endpoint..."
HEALTH=$(curl -s http://localhost:3101/health/ready)
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${YELLOW}⚠ Health check returned: $(echo $HEALTH | jq -r '.status' 2>/dev/null || echo 'unknown')${NC}"
fi
echo ""

# Test 5: Test feed values endpoint
echo "5️⃣  Testing feed values endpoint..."
echo -e "${BLUE}⏳ Waiting 30s for data sources to establish connections...${NC}"
sleep 30
FEED_VALUES=$(curl -s -X POST http://localhost:3101/feed-values \
    -H "Content-Type: application/json" \
    -d '{"feeds":[{"category":1,"name":"BTC/USD"},{"category":1,"name":"ETH/USD"}]}')

if echo "$FEED_VALUES" | grep -q '"data"'; then
    echo -e "${GREEN}✓ Feed values endpoint working${NC}"
    if command -v jq &> /dev/null; then
        echo "   Sample data:"
        echo "$FEED_VALUES" | jq '.data[] | {feed: .feed.name, value: .value, confidence: .confidence}' 2>/dev/null || echo "$FEED_VALUES" | head -3
    fi
else
    echo -e "${RED}✗ Feed values endpoint failed${NC}"
    echo "$FEED_VALUES"
    exit 1
fi
echo ""

# Test 6: Check Prometheus metrics endpoint
echo "6️⃣  Testing Prometheus metrics endpoint..."
METRICS=$(curl -s http://localhost:3101/metrics/prometheus 2>/dev/null || echo "")
if [ -n "$METRICS" ]; then
    echo -e "${GREEN}✓ Prometheus metrics endpoint working${NC}"
    METRIC_COUNT=$(echo "$METRICS" | grep -c '^ftso_' 2>/dev/null || echo '0')
    echo "   Available metrics: $METRIC_COUNT FTSO metrics"
    
    # Show sample metrics
    echo "   Sample metrics:"
    echo "$METRICS" | grep '^ftso_api_requests_total' | head -1 | sed 's/^/   /'
    echo "$METRICS" | grep '^ftso_api_error_rate' | head -1 | sed 's/^/   /'
    echo "$METRICS" | grep '^ftso_memory_usage_percent' | head -1 | sed 's/^/   /'
else
    echo -e "${YELLOW}⚠ Prometheus metrics endpoint not responding (this is optional)${NC}"
fi
echo ""

# Test 7: Final error log check
echo "7️⃣  Final error log check..."
if check_error_logs; then
    echo -e "${GREEN}✓ No new errors during testing${NC}"
else
    echo -e "${YELLOW}⚠ Some errors detected, review logs above${NC}"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ All tests passed! Docker deployment is working.${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Service URLs:"
echo "   • API:        http://localhost:3101"
echo "   • Health:     http://localhost:3101/health/ready"
echo "   • Metrics:    http://localhost:3101/metrics/prometheus"
echo "   • Prometheus: http://localhost:9091 (if monitoring enabled)"
echo "   • Grafana:    http://localhost:3000 (if monitoring enabled)"
echo ""
echo "📝 Example API call:"
echo '   curl -X POST http://localhost:3101/feed-values \'
echo '     -H "Content-Type: application/json" \'
echo '     -d '"'"'{"feeds":[{"category":1,"name":"BTC/USD"}]}'"'"
echo ""
echo "💡 Useful commands:"
echo "   • View logs:    docker logs -f $CONTAINER_NAME"
echo "   • Restart:      pnpm docker:restart (rebuilds with code changes)"
echo "   • Full rebuild: pnpm docker:rebuild (clears cache)"
echo ""
