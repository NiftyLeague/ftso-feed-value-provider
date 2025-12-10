# Proxy Testing Suite

Automatically test which exchange adapters work in different geographic regions.

## Quick Start

### Full Automated Test (Free Proxies)

```bash
# Run everything - fully automated
./scripts/proxy/run-full-test.sh
```

The script will:

1. **Fetch** free proxies from multiple sources (ProxyScrape, GitHub lists)
2. **Filter** by target regions (ES, DE, BR, SG, US, FR, JP, CA, MX, NL, BE, GB,
   FI, IT, IL, IN)
3. **Test** proxies for connectivity and quality (measures latency)
4. **Run** your app locally through each working proxy
5. **Generate** compatibility matrix with result interpretation

**Improvements**:

- Tests up to 400 proxies (increased from 200)
- Requires proxies to work on 2+ test endpoints (quality check)
- Increased wait times for CCXT (120s + 60s stabilization)
- Retry logic for Binance and CCXT
- Distinguishes geo-blocking from connection errors
- Result interpretation guide

**Time:** 15-25 minutes total (depends on proxy availability)

### Paid Proxy Test (Recommended for Accuracy)

```bash
# Test with paid proxies for accurate results
./scripts/proxy/test-with-paid-proxies.sh
```

First run creates a template. Add your paid proxies to
`scripts/proxy/paid-proxies.txt`:

```
http://username:password@proxy.webshare.io:80|United States
http://username:password@proxy.webshare.io:80|Germany
http://username:password@proxy.webshare.io:80|Singapore
```

**Benefits**:

- 95-99% success rate (vs 5-10% for free)
- Low latency (50-200ms vs 500-2000ms)
- Accurate geo-blocking detection
- Reliable Binance and CCXT testing

**Time:** 5-10 minutes per proxy

### Quick Proxy Configuration Test

To verify proxy configuration is working correctly:

```bash
./scripts/proxy/test-proxy-config.sh [proxy_url]
```

Example:

```bash
./scripts/proxy/test-proxy-config.sh http://138.68.60.8:3128
```

This will test if the proxy is being used by the app and show adapter health.

## What It Does

### Step 1: Fetch Proxies

Downloads from multiple free sources:

- ProxyScrape API
- GitHub: TheSpeedX/PROXY-List
- GitHub: monosans/proxy-list
- GitHub: clarketm/proxy-list

Typically finds 10,000+ proxies

### Step 2: Test Proxies

Tests proxies in parallel batches of 20:

- Connects with 3s timeout
- Tests against Binance API (fast endpoint)
- Stops after finding 5 working proxies

### Step 3: Geolocate

Uses ip-api.com to determine proxy location

### Step 4: Test Adapters

For each working proxy:

- Updates `.env` with proxy URL
- Starts Docker container
- Waits 60s for initialization
- Checks `/health` endpoint
- Records which adapters work

### Step 5: Generate Matrix

Creates markdown table and JSON results

## Output

**Matrix** (`results/adapter-compatibility-matrix.md`):

```
| Region          | Coinbase | Binance | Kraken | Bitfinex | Bitstamp | KuCoin |
|-----------------|----------|---------|--------|----------|----------|--------|
| Madrid, Spain   | ✅       | ✅      | ✅     | ✅       | ✅       | ✅     |
| Berlin, Germany | ✅       | ✅      | ✅     | ✅       | ✅       | ✅     |
| Brussels, Belgium| ❌      | ✅      | ✅     | ✅       | ✅       | ✅     |
```

**JSON** (`results/proxy-test-results.json`):

- Full adapter status per region
- Error messages for failed adapters
- Timestamps and proxy URLs

## Requirements

- Docker and docker-compose
- curl
- jq: `brew install jq` (macOS) or `apt-get install jq` (Linux)

## Troubleshooting

### Proxy Not Being Used

If you see "No 'Using proxy' messages in logs", the proxy configuration isn't
being applied:

1. Verify env vars are set BEFORE app starts:

   ```bash
   WEBSOCKET_PROXY_ENABLED=true WEBSOCKET_PROXY_URL=http://proxy:port pnpm start
   ```

2. Check the base adapter logs for "Using proxy for [adapter]" messages

3. Run the quick test script to diagnose:
   ```bash
   ./scripts/proxy/test-proxy-config.sh http://your-proxy:port
   ```

### CCXT Adapter Failing

CCXT adapter may fail for several reasons:

1. **No exchanges configured**: Check feeds.json for CCXT-only exchanges
2. **Connection issues**: CCXT uses different connection methods than other
   adapters
3. **Proxy compatibility**: Some CCXT exchanges may not support proxy
   connections

Check logs for CCXT-specific errors:

```bash
grep -i "ccxt" /tmp/ftso-proxy-test.log | grep -i "error\|fail"
```

### Expected Behavior

- **Binance**: Should FAIL in United States (geo-blocked)
- **Coinbase**: Should FAIL in some EU regions (geo-blocked)
- **Kraken, OKX, Crypto.com**: Should work in most regions
- **CCXT**: Depends on configured exchanges

**Important**: If all adapters pass in all regions, the proxy is likely NOT
being used!

### Other Issues

**"Failed to download any proxy lists":**

- Check internet connection
- Try running again
- Some networks block proxy list sites

**"No working proxies found":**

- Free proxies are often dead/slow
- Run script again (availability changes constantly)
- Consider using paid proxies (see below)

**"Health endpoint not accessible":**

```bash
# Check app logs
tail -50 /tmp/ftso-proxy-test.log

# Stop and retry
pkill -f "nest start"
./scripts/proxy/run-full-test.sh
```

## Using Your Own Proxies

If you have paid proxies or want to test specific ones:

```bash
# Create proxy list
nano scripts/proxy/proxy-list.txt
```

Format (one per line):

```
http://proxy1:port|Region Name
http://proxy2:port|Another Region
```

The script will use this file if it exists instead of fetching free proxies.

## Paid Proxy Services

For more reliable testing:

- **Webshare**: https://www.webshare.io/ (10 free, then $2.99/month)
- **Bright Data**: https://brightdata.com/
- **Smartproxy**: https://smartproxy.com/
- **Oxylabs**: https://oxylabs.io/

## Notes

- Free proxies have ~5-10% success rate
- Script filters by target regions BEFORE testing for efficiency
- Aims for 1-2 proxies per country for geographic diversity
- Tests against LOCAL app (not Docker) for faster iteration
- Tests ALL adapters: coinbase, binance, kraken, cryptocom, okx, ccxt
- Proxy configuration must be set BEFORE app startup to take effect
- Total runtime: 10-20 minutes
- Results vary based on proxy availability
