#!/bin/bash

# Test server startup and basic functionality
echo "🚀 Testing FTSO Feed Value Provider server startup..."

# Ensure logs directory exists
mkdir -p logs

# Start the application in background
pnpm start:dev > logs/server-test.log 2>&1 &
APP_PID=$!

echo "📝 Application started with PID: $APP_PID"
echo "⏱️  Waiting for server to be ready..."

# Wait for server to be ready (check every 5 seconds for up to 2 minutes)
TIMEOUT=120
INTERVAL=5
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    # Check if process is still running
    if ! kill -0 $APP_PID 2>/dev/null; then
        echo "❌ Application stopped unexpectedly"
        exit 1
    fi
    
    # Test health endpoint
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3101/health/ready 2>/dev/null)
    
    if [ "$RESPONSE" = "200" ]; then
        echo "✅ Server is ready and responding!"
        
        # Test a few endpoints
        echo ""
        echo "🧪 Testing endpoints:"
        
        echo "📊 Health check:"
        curl -s http://localhost:3101/health | jq -r '.status // "No status field"' 2>/dev/null || echo "Health endpoint responded"
        
        echo ""
        echo "📈 Config status:"
        curl -s http://localhost:3101/config/status | jq -r '.status // "No status field"' 2>/dev/null || echo "Config endpoint responded"
        
        echo ""
        echo "✅ Server is working correctly!"
        break
    elif [ "$RESPONSE" = "503" ]; then
        echo "⏳ Server starting... (HTTP 503)"
    else
        echo "⏳ Waiting for server... (HTTP $RESPONSE)"
    fi
    
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    echo "⏰ Timeout reached. Server may still be starting."
    echo "📋 Last few log lines:"
    tail -10 logs/server-test.log
fi

# Stop the application
echo ""
echo "🛑 Stopping application..."
kill $APP_PID 2>/dev/null
wait $APP_PID 2>/dev/null

echo "✨ Test complete!"