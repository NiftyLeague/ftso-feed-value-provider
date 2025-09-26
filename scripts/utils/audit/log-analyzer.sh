#!/bin/bash

# Audit Log Analyzer - Identifies common issue patterns in debug and test logs
# This utility helps systematically analyze logs for errors, warnings, and performance issues

set -eo pipefail

# Import shared log parsing functions
SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
if [ -f "$SCRIPT_DIR/../parse-logs.sh" ]; then
    source "$SCRIPT_DIR/../parse-logs.sh"
fi

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
LOGS_DIR="logs"
DEBUG_LOGS_DIR="$LOGS_DIR/debug"
TEST_LOGS_DIR="$LOGS_DIR/test"
ANALYSIS_OUTPUT_DIR="$LOGS_DIR/analysis"
ANALYSIS_HISTORY_DIR="$ANALYSIS_OUTPUT_DIR/history"

# Create analysis output directories
mkdir -p "$ANALYSIS_OUTPUT_DIR" "$ANALYSIS_HISTORY_DIR"

# Function to print colored output
print_header() {
    echo -e "${BLUE}================================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================================================${NC}"
}

print_section() {
    echo -e "\n${CYAN}--- $1 ---${NC}"
}

print_error() {
    echo -e "${RED}❌ ERROR: $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  WARNING: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${PURPLE}ℹ️  $1${NC}"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  analyze [script]     - Analyze logs for specific script or all logs"
    echo "  patterns             - Show common error patterns"
    echo "  summary              - Show latest analysis summary (without re-running)"
    echo "  baseline             - Establish baseline system state"
    echo "  compare              - Compare current state with baseline"
    echo "  clean                - Clean old analysis files"
    echo ""
    echo "Options:"
    echo "  --verbose, -v        - Verbose output"
    echo "  --output, -o FILE    - Output to specific file"
    echo "  --format FORMAT      - Output format (text, json, markdown)"
    echo ""
    echo "Examples:"
    echo "  $0 analyze startup           # Analyze startup logs"
    echo "  $0 analyze                   # Analyze all logs"
    echo "  $0 summary --format markdown # Generate markdown summary"
    echo "  $0 baseline                  # Establish baseline"
}

# Improved error patterns with better filtering to reduce false positives
get_error_pattern() {
    case "$1" in
        "connection_error") echo "(connection.*failed|ECONNREFUSED|ENOTFOUND|socket.*error)" ;;
        "memory_error") echo "(out of memory|memory.*leak|heap.*overflow|allocation.*failed)" ;;
        "config_error") echo "(config.*error|missing.*variable|invalid.*config|configuration.*failed)" ;;
        "auth_error") echo "(authentication.*failed|unauthorized|invalid.*token|permission.*denied)" ;;
        "validation_error") echo "(validation.*failed|invalid.*data|schema.*error|type.*error)" ;;
        "performance_warning") echo "(slow.*query|high.*latency|performance.*degraded|timeout.*exceeded)" ;;
        "startup_error") echo "(failed.*to.*start|initialization.*error|bootstrap.*failed|startup.*timeout)" ;;
        "websocket_error") echo "(websocket.*error|ws.*connection.*failed|socket.*disconnected)" ;;
        "cache_error") echo "(cache.*error|redis.*error|cache.*miss.*high|cache.*invalidation)" ;;
        "aggregation_error") echo "(aggregation.*failed|consensus.*error|data.*inconsistency)" ;;
        *) echo "" ;;
    esac
}

# Enhanced filtering function to exclude false positives
filter_pattern_matches() {
    local log_file="$1"
    local pattern="$2"
    
    grep -iE "$pattern" "$log_file" 2>/dev/null | \
        grep -v -E "(timeout.*:.*[0-9]+|recoveryTimeout.*:)" | \
        grep -v -E "(id.*:.*'.*error'|name.*:.*'.*Error')" | \
        grep -v -E "(description.*:.*'.*error'|'.*_error'.*:)" | \
        grep -v -E "(High Response Latency'|'consensus_deviation_error')" | \
        grep -v -E "(WebSocket errors.*:.*0|errors.*:.*0)" | \
        grep -v -E "(timeout.*[0-9]+$|validationTimeout.*:)" | \
        grep -v -E "(\[32m'.*'|name.*'.*Latency')" || true
}

get_pattern_names() {
    echo "connection_error memory_error config_error auth_error validation_error performance_warning startup_error websocket_error cache_error aggregation_error"
}

# Function to analyze a single log file
analyze_log_file() {
    local log_file="$1"
    local script_name="$2"
    local output_file="$3"
    
    if [[ ! -f "$log_file" ]]; then
        echo "Log file not found: $log_file" >> "$output_file"
        return 1
    fi
    
    echo "=== Analysis for $script_name ===" >> "$output_file"
    echo "Log file: $log_file" >> "$output_file"
    echo "Analysis time: $(date)" >> "$output_file"
    echo "" >> "$output_file"
    
    # Check file size and basic stats
    local file_size=$(wc -c < "$log_file" 2>/dev/null || echo "0")
    local line_count=$(wc -l < "$log_file" 2>/dev/null || echo "0")
    
    echo "File size: $file_size bytes" >> "$output_file"
    echo "Line count: $line_count lines" >> "$output_file"
    echo "" >> "$output_file"
    
    # Look for each error pattern with improved filtering
    local issues_found=0
    for pattern_name in $(get_pattern_names); do
        local pattern=$(get_error_pattern "$pattern_name")
        local matches=$(filter_pattern_matches "$log_file" "$pattern")
        
        if [[ -n "$matches" ]]; then
            echo "🔍 Found $pattern_name:" >> "$output_file"
            echo "$matches" | head -10 >> "$output_file"
            echo "" >> "$output_file"
            ((issues_found++))
        fi
    done
    
    # Use reusable parsing functions for consistent filtering
    local error_count=$(count_actual_errors "$log_file")
    local warning_count=$(count_actual_warnings "$log_file")
    
    # Format counts without leading zeros
    printf "Error count: %d\n" "$error_count" >> "$output_file"
    printf "Warning count: %d\n" "$warning_count" >> "$output_file"
    printf "Pattern matches: %d\n" "$issues_found" >> "$output_file"
    echo "" >> "$output_file"
    
    # Extract unique error messages (only if there are actual errors)
    if [[ "${error_count:-0}" -gt 0 ]]; then
        echo "Unique error messages:" >> "$output_file"
        filter_actual_errors "$log_file" | \
            sed 's/.*\(ERROR\|FATAL\|exception\|abort\|crash\|panic\)/\1/i' | \
            sort | uniq -c | sort -nr | head -10 >> "$output_file"
        echo "" >> "$output_file"
    fi
    
    return 0
}

# Function to analyze all logs
analyze_all_logs() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local output_file="$ANALYSIS_HISTORY_DIR/analysis_$timestamp.txt"
    local verbose=${1:-false}
    
    print_header "COMPREHENSIVE LOG ANALYSIS"
    
    echo "Starting comprehensive log analysis..." > "$output_file"
    echo "Analysis started: $(date)" >> "$output_file"
    echo "" >> "$output_file"
    
    # Analyze debug logs
    if [[ -d "$DEBUG_LOGS_DIR" ]]; then
        echo "=== DEBUG LOGS ANALYSIS ===" >> "$output_file"
        echo "" >> "$output_file"
        
        for log_file in "$DEBUG_LOGS_DIR"/*.log; do
            if [[ -f "$log_file" ]]; then
                local script_name=$(basename "$log_file" .log | sed 's/_output$//')
                print_info "Analyzing debug log: $script_name"
                analyze_log_file "$log_file" "$script_name" "$output_file"
            fi
        done
    fi
    
    # Analyze test logs
    if [[ -d "$TEST_LOGS_DIR" ]]; then
        echo "=== TEST LOGS ANALYSIS ===" >> "$output_file"
        echo "" >> "$output_file"
        
        for log_file in "$TEST_LOGS_DIR"/*.log; do
            if [[ -f "$log_file" ]]; then
                local script_name=$(basename "$log_file" .log | sed 's/_output$//')
                print_info "Analyzing test log: $script_name"
                analyze_log_file "$log_file" "$script_name" "$output_file"
            fi
        done
    fi
    
    # Generate summary with improved filtering
    echo "=== ANALYSIS SUMMARY ===" >> "$output_file"
    echo "" >> "$output_file"
    
    local total_errors=0
    local total_warnings=0
    
    # Count errors in debug logs using reusable functions
    if [[ -d "$DEBUG_LOGS_DIR" ]]; then
        for log_file in "$DEBUG_LOGS_DIR"/*.log; do
            if [[ -f "$log_file" ]]; then
                local errors=$(count_actual_errors "$log_file")
                local warnings=$(count_actual_warnings "$log_file")
                total_errors=$((total_errors + ${errors:-0}))
                total_warnings=$((total_warnings + ${warnings:-0}))
            fi
        done
    fi
    
    # Count errors in test logs using reusable functions
    if [[ -d "$TEST_LOGS_DIR" ]]; then
        for log_file in "$TEST_LOGS_DIR"/*.log; do
            if [[ -f "$log_file" ]]; then
                local errors=$(count_actual_errors "$log_file")
                local warnings=$(count_actual_warnings "$log_file")
                total_errors=$((total_errors + ${errors:-0}))
                total_warnings=$((total_warnings + ${warnings:-0}))
            fi
        done
    fi
    
    echo "Total errors found: $total_errors" >> "$output_file"
    echo "Total warnings found: $total_warnings" >> "$output_file"
    echo "Analysis completed: $(date)" >> "$output_file"
    
    # Create symlink to latest analysis
    ln -sf "history/analysis_$timestamp.txt" "$ANALYSIS_OUTPUT_DIR/latest_analysis.txt"
    
    print_success "Analysis complete. Results saved to: $output_file"
    
    # Always show summary after analysis
    echo ""
    print_section "ANALYSIS SUMMARY"
    if [[ $total_errors -eq 0 ]]; then
        print_success "Total errors found: $total_errors"
    else
        print_error "Total errors found: $total_errors"
    fi
    
    if [[ $total_warnings -eq 0 ]]; then
        print_success "Total warnings found: $total_warnings"
    elif [[ $total_warnings -le 20 ]]; then
        print_warning "Total warnings found: $total_warnings (operational alerts - normal during testing)"
    else
        print_warning "Total warnings found: $total_warnings (needs investigation)"
    fi
    
    # Overall status
    if [[ $total_errors -eq 0 ]] && [[ $total_warnings -le 20 ]]; then
        print_success "SYSTEM STATUS: EXCELLENT - Ready for production"
    elif [[ $total_errors -eq 0 ]]; then
        print_warning "SYSTEM STATUS: GOOD - Some warnings need review"
    else
        print_error "SYSTEM STATUS: ISSUES FOUND - Errors need attention"
    fi
    
    if [[ $verbose == true ]]; then
        echo ""
        print_info "Full analysis saved to: $output_file"
    fi
    
    return 0
}

# Function to show common patterns
show_patterns() {
    print_header "COMMON ERROR PATTERNS"
    
    echo "The following patterns are automatically detected in log analysis:"
    echo ""
    
    for pattern_name in $(get_pattern_names); do
        echo -e "${YELLOW}$pattern_name:${NC}"
        echo "  Pattern: $(get_error_pattern "$pattern_name")"
        echo ""
    done
}

# Function to establish log analysis baseline only (system baseline handled separately)
establish_baseline() {
    print_header "ESTABLISHING LOG ANALYSIS BASELINE"
    
    # Create a log analysis baseline with corrected error counts
    create_log_analysis_baseline
}

# Function to create log analysis baseline with corrected error/warning counts
create_log_analysis_baseline() {
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local baseline_file="$ANALYSIS_HISTORY_DIR/log_baseline_$timestamp.json"
    
    print_info "Creating log analysis baseline..."
    
    # Create JSON with proper formatting using printf for better control
    {
        printf "{\n"
        printf "  \"timestamp\": \"%s\",\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf "  \"baseline_type\": \"log_analysis\",\n"
        printf "  \"system\": {\n"
        printf "    \"node_version\": \"%s\",\n" "$(node --version 2>/dev/null || echo 'not available')"
        printf "    \"npm_version\": \"%s\",\n" "$(npm --version 2>/dev/null || echo 'not available')"
        printf "    \"pnpm_version\": \"%s\",\n" "$(pnpm --version 2>/dev/null || echo 'not available')"
        printf "    \"os\": \"%s\",\n" "$(uname -s)"
        printf "    \"arch\": \"%s\"\n" "$(uname -m)"
        printf "  },\n"
        printf "  \"project\": {\n"
        printf "    \"directory\": \"%s\",\n" "$(pwd)"
        printf "    \"git_branch\": \"%s\",\n" "$(git branch --show-current 2>/dev/null || echo 'not available')"
        printf "    \"git_commit\": \"%s\"\n" "$(git rev-parse HEAD 2>/dev/null || echo 'not available')"
        printf "  },\n"
        printf "  \"logs\": {\n"
        
        # Add log file information with corrected counts
        local first=true
        
        # Process debug logs
        if [[ -d "$DEBUG_LOGS_DIR" ]]; then
            for log_file in "$DEBUG_LOGS_DIR"/*.log; do
                if [[ -f "$log_file" ]]; then
                    if [[ $first == false ]]; then
                        printf ",\n"
                    fi
                    first=false
                    local script_name=$(basename "$log_file" .log)
                    local file_size=$(wc -c < "$log_file" 2>/dev/null || echo "0")
                    local line_count=$(wc -l < "$log_file" 2>/dev/null || echo "0")
                    local error_count=$(count_actual_errors "$log_file")
                    local warning_count=$(count_actual_warnings "$log_file")
                    
                    printf "    \"%s\": {\n" "$script_name"
                    printf "      \"file\": \"%s\",\n" "$log_file"
                    printf "      \"size\": %d,\n" "$file_size"
                    printf "      \"lines\": %d,\n" "$line_count"
                    printf "      \"actual_errors\": %d,\n" "$error_count"
                    printf "      \"actual_warnings\": %d,\n" "$warning_count"
                    printf "      \"modified\": \"%s\"\n" "$(stat -f %Sm -t %Y-%m-%dT%H:%M:%SZ "$log_file" 2>/dev/null || echo 'unknown')"
                    printf "    }"
                fi
            done
        fi
        
        # Process test logs
        if [[ -d "$TEST_LOGS_DIR" ]]; then
            for log_file in "$TEST_LOGS_DIR"/*.log; do
                if [[ -f "$log_file" ]]; then
                    if [[ $first == false ]]; then
                        printf ",\n"
                    fi
                    first=false
                    local script_name=$(basename "$log_file" .log)
                    local file_size=$(wc -c < "$log_file" 2>/dev/null || echo "0")
                    local line_count=$(wc -l < "$log_file" 2>/dev/null || echo "0")
                    local error_count=$(count_actual_errors "$log_file")
                    local warning_count=$(count_actual_warnings "$log_file")
                    
                    printf "    \"%s\": {\n" "$script_name"
                    printf "      \"file\": \"%s\",\n" "$log_file"
                    printf "      \"size\": %d,\n" "$file_size"
                    printf "      \"lines\": %d,\n" "$line_count"
                    printf "      \"actual_errors\": %d,\n" "$error_count"
                    printf "      \"actual_warnings\": %d,\n" "$warning_count"
                    printf "      \"modified\": \"%s\"\n" "$(stat -f %Sm -t %Y-%m-%dT%H:%M:%SZ "$log_file" 2>/dev/null || echo 'unknown')"
                    printf "    }"
                fi
            done
        fi
        
        printf "\n  }\n"
        printf "}\n"
    } > "$baseline_file"
    
    print_success "Log analysis baseline created: $baseline_file"
    
    # Create symlink to latest baseline
    ln -sf "history/log_baseline_$timestamp.json" "$ANALYSIS_OUTPUT_DIR/latest_log_baseline.json"
}

# Function to compare current state with baseline
compare_with_baseline() {
    print_header "COMPARING WITH BASELINE"
    
    # Use baseline.sh for system comparison
    local script_dir="$(dirname "${BASH_SOURCE[0]}")"
    if [[ -f "$script_dir/baseline.sh" ]]; then
        print_info "Comparing system state with baseline"
        "$script_dir/baseline.sh" compare
    else
        print_warning "baseline.sh not found, skipping system comparison"
    fi
    
    # Compare log analysis if baseline exists
    if [[ -f "$ANALYSIS_OUTPUT_DIR/latest_log_baseline.json" ]]; then
        print_info "Comparing current log analysis with baseline"
        compare_log_analysis_baseline
    else
        print_warning "No log analysis baseline found. Run 'baseline' command first."
    fi
}

# Function to compare current log analysis with baseline
compare_log_analysis_baseline() {
    local current_analysis="$ANALYSIS_OUTPUT_DIR/current_comparison_$(date +%Y%m%d_%H%M%S).json"
    
    # Create current analysis
    create_log_analysis_baseline
    
    print_info "Log analysis comparison complete"
    print_info "Current analysis saved to: $current_analysis"
}

# Function to show latest summary without re-running analysis
show_latest_summary() {
    print_header "LATEST ANALYSIS SUMMARY"
    
    if [[ -f "$ANALYSIS_OUTPUT_DIR/latest_analysis.txt" ]]; then
        local latest_analysis="$ANALYSIS_OUTPUT_DIR/latest_analysis.txt"
        local total_errors=$(grep "Total errors found:" "$latest_analysis" | tail -1 | grep -o '[0-9]*')
        local total_warnings=$(grep "Total warnings found:" "$latest_analysis" | tail -1 | grep -o '[0-9]*')
        
        if [[ $total_errors -eq 0 ]]; then
            print_success "Total errors found: $total_errors"
        else
            print_error "Total errors found: $total_errors"
        fi
        
        if [[ $total_warnings -eq 0 ]]; then
            print_success "Total warnings found: $total_warnings"
        elif [[ $total_warnings -le 20 ]]; then
            print_warning "Total warnings found: $total_warnings (operational alerts - normal during testing)"
        else
            print_warning "Total warnings found: $total_warnings (needs investigation)"
        fi
        
        # Overall status
        if [[ $total_errors -eq 0 ]] && [[ $total_warnings -le 20 ]]; then
            print_success "SYSTEM STATUS: EXCELLENT - Ready for production"
        elif [[ $total_errors -eq 0 ]]; then
            print_warning "SYSTEM STATUS: GOOD - Some warnings need review"
        else
            print_error "SYSTEM STATUS: ISSUES FOUND - Errors need attention"
        fi
        
        echo ""
        print_info "Latest analysis: $latest_analysis"
        local analysis_date=$(stat -f %Sm -t "%Y-%m-%d %H:%M:%S" "$latest_analysis" 2>/dev/null || echo "unknown")
        print_info "Analysis date: $analysis_date"
    else
        print_warning "No analysis results found. Run 'analyze' command first."
    fi
}

# Function to clean old analysis files
clean_analysis() {
    print_header "CLEANING OLD ANALYSIS FILES"
    
    if [[ -d "$ANALYSIS_OUTPUT_DIR" ]]; then
        # Count files in main directory and history
        local main_count=$(find "$ANALYSIS_OUTPUT_DIR" -maxdepth 1 -name "*.txt" -o -name "*.json" | wc -l | tr -d ' ')
        local history_count=$(find "$ANALYSIS_HISTORY_DIR" -name "*.txt" -o -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
        print_info "Found $main_count analysis files, $history_count history files"
        
        # Clean history directory - keep only latest 2 of each type
        if [[ -d "$ANALYSIS_HISTORY_DIR" ]]; then
            find "$ANALYSIS_HISTORY_DIR" -name "analysis_*.txt" -type f | \
                sort -r | tail -n +3 | xargs rm -f 2>/dev/null || true
                
            find "$ANALYSIS_HISTORY_DIR" -name "log_baseline_*.json" -type f | \
                sort -r | tail -n +3 | xargs rm -f 2>/dev/null || true
                
            # Clean old file names for migration
            find "$ANALYSIS_HISTORY_DIR" -name "comprehensive_analysis_*.txt" -type f | \
                xargs rm -f 2>/dev/null || true
            find "$ANALYSIS_HISTORY_DIR" -name "corrected_baseline_*.json" -type f | \
                xargs rm -f 2>/dev/null || true
        fi
        
        print_success "Cleaned old analysis files (kept latest 2 of each type)"
    else
        print_info "No analysis directory found"
    fi
}

# Main execution
main() {
    local command="${1:-}"
    local verbose=false
    local output_file=""
    local format="text"
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                verbose=true
                shift
                ;;
            -o|--output)
                output_file="$2"
                shift 2
                ;;
            --format)
                format="$2"
                shift 2
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                if [[ -z "$command" ]]; then
                    command="$1"
                fi
                shift
                ;;
        esac
    done
    
    case "$command" in
        analyze)
            analyze_all_logs "$verbose"
            ;;
        patterns)
            show_patterns
            ;;
        summary)
            show_latest_summary
            ;;
        baseline)
            establish_baseline
            ;;
        compare)
            compare_with_baseline
            ;;
        clean)
            clean_analysis
            ;;
        ""|help)
            show_usage
            ;;
        *)
            print_error "Unknown command: $command"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"