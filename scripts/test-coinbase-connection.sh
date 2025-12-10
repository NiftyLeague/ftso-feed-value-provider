#!/bin/bash

# Coinbase Connection Test Script
# Run this on your VM to diagnose Coinbase connectivity issues

echo "🔍 Coinbase Connection Diagnostic Test"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Test Coinbase API (more reliable than website)
echo "📡 Test 1: Coinbase REST API"
echo "-------------------------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 https://api.coinbase.com/v2/time 2>&1)
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Coinbase API accessible (HTTP $HTTP_CODE)${NC}"
elif [ "$HTTP_CODE" = "451" ]; then
    echo -e "${RED}❌ GEO-BLOCKED! (HTTP 451 - Unavailable For Legal Reasons)${NC}"
    echo "   Coinbase is blocking your region (Belgium)"
    echo "   Solution: Enable proxy in .env"
elif [ "$HTTP_CODE" = "403" ]; then
    echo -e "${RED}❌ FORBIDDEN! (HTTP 403)${NC}"
    echo "   Coinbase is blocking your IP or region"
elif [ "$HTTP_CODE" = "000" ]; then
    echo -e "${RED}❌ Cannot connect to Coinbase${NC}"
    echo "   Check your internet connection or firewall"
else
    echo -e "${YELLOW}⚠️  Unexpected response (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Test 2: Coinbase Exchange API (what the app actually uses)
echo "📡 Test 2: Coinbase Exchange API"
echo "-------------------------------------------"
API_RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" --connect-timeout 10 https://api.exchange.coinbase.com/products/BTC-USD/ticker 2>&1)
HTTP_CODE=$(echo "$API_RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$API_RESPONSE" | grep -v "HTTP_CODE:" | head -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Coinbase Exchange API accessible (HTTP $HTTP_CODE)${NC}"
    echo "   Response: $BODY"
elif [ "$HTTP_CODE" = "451" ]; then
    echo -e "${RED}❌ GEO-BLOCKED! (HTTP 451)${NC}"
    echo "   Coinbase Exchange API is blocking your region"
elif [ "$HTTP_CODE" = "403" ]; then
    echo -e "${RED}❌ FORBIDDEN! (HTTP 403)${NC}"
    echo "   Coinbase Exchange API is blocking your IP"
else
    echo -e "${YELLOW}⚠️  Cannot reach Coinbase Exchange API (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Test 3: Coinbase WebSocket endpoint (the critical one)
echo "📡 Test 3: Coinbase WebSocket Endpoint"
echo "-------------------------------------------"
# Test WebSocket by trying to establish TCP connection
if timeout 5 bash -c "echo > /dev/tcp/ws-feed.exchange.coinbase.com/443" 2>/dev/null; then
    echo -e "${GREEN}✅ Can connect to WebSocket endpoint (TCP port 443)${NC}"
    
    # Now test HTTP upgrade
    WS_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 \
        -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        -H "Sec-WebSocket-Version: 13" \
        -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
        https://ws-feed.exchange.coinbase.com 2>&1)
    
    if [ "$WS_HTTP_CODE" = "101" ] || [ "$WS_HTTP_CODE" = "426" ] || [ "$WS_HTTP_CODE" = "400" ]; then
        echo -e "${GREEN}   WebSocket upgrade possible (HTTP $WS_HTTP_CODE)${NC}"
    elif [ "$WS_HTTP_CODE" = "451" ]; then
        echo -e "${RED}   ❌ GEO-BLOCKED! (HTTP 451)${NC}"
        echo "   This is why your app can't connect!"
    elif [ "$WS_HTTP_CODE" = "403" ]; then
        echo -e "${RED}   ❌ FORBIDDEN! (HTTP 403)${NC}"
    else
        echo -e "${YELLOW}   Response: HTTP $WS_HTTP_CODE${NC}"
    fi
else
    echo -e "${RED}❌ Cannot connect to WebSocket endpoint${NC}"
    echo "   TCP connection to ws-feed.exchange.coinbase.com:443 failed"
    echo "   This could be firewall, network, or geo-blocking"
fi
echo ""

# Test 3b: Real WebSocket subscription test (mimics app behavior)
echo "📡 Test 3b: WebSocket Subscription Test (Real Data)"
echo "-------------------------------------------"
if command -v node > /dev/null 2>&1; then
    echo "   Testing actual WebSocket subscription for BTC-USD..."
    
    # Create a temporary Node.js script to test WebSocket
    WS_TEST_SCRIPT=$(cat << 'EOF'
const WebSocket = require('ws');

const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
let receivedData = false;
let subscribed = false;

const timeout = setTimeout(() => {
    if (!subscribed) {
        console.log('ERROR: Subscription timeout - no response from server');
        process.exit(1);
    } else if (!receivedData) {
        console.log('WARNING: Subscribed but no ticker data received within 10s');
        process.exit(2);
    }
}, 10000);

ws.on('open', () => {
    console.log('CONNECTED: WebSocket connection established');
    
    // Subscribe to BTC-USD ticker (exactly like the app does)
    const subscribeMsg = {
        type: 'subscribe',
        product_ids: ['BTC-USD'],
        channels: ['ticker']
    };
    
    console.log('SUBSCRIBING: ' + JSON.stringify(subscribeMsg));
    ws.send(JSON.stringify(subscribeMsg));
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'subscriptions') {
            subscribed = true;
            console.log('SUBSCRIBED: ' + JSON.stringify(msg));
        } else if (msg.type === 'ticker') {
            receivedData = true;
            console.log('TICKER_DATA: ' + msg.product_id + ' = $' + msg.price + ' (time: ' + msg.time + ')');
            clearTimeout(timeout);
            ws.close();
            process.exit(0);
        } else if (msg.type === 'error') {
            console.log('ERROR: ' + JSON.stringify(msg));
            clearTimeout(timeout);
            process.exit(1);
        }
    } catch (e) {
        console.log('PARSE_ERROR: ' + e.message);
    }
});

ws.on('error', (error) => {
    console.log('WS_ERROR: ' + error.message);
    clearTimeout(timeout);
    process.exit(1);
});

ws.on('close', (code, reason) => {
    console.log('CLOSED: code=' + code + ' reason=' + reason);
    clearTimeout(timeout);
    if (!receivedData) {
        process.exit(1);
    }
});
EOF
)
    
    # Run the WebSocket test
    WS_OUTPUT=$(echo "$WS_TEST_SCRIPT" | node 2>&1)
    WS_EXIT_CODE=$?
    
    if [ $WS_EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}   ✅ WebSocket subscription successful!${NC}"
        echo "$WS_OUTPUT" | grep "TICKER_DATA:" | while read line; do
            echo "      $line"
        done
    elif [ $WS_EXIT_CODE -eq 2 ]; then
        echo -e "${YELLOW}   ⚠️  Subscribed but no data received${NC}"
        echo "$WS_OUTPUT" | while read line; do
            echo "      $line"
        done
        echo ""
        echo "      This could indicate:"
        echo "      • Geo-blocking after connection (data stream blocked)"
        echo "      • Low trading volume (unlikely for BTC-USD)"
        echo "      • Server-side filtering"
    else
        echo -e "${RED}   ❌ WebSocket subscription failed${NC}"
        echo "$WS_OUTPUT" | while read line; do
            echo "      $line"
        done
        echo ""
        if echo "$WS_OUTPUT" | grep -qi "ENOTFOUND\|getaddrinfo"; then
            echo "      Root cause: DNS resolution failure"
        elif echo "$WS_OUTPUT" | grep -qi "ECONNREFUSED"; then
            echo "      Root cause: Connection refused"
        elif echo "$WS_OUTPUT" | grep -qi "timeout"; then
            echo "      Root cause: Connection timeout"
        elif echo "$WS_OUTPUT" | grep -qi "403\|451"; then
            echo "      Root cause: Geo-blocking"
        fi
    fi
else
    echo -e "${YELLOW}   ⚠️  Node.js not found, skipping WebSocket subscription test${NC}"
    echo "      Install Node.js to test actual WebSocket data flow"
fi
echo ""

# Test 4: DNS resolution
echo "📡 Test 4: DNS Resolution"
echo "-------------------------------------------"

# Try multiple DNS resolution methods
DNS_SUCCESS=false

# Method 1: nslookup
echo "   Testing with nslookup..."
NSLOOKUP_OUTPUT=$(nslookup ws-feed.exchange.coinbase.com 2>&1)
if echo "$NSLOOKUP_OUTPUT" | grep -q "Address:"; then
    IP=$(echo "$NSLOOKUP_OUTPUT" | grep "Address:" | tail -1 | awk '{print $2}')
    echo -e "${GREEN}   ✅ nslookup: ws-feed.exchange.coinbase.com → $IP${NC}"
    DNS_SUCCESS=true
else
    echo -e "${RED}   ❌ nslookup failed${NC}"
    if echo "$NSLOOKUP_OUTPUT" | grep -qi "NXDOMAIN"; then
        echo "      Error: Domain does not exist (NXDOMAIN)"
    elif echo "$NSLOOKUP_OUTPUT" | grep -qi "SERVFAIL"; then
        echo "      Error: DNS server failure (SERVFAIL)"
    elif echo "$NSLOOKUP_OUTPUT" | grep -qi "timeout"; then
        echo "      Error: DNS query timeout"
    fi
fi

# Method 2: dig (if available)
if command -v dig > /dev/null 2>&1; then
    echo "   Testing with dig..."
    DIG_OUTPUT=$(dig +short ws-feed.exchange.coinbase.com 2>&1)
    if [ -n "$DIG_OUTPUT" ] && ! echo "$DIG_OUTPUT" | grep -q "connection timed out"; then
        echo -e "${GREEN}   ✅ dig: $DIG_OUTPUT${NC}"
        DNS_SUCCESS=true
    else
        echo -e "${RED}   ❌ dig failed or timed out${NC}"
    fi
fi

# Method 3: host (if available)
if command -v host > /dev/null 2>&1; then
    echo "   Testing with host..."
    HOST_OUTPUT=$(host ws-feed.exchange.coinbase.com 2>&1)
    if echo "$HOST_OUTPUT" | grep -q "has address"; then
        IP=$(echo "$HOST_OUTPUT" | grep "has address" | head -1 | awk '{print $4}')
        echo -e "${GREEN}   ✅ host: ws-feed.exchange.coinbase.com → $IP${NC}"
        DNS_SUCCESS=true
    else
        echo -e "${RED}   ❌ host failed${NC}"
    fi
fi

# Method 4: Try with Google DNS (8.8.8.8)
echo "   Testing with Google DNS (8.8.8.8)..."
GOOGLE_DNS=$(nslookup ws-feed.exchange.coinbase.com 8.8.8.8 2>&1)
if echo "$GOOGLE_DNS" | grep -q "Address:"; then
    IP=$(echo "$GOOGLE_DNS" | grep "Address:" | tail -1 | awk '{print $2}')
    echo -e "${GREEN}   ✅ Google DNS: ws-feed.exchange.coinbase.com → $IP${NC}"
    DNS_SUCCESS=true
else
    echo -e "${RED}   ❌ Google DNS also failed${NC}"
    echo "      This suggests Coinbase may be blocking DNS queries from your region"
fi

# Method 5: Try with Cloudflare DNS (1.1.1.1)
echo "   Testing with Cloudflare DNS (1.1.1.1)..."
CF_DNS=$(nslookup ws-feed.exchange.coinbase.com 1.1.1.1 2>&1)
if echo "$CF_DNS" | grep -q "Address:"; then
    IP=$(echo "$CF_DNS" | grep "Address:" | tail -1 | awk '{print $2}')
    echo -e "${GREEN}   ✅ Cloudflare DNS: ws-feed.exchange.coinbase.com → $IP${NC}"
    DNS_SUCCESS=true
else
    echo -e "${RED}   ❌ Cloudflare DNS also failed${NC}"
fi

# Check current DNS server
echo ""
echo "   Your DNS servers:"
if [ -f /etc/resolv.conf ]; then
    grep "nameserver" /etc/resolv.conf | while read line; do
        echo "      $line"
    done
fi

if [ "$DNS_SUCCESS" = false ]; then
    echo ""
    echo -e "${RED}   🚨 CRITICAL: All DNS resolution methods failed!${NC}"
    echo "      This is likely why Coinbase is failing in your application."
    echo ""
    echo "      Possible causes:"
    echo "      1. DNS-level geo-blocking by Coinbase"
    echo "      2. ISP/datacenter DNS filtering"
    echo "      3. Network firewall blocking DNS queries"
    echo "      4. Coinbase domain not available in your region"
fi
echo ""

# Test 5: Check your public IP and location
echo "📡 Test 5: Your Public IP & Location"
echo "-------------------------------------------"
IP_INFO=$(curl -s https://ipapi.co/json/ 2>&1)
if [ $? -eq 0 ]; then
    IP=$(echo "$IP_INFO" | grep -o '"ip":"[^"]*"' | cut -d'"' -f4)
    COUNTRY=$(echo "$IP_INFO" | grep -o '"country_name":"[^"]*"' | cut -d'"' -f4)
    CITY=$(echo "$IP_INFO" | grep -o '"city":"[^"]*"' | cut -d'"' -f4)
    echo "   IP: $IP"
    echo "   Location: $CITY, $COUNTRY"
    
    if [ "$COUNTRY" = "Belgium" ]; then
        echo -e "${YELLOW}   ⚠️  Belgium is known to have restrictions on some crypto exchanges${NC}"
    fi
else
    echo "   Could not determine location"
fi
echo ""

# Test 6: WebSocket persistence test (30 seconds)
echo "📡 Test 6: WebSocket Persistence Test"
echo "-------------------------------------------"
if command -v node > /dev/null 2>&1; then
    echo "   Testing if WebSocket stays connected and receives continuous data..."
    echo "   (This will take 30 seconds)"
    
    # Create a script that tests sustained connection
    WS_PERSIST_SCRIPT=$(cat << 'EOF'
const WebSocket = require('ws');

const ws = new WebSocket('wss://ws-feed.exchange.coinbase.com');
let messageCount = 0;
let lastMessageTime = 0;
const startTime = Date.now();

const timeout = setTimeout(() => {
    const duration = (Date.now() - startTime) / 1000;
    console.log('RESULT: Received ' + messageCount + ' messages in ' + duration.toFixed(1) + 's');
    
    if (messageCount === 0) {
        console.log('STATUS: FAILED - No data received');
        process.exit(1);
    } else if (messageCount < 5) {
        console.log('STATUS: WARNING - Very few messages (' + messageCount + ')');
        process.exit(2);
    } else {
        const avgRate = messageCount / duration;
        console.log('STATUS: SUCCESS - Avg rate: ' + avgRate.toFixed(2) + ' msg/s');
        process.exit(0);
    }
}, 30000);

ws.on('open', () => {
    const subscribeMsg = {
        type: 'subscribe',
        product_ids: ['BTC-USD', 'ETH-USD'],
        channels: ['ticker']
    };
    ws.send(JSON.stringify(subscribeMsg));
});

ws.on('message', (data) => {
    try {
        const msg = JSON.parse(data.toString());
        
        if (msg.type === 'ticker') {
            messageCount++;
            lastMessageTime = Date.now();
            
            // Log first message and every 10th message
            if (messageCount === 1 || messageCount % 10 === 0) {
                console.log('MSG_' + messageCount + ': ' + msg.product_id + ' = $' + msg.price);
            }
        }
    } catch (e) {
        // Ignore parse errors
    }
});

ws.on('error', (error) => {
    console.log('ERROR: ' + error.message);
    clearTimeout(timeout);
    process.exit(1);
});

ws.on('close', (code, reason) => {
    console.log('CLOSED: Unexpected close (code=' + code + ')');
    clearTimeout(timeout);
    process.exit(1);
});
EOF
)
    
    # Run the persistence test
    WS_PERSIST_OUTPUT=$(echo "$WS_PERSIST_SCRIPT" | node 2>&1)
    WS_PERSIST_EXIT=$?
    
    if [ $WS_PERSIST_EXIT -eq 0 ]; then
        echo -e "${GREEN}   ✅ WebSocket connection stable${NC}"
        echo "$WS_PERSIST_OUTPUT" | grep -E "MSG_|RESULT|STATUS" | while read line; do
            echo "      $line"
        done
    elif [ $WS_PERSIST_EXIT -eq 2 ]; then
        echo -e "${YELLOW}   ⚠️  Connection works but data flow is limited${NC}"
        echo "$WS_PERSIST_OUTPUT" | grep -E "MSG_|RESULT|STATUS" | while read line; do
            echo "      $line"
        done
        echo ""
        echo "      Possible causes:"
        echo "      • Geo-blocking with rate limiting"
        echo "      • Connection throttling"
        echo "      • Intermittent connectivity"
    else
        echo -e "${RED}   ❌ WebSocket connection unstable or blocked${NC}"
        echo "$WS_PERSIST_OUTPUT" | while read line; do
            echo "      $line"
        done
    fi
else
    echo -e "${YELLOW}   ⚠️  Node.js not found, skipping persistence test${NC}"
fi
echo ""

# Test 7: Check application logs for Coinbase errors
echo "📡 Test 7: Application Logs Check"
echo "-------------------------------------------"
if docker ps | grep -q ftso; then
    echo "   Checking Docker logs for Coinbase errors..."
    
    # Check for connection status
    CONNECTED=$(docker logs ftso 2>&1 | grep -i "coinbase.*connected" | tail -1)
    if [ -n "$CONNECTED" ]; then
        echo -e "${GREEN}   ✅ Found connection log:${NC}"
        echo "      $CONNECTED"
    fi
    
    # Check for errors
    ERRORS=$(docker logs ftso 2>&1 | grep -i "coinbase.*error\|error.*coinbase" | tail -3)
    if [ -n "$ERRORS" ]; then
        echo -e "${RED}   ❌ Found errors:${NC}"
        echo "$ERRORS" | while read line; do
            echo "      $line"
        done
    fi
    
    # Check for unhealthy status
    UNHEALTHY=$(docker logs ftso 2>&1 | grep -i "coinbase.*unhealthy" | tail -1)
    if [ -n "$UNHEALTHY" ]; then
        echo -e "${YELLOW}   ⚠️  Unhealthy status:${NC}"
        echo "      $UNHEALTHY"
    fi
else
    echo "   Docker container 'ftso' not running"
    echo "   Start with: docker-compose up -d"
fi
echo ""

# Summary and Recommendations
echo "📋 Summary & Recommendations"
echo "========================================"
echo ""

# Check for DNS failure first (most critical)
if [ "$DNS_SUCCESS" = false ]; then
    echo -e "${RED}🚨 DNS RESOLUTION FAILURE DETECTED${NC}"
    echo ""
    echo "Coinbase domains cannot be resolved from your location."
    echo "This is the ROOT CAUSE of your connectivity issues."
    echo ""
    echo "Why this happens:"
    echo "• Coinbase uses DNS-level geo-blocking for restricted regions"
    echo "• Belgium has strict crypto regulations"
    echo "• DNS servers return NXDOMAIN or SERVFAIL for blocked regions"
    echo ""
    echo "Solutions (in order of preference):"
    echo ""
    echo "1. Use a SOCKS5 proxy with DNS resolution:"
    echo "   WEBSOCKET_PROXY_ENABLED=true"
    echo "   WEBSOCKET_PROXY_URL=socks5://proxy-server:1080"
    echo "   (Proxy must resolve DNS, not just forward traffic)"
    echo ""
    echo "2. Use a VPN that handles DNS:"
    echo "   • Ensure VPN routes DNS queries through VPN tunnel"
    echo "   • Test: nslookup ws-feed.exchange.coinbase.com"
    echo ""
    echo "3. Change DNS servers (may not work if geo-blocked):"
    echo "   • Try Google DNS: 8.8.8.8, 8.8.4.4"
    echo "   • Try Cloudflare DNS: 1.1.1.1, 1.0.0.1"
    echo ""
    echo "4. Disable Coinbase source (last resort):"
    echo "   • Edit feeds.json to remove coinbase"
    echo "   • Use other exchanges only"
    echo ""
# Check if geo-blocked via HTTP
elif echo "$API_RESPONSE $WS_TEST" | grep -q "451"; then
    echo -e "${RED}🚨 HTTP GEO-BLOCKING DETECTED${NC}"
    echo ""
    echo "DNS works, but Coinbase is blocking HTTP/WebSocket connections."
    echo ""
    echo "Solutions:"
    echo "1. Enable proxy in your .env file:"
    echo "   WEBSOCKET_PROXY_ENABLED=true"
    echo "   WEBSOCKET_PROXY_URL=socks5://your-proxy-server:1080"
    echo ""
    echo "2. Use a VPN service"
    echo ""
    echo "3. Disable Coinbase adapter (not recommended):"
    echo "   Remove coinbase from your feeds.json sources"
    echo ""
elif [ "$HTTP_CODE" = "200" ] && [ "$WS_HTTP_CODE" = "426" ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "Coinbase is accessible from your location."
    echo "If you're still having issues, check:"
    echo "1. Docker container logs: docker logs ftso"
    echo "2. Application logs for specific errors"
    echo "3. Network configuration in docker-compose.yml"
else
    echo -e "${YELLOW}⚠️  Mixed results${NC}"
    echo ""
    echo "Some tests failed. Check the details above."
    echo "Common issues:"
    echo "- Firewall blocking WebSocket connections"
    echo "- Network configuration issues"
    echo "- Temporary Coinbase outage"
fi

echo ""
echo "💡 Quick Diagnosis Guide:"
echo "-------------------------------------------"
echo "• DNS fails → Use proxy with DNS resolution or VPN"
echo "• HTTP 451/403 → Geo-blocking, enable proxy"
echo "• WebSocket connects but no data → Possible rate limiting or filtering"
echo "• Connection drops quickly → Circuit breaker opening, check app logs"
echo ""
echo "For more help, see: docs/troubleshooting-geo-blocking.md"
