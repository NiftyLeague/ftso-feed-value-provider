#!/bin/bash
# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"

# Integration & Orchestration Debugging Script
# Tests service initialization, inter-service communication, event flow, and orchestration

echo "🔗 FTSO Integration & Orchestration Debugger"
echo "============================================"

# Ensure logs directory exists

# Configuration
TIMEOUT=90

# Set up logging using common utility
setup_debug_logging "integration-debug"
LOG_FILE="$DEBUG_LOG_FILE"

echo "📝 Starting integration system analysis..."

# Start the application in background
pnpm start:dev > "$LOG_FILE" 2>&1 &
APP_PID=$!

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring integration systems for $TIMEOUT seconds..."

# Monitor for the specified timeout
sleep $TIMEOUT

# Check if process is still running
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ Application is running"
    echo "🛑 Stopping application for analysis..."
    kill $APP_PID 2>/dev/null
    wait $APP_PID 2>/dev/null
else
    echo "❌ Application stopped unexpectedly"
fi

echo ""
echo "🔗 Integration System Analysis:"
echo "==============================="

if [ -f "$LOG_FILE" ]; then
    echo "🚀 Service Initialization Analysis:"
    echo "-----------------------------------"
    
    # Core integration services
    INTEGRATION_SERVICE=$(grep -c "IntegrationService.*initialized" "$LOG_FILE")
    echo "🔗 Integration services initialized: $INTEGRATION_SERVICE"
    
    DATA_SOURCE_INTEGRATION=$(grep -c "DataSourceIntegrationService.*initialized" "$LOG_FILE")
    echo "📊 Data source integration services: $DATA_SOURCE_INTEGRATION"
    
    PRICE_AGGREGATION_COORD=$(grep -c "PriceAggregationCoordinatorService.*initialized" "$LOG_FILE")
    echo "💰 Price aggregation coordinators: $PRICE_AGGREGATION_COORD"
    
    SYSTEM_HEALTH_SERVICE=$(grep -c "SystemHealthService.*initialized" "$LOG_FILE")
    echo "🏥 System health services: $SYSTEM_HEALTH_SERVICE"
    
    WEBSOCKET_ORCHESTRATOR=$(grep -c "WebSocketOrchestratorService.*initialized" "$LOG_FILE")
    echo "🌐 WebSocket orchestrators: $WEBSOCKET_ORCHESTRATOR"
    
    # Module initialization order
    echo ""
    echo "📦 Module Initialization Order:"
    echo "------------------------------"
    grep -E "(Module dependencies initialized)" "$LOG_FILE" | head -10
    
    # Service initialization timing
    echo ""
    echo "⏱️  Service Initialization Timing:"
    echo "----------------------------------"
    
    # Extract initialization timing
    INIT_START=$(grep -n "Starting Integration Orchestrator initialization" "$LOG_FILE" | head -1 | cut -d: -f1)
    INIT_COMPLETE=$(grep -n "Integration.*initialization.*completed" "$LOG_FILE" | head -1 | cut -d: -f1)
    
    if [ -n "$INIT_START" ] && [ -n "$INIT_COMPLETE" ]; then
        INIT_DURATION=$((INIT_COMPLETE - INIT_START))
        echo "📊 Integration initialization span: $INIT_DURATION log lines"
    fi
    
    echo ""
    echo "🔄 Data Source Integration Analysis:"
    echo "-----------------------------------"
    
    # Data source registration
    DATA_SOURCES_REGISTERED=$(grep -c "Registered data source" "$LOG_FILE")
    echo "📊 Data sources registered: $DATA_SOURCES_REGISTERED"
    
    # Data source connections
    DATA_SOURCE_CONNECTIONS=$(grep -c "Data source.*connected" "$LOG_FILE")
    echo "🔌 Data source connections: $DATA_SOURCE_CONNECTIONS"
    
    # Data source health
    DATA_SOURCE_HEALTHY=$(grep -c "Data source.*is healthy" "$LOG_FILE")
    echo "✅ Healthy data sources: $DATA_SOURCE_HEALTHY"
    
    # Show data source registration details
    echo ""
    echo "Data source registration details:"
    grep -E "(Registered data source)" "$LOG_FILE" | head -6
    
    # Data flow connections
    echo ""
    echo "🌊 Data Flow Analysis:"
    echo "---------------------"
    
    DATA_FLOW_CONNECTIONS=$(grep -c "Data flow connections established" "$LOG_FILE")
    echo "🌊 Data flow connections: $DATA_FLOW_CONNECTIONS"
    
    WIRING_EVENTS=$(grep -c "Wiring.*connections\|wiring.*connections" "$LOG_FILE")
    echo "🔗 Service wiring events: $WIRING_EVENTS"
    
    # Service interactions
    SERVICE_INTERACTIONS=$(grep -c "Service interactions.*wired\|wiring.*service.*interactions" "$LOG_FILE")
    echo "🤝 Service interactions: $SERVICE_INTERACTIONS"
    
    echo ""
    echo "🎯 Orchestration Analysis:"
    echo "-------------------------"
    
    # WebSocket orchestration
    WS_ORCHESTRATION=$(grep -c "WebSocket orchestrator.*initialized" "$LOG_FILE")
    echo "🌐 WebSocket orchestration: $WS_ORCHESTRATION"
    
    # Feed orchestration
    FEED_ORCHESTRATION=$(grep -c "feed.*orchestration\|Feed.*orchestration" "$LOG_FILE")
    echo "📊 Feed orchestration events: $FEED_ORCHESTRATION"
    
    # Connection orchestration
    CONNECTION_ORCHESTRATION=$(grep -c "connection.*orchestration\|Connection.*orchestration" "$LOG_FILE")
    echo "🔌 Connection orchestration: $CONNECTION_ORCHESTRATION"
    
    # Exchange orchestration
    EXCHANGE_ORCHESTRATION=$(grep -c "exchange.*orchestration\|Exchange.*orchestration" "$LOG_FILE")
    echo "🏦 Exchange orchestration: $EXCHANGE_ORCHESTRATION"
    
    echo ""
    echo "📡 Event Flow Analysis:"
    echo "----------------------"
    
    # Event emissions
    EVENT_EMISSIONS=$(grep -c "emit\|Event.*emitted" "$LOG_FILE")
    echo "📡 Event emissions: $EVENT_EMISSIONS"
    
    # Event listeners
    EVENT_LISTENERS=$(grep -c "event.*listener\|Event.*listener\|addEventListener" "$LOG_FILE")
    echo "👂 Event listeners: $EVENT_LISTENERS"
    
    # Event handlers
    EVENT_HANDLERS=$(grep -c "event.*handler\|Event.*handler" "$LOG_FILE")
    echo "🎯 Event handlers: $EVENT_HANDLERS"
    
    # Critical operation events
    CRITICAL_OPERATIONS=$(grep -c "Critical Operation.*completed successfully" "$LOG_FILE")
    echo "⚡ Critical operations completed: $CRITICAL_OPERATIONS"
    
    if [ $CRITICAL_OPERATIONS -gt 0 ]; then
        echo ""
        echo "Recent critical operations:"
        grep -E "(Critical Operation.*completed successfully)" "$LOG_FILE" | tail -5
    fi
    
    echo ""
    echo "🔄 Service Communication Analysis:"
    echo "---------------------------------"
    
    # Inter-service communication
    INTER_SERVICE_COMM=$(grep -c "service.*communication\|Service.*communication" "$LOG_FILE")
    echo "🤝 Inter-service communications: $INTER_SERVICE_COMM"
    
    # Service callbacks
    SERVICE_CALLBACKS=$(grep -c "callback.*configured\|Callback.*configured" "$LOG_FILE")
    echo "📞 Service callbacks configured: $SERVICE_CALLBACKS"
    
    # Service dependencies
    SERVICE_DEPENDENCIES=$(grep -c "dependencies initialized" "$LOG_FILE")
    echo "🔗 Service dependencies: $SERVICE_DEPENDENCIES"
    
    echo ""
    echo "⚡ Performance Integration Analysis:"
    echo "----------------------------------"
    
    # Performance coordination
    PERF_COORDINATION=$(grep -c "Performance.*coordination\|performance.*coordination" "$LOG_FILE")
    echo "📈 Performance coordination events: $PERF_COORDINATION"
    
    # Cache integration
    CACHE_INTEGRATION=$(grep -c "Cache.*integration\|cache.*integration" "$LOG_FILE")
    echo "💾 Cache integration events: $CACHE_INTEGRATION"
    
    # Monitoring integration
    MONITORING_INTEGRATION=$(grep -c "Monitoring.*integration\|monitoring.*integration" "$LOG_FILE")
    echo "📊 Monitoring integration events: $MONITORING_INTEGRATION"
    
    echo ""
    echo "🏥 Health Integration Analysis:"
    echo "------------------------------"
    
    # Health monitoring integration
    HEALTH_MONITORING=$(grep -c "Health monitoring.*started\|health.*monitoring.*started" "$LOG_FILE")
    echo "🏥 Health monitoring systems: $HEALTH_MONITORING"
    
    # System health initialization
    SYSTEM_HEALTH_INIT=$(grep -c "system.*health.*initialization" "$LOG_FILE")
    echo "🏥 System health initializations: $SYSTEM_HEALTH_INIT"
    
    # Health service wiring
    HEALTH_WIRING=$(grep -c "health.*service.*wiring\|Health.*service.*wiring" "$LOG_FILE")
    echo "🔗 Health service wiring: $HEALTH_WIRING"
    
    echo ""
    echo "🚨 Integration Issues Analysis:"
    echo "------------------------------"
    
    # Integration errors
    INTEGRATION_ERRORS=$(grep -c "integration.*error\|Integration.*error" "$LOG_FILE")
    echo "❌ Integration errors: $INTEGRATION_ERRORS"
    
    # Service initialization failures
    INIT_FAILURES=$(grep -c "initialization.*failed\|Initialization.*failed" "$LOG_FILE")
    echo "❌ Initialization failures: $INIT_FAILURES"
    
    # Connection failures
    CONNECTION_FAILURES=$(grep -c "connection.*failed\|Connection.*failed" "$LOG_FILE")
    echo "❌ Connection failures: $CONNECTION_FAILURES"
    
    # Wiring failures
    WIRING_FAILURES=$(grep -c "wiring.*failed\|Wiring.*failed" "$LOG_FILE")
    echo "❌ Wiring failures: $WIRING_FAILURES"
    
    if [ $((INTEGRATION_ERRORS + INIT_FAILURES + CONNECTION_FAILURES + WIRING_FAILURES)) -gt 0 ]; then
        echo ""
        echo "Recent integration issues:"
        grep -E "(integration.*error|initialization.*failed|connection.*failed|wiring.*failed)" "$LOG_FILE" | tail -5
    fi
    
    echo ""
    echo "📊 Integration Metrics:"
    echo "----------------------"
    
    # Timing metrics
    TIMING_METRICS=$(grep -c "duration.*ms\|took.*ms\|completed in.*ms" "$LOG_FILE")
    echo "⏱️  Timing measurements: $TIMING_METRICS"
    
    # Performance metrics
    PERFORMANCE_METRICS=$(grep -c "performance.*metric\|Performance.*metric" "$LOG_FILE")
    echo "📈 Performance metrics: $PERFORMANCE_METRICS"
    
    # Show some timing examples
    if [ $TIMING_METRICS -gt 0 ]; then
        echo ""
        echo "Sample timing metrics:"
        grep -E "(duration.*ms|took.*ms|completed in.*ms)" "$LOG_FILE" | head -5
    fi
    
    echo ""
    echo "🎯 Integration Recommendations:"
    echo "==============================="
    
    # Provide recommendations based on analysis
    if [ $INTEGRATION_ERRORS -gt 0 ]; then
        echo "🔧 ERRORS: Integration errors detected"
        echo "   - Review error messages above"
        echo "   - Check service dependencies"
        echo "   - Validate service initialization order"
    fi
    
    if [ $INIT_FAILURES -gt 0 ]; then
        echo "🔧 INITIALIZATION: Service initialization failures"
        echo "   - Review service startup sequence"
        echo "   - Check service dependencies"
        echo "   - Validate configuration settings"
    fi
    
    if [ $DATA_SOURCES_REGISTERED -lt 5 ]; then
        echo "🔧 DATA SOURCES: Few data sources registered"
        echo "   - Review data source configuration"
        echo "   - Check adapter availability"
        echo "   - Validate exchange connections"
    fi
    
    if [ $SERVICE_INTERACTIONS -eq 0 ]; then
        echo "🔧 INTERACTIONS: No service interactions detected"
        echo "   - Verify service wiring"
        echo "   - Check event flow configuration"
        echo "   - Review integration service setup"
    fi
    
    if [ $CRITICAL_OPERATIONS -lt 5 ]; then
        echo "🔧 OPERATIONS: Few critical operations completed"
        echo "   - Review operation execution"
        echo "   - Check service readiness"
        echo "   - Validate integration completeness"
    fi
    
    if [ $EVENT_EMISSIONS -eq 0 ]; then
        echo "🔧 EVENTS: No event emissions detected"
        echo "   - Verify event system setup"
        echo "   - Check event emitter configuration"
        echo "   - Review service communication"
    fi
    
    # Overall integration assessment
    echo ""
    echo "📊 Overall Integration Health:"
    echo "============================="
    
    integration_score=100
    
    if [ $INTEGRATION_ERRORS -gt 0 ]; then
        integration_score=$((integration_score - 25))
    fi
    
    if [ $INIT_FAILURES -gt 0 ]; then
        integration_score=$((integration_score - 20))
    fi
    
    if [ $CONNECTION_FAILURES -gt 0 ]; then
        integration_score=$((integration_score - 15))
    fi
    
    if [ $DATA_SOURCES_REGISTERED -lt 5 ]; then
        integration_score=$((integration_score - 15))
    fi
    
    if [ $SERVICE_INTERACTIONS -eq 0 ]; then
        integration_score=$((integration_score - 10))
    fi
    
    if [ $CRITICAL_OPERATIONS -lt 5 ]; then
        integration_score=$((integration_score - 10))
    fi
    
    if [ $integration_score -ge 90 ]; then
        echo "🎉 EXCELLENT: Integration system is performing optimally (Score: $integration_score/100)"
    elif [ $integration_score -ge 75 ]; then
        echo "✅ GOOD: Integration system is performing well (Score: $integration_score/100)"
    elif [ $integration_score -ge 60 ]; then
        echo "⚠️  FAIR: Integration system needs some attention (Score: $integration_score/100)"
    else
        echo "❌ POOR: Integration system requires immediate attention (Score: $integration_score/100)"
    fi
    
else
    echo "❌ No log file found"
fi

echo ""
echo "✨ Integration analysis complete!"
echo "📁 Detailed logs available at: $LOG_FILE"