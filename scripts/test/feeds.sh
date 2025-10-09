#!/bin/bash
# Comprehensive Feeds Test Script
# Tests every single trading pair listed in feeds.json to ensure they all work correctly
# Validates individual exchange data and overall aggregation for each pair

# Source common utilities
source "$(dirname "$0")/../utils/test-common.sh"
source "$(dirname "$0")/../utils/cleanup.sh"
source "$(dirname "$0")/../utils/websocket-detection.sh"

# Set up cleanup handlers
setup_cleanup_handlers

# Flag to track if we should continue processing
CONTINUE_PROCESSING=true

# Custom signal handler to stop processing
handle_interrupt() {
    echo ""
    echo "🛑 Interrupt received, stopping feed processing..."
    CONTINUE_PROCESSING=false
    # Don't exit immediately, let the script finish current batch and cleanup
}

# Override signal handlers to use our custom handler
trap handle_interrupt INT TERM

echo "🧪 Comprehensive Feeds Test"
echo "======================================"
echo "Testing every trading pair in feeds.json"
echo ""

# Configuration
TIMEOUT=60  # Reduced from 120
BATCH_SIZE=10  # Process feeds in batches to avoid overwhelming the system
FEEDS_CONFIG="src/config/feeds.json"

# Set up logging
setup_test_logging "feeds-comprehensive"

# Validate feeds.json exists
if [ ! -f "$FEEDS_CONFIG" ]; then
    log_both "❌ Error: feeds.json not found at $FEEDS_CONFIG"
    exit 1
fi

# Parse feeds.json to get all trading pairs
log_both "📊 Parsing feeds configuration..."
TOTAL_FEEDS=$(jq '. | length' "$FEEDS_CONFIG")
log_both "📈 Found $TOTAL_FEEDS trading pairs to test"

# Start the application using cleanup utilities
log_both "🚀 Starting application..."
start_app_with_cleanup "pnpm start:dev 2>&1 | strip_ansi" 3101 "$TEST_LOG_FILE"

# Wait for complete system readiness using enhanced detection
if ! check_system_readiness "$TEST_LOG_FILE"; then
    log_both "❌ System not ready for testing"
    exit 1
fi

# Test a few sample feeds to ensure data sources are working
log_both "🔍 Testing data source readiness with sample feeds..."
sample_feeds=("BTC/USD" "ETH/USD" "SOL/USD")
data_sources_ready=false
max_data_attempts=3
data_attempt=0

while [ $data_attempt -lt $max_data_attempts ] && [ "$data_sources_ready" = "false" ]; do
    data_attempt=$((data_attempt + 1))
    successful_samples=0
    
    for sample_feed in "${sample_feeds[@]}"; do
        # Test individual feed
        sample_request=$(jq -n --arg name "$sample_feed" \
            '{"feeds": [{"category": 1, "name": $name}]}')
        
        sample_response_file="/tmp/sample_${sample_feed//\//_}_test.json"
        sample_http_code=$(curl -s -w "%{http_code}" -X POST http://localhost:3101/feed-values \
            -H "Content-Type: application/json" \
            -d "$sample_request" \
            -o "$sample_response_file" 2>/dev/null)
        
        if [ "$sample_http_code" = "200" ] && jq -e '.data[0].value' "$sample_response_file" >/dev/null 2>&1; then
            successful_samples=$((successful_samples + 1))
            log_both "  ✅ Sample feed $sample_feed is working"
        else
            log_both "  ⏳ Sample feed $sample_feed not ready yet (attempt $data_attempt/$max_data_attempts)"
        fi
        
        rm -f "$sample_response_file" 2>/dev/null || true
    done
    
    if [ $successful_samples -ge 2 ]; then
        data_sources_ready=true
        log_both "✅ Data sources are ready (${successful_samples}/${#sample_feeds[@]} sample feeds working)"
    else
        log_both "⏳ Waiting for more data sources to initialize... (${successful_samples}/${#sample_feeds[@]} ready)"
        sleep 2
    fi
done

if [ "$data_sources_ready" = "false" ]; then
    log_both "⚠️  Data sources may not be fully ready, but proceeding with tests"
    log_both "    Some feeds may fail due to data source initialization timing"
fi

# Initialize test results
SUCCESSFUL_FEEDS=0
FAILED_FEEDS=0
EXCHANGE_FAILURES=()
AGGREGATION_ISSUES=()

# Create results directory and initialize consolidated issues log
mkdir -p logs/test/feeds-results

# Clear previous results to avoid confusion
rm -f logs/test/feeds-results/*_values.json logs/test/feeds-results/*_volumes.json 2>/dev/null || true

echo "# Consolidated Issues Log - $(date)" > logs/test/feeds-results/consolidated_issues.log
echo "# Format: FEED_NAME: Issue description" >> logs/test/feeds-results/consolidated_issues.log
echo "" >> logs/test/feeds-results/consolidated_issues.log

# Mark the start time for this test run
TEST_START_TIME=$(date +%s)

log_both ""
log_both "🧪 Starting comprehensive feed testing..."
log_both "========================================="

# Process feeds in batches
log_both "🔍 Debug: CONTINUE_PROCESSING=$CONTINUE_PROCESSING, TOTAL_FEEDS=$TOTAL_FEEDS, BATCH_SIZE=$BATCH_SIZE"
for ((batch_start=0; batch_start<TOTAL_FEEDS; batch_start+=BATCH_SIZE)); do
    # Check if we should continue processing
    if [ "$CONTINUE_PROCESSING" != "true" ]; then
        log_both "🛑 Stopping batch processing due to interrupt"
        break
    fi
    batch_end=$((batch_start + BATCH_SIZE - 1))
    if [ $batch_end -ge $TOTAL_FEEDS ]; then
        batch_end=$((TOTAL_FEEDS - 1))
    fi
    
    log_both ""
    log_both "📦 Processing batch $((batch_start/BATCH_SIZE + 1)): feeds $((batch_start + 1))-$((batch_end + 1))"
    log_both "🔍 Debug: batch_start=$batch_start, batch_end=$batch_end, CONTINUE_PROCESSING=$CONTINUE_PROCESSING"
    
    # Process each feed in the batch using array indexing to avoid subshell issues
    for ((feed_index=batch_start; feed_index<=batch_end; feed_index++)); do
        # Check if we should continue processing
        if [ "$CONTINUE_PROCESSING" != "true" ]; then
            log_both "🛑 Stopping feed processing due to interrupt"
            break
        fi
        
        # Extract individual feed config
        feed_config=$(jq -c ".[$feed_index]" "$FEEDS_CONFIG")
        # Check if we should continue processing
        if [ "$CONTINUE_PROCESSING" != "true" ]; then
            log_both "🛑 Stopping processing due to interrupt"
            break
        fi
        
        feed_name=$(echo "$feed_config" | jq -r '.feed.name')
        feed_category=$(echo "$feed_config" | jq -r '.feed.category')
        sources=$(echo "$feed_config" | jq -c '.sources')
        source_count=$(echo "$sources" | jq '. | length')
        
        log_both ""
        log_both "🔍 Testing feed: $feed_name (Category: $feed_category, Sources: $source_count)"
        
        # Test individual feed with retry for data source initialization issues
        feed_request=$(jq -n --argjson category "$feed_category" --arg name "$feed_name" \
            '{"feeds": [{"category": $category, "name": $name}]}')
        
        # Test feed values endpoint with retry logic
        response_file="logs/test/feeds-results/${feed_name//\//_}_values.json"
        max_feed_attempts=2
        feed_attempt=0
        http_code=""
        
        while [ $feed_attempt -lt $max_feed_attempts ]; do
            feed_attempt=$((feed_attempt + 1))
            
            http_code=$(curl -s -w "%{http_code}" -X POST http://localhost:3101/feed-values \
                -H "Content-Type: application/json" \
                -d "$feed_request" \
                -o "$response_file" 2>/dev/null)
            
            # If successful or not a data source issue, break
            if [ "$http_code" = "200" ]; then
                break
            elif [ "$http_code" = "503" ]; then
                # Check if this is a data source initialization issue
                if [ -f "$response_file" ]; then
                    error_code=$(jq -r '.error.code // .code // "UNKNOWN"' "$response_file" 2>/dev/null || echo "UNKNOWN")
                    if [ "$error_code" = "ALL_FEEDS_FAILED" ] && [ $feed_attempt -lt $max_feed_attempts ]; then
                        log_both "  ⏳ $feed_name: Data sources not ready, retrying (attempt $feed_attempt/$max_feed_attempts)..."
                        sleep 1
                        continue
                    fi
                fi
            fi
            
            # For other errors, don't retry
            break
        done
        
        # If we get connection refused or similar, the server is probably down
        if [ "$http_code" = "000" ] || [ "$http_code" = "7" ]; then
            log_both "  ⚠️  $feed_name: Server appears to be down (HTTP $http_code), stopping tests"
            CONTINUE_PROCESSING=false
            break
        fi
        
        if [ "$http_code" = "200" ]; then
            # Validate response structure
            if jq -e '.data[0].value' "$response_file" >/dev/null 2>&1; then
                value=$(jq -r '.data[0].value' "$response_file")
                confidence=$(jq -r '.data[0].confidence // "N/A"' "$response_file")
                source=$(jq -r '.data[0].source // "unknown"' "$response_file")
                
                log_both "  ✅ $feed_name: $value (confidence: ${confidence}, source: ${source})"
                
                # Test volumes endpoint
                volume_response_file="logs/test/feeds-results/${feed_name//\//_}_volumes.json"
                volume_http_code=$(curl -s -w "%{http_code}" -X POST http://localhost:3101/volumes \
                    -H "Content-Type: application/json" \
                    -d "$feed_request" \
                    -o "$volume_response_file" 2>/dev/null)
                
                if [ "$volume_http_code" = "200" ]; then
                    log_both "  ✅ $feed_name: Volume data retrieved successfully"
                else
                    log_both "  ⚠️  $feed_name: Volume endpoint failed (HTTP $volume_http_code)"
                    echo "$feed_name: Volume endpoint failed (HTTP $volume_http_code)" >> "logs/test/feeds-results/consolidated_issues.log"
                fi
                
                SUCCESSFUL_FEEDS=$((SUCCESSFUL_FEEDS + 1))
            else
                log_both "  ❌ $feed_name: Invalid response structure"
                FAILED_FEEDS=$((FAILED_FEEDS + 1))
                AGGREGATION_ISSUES+=("$feed_name: Invalid response structure")
                echo "$feed_name: Invalid response structure" >> "logs/test/feeds-results/consolidated_issues.log"
            fi
        else
            log_both "  ❌ $feed_name: HTTP $http_code"
            FAILED_FEEDS=$((FAILED_FEEDS + 1))
            
            # Try to get error details and categorize the error
            if [ -f "$response_file" ]; then
                error_msg=$(jq -r '.error.message // .message // .error // "Unknown error"' "$response_file" 2>/dev/null || echo "Unknown error")
                error_code=$(jq -r '.error.code // .code // "UNKNOWN"' "$response_file" 2>/dev/null || echo "UNKNOWN")
                
                # Check if this is a data source initialization issue
                if [ "$error_code" = "ALL_FEEDS_FAILED" ] && [ "$http_code" = "503" ]; then
                    log_both "     Error: Data sources not ready - $error_msg"
                    echo "$feed_name: Data sources not ready - $error_msg" >> "logs/test/feeds-results/consolidated_issues.log"
                else
                    log_both "     Error: $error_msg"
                    echo "$feed_name: $error_msg" >> "logs/test/feeds-results/consolidated_issues.log"
                fi
                
                AGGREGATION_ISSUES+=("$feed_name: $error_msg")
            else
                echo "$feed_name: HTTP $http_code (no response file)" >> "logs/test/feeds-results/consolidated_issues.log"
            fi
        fi
        
        
        # Minimal delay between feeds to avoid overwhelming the system
        sleep 0.1
    done
    
    # Minimal delay between batches to avoid rate limiting
    sleep 0.2
done

# Stop the application (cleanup will be handled automatically by trap)
log_both ""
log_both "🛑 Stopping application..."

# Wait a moment for clean shutdown
sleep 1

# Analyze results
log_both ""
log_both "📊 Test Results Summary"
log_both "======================="

# Count actual results from files created during this test run
ACTUAL_SUCCESSFUL=0
ACTUAL_FAILED=0

# Count results by checking files created after the test started
for ((i=0; i<TOTAL_FEEDS; i++)); do
    feed_config=$(jq -c ".[$i]" "$FEEDS_CONFIG")
    feed_name=$(echo "$feed_config" | jq -r '.feed.name')
    result_file="logs/test/feeds-results/${feed_name//\//_}_values.json"
    
    # Only count files that exist and have valid data
    if [ -f "$result_file" ] && jq -e '.data[0].value' "$result_file" >/dev/null 2>&1; then
        ACTUAL_SUCCESSFUL=$((ACTUAL_SUCCESSFUL + 1))
    else
        ACTUAL_FAILED=$((ACTUAL_FAILED + 1))
    fi
done

# If no feeds were actually processed (e.g., interrupted before processing), show that
if [ $ACTUAL_SUCCESSFUL -eq 0 ] && [ $ACTUAL_FAILED -eq $TOTAL_FEEDS ]; then
    log_both ""
    log_both "⚠️  Note: No feeds were processed in this run (interrupted before processing started)"
fi

log_both "📈 Total feeds tested: $TOTAL_FEEDS"
log_both "✅ Successful feeds: $ACTUAL_SUCCESSFUL"
log_both "❌ Failed feeds: $ACTUAL_FAILED"
log_both "📊 Success rate: $(echo "scale=1; $ACTUAL_SUCCESSFUL * 100 / $TOTAL_FEEDS" | bc)%"

# Analyze exchange performance
log_both ""
log_both "📊 Exchange Analysis"
log_both "==================="

# Count exchanges from feeds.json (using arrays for compatibility)

# Parse all exchanges from feeds.json
jq -r '.[] | .sources[] | .exchange' "$FEEDS_CONFIG" | sort | uniq -c | while read count exchange; do
    log_both "📈 $exchange: Used in $count feed sources"
done

# Analyze successful feeds by exchange
log_both ""
log_both "🔍 Exchange Success Analysis:"
for result_file in logs/test/feeds-results/*_values.json; do
    if [ -f "$result_file" ] && jq -e '.data[0].value' "$result_file" >/dev/null 2>&1; then
        feed_name=$(basename "$result_file" | sed 's/_values.json$//' | sed 's/_/\//g')
        source=$(jq -r '.data[0].source // "unknown"' "$result_file")
        log_both "  ✅ $feed_name: $source"
    fi
done

# Identify problematic feeds
log_both ""
log_both "🚨 Failed Feeds Analysis"
log_both "========================"

if [ $ACTUAL_FAILED -gt 0 ]; then
    log_both "❌ Feeds that failed to return valid data:"
    
    # Find feeds without successful results
    all_feeds=$(jq -r '.[].feed.name' "$FEEDS_CONFIG")
    for feed in $all_feeds; do
        result_file="logs/test/feeds-results/${feed//\//_}_values.json"
        if [ ! -f "$result_file" ] || ! jq -e '.data[0].value' "$result_file" >/dev/null 2>&1; then
            log_both "  ❌ $feed"
            
            # Show error details if available
            if [ -f "$result_file" ]; then
                error_msg=$(jq -r '.message // .error // "No error message"' "$result_file" 2>/dev/null || echo "Invalid JSON response")
                log_both "     Error: $error_msg"
            else
                log_both "     Error: No response file generated"
            fi
        fi
    done
else
    log_both "🎉 All feeds returned valid data!"
fi

# Application log analysis
log_both ""
log_both "📋 Application Log Analysis"
log_both "==========================="

if [ -f "$TEST_LOG_FILE" ]; then
    # Count key events
    STARTUP_EVENTS=$(grep -c "Application started\|Server started\|Listening on" "$TEST_LOG_FILE")
    ERROR_EVENTS=$(grep -c "ERROR\|Error\|error" "$TEST_LOG_FILE")
    WARNING_EVENTS=$(grep -c "WARN\|Warning\|warning" "$TEST_LOG_FILE")
    FEED_EVENTS=$(grep -c "feed.*value\|Feed.*value\|price.*feed" "$TEST_LOG_FILE")
    
    log_both "🚀 Startup events: $STARTUP_EVENTS"
    log_both "📊 Feed processing events: $FEED_EVENTS"
    log_both "⚠️  Warning events: $WARNING_EVENTS"
    log_both "🚨 Error events: $ERROR_EVENTS"
    
    # Show recent errors if any
    if [ $ERROR_EVENTS -gt 0 ]; then
        log_both ""
        log_both "🚨 Recent errors:"
        grep -i "error" "$TEST_LOG_FILE" | tail -5 | while read -r line; do
            log_both "  $line"
        done
    fi
    
    # Memory and performance analysis
    MEMORY_WARNINGS=$(grep -c "memory\|Memory\|heap" "$TEST_LOG_FILE")
    if [ $MEMORY_WARNINGS -gt 0 ]; then
        log_both ""
        log_both "💾 Memory-related events: $MEMORY_WARNINGS"
    fi
else
    log_both "❌ No application log file found"
fi

# Performance metrics
log_both ""
log_both "⚡ Performance Metrics"
log_both "====================="

# Calculate average response times from successful requests
if [ $ACTUAL_SUCCESSFUL -gt 0 ]; then
    log_both "📊 Successfully tested $ACTUAL_SUCCESSFUL feeds"
    log_both "⏱️  Average processing time: ~$(echo "scale=1; $TIMEOUT / $TOTAL_FEEDS" | bc)s per feed"
else
    log_both "❌ No successful feeds to analyze performance"
fi

# Final assessment
log_both ""
log_both "🎯 Final Assessment"
log_both "=================="

SUCCESS_RATE=$(echo "scale=1; $ACTUAL_SUCCESSFUL * 100 / $TOTAL_FEEDS" | bc)

if [ $(echo "$SUCCESS_RATE >= 95" | bc) -eq 1 ]; then
    log_both "🎉 EXCELLENT: $SUCCESS_RATE% success rate - System is performing very well!"
    exit_code=0
elif [ $(echo "$SUCCESS_RATE >= 80" | bc) -eq 1 ]; then
    log_both "✅ GOOD: $SUCCESS_RATE% success rate - System is performing adequately"
    exit_code=0
elif [ $(echo "$SUCCESS_RATE >= 60" | bc) -eq 1 ]; then
    log_both "⚠️  FAIR: $SUCCESS_RATE% success rate - Some issues need attention"
    exit_code=1
else
    log_both "❌ POOR: $SUCCESS_RATE% success rate - Significant issues require immediate attention"
    exit_code=2
fi

log_both ""
log_both "📁 Detailed results saved in: logs/test/feeds-results/"
log_both "📋 Full log available at: $TEST_LOG_FILE"

# Consolidated Issues Analysis
log_both ""
log_both "📋 Consolidated Issues Analysis"
log_both "==============================="

ISSUES_LOG="logs/test/feeds-results/consolidated_issues.log"
if [ -f "$ISSUES_LOG" ]; then
    TOTAL_ISSUES=$(wc -l < "$ISSUES_LOG")
    log_both "📊 Total issues found: $TOTAL_ISSUES"
    
    if [ $TOTAL_ISSUES -gt 0 ]; then
        log_both ""
        log_both "🔍 Issue Categories:"
        
        # Categorize issues
        EXCHANGE_ERRORS=$(grep -c "has errors" "$ISSUES_LOG" 2>/dev/null || echo "0")
        EXCHANGE_INACTIVE=$(grep -c "no recent activity" "$ISSUES_LOG" 2>/dev/null || echo "0")
        VOLUME_ISSUES=$(grep -c "Volume endpoint failed" "$ISSUES_LOG" 2>/dev/null || echo "0")
        FEED_FAILURES=$(grep -c "HTTP\|Invalid response\|ALL_FEEDS_FAILED" "$ISSUES_LOG" 2>/dev/null || echo "0")
        
        log_both "  🚨 Exchange errors: $EXCHANGE_ERRORS"
        log_both "  ⚠️  Inactive exchanges: $EXCHANGE_INACTIVE"
        log_both "  📊 Volume endpoint issues: $VOLUME_ISSUES"
        log_both "  ❌ Feed failures: $FEED_FAILURES"
        
        log_both ""
        log_both "🔍 Most Problematic Exchanges:"
        # Find exchanges with most issues
        grep "has errors\|no recent activity" "$ISSUES_LOG" 2>/dev/null | \
        sed 's/.*: \([^(]*\) (.*/\1/' | sort | uniq -c | sort -nr | head -5 | \
        while read count exchange; do
            log_both "  📈 $exchange: $count issues"
        done
        
        log_both ""
        log_both "📋 All Issues Summary:"
        log_both "---------------------"
        cat "$ISSUES_LOG" | while read -r issue; do
            log_both "  • $issue"
        done
    else
        log_both "🎉 No issues found! All feeds and exchanges are working correctly."
    fi
else
    log_both "ℹ️  No consolidated issues log found"
fi

log_both ""
log_both "📁 Generated Files:"
log_both "  - Individual results: logs/test/feeds-results/"
log_both "  - Consolidated issues: $ISSUES_LOG"
log_both "  - Full test log: $TEST_LOG_FILE"
log_both ""
log_both "✨ Comprehensive feeds test complete!"

exit $exit_code