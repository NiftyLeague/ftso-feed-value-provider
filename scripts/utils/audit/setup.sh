#!/bin/bash

# Audit Environment Setup - Prepares the system for comprehensive audit
# This script sets up the audit environment and verifies all components are ready

set -eo pipefail

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

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
    echo "  setup                - Complete audit environment setup"
    echo "  verify               - Verify audit environment readiness"
    echo "  status               - Show current audit environment status"
    echo "  clean                - Clean up audit artifacts"
    echo ""
    echo "Options:"
    echo "  --verbose, -v        - Verbose output"
    echo "  --force              - Force setup even if already configured"
    echo ""
    echo "Examples:"
    echo "  $0 setup --verbose           # Complete setup with verbose output"
    echo "  $0 verify                    # Verify environment is ready"
    echo "  $0 status                    # Show current status"
}

# Function to verify script permissions
verify_script_permissions() {
    print_section "VERIFYING SCRIPT PERMISSIONS"
    
    local issues=0
    
    # Check main run.sh script
    if [[ -x "scripts/run.sh" ]]; then
        print_success "Main run.sh script is executable"
    else
        print_error "Main run.sh script is not executable"
        chmod +x scripts/run.sh
        print_info "Fixed run.sh permissions"
    fi
    
    # Check debug scripts
    print_info "Checking debug scripts..."
    for script in scripts/debug/*.sh; do
        if [[ -f "$script" ]]; then
            if [[ -x "$script" ]]; then
                echo "  ✓ $(basename "$script")"
            else
                echo "  ✗ $(basename "$script") - fixing permissions"
                chmod +x "$script"
                ((issues++))
            fi
        fi
    done
    
    # Check test scripts
    print_info "Checking test scripts..."
    for script in scripts/test/*.sh; do
        if [[ -f "$script" ]]; then
            if [[ -x "$script" ]]; then
                echo "  ✓ $(basename "$script")"
            else
                echo "  ✗ $(basename "$script") - fixing permissions"
                chmod +x "$script"
                ((issues++))
            fi
        fi
    done
    
    # Check utility scripts
    print_info "Checking utility scripts..."
    for script in scripts/utils/*.sh; do
        if [[ -f "$script" ]]; then
            if [[ -x "$script" ]]; then
                echo "  ✓ $(basename "$script")"
            else
                echo "  ✗ $(basename "$script") - fixing permissions"
                chmod +x "$script"
                ((issues++))
            fi
        fi
    done
    
    if [[ $issues -eq 0 ]]; then
        print_success "All scripts have correct permissions"
    else
        print_warning "Fixed $issues script permission issues"
    fi
    
    return 0
}

# Function to test run.sh functionality
test_run_script() {
    print_section "TESTING RUN.SH FUNCTIONALITY"
    
    # Test help command
    if ./scripts/run.sh help >/dev/null 2>&1; then
        print_success "run.sh help command works"
    else
        print_error "run.sh help command failed"
        return 1
    fi
    
    # Test debug script listing (expect it to show available scripts when no script specified)
    if ./scripts/run.sh debug 2>&1 | grep -q "Available scripts"; then
        print_success "run.sh can list debug scripts"
    else
        print_warning "run.sh debug script listing may have issues"
    fi
    
    # Test test script listing (expect it to show available scripts when no script specified)
    if ./scripts/run.sh test 2>&1 | grep -q "Available scripts"; then
        print_success "run.sh can list test scripts"
    else
        print_warning "run.sh test script listing may have issues"
    fi
    
    return 0
}

# Function to setup log analysis utilities
setup_log_analysis() {
    print_section "SETTING UP LOG ANALYSIS UTILITIES"
    
    # Ensure log directories exist
    mkdir -p logs/debug logs/test logs/analysis logs/baseline logs/baseline/history
    print_success "Log directories created"
    
    # Test log analyzer
    if ./scripts/utils/audit/log-analyzer.sh patterns >/dev/null 2>&1; then
        print_success "Log analyzer is functional"
    else
        print_error "Log analyzer has issues"
        return 1
    fi
    
    # Test system baseline utility
    if ./scripts/utils/audit/baseline.sh status >/dev/null 2>&1; then
        print_success "System baseline utility is functional"
    else
        print_error "System baseline utility has issues"
        return 1
    fi
    
    return 0
}

# Function to establish baseline
establish_baseline() {
    print_section "ESTABLISHING SYSTEM BASELINE"
    
    # Capture baseline system state
    if ./scripts/utils/audit/baseline.sh capture; then
        print_success "System baseline captured"
    else
        print_error "Failed to capture system baseline"
        return 1
    fi
    
    # Run initial log analysis if logs exist
    if [[ -d "logs/debug" ]] && [[ "$(find logs/debug -name "*.log" | wc -l)" -gt 0 ]]; then
        print_info "Running initial log analysis..."
        if ./scripts/utils/audit/log-analyzer.sh analyze >/dev/null 2>&1; then
            print_success "Initial log analysis completed"
        else
            print_warning "Initial log analysis had issues (this is normal if no logs exist yet)"
        fi
    else
        print_info "No existing logs found - will analyze after first script runs"
    fi
    
    return 0
}

# Function to verify environment readiness
verify_environment() {
    print_section "VERIFYING ENVIRONMENT READINESS"
    
    local issues=0
    
    # Check Node.js
    if command -v node >/dev/null 2>&1; then
        print_success "Node.js is available: $(node --version)"
    else
        print_error "Node.js is not available"
        ((issues++))
    fi
    
    # Check npm/pnpm
    if command -v pnpm >/dev/null 2>&1; then
        print_success "pnpm is available: $(pnpm --version)"
    elif command -v npm >/dev/null 2>&1; then
        print_success "npm is available: $(npm --version)"
    else
        print_error "Neither npm nor pnpm is available"
        ((issues++))
    fi
    
    # Check package.json
    if [[ -f "package.json" ]]; then
        print_success "package.json exists"
    else
        print_error "package.json not found"
        ((issues++))
    fi
    
    # Check node_modules
    if [[ -d "node_modules" ]]; then
        print_success "node_modules directory exists"
    else
        print_warning "node_modules directory not found - run npm/pnpm install"
    fi
    
    # Check TypeScript compilation
    if command -v tsc >/dev/null 2>&1 || [[ -f "node_modules/.bin/tsc" ]]; then
        print_success "TypeScript compiler is available"
    else
        print_warning "TypeScript compiler not found"
    fi
    
    # Check Jest
    if command -v jest >/dev/null 2>&1 || [[ -f "node_modules/.bin/jest" ]]; then
        print_success "Jest is available"
    else
        print_warning "Jest not found"
    fi
    
    # Check essential directories
    for dir in src scripts logs; do
        if [[ -d "$dir" ]]; then
            print_success "$dir directory exists"
        else
            print_error "$dir directory not found"
            ((issues++))
        fi
    done
    
    if [[ $issues -eq 0 ]]; then
        print_success "Environment verification passed"
        return 0
    else
        print_error "Environment verification found $issues critical issues"
        return 1
    fi
}

# Function to show current status
show_status() {
    print_header "AUDIT ENVIRONMENT STATUS"
    
    # Script permissions status
    print_section "SCRIPT PERMISSIONS"
    local executable_count=$(find scripts -name "*.sh" -perm +111 | wc -l | tr -d ' ')
    local total_count=$(find scripts -name "*.sh" | wc -l | tr -d ' ')
    echo "Executable scripts: $executable_count/$total_count"
    
    # Baseline status
    print_section "BASELINE STATUS"
    ./scripts/utils/audit/baseline.sh status
    
    # Log analysis status
    print_section "LOG ANALYSIS STATUS"
    if [[ -d "logs/analysis" ]]; then
        local analysis_count=$(find logs/analysis -name "*.txt" | wc -l | tr -d ' ')
        echo "Analysis files: $analysis_count"
        if [[ $analysis_count -gt 0 ]]; then
            echo "Latest analysis: $(find logs/analysis -name "comprehensive_analysis_*.txt" | sort -r | head -1)"
        fi
    else
        echo "No analysis directory found"
    fi
    
    # Available logs
    print_section "AVAILABLE LOGS"
    if [[ -d "logs/debug" ]]; then
        local debug_logs=$(find logs/debug -name "*.log" | wc -l | tr -d ' ')
        echo "Debug logs: $debug_logs"
    fi
    if [[ -d "logs/test" ]]; then
        local test_logs=$(find logs/test -name "*.log" | wc -l | tr -d ' ')
        echo "Test logs: $test_logs"
    fi
}

# Function to clean audit artifacts
clean_audit() {
    print_section "CLEANING AUDIT ARTIFACTS"
    
    # Clean old analysis files
    ./scripts/utils/audit/log-analyzer.sh clean
    
    # Clean old baseline files (keep latest 3)
    if [[ -d "logs/baseline/history" ]]; then
        find logs/baseline/history -name "*.json" | sort -r | tail -n +4 | xargs rm -f
        print_info "Cleaned old baseline files"
    fi
    
    print_success "Audit cleanup completed"
}

# Function to perform complete setup
complete_setup() {
    local verbose=${1:-false}
    local force=${2:-false}
    
    print_header "AUDIT ENVIRONMENT SETUP"
    
    # Check if already set up (unless forced)
    if [[ $force == false ]] && [[ -f "logs/baseline/current_baseline.json" ]]; then
        print_info "Audit environment appears to be already set up"
        print_info "Use --force to re-setup or run 'verify' to check status"
        return 0
    fi
    
    # Step 1: Verify and fix script permissions
    verify_script_permissions
    
    # Step 2: Test run.sh functionality
    test_run_script
    
    # Step 3: Setup log analysis utilities
    setup_log_analysis
    
    # Step 4: Establish baseline
    establish_baseline
    
    # Step 5: Verify environment
    if verify_environment; then
        print_success "Audit environment setup completed successfully"
        
        if [[ $verbose == true ]]; then
            echo ""
            show_status
        fi
        
        echo ""
        print_info "You can now start the audit by running:"
        print_info "  ./scripts/run.sh debug startup"
        print_info "  ./scripts/utils/audit/log-analyzer.sh analyze"
        
    else
        print_error "Environment setup completed but verification failed"
        print_info "Please address the issues above before starting the audit"
        return 1
    fi
    
    return 0
}

# Main execution
main() {
    local command="${1:-setup}"
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
    
    case "$command" in
        setup)
            complete_setup "$verbose" "$force"
            ;;
        verify)
            verify_environment
            ;;
        status)
            show_status
            ;;
        clean)
            clean_audit
            ;;
        help)
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