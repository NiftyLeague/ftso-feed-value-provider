#!/bin/bash

# FTSO System Audit - Unified audit system for comprehensive system validation
# This is the main entry point for all audit operations

set -eo pipefail

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
AUDIT_DIR="$SCRIPT_DIR/audit"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Function to print colored output
print_header() {
    echo -e "${BLUE}================================================================================${NC}"
    echo -e "${BLUE}🔍 FTSO System Audit - $1${NC}"
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
    echo "🔍 AUDIT COMMANDS:"
    echo "  full                 - Run complete audit (setup + debug + test + analysis)"
    echo "  debug                - Run debug scripts only"
    echo "  test                 - Run test scripts only"
    echo "  analyze              - Analyze existing logs only"
    echo "  summary              - Show latest analysis summary (quick status check)"
    echo ""
    echo "📊 BASELINE COMMANDS:"
    echo "  baseline             - Establish new system baseline"
    echo "  compare              - Compare current state with baseline"
    echo "  status               - Show baseline and system status"
    echo ""
    echo "🛠️  SETUP COMMANDS:"
    echo "  setup                - Setup audit environment"
    echo "  verify               - Verify audit environment readiness"
    echo "  clean                - Clean old audit files"
    echo ""
    echo "OPTIONS:"
    echo "  --verbose, -v        - Verbose output"
    echo "  --force              - Force operations even if already configured"
    echo "  --help, -h           - Show this help"
    echo ""
    echo "EXAMPLES:"
    echo "  $0 full --verbose           # Complete audit with verbose output"
    echo "  $0 baseline                 # Establish new baseline"
    echo "  $0 status                   # Show current system status"
    echo ""
    echo "🔧 INDIVIDUAL AUDIT TOOLS:"
    echo "  ./scripts/utils/audit/setup.sh         - Environment setup"
    echo "  ./scripts/utils/audit/baseline.sh      - System baseline management"
    echo "  ./scripts/utils/audit/log-analyzer.sh  - Log analysis and patterns"
}

# Function to run setup
run_setup() {
    local verbose=$1
    local force=$2
    
    print_section "AUDIT ENVIRONMENT SETUP"
    
    local setup_args=""
    if [[ $verbose == true ]]; then
        setup_args="$setup_args --verbose"
    fi
    if [[ $force == true ]]; then
        setup_args="$setup_args --force"
    fi
    
    "$AUDIT_DIR/setup.sh" setup $setup_args
}

# Function to verify environment
verify_environment() {
    print_section "ENVIRONMENT VERIFICATION"
    "$AUDIT_DIR/setup.sh" verify
}

# Function to establish baseline
establish_baseline() {
    print_section "ESTABLISHING BASELINE"
    
    # System baseline
    print_info "Creating system baseline..."
    "$AUDIT_DIR/baseline.sh" capture
    
    # Log analysis baseline (if logs exist)
    if [[ -d "logs/debug" ]] || [[ -d "logs/test" ]]; then
        print_info "Creating log analysis baseline..."
        "$AUDIT_DIR/log-analyzer.sh" baseline
    else
        print_info "No logs found - log analysis baseline will be created after first audit run"
    fi
}

# Function to show status
show_status() {
    print_section "SYSTEM STATUS"
    "$AUDIT_DIR/baseline.sh" status
    
    print_section "LOG ANALYSIS STATUS"
    if [[ -f "logs/analysis/latest_log_baseline.json" ]]; then
        print_success "Log analysis baseline exists"
        local baseline_date=$(stat -f %Sm -t "%Y-%m-%d %H:%M:%S" "logs/analysis/latest_log_baseline.json" 2>/dev/null || echo "unknown")
        print_info "Created: $baseline_date"
    else
        print_warning "No log analysis baseline found. Run 'baseline' command first."
    fi
    
    print_section "AVAILABLE LOGS"
    if [[ -d "logs/debug" ]]; then
        local debug_count=$(find logs/debug -name "*.log" | wc -l | tr -d ' ')
        print_info "Debug logs: $debug_count files"
    fi
    if [[ -d "logs/test" ]]; then
        local test_count=$(find logs/test -name "*.log" | wc -l | tr -d ' ')
        print_info "Test logs: $test_count files"
    fi
}

# Function to run debug scripts
run_debug_scripts() {
    local verbose=$1
    
    print_section "RUNNING DEBUG SCRIPTS"
    
    cd "$ROOT_DIR"
    if [[ $verbose == true ]]; then
        print_info "Running: ./scripts/run.sh debug all"
    fi
    
    ./scripts/run.sh debug all
    
    print_success "Debug scripts completed"
}

# Function to run test scripts
run_test_scripts() {
    local verbose=$1
    
    print_section "RUNNING TEST SCRIPTS"
    
    cd "$ROOT_DIR"
    if [[ $verbose == true ]]; then
        print_info "Running: ./scripts/run.sh test all"
    fi
    
    ./scripts/run.sh test all
    
    print_success "Test scripts completed"
}

# Function to analyze logs
analyze_logs() {
    local verbose=$1
    
    print_section "ANALYZING LOGS"
    
    local analyze_args=""
    if [[ $verbose == true ]]; then
        analyze_args="--verbose"
    fi
    
    "$AUDIT_DIR/log-analyzer.sh" analyze $analyze_args
}

# Function to compare with baseline
compare_with_baseline() {
    print_section "COMPARING WITH BASELINE"
    
    # System comparison
    "$AUDIT_DIR/baseline.sh" compare
    
    # Log analysis comparison
    "$AUDIT_DIR/log-analyzer.sh" compare
}

# Function to clean audit files
clean_audit_files() {
    print_section "CLEANING AUDIT FILES"
    
    # Clean log analysis files
    "$AUDIT_DIR/log-analyzer.sh" clean
    
    # Clean old baseline files (keep latest 2)
    if [[ -d "logs/baseline/history" ]]; then
        print_info "Cleaning old baseline history files..."
        find logs/baseline/history -name "baseline_*.json" -type f | \
            sort -r | tail -n +3 | xargs rm -f 2>/dev/null || true
        find logs/baseline/history -name "comparison_*.json" -type f | \
            sort -r | tail -n +3 | xargs rm -f 2>/dev/null || true
    fi
    
    print_success "Audit cleanup completed"
    print_info "Note: Debug and test logs are not cleaned as they represent the latest system state"
}

# Function to run full audit
run_full_audit() {
    local verbose=$1
    local force=$2
    
    print_header "FULL SYSTEM AUDIT"
    
    # Step 1: Setup (if needed)
    if [[ $force == true ]] || [[ ! -f "logs/baseline/current_baseline.json" ]]; then
        run_setup "$verbose" "$force"
    else
        print_info "Audit environment already set up (use --force to re-setup)"
    fi
    
    # Step 2: Establish baseline (if needed)
    if [[ $force == true ]] || [[ ! -f "logs/baseline/current_baseline.json" ]]; then
        establish_baseline
    else
        print_info "Baseline already exists (use --force to recreate)"
    fi
    
    # Step 3: Run debug scripts
    run_debug_scripts "$verbose"
    
    # Step 4: Run test scripts
    run_test_scripts "$verbose"
    
    # Step 5: Analyze results
    analyze_logs "$verbose"
    
    # Step 6: Generate summary
    print_section "AUDIT SUMMARY"
    show_audit_summary
    
    print_success "Full audit completed!"
    print_info "Check logs/analysis/ for detailed results"
}



# Function to show audit summary
show_audit_summary() {
    # Get latest analysis file
    local latest_analysis=$(find logs/analysis -name "comprehensive_analysis_*.txt" | sort -r | head -1)
    
    if [[ -f "$latest_analysis" ]]; then
        local total_errors=$(grep "Total errors found:" "$latest_analysis" | tail -1 | grep -o '[0-9]*')
        local total_warnings=$(grep "Total warnings found:" "$latest_analysis" | tail -1 | grep -o '[0-9]*')
        
        echo ""
        echo "📊 AUDIT RESULTS SUMMARY:"
        echo "========================="
        if [[ "${total_errors:-0}" -eq 0 ]]; then
            print_success "Actual Errors: $total_errors"
        else
            print_error "Actual Errors: $total_errors"
        fi
        
        if [[ "${total_warnings:-0}" -eq 0 ]]; then
            print_success "Actual Warnings: $total_warnings"
        elif [[ "${total_warnings:-0}" -le 15 ]]; then
            print_warning "Actual Warnings: $total_warnings (monitoring alerts)"
        else
            print_error "Actual Warnings: $total_warnings (needs investigation)"
        fi
        
        echo ""
        if [[ "${total_errors:-0}" -eq 0 ]] && [[ "${total_warnings:-0}" -le 15 ]]; then
            print_success "SYSTEM STATUS: EXCELLENT - Ready for production"
        elif [[ "${total_errors:-0}" -eq 0 ]]; then
            print_warning "SYSTEM STATUS: GOOD - Some warnings need review"
        else
            print_error "SYSTEM STATUS: ISSUES FOUND - Errors need immediate attention"
        fi
        
        echo ""
        print_info "Detailed analysis: $latest_analysis"
    else
        print_warning "No analysis results found. Run 'analyze' command first."
    fi
}

# Main execution
main() {
    local command="${1:-full}"
    local verbose=false
    local force=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                verbose=true
                shift
                ;;
            --force)
                force=true
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                if [[ "$1" != "$command" ]]; then
                    command="$1"
                fi
                shift
                ;;
        esac
    done
    
    # Change to root directory for consistent execution
    cd "$ROOT_DIR"
    
    case "$command" in
        full)
            run_full_audit "$verbose" "$force"
            ;;
        debug)
            run_debug_scripts "$verbose"
            ;;
        test)
            run_test_scripts "$verbose"
            ;;
        analyze)
            analyze_logs "$verbose"
            ;;
        summary)
            "$AUDIT_DIR/log-analyzer.sh" summary
            ;;
        baseline)
            establish_baseline
            ;;
        compare)
            compare_with_baseline
            ;;
        status)
            show_status
            ;;
        setup)
            run_setup "$verbose" "$force"
            ;;
        verify)
            verify_environment
            ;;
        clean)
            clean_audit_files
            ;;
        help)
            show_usage
            ;;
        *)
            print_error "Unknown command: $command"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"