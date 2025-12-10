#!/bin/bash

# Quick test to verify proxy configuration is working
# Usage: ./scripts/proxy/test-proxy-config.sh <proxy_url>

set -e

PROXY_URL="${1:-http://138.68.60.8:3128}"

echo "Testing proxy configuration..."
echo "Proxy: $PROXY_URL"
echo ""

# Test 1: Verify proxy works
echo "Test 1: Verifying proxy connectivity..."
if timeout 5 curl -s --proxy "$PROXY_URL" "http://httpbin.org/ip" > /dev/null 2>&1; then
    echo "✅ Proxy is reachable"
else
    echo "❌ Proxy is not reachable"
    exit 1
fi

# Test 2: Check proxy location
echo ""
echo "Test 2: Checking proxy location..."
LOCATION=$(timeout 5 curl -s --proxy "$PROXY_URL" "http://ip-api.com/json/" 2>/dev/null)
COUNTRY=$(echo "$LOCATION" | jq -r '.country // "Unknown"')
CITY=$(echo "$LOCATION" | jq -r '.city // "Unknown"')
echo "📍 Proxy location: $CITY, $COUNTRY"

# Test 3: Start app with proxy and check logs
echo ""
echo "Test 3: Starting app with proxy configuration..."
cd "$(dirname "$0")/../.."

# Kill any existing app
pkill -f "nest start" 2>/dev/null || true
sleep 2

# Start app with proxy
echo "Starting app with WEBSOCKET_PROXY_ENABLED=true WEBSOCKET_PROXY_URL=$PROXY_URL"
WEBSOCKET_PROXY_ENABLED=true WEBSOCKET_PROXY_URL="$PROXY_URL" pnpm start > /tmp/proxy-config-test.log 2>&1 &
APP_PID=$!

echo "Waiting for app to start..."
sleep 15

# Check logs for proxy usage
echo ""
echo "Checking logs for proxy usage..."
if grep -qi "using proxy" /tmp/proxy-config-test.log; then
    echo "✅ Proxy configuration is being used:"
    grep -i "using proxy" /tmp/proxy-config-test.log | head -5
else
    echo "❌ No 'Using proxy' messages found in logs!"
    echo ""
    echo "Checking for any proxy mentions..."
    grep -i "proxy" /tmp/proxy-config-test.log | head -10 || echo "No proxy mentions at all"
    echo ""
    echo "Last 30 lines of log:"
    tail -30 /tmp/proxy-config-test.log
fi

# Check health endpoint
echo ""
echo "Test 4: Checking health endpoint..."
sleep 5
HEALTH=$(curl -s http://localhost:3101/health 2>&1 || echo '{}')
HEALTHY_COUNT=$(echo "$HEALTH" | jq -r '.sources.healthy | length' 2>/dev/null || echo "0")
UNHEALTHY_COUNT=$(echo "$HEALTH" | jq -r '.sources.unhealthy | length' 2>/dev/null || echo "0")

echo "Healthy adapters: $HEALTHY_COUNT"
echo "Unhealthy adapters: $UNHEALTHY_COUNT"

if [ "$HEALTHY_COUNT" -gt 0 ]; then
    echo "✅ Some adapters are healthy"
    echo "$HEALTH" | jq -r '.sources.healthy[]' 2>/dev/null
else
    echo "❌ No healthy adapters"
fi

# Cleanup
echo ""
echo "Cleaning up..."
kill $APP_PID 2>/dev/null || true
pkill -f "nest start" 2>/dev/null || true

echo ""
echo "Test complete!"
