#!/bin/bash

# Complete proxy testing suite - fetches proxies, tests them, and generates compatibility matrix
# Usage: ./scripts/proxy/run-full-test.sh

# Don't exit on errors - we handle them gracefully
set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
RESULTS_FILE="$RESULTS_DIR/proxy-test-results.json"
MATRIX_FILE="$RESULTS_DIR/adapter-compatibility-matrix.md"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🚀 FTSO Proxy Testing Suite${NC}"
echo "============================"
echo ""

# Check dependencies
if ! command -v jq > /dev/null 2>&1; then
    echo -e "${RED}❌ jq is required but not installed${NC}"
    echo "   Install: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

if ! command -v docker > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is required${NC}"
    exit 1
fi

mkdir -p "$RESULTS_DIR"

# ============================================================================
# STEP 1: FETCH AND TEST FREE PROXIES
# ============================================================================
echo -e "${YELLOW}📥 Step 1/4: Fetching free proxies...${NC}"

TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

WORKING_PROXIES=()
TARGET_PROXIES=12  # Aim for 12 different regions (increased for better coverage)

# Track which countries we already have proxies for
declare -a FOUND_COUNTRIES

# Use only the most reliable sources (based on testing)
echo "   Downloading proxy lists from reliable sources..."

# Source 1: ProxyScrape API (most reliable, updated frequently)
echo "   Source 1: ProxyScrape API..."
timeout 30 curl -s "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all" \
    -o "$TEMP_DIR/proxyscrape.txt" 2>/dev/null || true

if [ -s "$TEMP_DIR/proxyscrape.txt" ]; then
    PROXY_COUNT=$(wc -l < "$TEMP_DIR/proxyscrape.txt")
    echo "   ✅ Downloaded $PROXY_COUNT proxies from ProxyScrape"
fi

# Source 2: GitHub - monosans (updated hourly, good quality)
echo "   Source 2: GitHub monosans..."
timeout 30 curl -s "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt" \
    -o "$TEMP_DIR/monosans.txt" 2>/dev/null || true

if [ -s "$TEMP_DIR/monosans.txt" ]; then
    PROXY_COUNT=$(wc -l < "$TEMP_DIR/monosans.txt")
    echo "   ✅ Downloaded $PROXY_COUNT proxies from monosans"
fi

# Source 3: Proxy-List.download API
echo "   Source 3: Proxy-List.download..."
timeout 30 curl -s "https://www.proxy-list.download/api/v1/get?type=http" \
    -o "$TEMP_DIR/proxylistdownload.txt" 2>/dev/null || true

if [ -s "$TEMP_DIR/proxylistdownload.txt" ]; then
    PROXY_COUNT=$(wc -l < "$TEMP_DIR/proxylistdownload.txt")
    echo "   ✅ Downloaded $PROXY_COUNT proxies from Proxy-List.download"
fi

# Combine and deduplicate
cat "$TEMP_DIR"/*.txt 2>/dev/null | \
    grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$' | \
    sort -u > "$TEMP_DIR/all_proxies.txt"

TOTAL_PROXIES=$(wc -l < "$TEMP_DIR/all_proxies.txt" 2>/dev/null || echo "0")

if [ "$TOTAL_PROXIES" -eq 0 ]; then
    echo -e "${RED}❌ Failed to download any proxy lists${NC}"
    echo "   This could be due to network issues or blocked access."
    echo ""
    echo "   You can manually create scripts/proxy/proxy-list.txt with format:"
    echo "   http://proxy:port|Region Name"
    exit 1
fi

echo "   Total unique proxies: $TOTAL_PROXIES"
echo ""

# Filter proxies by target countries and organize by country
echo "   Filtering proxies by target regions..."

# Priority order: diverse regions across continents
TARGET_COUNTRIES=(
    "ES"  # Spain (Europe - Southwest)
    "DE"  # Germany (Europe - Central)
    "BR"  # Brazil (South America)
    "SG"  # Singapore (Asia)
    "US"  # USA (North America)
    "FR"  # France (Europe - West)
    "JP"  # Japan (Asia)
    "CA"  # Canada (North America)
    "MX"  # Mexico (Latin America)
    "NL"  # Netherlands (Europe)
    "BE"  # Belgium (Europe)
    "GB"  # UK (Europe)
    "FI"  # Finland (Europe - North)
    "IT"  # Italy (Europe - South)
    "IL"  # Israel (Middle East)
    "IN"  # India (Asia)
)

# Organize proxies by country
CHECKED=0
MAX_CHECK=300

# Create country-specific files
for country in "${TARGET_COUNTRIES[@]}"; do
    touch "$TEMP_DIR/country_${country}.txt"
done

echo "   Checking proxy locations..."
while IFS= read -r proxy && [ $CHECKED -lt $MAX_CHECK ]; do
    CHECKED=$((CHECKED + 1))
    
    # Extract IP
    if [[ $proxy =~ ^([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+):([0-9]+)$ ]]; then
        IP="${BASH_REMATCH[1]}"
        
        # Get full location info (country code, country name, city)
        LOCATION=$(timeout 2 curl -s "http://ip-api.com/json/${IP}?fields=countryCode,country,city" 2>/dev/null)
        COUNTRY_CODE=$(echo "$LOCATION" | jq -r '.countryCode // ""' 2>/dev/null)
        COUNTRY_NAME=$(echo "$LOCATION" | jq -r '.country // ""' 2>/dev/null)
        CITY=$(echo "$LOCATION" | jq -r '.city // ""' 2>/dev/null)
        
        # Save to country-specific file with location
        for target in "${TARGET_COUNTRIES[@]}"; do
            if [ "$COUNTRY_CODE" = "$target" ]; then
                # Only save first 5 proxies per country
                COUNT=$(wc -l < "$TEMP_DIR/country_${target}.txt" 2>/dev/null || echo "0")
                if [ "$COUNT" -lt 5 ]; then
                    # Save proxy with location: proxy|City, Country
                    if [ -n "$CITY" ] && [ -n "$COUNTRY_NAME" ]; then
                        echo "$proxy|$CITY, $COUNTRY_NAME" >> "$TEMP_DIR/country_${target}.txt"
                    else
                        echo "$proxy|$COUNTRY_NAME" >> "$TEMP_DIR/country_${target}.txt"
                    fi
                fi
                break
            fi
        done
    fi
    
    # Rate limit
    [ $((CHECKED % 15)) -eq 0 ] && sleep 1
    
    # Show progress
    [ $((CHECKED % 50)) -eq 0 ] && echo "   Checked $CHECKED proxies..."
done < "$TEMP_DIR/all_proxies.txt"

# Combine proxies with locations, prioritizing diversity (one from each country first)
> "$TEMP_DIR/filtered_proxies_with_locations.txt"
for country in "${TARGET_COUNTRIES[@]}"; do
    if [ -s "$TEMP_DIR/country_${country}.txt" ]; then
        head -1 "$TEMP_DIR/country_${country}.txt" >> "$TEMP_DIR/filtered_proxies_with_locations.txt"
    fi
done

# Add more proxies from countries that have them (up to 2 per country)
for country in "${TARGET_COUNTRIES[@]}"; do
    if [ -s "$TEMP_DIR/country_${country}.txt" ]; then
        tail -n +2 "$TEMP_DIR/country_${country}.txt" | head -1 >> "$TEMP_DIR/filtered_proxies_with_locations.txt"
    fi
done

# Create filtered_proxies.txt without locations for testing
cut -d'|' -f1 "$TEMP_DIR/filtered_proxies_with_locations.txt" > "$TEMP_DIR/filtered_proxies.txt"

FILTERED_COUNT=$(wc -l < "$TEMP_DIR/filtered_proxies.txt" 2>/dev/null || echo "0")

if [ "$FILTERED_COUNT" -gt 0 ]; then
    echo "   ✅ Filtered to $FILTERED_COUNT proxies across multiple regions"
    
    # Show distribution
    echo "   Distribution:"
    for country in "${TARGET_COUNTRIES[@]}"; do
        COUNT=$(wc -l < "$TEMP_DIR/country_${country}.txt" 2>/dev/null || echo "0")
        [ "$COUNT" -gt 0 ] && echo "      $country: $COUNT proxies"
    done
else
    echo "   ⚠️  No proxies found in target regions, using all proxies"
    cp "$TEMP_DIR/all_proxies.txt" "$TEMP_DIR/filtered_proxies.txt"
fi

echo ""
echo "   Testing proxies for connectivity and quality..."

# Test proxies in batches with multiple test endpoints
# Increased limits to find more working proxies
TESTED=0
MAX_TEST=400  # Test more proxies
BATCH_SIZE=40  # Larger batches for speed

# Test endpoints (use multiple to increase success rate)
# Use faster, more reliable endpoints for proxy testing
TEST_ENDPOINTS=(
    "http://httpbin.org/ip"
    "https://api.kraken.com/0/public/Time"
    "http://ip-api.com/json/"
)

echo "   Testing proxies in batches of $BATCH_SIZE..."

while IFS= read -r proxy && [ $TESTED -lt $MAX_TEST ] && [ ${#WORKING_PROXIES[@]} -lt $TARGET_PROXIES ]; do
    TESTED=$((TESTED + 1))
    
    # Test in background for speed
    (
        # Try multiple endpoints - if at least 2 work, proxy is good
        SUCCESS_COUNT=0
        
        for endpoint in "${TEST_ENDPOINTS[@]}"; do
            if timeout 6 curl -s --proxy "http://$proxy" \
                --connect-timeout 4 --max-time 5 \
                "$endpoint" > /dev/null 2>&1; then
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
            fi
        done
        
        # Only accept proxies that work on at least 2 endpoints
        if [ "$SUCCESS_COUNT" -ge 2 ]; then
            echo "$proxy" >> "$TEMP_DIR/working.txt"
        fi
    ) &
    
    # Wait after each batch
    if [ $((TESTED % BATCH_SIZE)) -eq 0 ]; then
        wait
        
        # Collect working proxies
        if [ -f "$TEMP_DIR/working.txt" ]; then
            # Remove duplicates
            sort -u "$TEMP_DIR/working.txt" > "$TEMP_DIR/working_unique.txt"
            
            while IFS= read -r working_proxy; do
                if [[ ! " ${WORKING_PROXIES[@]} " =~ " ${working_proxy} " ]]; then
                    WORKING_PROXIES+=("$working_proxy")
                    echo "   ✅ Working proxy found: $working_proxy"
                fi
            done < "$TEMP_DIR/working_unique.txt"
            
            rm -f "$TEMP_DIR/working.txt" "$TEMP_DIR/working_unique.txt"
        fi
        
        # Stop if we have enough diverse proxies
        if [ ${#WORKING_PROXIES[@]} -ge $TARGET_PROXIES ]; then
            echo "   Found $TARGET_PROXIES working proxies across different regions, stopping tests..."
            break
        fi
        
        echo "   Progress: Tested $TESTED proxies, found ${#WORKING_PROXIES[@]} working..."
    fi
done < "$TEMP_DIR/filtered_proxies.txt"

# Wait for final batch
wait

# Collect final results
if [ -f "$TEMP_DIR/working.txt" ]; then
    sort -u "$TEMP_DIR/working.txt" > "$TEMP_DIR/working_unique.txt"
    
    while IFS= read -r working_proxy; do
        if [[ ! " ${WORKING_PROXIES[@]} " =~ " ${working_proxy} " ]]; then
            WORKING_PROXIES+=("$working_proxy")
            echo "   ✅ Working proxy found: $working_proxy"
        fi
    done < "$TEMP_DIR/working_unique.txt"
fi

if [ ${#WORKING_PROXIES[@]} -eq 0 ]; then
    echo "   No HTTP proxies worked, trying SOCKS5 proxies..."
    
    # Try SOCKS5 as fallback
    echo "   Downloading SOCKS5 proxy lists..."
    timeout 30 curl -s "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000&country=all" \
        -o "$TEMP_DIR/socks5.txt" 2>/dev/null || true
    
    timeout 30 curl -s "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt" \
        >> "$TEMP_DIR/socks5.txt" 2>/dev/null || true
    
    timeout 30 curl -s "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt" \
        >> "$TEMP_DIR/socks5.txt" 2>/dev/null || true
    
    if [ -s "$TEMP_DIR/socks5.txt" ]; then
        sort -u "$TEMP_DIR/socks5.txt" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+$' > "$TEMP_DIR/socks5_clean.txt"
        SOCKS_COUNT=$(wc -l < "$TEMP_DIR/socks5_clean.txt")
        echo "   Found $SOCKS_COUNT SOCKS5 proxies, testing..."
        
        TESTED_SOCKS=0
        while IFS= read -r proxy && [ $TESTED_SOCKS -lt 50 ] && [ ${#WORKING_PROXIES[@]} -lt $TARGET_PROXIES ]; do
            TESTED_SOCKS=$((TESTED_SOCKS + 1))
            
            (
                if timeout 6 curl -s --proxy "socks5://$proxy" \
                    --connect-timeout 4 --max-time 5 \
                    "http://httpbin.org/ip" > /dev/null 2>&1; then
                    echo "socks5://$proxy" >> "$TEMP_DIR/working_socks.txt"
                fi
            ) &
            
            if [ $((TESTED_SOCKS % 10)) -eq 0 ]; then
                wait
                if [ -f "$TEMP_DIR/working_socks.txt" ]; then
                    while IFS= read -r working_proxy; do
                        WORKING_PROXIES+=("$working_proxy")
                        echo "   ✅ Working SOCKS5 proxy found: $working_proxy"
                    done < "$TEMP_DIR/working_socks.txt"
                    rm "$TEMP_DIR/working_socks.txt"
                fi
                [ ${#WORKING_PROXIES[@]} -ge $TARGET_PROXIES ] && break
            fi
        done < "$TEMP_DIR/socks5_clean.txt"
        
        wait
        if [ -f "$TEMP_DIR/working_socks.txt" ]; then
            while IFS= read -r working_proxy; do
                WORKING_PROXIES+=("$working_proxy")
                echo "   ✅ Working SOCKS5 proxy found: $working_proxy"
            done < "$TEMP_DIR/working_socks.txt"
        fi
    fi
fi

if [ ${#WORKING_PROXIES[@]} -eq 0 ]; then
    echo -e "${RED}❌ No working proxies found after testing $TESTED HTTP and SOCKS5 proxies${NC}"
    echo ""
    echo "   This can happen because:"
    echo "   - Free proxies have very low success rates (often <5%)"
    echo "   - Proxies go offline quickly"
    echo "   - Your network may be blocking proxy connections"
    echo ""
    echo "   Solutions:"
    echo "   1. Run the script again (proxy availability changes constantly)"
    echo "   2. Try from a different network"
    echo "   3. Use paid proxies (much more reliable):"
    echo "      - Webshare: https://www.webshare.io/ (10 free proxies)"
    echo "      - Bright Data: https://brightdata.com/"
    echo ""
    exit 1
fi

echo ""
echo "   Loading proxy locations from filtering step..."

# Read locations from the file we created during filtering
PROXY_CONFIGS=()
if [ -f "$TEMP_DIR/filtered_proxies_with_locations.txt" ]; then
    while IFS='|' read -r proxy region; do
        # Only include proxies that are in WORKING_PROXIES
        for working_proxy in "${WORKING_PROXIES[@]}"; do
            if [ "$proxy" = "$working_proxy" ]; then
                PROXY_CONFIGS+=("$proxy|$region")
                echo "   📍 $region"
                break
            fi
        done
    done < "$TEMP_DIR/filtered_proxies_with_locations.txt"
else
    echo "   ⚠️  Location file not found, using proxies without locations"
    for proxy in "${WORKING_PROXIES[@]}"; do
        PROXY_CONFIGS+=("$proxy|Unknown Location")
    done
fi

echo ""
echo "   📊 Selected ${#PROXY_CONFIGS[@]} proxies for testing"

echo ""
echo -e "${GREEN}✅ Found ${#PROXY_CONFIGS[@]} working proxies${NC}"
echo ""

# ============================================================================
# STEP 2: TEST ADAPTERS THROUGH EACH PROXY
# ============================================================================
echo -e "${YELLOW}🔬 Step 2/4: Testing adapters through proxies...${NC}"
echo "   This will take approximately $((${#PROXY_CONFIGS[@]} * 2)) minutes"
echo ""

# Backup original .env
[ -f "$PROJECT_ROOT/.env" ] && cp "$PROJECT_ROOT/.env" "$PROJECT_ROOT/.env.backup"

# No Docker build needed - using local app
echo "   ℹ️  Will test using local app (no Docker)"
echo ""

echo "[" > "$RESULTS_FILE"
FIRST=true
COUNT=0

for proxy_config in "${PROXY_CONFIGS[@]}"; do
    COUNT=$((COUNT + 1))
    IFS='|' read -r PROXY_URL REGION <<< "$proxy_config"
    
    echo -e "${BLUE}Testing [$COUNT/${#WORKING_PROXIES[@]}]: $REGION${NC}"
    
    # Ensure proxy URL has protocol prefix
    PROXY_WITH_PROTOCOL="$PROXY_URL"
    if [[ ! "$PROXY_URL" =~ ^(http|socks5):// ]]; then
        PROXY_WITH_PROTOCOL="http://$PROXY_URL"
    fi
    
    echo "   🔧 Using proxy: $PROXY_WITH_PROTOCOL"
    
    # Verify proxy is working and routing through expected region
    if [ "$COUNT" -eq 1 ]; then
        echo "   🔍 Verifying proxy routes through correct region..."
        PROXY_IP_CHECK=$(timeout 5 curl -s --proxy "$PROXY_WITH_PROTOCOL" "http://ip-api.com/json/" 2>/dev/null || echo "{}")
        PROXY_COUNTRY=$(echo "$PROXY_IP_CHECK" | jq -r '.country // "Unknown"' 2>/dev/null)
        PROXY_CITY=$(echo "$PROXY_IP_CHECK" | jq -r '.city // "Unknown"' 2>/dev/null)
        echo "   📍 Proxy appears to be in: $PROXY_CITY, $PROXY_COUNTRY"
        
        # Compare with expected region
        if [[ "$REGION" == *"$PROXY_COUNTRY"* ]] || [[ "$REGION" == *"$PROXY_CITY"* ]]; then
            echo "   ✅ Proxy location matches expected region"
        else
            echo "   ⚠️  Warning: Proxy location ($PROXY_CITY, $PROXY_COUNTRY) doesn't match expected ($REGION)"
        fi
        echo ""
    fi
    
    # Stop any running app
    cd "$PROJECT_ROOT"
    pkill -f "nest start" 2>/dev/null || true
    sleep 2
    
    # Start app in background with proxy env vars
    echo "   🚀 Starting app with proxy..."
    echo "   🔍 Proxy config: WEBSOCKET_PROXY_ENABLED=true, WEBSOCKET_PROXY_URL=$PROXY_WITH_PROTOCOL"
    
    # Start app with env vars set inline (ensures they're available at startup)
    WEBSOCKET_PROXY_ENABLED=true WEBSOCKET_PROXY_URL="$PROXY_WITH_PROTOCOL" pnpm start > /tmp/ftso-proxy-test.log 2>&1 &
    APP_PID=$!
    
    echo "   ⏳ Waiting for app to start..."
    
    # Wait for app to be ready (max 120 seconds - CCXT needs more time with proxies)
    WAIT_TIME=0
    MAX_WAIT=120
    APP_READY=false
    
    while [ $WAIT_TIME -lt $MAX_WAIT ]; do
        sleep 5
        WAIT_TIME=$((WAIT_TIME + 5))
        
        # Try health endpoint
        HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/health 2>/dev/null || echo "000")
        
        if [ "$HEALTH_CHECK" = "200" ]; then
            APP_READY=true
            echo "   ✅ App ready after ${WAIT_TIME}s"
            break
        fi
        
        # Check if process is still running
        if ! kill -0 $APP_PID 2>/dev/null; then
            echo "   ⚠️  App process died, checking logs..."
            tail -20 /tmp/ftso-proxy-test.log
            break
        fi
        
        [ $((WAIT_TIME % 20)) -eq 0 ] && echo "   ⏳ Still waiting... (${WAIT_TIME}s)"
    done
    
    if [ "$APP_READY" = false ]; then
        echo "   ⚠️  App didn't become ready, checking logs..."
        tail -30 /tmp/ftso-proxy-test.log
    else
        # Give adapters extra time to stabilize through proxy
        # CCXT handles 11 exchanges, Binance needs stable connection
        if [ "$COUNT" -eq 1 ]; then
            echo "   ⏳ Giving adapters extra time to initialize through proxy (60s)..."
            echo "      - CCXT initializing 11 exchanges"
            echo "      - Binance establishing WebSocket connection"
            sleep 60
        else
            echo "   ⏳ Waiting for adapters to stabilize (30s)..."
            sleep 30
        fi
        
        # Check health again after stabilization
        echo "   🔍 Checking adapter health after stabilization..."
    fi
    
    # Verify proxy is being used (check logs for proxy mentions)
    if [ "$COUNT" -eq 1 ]; then
        echo "   🔍 Checking if proxy is being used..."
        sleep 2  # Give app time to log proxy usage
        if grep -qi "using proxy" /tmp/ftso-proxy-test.log; then
            echo "   ✅ Proxy configuration found in logs:"
            grep -i "using proxy" /tmp/ftso-proxy-test.log | head -5
        else
            echo "   ⚠️  WARNING: No 'Using proxy' messages in logs!"
            echo "   This means the proxy is NOT being used by the adapters."
            echo "   Checking for any proxy-related messages..."
            grep -i "proxy" /tmp/ftso-proxy-test.log | head -10 || echo "   No proxy mentions at all!"
        fi
        echo ""
    fi
    
    # Get health status (with retry for more accurate results)
    HEALTH=$(curl -s http://localhost:3101/health 2>&1 || echo '{}')
    
    # Check if Binance or CCXT are unhealthy - give them one more chance
    BINANCE_UNHEALTHY=$(echo "$HEALTH" | jq -r '.sources.unhealthy.binance // ""' 2>/dev/null)
    CCXT_UNHEALTHY=$(echo "$HEALTH" | jq -r '.sources.unhealthy.ccxt // ""' 2>/dev/null)
    
    if [ -n "$BINANCE_UNHEALTHY" ] || [ -n "$CCXT_UNHEALTHY" ]; then
        if [ "$COUNT" -eq 1 ]; then
            echo "   ⏳ Binance or CCXT unhealthy, waiting 30s more for retry..."
            sleep 30
            HEALTH=$(curl -s http://localhost:3101/health 2>&1 || echo '{}')
            echo "   🔍 Rechecked health status"
        fi
    fi
    
    # Parse results
    RESULT_JSON=$(cat << EOF
{
  "proxy": "$PROXY_URL",
  "region": "$REGION",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "adapters": {
EOF
)
    
    # All adapters in your app
    ADAPTERS=("coinbase" "binance" "kraken" "cryptocom" "okx" "ccxt")
    ADAPTER_FIRST=true
    
    # Debug: show health response and check for issues
    if [ "$COUNT" -eq 1 ]; then
        echo "   📋 Health response sample:"
        echo "$HEALTH" | jq '.' 2>/dev/null || echo "   (Invalid JSON or no response)"
        echo ""
        
        # Check for CCXT specific errors
        CCXT_ERROR=$(echo "$HEALTH" | jq -r '.sources.unhealthy.ccxt.error // ""' 2>/dev/null)
        CCXT_LAST_ERROR=$(echo "$HEALTH" | jq -r '.sources.unhealthy.ccxt.lastError // ""' 2>/dev/null)
        
        if [ -n "$CCXT_ERROR" ] && [ "$CCXT_ERROR" != "null" ] && [ "$CCXT_ERROR" != "" ]; then
            echo "   ⚠️  CCXT Error: $CCXT_ERROR"
        fi
        if [ -n "$CCXT_LAST_ERROR" ] && [ "$CCXT_LAST_ERROR" != "null" ] && [ "$CCXT_LAST_ERROR" != "" ]; then
            echo "   ⚠️  CCXT Last Error: $CCXT_LAST_ERROR"
        fi
        
        if [ -n "$CCXT_ERROR" ] || [ -n "$CCXT_LAST_ERROR" ]; then
            echo "   Checking logs for CCXT issues..."
            grep -i "ccxt" /tmp/ftso-proxy-test.log | grep -i "error\|fail\|warn" | tail -10
        fi
        echo ""
    fi
    
    for adapter in "${ADAPTERS[@]}"; do
        [ "$ADAPTER_FIRST" = false ] && RESULT_JSON="${RESULT_JSON},"
        ADAPTER_FIRST=false
        
        # Check if adapter is in healthy array
        IS_HEALTHY=$(echo "$HEALTH" | jq -r ".sources.healthy[]? | select(. == \"$adapter\")" 2>/dev/null)
        
        if [ -n "$IS_HEALTHY" ]; then
            echo "      ✅ $adapter - HEALTHY"
            RESULT_JSON="${RESULT_JSON}
    \"$adapter\": {\"status\": \"healthy\", \"working\": true}"
        else
            # Try to get error from unhealthy sources
            ERROR=$(echo "$HEALTH" | jq -r ".sources.unhealthy.${adapter}.error // \"No error info\"" 2>/dev/null)
            LAST_ERROR=$(echo "$HEALTH" | jq -r ".sources.unhealthy.${adapter}.lastError // \"\"" 2>/dev/null)
            
            if [ -n "$LAST_ERROR" ] && [ "$LAST_ERROR" != "null" ]; then
                ERROR="$LAST_ERROR"
            fi
            
            # Analyze error type to distinguish geo-blocking from connection issues
            ERROR_TYPE="unknown"
            if [[ "$ERROR" == *"403"* ]] || [[ "$ERROR" == *"Forbidden"* ]] || [[ "$ERROR" == *"not available"* ]] || [[ "$ERROR" == *"restricted"* ]]; then
                ERROR_TYPE="geo-block"
            elif [[ "$ERROR" == *"timeout"* ]] || [[ "$ERROR" == *"closed"* ]] || [[ "$ERROR" == *"hang up"* ]] || [[ "$ERROR" == *"ECONNRESET"* ]]; then
                ERROR_TYPE="connection"
            elif [[ "$ERROR" == *"inactivity"* ]] || [[ "$ERROR" == *"No data"* ]]; then
                ERROR_TYPE="inactivity"
            fi
            
            # Add context for common failures
            if [ "$adapter" = "binance" ]; then
                if [ "$ERROR_TYPE" = "geo-block" ]; then
                    echo "      ❌ $adapter - GEO-BLOCKED ($ERROR)"
                elif [ "$ERROR_TYPE" = "connection" ]; then
                    echo "      ❌ $adapter - CONNECTION ISSUE ($ERROR)"
                    [ "$COUNT" -eq 1 ] && echo "         Note: Likely proxy quality, not geo-blocking"
                else
                    echo "      ❌ $adapter - UNHEALTHY ($ERROR)"
                fi
            elif [ "$adapter" = "ccxt" ]; then
                if [ "$ERROR_TYPE" = "inactivity" ]; then
                    echo "      ❌ $adapter - INACTIVE ($ERROR)"
                    [ "$COUNT" -eq 1 ] && echo "         Note: CCXT handles 11 exchanges, may need more time"
                else
                    echo "      ❌ $adapter - UNHEALTHY ($ERROR)"
                fi
            else
                if [ "$ERROR_TYPE" = "geo-block" ]; then
                    echo "      ❌ $adapter - GEO-BLOCKED ($ERROR)"
                else
                    echo "      ❌ $adapter - UNHEALTHY ($ERROR)"
                fi
            fi
            
            RESULT_JSON="${RESULT_JSON}
    \"$adapter\": {\"status\": \"unhealthy\", \"working\": false, \"error\": \"$ERROR\"}"
        fi
    done
    
    RESULT_JSON="${RESULT_JSON}
  }
}"
    
    [ "$FIRST" = false ] && echo "," >> "$RESULTS_FILE"
    FIRST=false
    echo "$RESULT_JSON" >> "$RESULTS_FILE"
    
    # Stop app
    kill $APP_PID 2>/dev/null || true
    pkill -f "nest start" 2>/dev/null || true
    sleep 2
    echo ""
done

# Final cleanup
echo "   🧹 Cleaning up..."
pkill -f "nest start" 2>/dev/null || true

echo "]" >> "$RESULTS_FILE"

# Restore .env
[ -f "$PROJECT_ROOT/.env.backup" ] && mv "$PROJECT_ROOT/.env.backup" "$PROJECT_ROOT/.env"
rm -f "$PROJECT_ROOT/.env.test"

echo -e "${GREEN}✅ Adapter testing complete${NC}"
echo ""

# ============================================================================
# STEP 3: GENERATE COMPATIBILITY MATRIX
# ============================================================================
echo -e "${YELLOW}📊 Step 3/4: Generating compatibility matrix...${NC}"

cat > "$MATRIX_FILE" << EOF
# Exchange Adapter Compatibility Matrix

**Test Date:** $(date -u +%Y-%m-%d\ %H:%M:%S) UTC

## Results

| Region | Coinbase | Binance | Kraken | Crypto.com | OKX | CCXT |
|--------|----------|---------|--------|------------|-----|------|
EOF

# Add rows
RESULT_COUNT=$(jq 'length' "$RESULTS_FILE")
for i in $(seq 0 $((RESULT_COUNT - 1))); do
    REGION=$(jq -r ".[$i].region" "$RESULTS_FILE")
    ROW="| $REGION |"
    
    for adapter in coinbase binance kraken cryptocom okx ccxt; do
        WORKING=$(jq -r ".[$i].adapters.${adapter}.working // false" "$RESULTS_FILE")
        [ "$WORKING" = "true" ] && ROW="$ROW ✅ |" || ROW="$ROW ❌ |"
    done
    
    echo "$ROW" >> "$MATRIX_FILE"
done

# Add summary
cat >> "$MATRIX_FILE" << EOF

## Summary

EOF

for adapter in coinbase binance kraken cryptocom okx ccxt; do
    TOTAL=$(jq "[.[].adapters.${adapter}] | length" "$RESULTS_FILE")
    SUCCESS=$(jq "[.[].adapters.${adapter}] | map(select(.working == true)) | length" "$RESULTS_FILE")
    PERCENT=$((SUCCESS * 100 / TOTAL))
    ADAPTER_NAME=$(echo $adapter | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')
    echo "- **${ADAPTER_NAME}**: ${SUCCESS}/${TOTAL} regions (${PERCENT}%)" >> "$MATRIX_FILE"
done

echo -e "${GREEN}✅ Matrix generated${NC}"
echo ""

# ============================================================================
# FINAL SUMMARY
# ============================================================================
echo -e "${GREEN}🎉 Testing Complete!${NC}"
echo "===================="
echo ""
echo "📁 Results:"
echo "   JSON: $RESULTS_FILE"
echo "   Matrix: $MATRIX_FILE"
echo ""
echo "📊 Summary:"
jq -r '.[] | "   \(.region): \([.adapters | to_entries[] | select(.value.working == true)] | length)/6 adapters working"' "$RESULTS_FILE"
echo ""
echo "💡 View matrix: cat $MATRIX_FILE"
echo ""

# ============================================================================
# RESULT INTERPRETATION
# ============================================================================
echo -e "${YELLOW}📊 Result Interpretation:${NC}"
echo ""

# Analyze Binance results
BINANCE_SUCCESS=$(jq '[.[].adapters.binance] | map(select(.working == true)) | length' "$RESULTS_FILE")
BINANCE_TOTAL=$(jq '[.[].adapters.binance] | length' "$RESULTS_FILE")

if [ "$BINANCE_SUCCESS" -eq 0 ]; then
    echo "⚠️  Binance: 0% success rate"
    echo "   This suggests proxy quality issues, not geo-blocking"
    echo "   Expected: Fail in US only, work elsewhere"
    echo "   Recommendation: Test with paid proxies for accurate results"
elif [ "$BINANCE_SUCCESS" -eq "$BINANCE_TOTAL" ]; then
    echo "✅ Binance: 100% success rate"
    echo "   Either proxies are working well, or none are in blocked regions"
    echo "   Note: Binance blocks US and Singapore (retail)"
else
    echo "✅ Binance: Partial success ($BINANCE_SUCCESS/$BINANCE_TOTAL)"
    echo "   This suggests real geo-blocking patterns detected"
    echo "   Check which regions failed - likely US or Singapore"
fi

echo ""

# Analyze CCXT results
CCXT_SUCCESS=$(jq '[.[].adapters.ccxt] | map(select(.working == true)) | length' "$RESULTS_FILE")
CCXT_TOTAL=$(jq '[.[].adapters.ccxt] | length' "$RESULTS_FILE")

if [ "$CCXT_SUCCESS" -eq 0 ]; then
    echo "⚠️  CCXT: 0% success rate"
    echo "   Likely needs more initialization time or better proxies"
    echo "   CCXT handles 11 exchanges: bitget, bitmart, bitstamp, bybit, etc."
    echo "   Recommendation: Increase wait time or use paid proxies"
elif [ "$CCXT_SUCCESS" -eq "$CCXT_TOTAL" ]; then
    echo "✅ CCXT: 100% success rate"
    echo "   All CCXT exchanges working through proxies"
else
    echo "✅ CCXT: Partial success ($CCXT_SUCCESS/$CCXT_TOTAL)"
    echo "   Some regions working, check matrix for details"
fi

echo ""

# Overall assessment
TOTAL_TESTS=$((BINANCE_TOTAL * 6))  # 6 adapters
TOTAL_SUCCESS=$(jq '[.[].adapters | to_entries[] | select(.value.working == true)] | length' "$RESULTS_FILE")
SUCCESS_RATE=$((TOTAL_SUCCESS * 100 / TOTAL_TESTS))

echo "📈 Overall Success Rate: ${SUCCESS_RATE}%"
echo ""

if [ "$SUCCESS_RATE" -lt 50 ]; then
    echo "⚠️  Low success rate suggests proxy quality issues"
    echo "   Consider using paid proxy service for accurate testing"
elif [ "$SUCCESS_RATE" -gt 90 ]; then
    echo "✅ High success rate - proxies working well"
    echo "   Results likely reflect actual geo-blocking patterns"
else
    echo "✅ Moderate success rate - mixed results"
    echo "   Some adapters affected by proxy quality, others working well"
fi

echo ""
echo "📚 For detailed analysis, see:"
echo "   - scripts/proxy/FINDINGS.md"
echo "   - scripts/proxy/ANALYSIS.md"
