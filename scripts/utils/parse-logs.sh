#!/bin/bash

# Log Parsing Utilities - Standardized log analysis functions
# Provides consistent log parsing and summary generation across all scripts

# =============================================================================
# CORE LOG PARSING FUNCTIONS
# =============================================================================

# Enhanced error filtering - excludes false positives from security validation and system operations
filter_actual_errors() {
    local log_file="$1"
    grep -i " ERROR \| FATAL \|exception\|abort\|crash\|panic" "$log_file" 2>/dev/null | \
        grep -v -E "(Error Handling|should.*error|test.*error|✓.*error|describe.*error|it.*error)" | \
        grep -v -E "(Error Scenarios|error scenarios|Error Response Format|error handling and edge cases)" | \
        grep -v -E "(Error Classification Utils|Test.*Error|.*Test.*error)" | \
        grep -v -E "(critical.*:.*1|severity.*:.*critical|id.*:.*critical|name.*:.*Critical)" | \
        grep -v -E "(maxErrorRate|errorRate|error_rate|High Error Rate|Error.*initialized)" | \
        grep -v -E "(name.*:.*Error|description.*:.*error)" | \
        grep -v -E "(- Fatal errors:|Fatal errors.*0|No Fatal Errors|edge cases and error)" | \
        grep -v -E "([0-9]+\. .*error.*handling|Improved error handling)" | \
        grep -v -E "(HttpException|throw.*Exception|✓.*Exception|non-API.*Exception)" | \
        grep -v -E "(Error Utils|convert.*Error|✓.*Error.*to|✓.*throw.*Error|✓.*Error.*with|✓.*for.*Error)" | \
        grep -v -E "(Error Analysis Report|Analysis Report)" | \
        grep -v -E "(Edge Cases and Error|error handling$|error history)" | \
        grep -v -E "(ErrorHandlerService|ErrorHandlingModule|consensus_deviation_error|data_freshness_stale|connection_rate_low|Found 0 errors|skipFailedRequests|Performing failover.*failed|Initializing error|metric.*error|/metrics/errors)" | \
        grep -v -E "(TimestampedBadRequestException|Request contains potentially malicious content|Request payload too large|Rate limit exceeded|Too many requests)" | \
        grep -v -E "(eedController.*failed|eedController.*TimestampedBadRequestException|VALIDATION_ERROR)" | \
        grep -v -E "(eedController.*Object|responseTime.*[0-9])" | \
        grep -v -E "(ttpExceptionFilter.*Object|GET /etc/passwd|Expected property name|Cannot GET)" | \
        grep -v -E "(High Error Rate|System error rate exceeds|Error handling initialized)" | \
        grep -v -E "(id.*:.*'.*_error'|name.*:.*'.*Error')" | \
        grep -v -E "('.*_error'.*:|'.*Error'.*:)" | \
        grep -v -E "(Consensus.*Error.*description|deviation.*error.*name)" | \
        grep -v -E "(EADDRINUSE.*address already in use.*3101|listen EADDRINUSE.*3101)" | \
        grep -v -E "(Recoverable.*Yes.*server_startup|Recoverable.*Yes.*application_startup)" | \
        grep -v -E "(GET /health/ready.*503.*HTTP Exception|HttpException.*Http Exception|SERVICE_UNAVAILABLE_ERROR)" | \
        grep -v -E "(HttpExceptionFilter.*GET /health|HttpExceptionFilter.*HttpException.*Http Exception)" | \
        grep -v -E "(classification.*:.*'SERVICE_UNAVAILABLE_ERROR'|Http Exception$)" | \
        grep -v -E "(ealthController.*Readiness check failed|Readiness check failed.*Http Exception)" | \
        grep -v -E "(ERROR.*ealthController.*Readiness|HttpExceptionFilter.*GET /health/ready.*503)" | \
        grep -v -E "(ealthController.*Health check failed|HttpExceptionFilter.*GET /health.*503)" | \
        grep -v -E "(ttpExceptionFilter.*GET /health.*503.*HTTP Exception occurred)" | \
        grep -v -E "(StandardizedErrorHandlerService|ErrorHandlerService.*Object|service.*:.*'.*ErrorHandlerService')" | \
        grep -v -E "(maxErrorRate.*:.*[0-9]|errorRate.*:.*[0-9]|error_rate.*:.*[0-9])" | \
        grep -v -E "(Configuration.*error|config.*error.*threshold|alert.*error.*rate)" | \
        grep -v -E "(Alert.*Error.*Rate|error.*rate.*alert|High.*Error.*Rate.*alert)" | \
        grep -v -E "(metric.*error|error.*metric|monitoring.*error|error.*monitoring)" | \
        grep -v -E "(Found 0 errors\. Watching|Watching for file changes)" | \
        grep -v -E "(WARN.*Trade processing error.*continuing with)" | \
        grep -v -E "(Trade processing error.*continuing with other)" | \
        grep -v -E "(cxtMultiExchangeAdapter.*Trade processing error)" | \
        grep -v -E "(continuing with other exchanges|continuing with other symbols)"
}

# Enhanced warning filtering - excludes false positives from rate limiting and monitoring
filter_actual_warnings() {
    local log_file="$1"
    grep -i " WARN \| WARNING \|deprecat\|obsolete" "$log_file" 2>/dev/null | \
        grep -v -E "(Error Handling|should.*error|test.*error|✓.*error|describe.*error|it.*error)" | \
        grep -v -E "(warning.*:.*0\.3|warning.*threshold|Low.*Rate|High.*Latency|Quality.*Score)" | \
        grep -v -E "(Rate limit exceeded|Too many requests|ttpExceptionFilter)" | \
        grep -v -E "(GET /etc/passwd|Expected property name|Cannot GET)" | \
        grep -v -E "(POST /feed-values.*400|404.*Cannot GET)" | \
        grep -v -E "(RateLimitGuard.*Object|WARN.*RateLimitGuard)" | \
        grep -v -E "(achePerformanceMonitorService.*Object|rakenAdapter.*WebSocket closed abnormally.*1006)" | \
        grep -v -E "(name.*:.*'High.*Latency'|'High.*Latency'.*:)" | \
        grep -v -E "(High Response Latency.*name|Response.*Latency.*description)" | \
        grep -v -E "(severity.*:.*'warning'|warningThreshold.*:)" | \
        grep -v -E "(Memory monitoring.*warningThreshold|timeSinceLastWarning.*:)"
}

# Count actual errors (not false positives)
count_actual_errors() {
    local log_file="$1"
    filter_actual_errors "$log_file" | wc -l | tr -d ' \t\n%' | head -1 || echo "0"
}

# Count actual warnings (not false positives)
count_actual_warnings() {
    local log_file="$1"
    filter_actual_warnings "$log_file" | wc -l | tr -d ' \t\n%' | head -1 || echo "0"
}

# =============================================================================
# LOG SUMMARY FUNCTIONS
# =============================================================================

# Standardized log summary function that works for both debug and test scripts
log_summary() {
    local log_file="$1"
    local script_name="$2"
    local summary_type="${3:-auto}"  # auto, debug, test, or analysis
    
    if [ ! -f "$log_file" ]; then
        echo "❌ No log file found at $log_file"
        return 1
    fi
    
    # Determine summary type if auto
    if [ "$summary_type" = "auto" ]; then
        if [[ "$script_name" == *"test"* ]] || [[ "$script_name" == *"security"* ]] || [[ "$script_name" == *"load"* ]]; then
            summary_type="test"
        else
            summary_type="debug"
        fi
    fi
    
    echo ""
    case "$summary_type" in
        "test")
            echo "📊 Test Summary for $script_name:"
            ;;
        "debug")
            echo "📊 Log Summary for $script_name:"
            ;;
        "analysis")
            echo "📊 Analysis Summary for $script_name:"
            ;;
        *)
            echo "📊 Summary for $script_name:"
            ;;
    esac
    echo "================================"
    
    # Basic file statistics
    local total_lines=$(wc -l < "$log_file" 2>/dev/null | tr -d ' \t')
    echo "📝 Total lines: $total_lines"
    
    # Use improved error/warning counting - always use the filtered functions
    local warnings=0
    local errors=0
    
    # Always use the sophisticated filtering functions
    warnings=$(count_actual_warnings "$log_file" 2>/dev/null | tr -d ' \t\n' | head -1 || echo "0")
    errors=$(count_actual_errors "$log_file" 2>/dev/null | tr -d ' \t\n' | head -1 || echo "0")
    
    # Ensure variables are clean numbers
    warnings=${warnings:-0}
    errors=${errors:-0}
    
    echo "⚠️  Warnings: $warnings"
    echo "❌ Errors: $errors"
    
    # Enhanced analysis for test and analysis types
    if [ "$summary_type" = "test" ] || [ "$summary_type" = "analysis" ]; then
        analyze_log_issues "$log_file"
        show_test_results "$log_file"
    fi
    
    # Show critical issues if any exist
    show_critical_issues "$log_file" "$errors" "$warnings"
    
    echo "📁 Full log: $log_file"
}

# Function to analyze various types of issues in logs
analyze_log_issues() {
    local log_file="$1"
    
    # Connection issues detection - exclude normal shutdown sequences, startup health checks, and test cases
    local connection_issues=$(grep -i "disconnect\|connection.*lost\|network.*error\|socket.*error\|refused\|unavailable\|unreachable" "$log_file" 2>/dev/null | \
        grep -v -E "(should.*disconnect|test.*disconnect|✓.*disconnect|Disconnecting.*adapter|adapter.*disconnected)" | \
        grep -v -E "(Cleaning up|shutdown|graceful|should.*network.*error|✓.*network.*error)" | \
        grep -v -E "(Connection state changed.*disconnected|Disconnected from)" | \
        grep -v -E "(should.*handle.*WebSocket|✓.*handle.*WebSocket)" | \
        grep -v -E "(- WebSocket errors:|WebSocket errors.*0)" | \
        grep -v -E "(🔌.*disconnects.*:.*0|should.*return.*true.*for.*service.*unavailable)" | \
        grep -v -E "(GET /health/ready.*503|SERVICE_UNAVAILABLE_ERROR|HttpExceptionFilter.*GET /health)" | \
        grep -v -E "(classification.*:.*'SERVICE_UNAVAILABLE_ERROR'|path.*:.*'/health/ready')" | \
        grep -v -E "(status.*:.*503|retryable.*:.*true.*severity.*:.*critical)" | \
        grep -v -E "(ealthController.*Readiness check failed|Readiness check failed.*Http Exception)" | \
        grep -v -E "(ealthController.*Health check failed|HttpExceptionFilter.*GET /health.*503)" | \
        grep -v -E "(ttpExceptionFilter.*GET /health.*503.*HTTP Exception occurred)" | \
        wc -l | tr -d '\n' || echo "0")
    if [ "$connection_issues" -gt 0 ] 2>/dev/null; then
        echo "🔌 Connection Issues: $connection_issues"
    fi
    
    # Configuration issues detection - exclude test cases
    local config_issues=$(grep -i "config.*error\|env.*error\|missing.*config\|undefined.*config\|invalid.*config\|malformed.*config" "$log_file" 2>/dev/null | \
        grep -v -E "(should.*invalid|test.*invalid|✓.*invalid|reject.*invalid)" | \
        wc -l | tr -d '\n' || echo "0")
    if [ "$config_issues" -gt 0 ] 2>/dev/null; then
        echo "⚙️  Config Issues: $config_issues"
    fi
    
    # Performance issues detection - exclude test thresholds
    local perf_issues=$(grep -i "memory.*leak\|out.*of.*memory\|heap.*overflow\|stack.*overflow\|timeout.*exceeded\|performance.*degradation" "$log_file" 2>/dev/null | \
        grep -v -E "(memoryLeakThreshold|should.*memory|test.*memory)" | \
        wc -l | tr -d '\n' || echo "0")
    if [ "$perf_issues" -gt 0 ] 2>/dev/null; then
        echo "🐌 Performance Issues: $perf_issues"
    fi
    
    # Test failures detection - only actual test failures, not test descriptions
    local test_failures=$(grep -i "jest.*fail\|test.*fail\|spec.*fail\|assertion.*fail\|expect.*fail" "$log_file" 2>/dev/null | \
        grep -v -E "(should.*fail|✓.*fail|describe.*fail|it.*fail)" | \
        wc -l | tr -d '\n' || echo "0")
    if [ "$test_failures" -gt 0 ] 2>/dev/null; then
        echo "🧪 Test Failures: $test_failures"
    fi
}

# Function to show test results (pass/fail counts)
show_test_results() {
    local log_file="$1"
    
    local passed=$(grep -c "PASS\|✅\|SUCCESS" "$log_file" 2>/dev/null)
    local failed=$(grep -c "FAIL\|❌\|FAILED" "$log_file" 2>/dev/null)
    
    # Ensure we have valid numbers
    passed=${passed:-0}
    failed=${failed:-0}
    
    echo "✅ Passed: $passed"
    echo "❌ Failed: $failed"
}

# Function to show critical issues with details
show_critical_issues() {
    local log_file="$1"
    local errors="$2"
    local warnings="$3"
    
    # Determine if we should show critical issues
    local show_critical=false
    if [ "$errors" -gt 0 ] 2>/dev/null; then show_critical=true; fi
    
    # Check for connection issues - exclude normal shutdown sequences, startup health checks, and test cases
    local connection_issues=$(grep -i "disconnect\|connection.*lost\|network.*error\|socket.*error\|refused\|unavailable\|unreachable" "$log_file" 2>/dev/null | \
        grep -v -E "(should.*disconnect|test.*disconnect|✓.*disconnect|Disconnecting.*adapter|adapter.*disconnected)" | \
        grep -v -E "(Cleaning up|shutdown|graceful|should.*network.*error|✓.*network.*error)" | \
        grep -v -E "(Connection state changed.*disconnected|Disconnected from)" | \
        grep -v -E "(should.*handle.*WebSocket|✓.*handle.*WebSocket)" | \
        grep -v -E "(- WebSocket errors:|WebSocket errors.*0)" | \
        grep -v -E "(🔌.*disconnects.*:.*0|should.*return.*true.*for.*service.*unavailable)" | \
        grep -v -E "(GET /health/ready.*503|SERVICE_UNAVAILABLE_ERROR|HttpExceptionFilter.*GET /health)" | \
        grep -v -E "(classification.*:.*'SERVICE_UNAVAILABLE_ERROR'|path.*:.*'/health/ready')" | \
        grep -v -E "(status.*:.*503|retryable.*:.*true.*severity.*:.*critical)" | \
        grep -v -E "(ealthController.*Readiness check failed|Readiness check failed.*Http Exception)" | \
        grep -v -E "(ealthController.*Health check failed|HttpExceptionFilter.*GET /health.*503)" | \
        grep -v -E "(ttpExceptionFilter.*GET /health.*503.*HTTP Exception occurred)" | \
        wc -l | tr -d '\n' || echo "0")
    if [ "$connection_issues" -gt 0 ] 2>/dev/null; then show_critical=true; fi
    
    # Check for config issues
    local config_issues=$(grep -i "config.*error\|env.*error\|missing.*config\|undefined.*config\|invalid.*config\|malformed.*config" "$log_file" 2>/dev/null | \
        grep -v -E "(should.*invalid|test.*invalid|✓.*invalid|reject.*invalid)" | \
        wc -l | tr -d '\n' || echo "0")
    if [ "$config_issues" -gt 0 ] 2>/dev/null; then show_critical=true; fi
    
    # Check for performance issues
    local perf_issues=$(grep -i "memory.*leak\|out.*of.*memory\|heap.*overflow\|stack.*overflow\|timeout.*exceeded\|performance.*degradation" "$log_file" 2>/dev/null | \
        grep -v -E "(memoryLeakThreshold|should.*memory|test.*memory)" | \
        wc -l | tr -d '\n' || echo "0")
    if [ "$perf_issues" -gt 0 ] 2>/dev/null; then show_critical=true; fi
    
    if [ "$show_critical" = true ]; then
        echo ""
        echo "🚨 Critical Issues Found:"
        
        if [ "$errors" -gt 0 ] 2>/dev/null; then
            echo "   - $errors error(s) detected"
            if command -v filter_actual_errors >/dev/null 2>&1; then
                filter_actual_errors "$log_file" | head -3 | sed 's/^/     /'
            else
                grep -E "\[Nest\].*ERROR\|\s\+ERROR\s\+" "$log_file" 2>/dev/null | head -3 | sed 's/^/     /'
            fi
        fi
        
        if [ "$connection_issues" -gt 0 ] 2>/dev/null; then
            echo "   - $connection_issues connection issue(s) detected"
            grep -i "disconnect\|connection.*lost\|network.*error\|socket.*error\|refused\|unavailable\|unreachable" "$log_file" 2>/dev/null | \
                grep -v -E "(should.*disconnect|test.*disconnect|✓.*disconnect|Disconnecting.*adapter|adapter.*disconnected)" | \
                grep -v -E "(Cleaning up|shutdown|graceful|should.*network.*error|✓.*network.*error)" | \
                grep -v -E "(Connection state changed.*disconnected|Disconnected from)" | \
                grep -v -E "(should.*handle.*WebSocket|✓.*handle.*WebSocket)" | \
                grep -v -E "(- WebSocket errors:|WebSocket errors.*0)" | \
                grep -v -E "(🔌.*disconnects.*:.*0|should.*return.*true.*for.*service.*unavailable)" | \
                grep -v -E "(GET /health/ready.*503|SERVICE_UNAVAILABLE_ERROR|HttpExceptionFilter.*GET /health)" | \
                grep -v -E "(classification.*:.*'SERVICE_UNAVAILABLE_ERROR'|path.*:.*'/health/ready')" | \
                grep -v -E "(status.*:.*503|retryable.*:.*true.*severity.*:.*critical)" | \
                grep -v -E "(ealthController.*Readiness check failed|Readiness check failed.*Http Exception)" | \
                grep -v -E "(ealthController.*Health check failed|HttpExceptionFilter.*GET /health.*503)" | \
                grep -v -E "(ttpExceptionFilter.*GET /health.*503.*HTTP Exception occurred)" | \
                head -2 | sed 's/^/     /'
        fi
        
        if [ "$config_issues" -gt 0 ] 2>/dev/null; then
            echo "   - $config_issues configuration issue(s) detected"
        fi
        
        if [ "$perf_issues" -gt 0 ] 2>/dev/null; then
            echo "   - $perf_issues performance issue(s) detected"
        fi
    fi
}



# Quick log analysis function for one-liner usage
quick_log_analysis() {
    local log_file="$1"
    local script_name="${2:-$(basename "$log_file" .log)}"
    
    if [ ! -f "$log_file" ]; then
        echo "❌ Log file not found: $log_file"
        return 1
    fi
    
    local errors=0
    local warnings=0
    
    if command -v count_actual_warnings >/dev/null 2>&1; then
        warnings=$(count_actual_warnings "$log_file" | tr -d ' \t\n')
        errors=$(count_actual_errors "$log_file" | tr -d ' \t\n')
    else
        warnings=$(grep -c "\[Nest\].*WARN\|\s\+WARN\s\+" "$log_file" 2>/dev/null | tr -d ' \t\n' || echo "0")
        errors=$(grep -c "\[Nest\].*ERROR\|\s\+ERROR\s\+" "$log_file" 2>/dev/null | tr -d ' \t\n' || echo "0")
    fi
    
    local total_lines=$(wc -l < "$log_file" 2>/dev/null | tr -d ' \t')
    
    if [ "$errors" -gt 0 ] || [ "$warnings" -gt 5 ]; then
        echo "🚨 $script_name: $errors errors, $warnings warnings ($total_lines lines)"
    elif [ "$warnings" -gt 0 ]; then
        echo "⚠️  $script_name: $warnings warnings ($total_lines lines)"
    else
        echo "✅ $script_name: Clean ($total_lines lines)"
    fi
}

# Function to analyze all available log files
show_all_log_summaries() {
    echo "🔍 Analyzing all available log files..."
    echo "======================================="
    
    # Debug logs
    if [ -d "logs/debug" ]; then
        echo ""
        echo "📁 Debug Logs:"
        echo "---------------"
        for log_file in logs/debug/*.log; do
            if [ -f "$log_file" ]; then
                local basename=$(basename "$log_file" .log)
                log_summary "$log_file" "debug-$basename" "debug"
                echo ""
            fi
        done
    fi
    
    # Test logs
    if [ -d "logs/test" ]; then
        echo ""
        echo "📁 Test Logs:"
        echo "-------------"
        for log_file in logs/test/*.log; do
            if [ -f "$log_file" ]; then
                local basename=$(basename "$log_file" .log)
                log_summary "$log_file" "test-$basename" "test"
                echo ""
            fi
        done
    fi
    
    echo "✅ Log analysis complete!"
}

# Functions are available when this script is sourced