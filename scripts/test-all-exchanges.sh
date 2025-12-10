#!/bin/bash

# Test All Exchange Connections
# Quick test to see which exchanges are accessible from your location

echo "🔍 Testing All Exchange Connections"
echo "===================================="
echo ""

# Exchange endpoints
declare -A EXCHANGES=(
    ["binance"]="https://api.binance.com/api/v3/ping"
    ["coinbase"]="https://api.coinbase.com/v2/time"
    ["kraken"]="https://api.kraken.com/0/public/Time"
    ["okx"]="https://www.okx.com/api/v5/public/time"
    ["cryptocom"]="https://api.crypto.com/v2/public/get-ticker"
)

declare -A WS_ENDPOINTS=(
    ["binance"]="wss://stream.binance.com:9443/ws"
    ["coinbase"]="wss://ws-feed.exchange.coinbase.com"
    ["kraken"]="wss://ws.kraken.com"
    ["okx"]="wss://ws.okx.com:8443/ws/v5/public"
    ["cryptocom"]="wss://stream.crypto.com/v2/market"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Testing REST API Endpoints:"
echo "----------------------------"

for exchange in "${!EXCHANGES[@]}"; do
    url="${EXCHANGES[$exchange]}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$url" 2>&1)
    
    printf "%-12s " "$exchange:"
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ OK (HTTP $HTTP_CODE)${NC}"
    elif [ "$HTTP_CODE" = "451" ]; then
        echo -e "${RED}❌ GEO-BLOCKED (HTTP 451)${NC}"
    elif [ "$HTTP_CODE" = "403" ]; then
        echo -e "${RED}❌ FORBIDDEN (HTTP 403)${NC}"
    elif [ "$HTTP_CODE" = "000" ]; then
        echo -e "${RED}❌ CONNECTION FAILED${NC}"
    else
        echo -e "${YELLOW}⚠️  HTTP $HTTP_CODE${NC}"
    fi
done

echo ""
echo "Testing WebSocket Endpoints:"
echo "----------------------------"

for exchange in "${!WS_ENDPOINTS[@]}"; do
    url="${WS_ENDPOINTS[$exchange]}"
    # Try to connect to WebSocket endpoint
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 \
        -H "Connection: Upgrade" \
        -H "Upgrade: websocket" \
        "${url/wss:/https:}" 2>&1)
    
    printf "%-12s " "$exchange:"
    if [ "$HTTP_CODE" = "426" ] || [ "$HTTP_CODE" = "101" ] || [ "$HTTP_CODE" = "400" ]; then
        echo -e "${GREEN}✅ ACCESSIBLE${NC}"
    elif [ "$HTTP_CODE" = "451" ]; then
        echo -e "${RED}❌ GEO-BLOCKED (HTTP 451)${NC}"
    elif [ "$HTTP_CODE" = "403" ]; then
        echo -e "${RED}❌ FORBIDDEN (HTTP 403)${NC}"
    elif [ "$HTTP_CODE" = "000" ]; then
        echo -e "${RED}❌ CONNECTION FAILED${NC}"
    else
        echo -e "${YELLOW}⚠️  HTTP $HTTP_CODE${NC}"
    fi
done

echo ""
echo "Your Location:"
echo "----------------------------"
IP_INFO=$(curl -s https://ipapi.co/json/ 2>&1)
if [ $? -eq 0 ]; then
    IP=$(echo "$IP_INFO" | grep -o '"ip":"[^"]*"' | cut -d'"' -f4)
    COUNTRY=$(echo "$IP_INFO" | grep -o '"country_name":"[^"]*"' | cut -d'"' -f4)
    CITY=$(echo "$IP_INFO" | grep -o '"city":"[^"]*"' | cut -d'"' -f4)
    echo "IP: $IP"
    echo "Location: $CITY, $COUNTRY"
else
    echo "Could not determine location"
fi

echo ""
