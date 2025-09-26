#!/bin/bash

# Comprehensive FTSO System Debugger
# Runs all debugging scripts in sequence for complete system analysis

echo "🔍 FTSO Comprehensive System Debugger"
echo "================================================================================"
echo "This script will run all debugging tools to provide a complete system analysis."
echo ""

# Ensure logs directory exists
mkdir -p logs

# Create debug directory
DEBUG_DIR="logs/debug"
mkdir -p "$DEBUG_DIR"

echo "📁 Debug directory: $DEBUG_DIR"
echo "⏱️  Starting comprehensive analysis..."
echo ""

# Function to run a debug script
run_debug_script() {
    local script_name=$1
    local description=$2
    
    echo "🔄 Running $description..."
    echo "----------------------------------------"
    
    if [ -f "scripts/$script_name" ]; then
        # Make sure script is executable
        chmod +x "scripts/$script_name"
        
        # Extract just the filename without directory and extension
        local base_name=$(basename "$script_name" .sh)
        
        # Run the script - it will handle its own logging to logs/debug/
        ./scripts/$script_name
        
        # Show summary
        echo "✅ $description completed"
        echo "📊 Output: $DEBUG_DIR/${base_name}_output.log"
    else
        echo "❌ Script not found: scripts/$script_name"
    fi
    
    echo ""
}

# Run all debug scripts in logical order
echo "🚀 Phase 1: Startup Analysis"
echo "============================"
run_debug_script "debug/startup.sh" "Startup Analysis"

echo "🌐 Phase 2: WebSocket Stability Analysis"
echo "========================================"
run_debug_script "debug/websockets.sh" "Comprehensive WebSocket Stability Test"

echo "📈 Phase 3: Performance Analysis"
echo "================================"
run_debug_script "debug/performance.sh" "Performance Monitoring"

echo "📊 Phase 4: Feed Data Analysis"
echo "=============================="
run_debug_script "debug/feeds.sh" "Feed Data Quality Analysis"

echo "🚨 Phase 5: Error Analysis"
echo "=========================="
run_debug_script "debug/errors.sh" "Error Pattern Analysis"

echo "💾 Phase 6: Cache System Analysis"
echo "================================="
run_debug_script "debug/cache.sh" "Cache System Analysis"

echo "�️P  Phase 7: Resilience Analysis"
echo "================================"
run_debug_script "debug/resilience.sh" "Resilience & Circuit Breaker Analysis"

echo "🎯 Phase 8: Aggregation Analysis"
echo "================================"
run_debug_script "debug/data-aggregation.sh" "Data Aggregation & Consensus Analysis"

echo "⚙️  Phase 9: Configuration Analysis"
echo "==================================="
run_debug_script "debug/config.sh" "Configuration & Environment Analysis"

echo "🔗 Phase 10: Integration Analysis"
echo "================================="
run_debug_script "debug/integration.sh" "Integration & Orchestration Analysis"

echo "🧪 Phase 11: Resilience Consistency Test"
echo "========================================"
run_debug_script "debug/resilience-consistency.sh" "Environment Consistency Validation"

# Generate comprehensive summary report
SUMMARY_FILE="$DEBUG_DIR/comprehensive_summary.md"

echo "📋 Generating comprehensive summary..."

cat > "$SUMMARY_FILE" << EOF
# FTSO System Debug Report
**Generated:** $(date)

## Executive Summary

This report provides a comprehensive analysis of the FTSO Feed Value Provider system across multiple dimensions:

### Analysis Coverage
- ✅ Startup Performance
- ✅ WebSocket Stability & Connection Health
- ✅ System Performance & Resource Usage
- ✅ Feed Data Quality & Validation
- ✅ Error Patterns & Diagnostics
- ✅ Cache & Resilience Systems

### Key Findings

EOF

# Analyze each component and add to summary
if [ -f "$SESSION_DIR/debug-startup_output.log" ]; then
    echo "#### Startup Analysis" >> "$SUMMARY_FILE"
    
    # Extract key metrics from startup log
    STARTUP_TIME=$(grep "Total log lines:" "$SESSION_DIR/debug-startup_output.log" | awk '{print $4}' || echo "Unknown")
    COMPILATION_ERRORS=$(grep "Found.*errors" "$SESSION_DIR/debug-startup_output.log" | head -1 || echo "No compilation issues")
    
    echo "- **Startup Log Lines:** $STARTUP_TIME" >> "$SUMMARY_FILE"
    echo "- **Compilation Status:** $COMPILATION_ERRORS" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

if [ -f "$SESSION_DIR/debug-websockets_output.log" ]; then
    echo "#### WebSocket Stability Analysis" >> "$SUMMARY_FILE"
    
    # Extract enhanced WebSocket metrics
    TOTAL_CONNECTIONS=$(grep "Total successful connections:" "$SESSION_DIR/debug-websockets_output.log" | awk '{print $4}' || echo "0")
    TOTAL_DISCONNECTS=$(grep "Total disconnections:" "$SESSION_DIR/debug-websockets_output.log" | awk '{print $3}' || echo "0")
    STABILITY_PERCENTAGE=$(grep "Overall stability:" "$SESSION_DIR/debug-websockets_output.log" | awk '{print $3}' || echo "N/A")
    TEST_RESULT=$(grep -E "(EXCELLENT|GOOD|ACCEPTABLE|POOR):" "$SESSION_DIR/debug-websockets_output.log" | head -1 | awk '{print $2}' || echo "Unknown")
    
    echo "- **Total Connections:** $TOTAL_CONNECTIONS" >> "$SUMMARY_FILE"
    echo "- **Total Disconnections:** $TOTAL_DISCONNECTS" >> "$SUMMARY_FILE"
    echo "- **Stability Rating:** $STABILITY_PERCENTAGE" >> "$SUMMARY_FILE"
    echo "- **Test Result:** $TEST_RESULT" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

if [ -f "$SESSION_DIR/debug-performance_output.log" ]; then
    echo "#### Performance Analysis" >> "$SUMMARY_FILE"
    
    # Extract performance metrics
    AVG_CPU=$(grep "Average CPU:" "$SESSION_DIR/debug-performance_output.log" | awk '{print $3}' || echo "N/A")
    AVG_MEMORY=$(grep "Average Memory:" "$SESSION_DIR/debug-performance_output.log" | awk '{print $3}' || echo "N/A")
    
    echo "- **Average CPU Usage:** $AVG_CPU" >> "$SUMMARY_FILE"
    echo "- **Average Memory Usage:** $AVG_MEMORY" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

if [ -f "$SESSION_DIR/debug-feeds_output.log" ]; then
    echo "#### Feed Data Analysis" >> "$SUMMARY_FILE"
    
    # Extract feed metrics
    CONFIGURED_FEEDS=$(grep "Configured feeds:" "$SESSION_DIR/debug-feeds_output.log" | awk '{print $3}' || echo "0")
    VALIDATION_EVENTS=$(grep "Validation events:" "$SESSION_DIR/debug-feeds_output.log" | awk '{print $3}' || echo "0")
    
    echo "- **Configured Feeds:** $CONFIGURED_FEEDS" >> "$SUMMARY_FILE"
    echo "- **Validation Events:** $VALIDATION_EVENTS" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

if [ -f "$SESSION_DIR/debug-errors_output.log" ]; then
    echo "#### Error Analysis" >> "$SUMMARY_FILE"
    
    # Extract error metrics
    FATAL_ERRORS=$(grep "Fatal errors:" "$SESSION_DIR/debug-errors_output.log" | awk '{print $3}' || echo "0")
    TOTAL_ERRORS=$(grep "Errors:" "$SESSION_DIR/debug-errors_output.log" | awk '{print $2}' || echo "0")
    WARNINGS=$(grep "Warnings:" "$SESSION_DIR/debug-errors_output.log" | awk '{print $2}' || echo "0")
    
    echo "- **Fatal Errors:** $FATAL_ERRORS" >> "$SUMMARY_FILE"
    echo "- **Total Errors:** $TOTAL_ERRORS" >> "$SUMMARY_FILE"
    echo "- **Warnings:** $WARNINGS" >> "$SUMMARY_FILE"
    echo "" >> "$SUMMARY_FILE"
fi

# Add recommendations section
cat >> "$SUMMARY_FILE" << EOF
## Recommendations

### Immediate Actions
- Review any fatal errors or connection failures
- Monitor memory usage if above 70%
- Address WebSocket stability issues if below 80%
- Check exchange-specific connection problems

### Performance Optimization
- Consider adjusting cache sizes if memory usage is high
- Review timeout configurations for any timeout errors
- Monitor circuit breaker patterns for stability

### Monitoring
- Set up alerts for critical error patterns
- Monitor feed data quality metrics
- Track WebSocket connection health and reconnection rates
- Monitor exchange-specific stability metrics

## Files Generated
EOF

# List all generated files
for file in "$DEBUG_DIR"/*_output.log; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        echo "- \`$filename\`" >> "$SUMMARY_FILE"
    fi
done

echo "" >> "$SUMMARY_FILE"
echo "---" >> "$SUMMARY_FILE"
echo "*Report generated by FTSO Debug Suite*" >> "$SUMMARY_FILE"

# Display final summary
echo "📋 Comprehensive Analysis Complete!"
echo "=================================="
echo ""
echo "📁 All results saved to: $DEBUG_DIR"

echo ""
echo "📄 Comprehensive report: $SUMMARY_FILE"
echo ""
echo "🔧 Next Steps:"
echo "1. Review the enhanced log analysis above for critical issues"
echo "2. Check the comprehensive summary: $SUMMARY_FILE"
echo "3. Check individual component logs in: $DEBUG_DIR"
echo "4. Address any critical issues identified"
echo "5. Review resilience consistency test results"
echo "6. Set up monitoring for ongoing health checks"
echo ""
echo "✨ Debug session complete!"