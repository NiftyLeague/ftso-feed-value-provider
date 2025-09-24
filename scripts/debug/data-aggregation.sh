#!/bin/bash
# Source common debug utilities
source "$(dirname "$0")/../utils/debug-common.sh"

# Data Aggregation & Consensus Debugging Script
# Tests consensus calculation, weight distribution, outlier detection, and aggregation performance

echo "🎯 FTSO Data Aggregation & Consensus Debugger"
echo "============================================="



# Configuration
TIMEOUT=90

# Set up logging using common utility
setup_debug_logging "data-aggregation"
LOG_FILE="$DEBUG_LOG_FILE"

echo "📝 Starting aggregation system analysis..."

# Start the application in background
pnpm start:dev > "$LOG_FILE" 2>&1 &
APP_PID=$!

echo "🚀 Application started with PID: $APP_PID"
echo "⏱️  Monitoring aggregation systems for $TIMEOUT seconds..."

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
echo "🎯 Aggregation System Analysis:"
echo "==============================="

if [ -f "$LOG_FILE" ]; then
    echo "🚀 System Initialization:"
    echo "-------------------------"
    
    # Aggregation service initialization
    AGGREGATION_INIT=$(grep -c "ConsensusAggregator.*initialized\|Aggregation.*initialized" "$LOG_FILE")
    echo "🎯 Consensus aggregators initialized: $AGGREGATION_INIT"
    
    # Real-time aggregation initialization
    RT_AGGREGATION_INIT=$(grep -c "RealTimeAggregationService.*initialized" "$LOG_FILE")
    echo "⚡ Real-time aggregation services initialized: $RT_AGGREGATION_INIT"
    
    # Price aggregation coordinator
    PRICE_COORD_INIT=$(grep -c "PriceAggregationCoordinatorService.*initialized" "$LOG_FILE")
    echo "📊 Price aggregation coordinators initialized: $PRICE_COORD_INIT"
    
    echo ""
    echo "⚖️  Weight Distribution Analysis:"
    echo "--------------------------------"
    
    # Exchange weight initialization
    WEIGHT_INIT=$(grep -c "Initialized.*weights.*exchanges\|optimized weights" "$LOG_FILE")
    echo "⚖️  Exchange weight systems initialized: $WEIGHT_INIT"
    
    # Weight updates
    WEIGHT_UPDATES=$(grep -c "weight.*update\|Weight.*update\|weights.*updated" "$LOG_FILE")
    echo "🔄 Weight updates: $WEIGHT_UPDATES"
    
    # Show weight configurations
    echo ""
    echo "Exchange weight configurations:"
    grep -E "(weight.*exchange|Exchange.*weight|tierWeights)" "$LOG_FILE" | head -5
    
    # Tier-based weighting
    TIER1_WEIGHTS=$(grep -c "tier.*1.*weight\|Tier.*1.*weight" "$LOG_FILE")
    TIER2_WEIGHTS=$(grep -c "tier.*2.*weight\|Tier.*2.*weight" "$LOG_FILE")
    
    echo ""
    echo "📊 Tier-based weighting:"
    echo "  🥇 Tier 1 weight events: $TIER1_WEIGHTS"
    echo "  🥈 Tier 2 weight events: $TIER2_WEIGHTS"
    
    echo ""
    echo "🎯 Consensus Calculation Analysis:"
    echo "---------------------------------"
    
    # Consensus events
    CONSENSUS_EVENTS=$(grep -c "Consensus\|consensus" "$LOG_FILE")
    echo "🎯 Consensus calculation events: $CONSENSUS_EVENTS"
    
    # Consensus threshold checks
    CONSENSUS_THRESHOLD=$(grep -c "consensus.*threshold\|Consensus.*threshold" "$LOG_FILE")
    echo "📏 Consensus threshold checks: $CONSENSUS_THRESHOLD"
    
    # Consensus deviations
    CONSENSUS_DEVIATIONS=$(grep -c "consensus.*deviation\|Consensus.*deviation" "$LOG_FILE")
    echo "📈 Consensus deviations detected: $CONSENSUS_DEVIATIONS"
    
    if [ $CONSENSUS_DEVIATIONS -gt 0 ]; then
        echo ""
        echo "Recent consensus deviations:"
        grep -E "(consensus.*deviation|Consensus.*deviation)" "$LOG_FILE" | tail -5
        
        if [ $CONSENSUS_DEVIATIONS -gt 10 ]; then
            echo "⚠️  HIGH: Frequent consensus deviations detected"
        elif [ $CONSENSUS_DEVIATIONS -gt 5 ]; then
            echo "⚠️  MODERATE: Some consensus deviations detected"
        else
            echo "✅ LOW: Few consensus deviations detected"
        fi
    else
        echo "✅ No consensus deviations detected"
    fi
    
    echo ""
    echo "🚨 Outlier Detection Analysis:"
    echo "-----------------------------"
    
    # Outlier detection events
    OUTLIERS_DETECTED=$(grep -c "outlier\|Outlier" "$LOG_FILE")
    echo "🚨 Outliers detected: $OUTLIERS_DETECTED"
    
    # Outlier threshold usage
    OUTLIER_THRESHOLD_CHECKS=$(grep -c "outlier.*threshold\|Outlier.*threshold" "$LOG_FILE")
    echo "📏 Outlier threshold checks: $OUTLIER_THRESHOLD_CHECKS"
    
    if [ $OUTLIERS_DETECTED -gt 0 ]; then
        echo ""
        echo "Recent outlier detections:"
        grep -E "(outlier|Outlier)" "$LOG_FILE" | tail -5
        
        # Outlier frequency assessment
        if [ $OUTLIERS_DETECTED -gt 50 ]; then
            echo "⚠️  HIGH: Many outliers detected - review data sources"
        elif [ $OUTLIERS_DETECTED -gt 20 ]; then
            echo "⚠️  MODERATE: Some outliers detected - normal operation"
        else
            echo "✅ LOW: Few outliers detected - good data quality"
        fi
    else
        echo "✅ No outliers detected"
    fi
    
    echo ""
    echo "⏰ Data Freshness Analysis:"
    echo "--------------------------"
    
    # Data freshness checks
    FRESHNESS_CHECKS=$(grep -c "fresh.*data\|Fresh.*data\|data.*fresh" "$LOG_FILE")
    echo "⏰ Data freshness checks: $FRESHNESS_CHECKS"
    
    # Stale data warnings
    STALE_DATA=$(grep -c "stale.*data\|Stale.*data\|data.*stale" "$LOG_FILE")
    echo "⚠️  Stale data warnings: $STALE_DATA"
    
    # Data age analysis
    MAX_DATA_AGE=$(grep -c "max.*data.*age\|Max.*data.*age" "$LOG_FILE")
    echo "📊 Data age checks: $MAX_DATA_AGE"
    
    if [ $STALE_DATA -gt 0 ]; then
        echo ""
        echo "Recent stale data warnings:"
        grep -E "(stale.*data|Stale.*data)" "$LOG_FILE" | tail -3
        
        if [ $STALE_DATA -gt 20 ]; then
            echo "❌ CRITICAL: Frequent stale data - check data sources"
        elif [ $STALE_DATA -gt 10 ]; then
            echo "⚠️  WARNING: Some stale data detected"
        else
            echo "✅ MINOR: Few stale data warnings"
        fi
    else
        echo "✅ No stale data detected"
    fi
    
    echo ""
    echo "📊 Aggregation Performance Analysis:"
    echo "-----------------------------------"
    
    # Aggregation timing
    AGGREGATION_PERFORMANCE=$(grep -c "aggregation.*performance\|Aggregation.*performance" "$LOG_FILE")
    echo "📈 Performance measurements: $AGGREGATION_PERFORMANCE"
    
    # Batch processing
    BATCH_PROCESSING=$(grep -c "batch.*processing\|Batch.*processing" "$LOG_FILE")
    echo "📦 Batch processing events: $BATCH_PROCESSING"
    
    # Processing time analysis
    echo ""
    echo "Processing performance metrics:"
    grep -E "(processing.*time|Processing.*time|aggregation.*ms)" "$LOG_FILE" | head -5
    
    # Performance targets
    PERFORMANCE_TARGETS=$(grep -c "performance.*target\|Performance.*target" "$LOG_FILE")
    echo ""
    echo "📊 Performance target checks: $PERFORMANCE_TARGETS"
    
    echo ""
    echo "🔄 Real-time Processing Analysis:"
    echo "--------------------------------"
    
    # Real-time aggregation events
    RT_AGGREGATION_EVENTS=$(grep -c "real.*time.*aggregation\|Real.*time.*aggregation" "$LOG_FILE")
    echo "⚡ Real-time aggregation events: $RT_AGGREGATION_EVENTS"
    
    # Aggregation intervals
    AGGREGATION_INTERVALS=$(grep -c "aggregation.*interval\|Aggregation.*interval" "$LOG_FILE")
    echo "⏱️  Aggregation interval checks: $AGGREGATION_INTERVALS"
    
    # Quality metrics
    QUALITY_METRICS=$(grep -c "quality.*metrics\|Quality.*metrics" "$LOG_FILE")
    echo "📊 Quality metrics events: $QUALITY_METRICS"
    
    echo ""
    echo "📈 Data Source Analysis:"
    echo "-----------------------"
    
    # Source participation
    echo "Data source participation:"
    EXCHANGES=("binance" "coinbase" "kraken" "okx" "cryptocom")
    
    for exchange in "${EXCHANGES[@]}"; do
        EXCHANGE_DATA=$(grep -c "data.*$exchange\|$exchange.*data\|price.*$exchange" "$LOG_FILE")
        if [ $EXCHANGE_DATA -gt 0 ]; then
            echo "  📊 $exchange: $EXCHANGE_DATA data points"
        else
            echo "  ❌ $exchange: No data detected"
        fi
    done
    
    # Multi-exchange aggregation
    MULTI_EXCHANGE=$(grep -c "multi.*exchange\|Multi.*exchange" "$LOG_FILE")
    echo ""
    echo "🔄 Multi-exchange aggregation events: $MULTI_EXCHANGE"
    
    echo ""
    echo "⚡ Lambda Decay Analysis:"
    echo "------------------------"
    
    # Lambda decay usage
    LAMBDA_DECAY=$(grep -c "lambda.*decay\|Lambda.*decay" "$LOG_FILE")
    echo "📉 Lambda decay calculations: $LAMBDA_DECAY"
    
    # Decay parameter usage
    echo ""
    echo "Decay parameter configurations:"
    grep -E "(lambda.*decay|Lambda.*decay)" "$LOG_FILE" | head -3
    
    echo ""
    echo "🎯 Aggregation Recommendations:"
    echo "==============================="
    
    # Provide recommendations based on analysis
    if [ $CONSENSUS_DEVIATIONS -gt 20 ]; then
        echo "🔧 CONSENSUS: High consensus deviations"
        echo "   - Review consensus threshold settings"
        echo "   - Check data source reliability"
        echo "   - Validate weight distributions"
    fi
    
    if [ $OUTLIERS_DETECTED -gt 100 ]; then
        echo "🔧 OUTLIERS: High outlier detection rate"
        echo "   - Review outlier threshold settings"
        echo "   - Check data source quality"
        echo "   - Validate data normalization"
    fi
    
    if [ $STALE_DATA -gt 30 ]; then
        echo "🔧 FRESHNESS: Frequent stale data warnings"
        echo "   - Review data source connectivity"
        echo "   - Check data refresh intervals"
        echo "   - Validate timeout configurations"
    fi
    
    if [ $WEIGHT_UPDATES -eq 0 ]; then
        echo "🔧 WEIGHTS: No weight updates detected"
        echo "   - Verify weight update mechanism"
        echo "   - Check weight update intervals"
        echo "   - Review adaptive weighting settings"
    fi
    
    if [ $RT_AGGREGATION_EVENTS -eq 0 ]; then
        echo "🔧 REAL-TIME: No real-time aggregation detected"
        echo "   - Verify real-time aggregation service"
        echo "   - Check aggregation intervals"
        echo "   - Review data flow configuration"
    fi
    
    # Overall aggregation assessment
    echo ""
    echo "📊 Overall Aggregation Health:"
    echo "============================="
    
    agg_score=100
    
    if [ $CONSENSUS_DEVIATIONS -gt 20 ]; then
        agg_score=$((agg_score - 25))
    fi
    
    if [ $OUTLIERS_DETECTED -gt 100 ]; then
        agg_score=$((agg_score - 20))
    fi
    
    if [ $STALE_DATA -gt 30 ]; then
        agg_score=$((agg_score - 20))
    fi
    
    if [ $WEIGHT_UPDATES -eq 0 ]; then
        agg_score=$((agg_score - 15))
    fi
    
    if [ $RT_AGGREGATION_EVENTS -eq 0 ]; then
        agg_score=$((agg_score - 10))
    fi
    
    if [ $agg_score -ge 90 ]; then
        echo "🎉 EXCELLENT: Aggregation system is performing optimally (Score: $agg_score/100)"
    elif [ $agg_score -ge 75 ]; then
        echo "✅ GOOD: Aggregation system is performing well (Score: $agg_score/100)"
    elif [ $agg_score -ge 60 ]; then
        echo "⚠️  FAIR: Aggregation system needs some attention (Score: $agg_score/100)"
    else
        echo "❌ POOR: Aggregation system requires immediate attention (Score: $agg_score/100)"
    fi
    
else
    echo "❌ No log file found"
fi

echo ""
echo "✨ Aggregation analysis complete!"
echo "📁 Detailed logs available at: $LOG_FILE"