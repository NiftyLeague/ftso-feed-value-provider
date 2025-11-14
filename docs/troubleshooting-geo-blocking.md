# Troubleshooting Geo-Blocking and HTTP 451 Errors

## Problem: WebSocket Connection Failures with HTTP 451

If you're seeing errors like this in your logs:

```
Error: Unexpected server response: 451
WebSocket was closed before the connection was established
Circuit breaker opened for binance
```

This indicates that the exchange (e.g., Binance) is blocking connections from
your VM's geographic location or network. HTTP 451 means "Unavailable For Legal
Reasons" - the service is restricted in your region.

## Solutions

### Option 1: Use a Proxy (Recommended for Production)

Configure the application to route WebSocket connections through a proxy server
located in an allowed region.

#### Step 1: Get a Proxy

You'll need access to a proxy server in a region where the exchange is
available. Options include:

- **Commercial proxy services**: Bright Data, Oxylabs, SmartProxy
- **VPN providers with proxy support**: NordVPN, ExpressVPN
- **Self-hosted proxy**: Set up a proxy server in an allowed region (AWS,
  DigitalOcean, etc.)

##### Recommended Proxy Services

For production use, consider these reliable proxy providers:

1. **Bright Data** (formerly Luminati) - Enterprise-grade, expensive but
   reliable
2. **Oxylabs** - Good balance of price and performance
3. **SmartProxy** - Affordable residential proxies
4. **ProxyMesh** - Simple rotating proxies
5. **Self-hosted** - Use a VPS in an allowed region with Squid proxy

##### Setting Up a Self-Hosted Proxy

If you want to set up your own proxy server:

```bash
# On a VPS in an allowed region (e.g., AWS us-east-1)
sudo apt-get update
sudo apt-get install squid

# Configure Squid
sudo nano /etc/squid/squid.conf

# Add these lines:
# http_port 3128
# acl allowed_ips src YOUR_VM_IP/32
# http_access allow allowed_ips
# http_access deny all

# Restart Squid
sudo systemctl restart squid

# Test from your VM
curl -x http://YOUR_VPS_IP:3128 https://api.binance.com/api/v3/ping
```

Then use in your configuration:

```bash
WEBSOCKET_PROXY_URL=http://YOUR_VPS_IP:3128
```

#### Step 2: Configure Proxy in Docker

Edit your `docker-compose.registry.yml` or create a `.env` file:

```bash
# Enable proxy
WEBSOCKET_PROXY_ENABLED=true

# Set proxy URL (replace with your actual proxy)
WEBSOCKET_PROXY_URL=http://proxy.example.com:8080

# If proxy requires authentication:
WEBSOCKET_PROXY_URL=http://username:password@proxy.example.com:8080

# For SOCKS5 proxy:
WEBSOCKET_PROXY_URL=socks5://proxy.example.com:1080
```

#### Step 3: Restart the Container

```bash
# Stop the current container
docker-compose -f docker-compose.registry.yml down

# Start with new configuration
WEBSOCKET_PROXY_ENABLED=true WEBSOCKET_PROXY_URL=http://your-proxy:8080 \
  docker-compose -f docker-compose.registry.yml up -d

# Check logs
docker-compose -f docker-compose.registry.yml logs -f ftso-provider
```

You should see log messages indicating proxy usage:

```
Using proxy for binance: http://your-proxy:8080
WebSocket connected for binance
```

### Option 2: Use a VPN on the VM

Install and configure a VPN client on your VM to route all traffic through an
allowed region.

#### For Ubuntu/Debian:

```bash
# Install OpenVPN
sudo apt-get update
sudo apt-get install openvpn

# Configure with your VPN provider's config file
sudo openvpn --config /path/to/vpn-config.ovpn
```

#### For Docker with VPN:

Use a VPN container to route traffic:

```yaml
services:
  vpn:
    image: dperson/openvpn-client
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun
    volumes:
      - /path/to/vpn:/vpn
    command: '-f "" -r 192.168.1.0/24'

  ftso-provider:
    network_mode: "service:vpn"
    depends_on:
      - vpn
```

### Option 3: Relocate Your VM

Move your VM to a cloud region where the exchange is accessible:

- **AWS**: Use regions like us-east-1, eu-west-1, ap-southeast-1
- **DigitalOcean**: Choose data centers in US, Europe, or Singapore
- **Google Cloud**: Select regions in allowed countries

### Option 4: Disable Affected Exchanges

If you can't use a proxy or VPN, disable the blocked exchanges and rely on
others:

1. Edit your feeds configuration to remove blocked exchanges
2. Ensure you have enough alternative data sources for price aggregation
3. Monitor data quality to ensure sufficient coverage

## Verifying the Fix

After implementing a solution, verify it's working:

```bash
# Check logs for successful connections
docker-compose -f docker-compose.registry.yml logs -f ftso-provider | grep "WebSocket connected"

# Check for HTTP 451 errors (should be none)
docker-compose -f docker-compose.registry.yml logs ftso-provider | grep "451"

# Monitor circuit breaker status
docker-compose -f docker-compose.registry.yml logs ftso-provider | grep "Circuit breaker"
```

## Testing Proxy Configuration Locally

Before deploying to production, test your proxy configuration:

```bash
# Test with curl
curl -x http://your-proxy:8080 https://api.binance.com/api/v3/ping

# Test WebSocket connection through proxy
wscat -c wss://stream.binance.com:9443/ws/!ticker@arr --proxy http://your-proxy:8080
```

## Common Proxy Issues

### Authentication Failures

If your proxy requires authentication, ensure credentials are URL-encoded:

```bash
# Special characters must be encoded
# @ becomes %40, : becomes %3A, etc.
WEBSOCKET_PROXY_URL=http://user%40domain:p%40ssw0rd@proxy.example.com:8080
```

### Proxy Connection Timeout

Increase connection timeout if proxy is slow:

```bash
WEBSOCKET_CONNECTION_TIMEOUT_MS=60000
```

### Proxy Not Supporting WebSocket

Ensure your proxy supports WebSocket protocol (CONNECT method). Not all HTTP
proxies support WebSocket tunneling.

## Monitoring After Fix

Monitor these metrics to ensure the fix is working:

1. **Connection success rate**: Should be >95%
2. **Circuit breaker status**: Should remain closed
3. **Data freshness**: Should have recent timestamps
4. **Error logs**: No more HTTP 451 errors

## Additional Resources

- [Binance API Documentation](https://binance-docs.github.io/apidocs/)
- [WebSocket Proxy Configuration](https://github.com/websockets/ws#external-https-proxy)
- [Docker Networking](https://docs.docker.com/network/)

## Support

If you continue experiencing issues after trying these solutions, check:

1. Proxy server logs for connection attempts
2. VM firewall rules (ensure outbound connections are allowed)
3. DNS resolution (ensure exchange domains resolve correctly)
4. Network latency (high latency can cause timeouts)
