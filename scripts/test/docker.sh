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
NC='\033[0m' # No Color

# Test 1: Check if container is running
echo "1️⃣  Checking if container is running..."
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}✓ Container is running${NC}"
else
    echo -e "${RED}✗ Container is not running${NC}"
    exit 1
fi
echo ""

# Test 2: Check liveness endpoint
echo "2️⃣  Testing liveness endpoint..."
LIVENESS=$(curl -s http://localhost:3101/health/live)
if echo "$LIVENESS" | grep -q '"alive":true'; then
    echo -e "${GREEN}✓ Liveness check passed${NC}"
else
    echo -e "${RED}✗ Liveness check failed${NC}"
    echo "$LIVENESS"
    exit 1
fi
echo ""

# Test 3: Check health endpoint
echo "3️⃣  Testing health endpoint..."
HEALTH=$(curl -s http://localhost:3101/health)
if echo "$HEALTH" | grep -q '"status":"healthy"'; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${YELLOW}⚠ Health check returned: $(echo $HEALTH | jq -r '.status')${NC}"
fi
echo ""

# Test 4: Test feed values endpoint
echo "4️⃣  Testing feed values endpoint..."
FEED_VALUES=$(curl -s -X POST http://localhost:3101/feed-values \
    -H "Content-Type: application/json" \
    -d '{"feeds":[{"category":1,"name":"BTC/USD"},{"category":1,"name":"ETH/USD"}]}')

if echo "$FEED_VALUES" | grep -q '"data"'; then
    echo -e "${GREEN}✓ Feed values endpoint working${NC}"
    echo "   Sample data:"
    echo "$FEED_VALUES" | jq '.data[] | {feed: .feed.name, value: .value, confidence: .confidence}'
else
    echo -e "${RED}✗ Feed values endpoint failed${NC}"
    echo "$FEED_VALUES"
    exit 1
fi
echo ""

# Test 5: Check metrics endpoint
echo "5️⃣  Testing metrics endpoint..."
METRICS=$(curl -s http://localhost:9090/metrics 2>/dev/null || echo "")
if [ -n "$METRICS" ]; then
    echo -e "${GREEN}✓ Metrics endpoint working${NC}"
    METRIC_COUNT=$(echo "$METRICS" | grep -c '^ftso_' 2>/dev/null || echo '0')
    echo "   Available metrics: $METRIC_COUNT FTSO metrics"
else
    echo -e "${YELLOW}⚠ Metrics endpoint not responding (this is optional)${NC}"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ All tests passed! Docker deployment is working.${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Service URLs:"
echo "   • API:     http://localhost:3101"
echo "   • Metrics: http://localhost:9090/metrics"
echo "   • Health:  http://localhost:3101/health"
echo ""
echo "📝 Example API call:"
echo '   curl -X POST http://localhost:3101/feed-values \'
echo '     -H "Content-Type: application/json" \'
echo '     -d '"'"'{"feeds":[{"category":1,"name":"BTC/USD"}]}'"'"
echo ""
