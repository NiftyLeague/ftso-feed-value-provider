#!/bin/bash

# System Baseline Utility - Establishes and monitors baseline system state for audit
# This utility captures system state before audit and tracks changes during the process

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
BASELINE_DIR="logs/baseline"
CURRENT_BASELINE="$BASELINE_DIR/current_baseline.json"
BASELINE_HISTORY="$BASELINE_DIR/history"

# Create baseline directories
mkdir -p "$BASELINE_DIR" "$BASELINE_HISTORY"

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
    echo "  capture              - Capture current system baseline"
    echo "  compare              - Compare current state with baseline"
    echo "  status               - Show current baseline status"
    echo "  history              - Show baseline history"
    echo "  reset                - Reset baseline to current state"
    echo ""
    echo "Options:"
    echo "  --verbose, -v        - Verbose output"
    echo "  --save-history       - Save comparison to history"
    echo ""
    echo "Examples:"
    echo "  $0 capture                   # Capture new baseline"
    echo "  $0 compare --verbose         # Compare with verbose output"
    echo "  $0 status                    # Show baseline status"
}

# Function to get system information
get_system_info() {
    local output_file="$1"
    
    cat > "$output_file" << EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "capture_time": "$(date)",
  "system": {
    "hostname": "$(hostname)",
    "os": "$(uname -s)",
    "arch": "$(uname -m)",
    "kernel": "$(uname -r)",
    "uptime": "$(uptime | sed 's/.*up //' | sed 's/, [0-9]* user.*//' | tr -d '\n\r' | sed 's/"/\\"/g')"
  },
  "runtime": {
    "node_version": "$(node --version 2>/dev/null || echo 'not available')",
    "npm_version": "$(npm --version 2>/dev/null || echo 'not available')",
    "pnpm_version": "$(pnpm --version 2>/dev/null || echo 'not available')",
    "jest_version": "$(npx jest --version 2>/dev/null | head -1 || echo 'not available')"
  },
  "project": {
    "directory": "$(pwd)",
    "git_branch": "$(git branch --show-current 2>/dev/null || echo 'not available')",
    "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo 'not available')",
    "git_status": "$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ') files modified",
    "package_json_exists": $([ -f package.json ] && echo "true" || echo "false"),
    "node_modules_exists": $([ -d node_modules ] && echo "true" || echo "false")
  },
  "resources": {
    "disk_usage": "$(df -h . | tail -1 | awk '{print $5}' | sed 's/%//')",
    "available_memory": "$(free -m 2>/dev/null | grep '^Mem:' | awk '{print $7}' || echo 'unknown')",
    "load_average": "$(uptime | sed 's/.*load average: //' | tr -d '\n\r' | sed 's/"/\\"/g' || echo 'unknown')"
  },
  "network": {
    "interfaces": [
EOF
    
    # Add network interfaces (simplified for cross-platform compatibility)
    echo "      \"lo0\"" >> "$output_file"
    
    cat >> "$output_file" << EOF
    ]
  },
  "processes": {
    "node_processes": $(pgrep -f node | wc -l | tr -d ' '),
    "jest_processes": $(pgrep -f jest | wc -l | tr -d ' '),
    "total_processes": $(ps aux | wc -l | tr -d ' ')
  },
  "files": {
EOF
    
    # Add file system information
    local first=true
    
    # Check for important project files
    for file in package.json tsconfig.json jest.config.js .env; do
        if [[ $first == false ]]; then
            echo "," >> "$output_file"
        fi
        first=false
        
        if [[ -f "$file" ]]; then
            local size=$(wc -c < "$file" 2>/dev/null || echo "0")
            local modified=$(stat -f %Sm -t %Y-%m-%dT%H:%M:%SZ "$file" 2>/dev/null || echo 'unknown')
            cat >> "$output_file" << EOF
    "$file": {
      "exists": true,
      "size": $size,
      "modified": "$modified"
    }
EOF
        else
            cat >> "$output_file" << EOF
    "$file": {
      "exists": false
    }
EOF
        fi
    done
    
    cat >> "$output_file" << EOF
  },
  "directories": {
EOF
    
    # Add directory information
    first=true
    for dir in src scripts logs node_modules dist coverage; do
        if [[ $first == false ]]; then
            echo "," >> "$output_file"
        fi
        first=false
        
        if [[ -d "$dir" ]]; then
            local file_count=$(find "$dir" -type f 2>/dev/null | wc -l | tr -d ' ')
            local dir_size=$(du -sh "$dir" 2>/dev/null | awk '{print $1}' || echo 'unknown')
            cat >> "$output_file" << EOF
    "$dir": {
      "exists": true,
      "file_count": $file_count,
      "size": "$dir_size"
    }
EOF
        else
            cat >> "$output_file" << EOF
    "$dir": {
      "exists": false
    }
EOF
        fi
    done
    
    cat >> "$output_file" << EOF
  },
  "ports": {
    "listening_ports": [
EOF
    
    # Add listening ports information (simplified)
    echo "      \"3000\"" >> "$output_file"
    
    echo "    ]" >> "$output_file"
    echo "  }" >> "$output_file"
    echo "}" >> "$output_file"
}

# Function to capture baseline
capture_baseline() {
    local verbose=${1:-false}
    
    print_header "CAPTURING SYSTEM BASELINE"
    
    print_info "Collecting system information..."
    
    # Save previous baseline if it exists
    if [[ -f "$CURRENT_BASELINE" ]]; then
        local timestamp=$(date +%Y%m%d_%H%M%S)
        cp "$CURRENT_BASELINE" "$BASELINE_HISTORY/baseline_$timestamp.json"
        print_info "Previous baseline saved to history"
    fi
    
    # Capture new baseline
    get_system_info "$CURRENT_BASELINE"
    
    print_success "Baseline captured successfully"
    
    if [[ $verbose == true ]]; then
        print_section "BASELINE SUMMARY"
        if command -v jq >/dev/null 2>&1; then
            echo "Timestamp: $(jq -r '.timestamp' "$CURRENT_BASELINE")"
            echo "Git branch: $(jq -r '.project.git_branch' "$CURRENT_BASELINE")"
            echo "Git commit: $(jq -r '.project.git_commit' "$CURRENT_BASELINE")"
            echo "Node version: $(jq -r '.runtime.node_version' "$CURRENT_BASELINE")"
            echo "Disk usage: $(jq -r '.resources.disk_usage' "$CURRENT_BASELINE")%"
        else
            echo "Baseline file: $CURRENT_BASELINE"
            echo "Use 'jq' for detailed baseline information"
        fi
    fi
    
    return 0
}

# Function to compare with baseline
compare_baseline() {
    local verbose=${1:-false}
    local save_history=${2:-false}
    
    print_header "COMPARING WITH BASELINE"
    
    if [[ ! -f "$CURRENT_BASELINE" ]]; then
        print_error "No baseline found. Run 'capture' first."
        return 1
    fi
    
    print_info "Comparing current state with baseline..."
    
    # Create temporary file for current state
    local temp_current="/tmp/current_state_$$.json"
    get_system_info "$temp_current"
    
    # Compare key metrics
    if command -v jq >/dev/null 2>&1; then
        print_section "COMPARISON RESULTS"
        
        # Git changes
        local baseline_commit=$(jq -r '.project.git_commit' "$CURRENT_BASELINE")
        local current_commit=$(jq -r '.project.git_commit' "$temp_current")
        
        if [[ "$baseline_commit" != "$current_commit" ]]; then
            print_warning "Git commit changed: $baseline_commit -> $current_commit"
        else
            print_success "Git commit unchanged"
        fi
        
        # File changes
        local baseline_modified=$(jq -r '.project.git_status' "$CURRENT_BASELINE")
        local current_modified=$(jq -r '.project.git_status' "$temp_current")
        
        if [[ "$baseline_modified" != "$current_modified" ]]; then
            print_warning "Modified files changed: $baseline_modified -> $current_modified"
        else
            print_success "No new file modifications"
        fi
        
        # Process changes
        local baseline_node=$(jq -r '.processes.node_processes' "$CURRENT_BASELINE")
        local current_node=$(jq -r '.processes.node_processes' "$temp_current")
        
        if [[ "$baseline_node" != "$current_node" ]]; then
            print_info "Node processes: $baseline_node -> $current_node"
        fi
        
        # Disk usage
        local baseline_disk=$(jq -r '.resources.disk_usage' "$CURRENT_BASELINE")
        local current_disk=$(jq -r '.resources.disk_usage' "$temp_current")
        
        if [[ "$baseline_disk" != "$current_disk" ]]; then
            local disk_diff=$((current_disk - baseline_disk))
            if [[ $disk_diff -gt 5 ]]; then
                print_warning "Disk usage increased significantly: ${baseline_disk}% -> ${current_disk}% (+${disk_diff}%)"
            else
                print_info "Disk usage: ${baseline_disk}% -> ${current_disk}%"
            fi
        fi
        
        if [[ $verbose == true ]]; then
            print_section "DETAILED COMPARISON"
            echo "Baseline timestamp: $(jq -r '.timestamp' "$CURRENT_BASELINE")"
            echo "Current timestamp: $(jq -r '.timestamp' "$temp_current")"
            echo ""
            echo "Runtime versions:"
            echo "  Node: $(jq -r '.runtime.node_version' "$CURRENT_BASELINE") -> $(jq -r '.runtime.node_version' "$temp_current")"
            echo "  NPM: $(jq -r '.runtime.npm_version' "$CURRENT_BASELINE") -> $(jq -r '.runtime.npm_version' "$temp_current")"
            echo "  PNPM: $(jq -r '.runtime.pnpm_version' "$CURRENT_BASELINE") -> $(jq -r '.runtime.pnpm_version' "$temp_current")"
        fi
        
    else
        print_warning "jq not available. Install jq for detailed comparison."
        print_info "Baseline file: $CURRENT_BASELINE"
        print_info "Current state: $temp_current"
    fi
    
    # Save comparison to history if requested
    if [[ $save_history == true ]]; then
        local timestamp=$(date +%Y%m%d_%H%M%S)
        cp "$temp_current" "$BASELINE_HISTORY/comparison_$timestamp.json"
        print_info "Comparison saved to history"
    fi
    
    # Cleanup
    rm -f "$temp_current"
    
    return 0
}

# Function to show baseline status
show_status() {
    print_header "BASELINE STATUS"
    
    if [[ -f "$CURRENT_BASELINE" ]]; then
        print_success "Baseline exists"
        
        if command -v jq >/dev/null 2>&1; then
            echo "Captured: $(jq -r '.capture_time' "$CURRENT_BASELINE")"
            echo "Git branch: $(jq -r '.project.git_branch' "$CURRENT_BASELINE")"
            echo "Git commit: $(jq -r '.project.git_commit' "$CURRENT_BASELINE")"
            echo "Node version: $(jq -r '.runtime.node_version' "$CURRENT_BASELINE")"
        else
            echo "File: $CURRENT_BASELINE"
            echo "Size: $(wc -c < "$CURRENT_BASELINE") bytes"
            echo "Modified: $(stat -f %Sm "$CURRENT_BASELINE" 2>/dev/null || echo 'unknown')"
        fi
    else
        print_warning "No baseline captured yet"
        print_info "Run '$0 capture' to establish baseline"
    fi
    
    # Show history count
    local history_count=$(find "$BASELINE_HISTORY" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
    echo "History entries: $history_count"
}

# Function to show baseline history
show_history() {
    print_header "BASELINE HISTORY"
    
    if [[ -d "$BASELINE_HISTORY" ]]; then
        local files=$(find "$BASELINE_HISTORY" -name "*.json" | sort -r)
        
        if [[ -n "$files" ]]; then
            echo "$files" | while read -r file; do
                local filename=$(basename "$file")
                local size=$(wc -c < "$file" 2>/dev/null || echo "0")
                local modified=$(stat -f %Sm "$file" 2>/dev/null || echo 'unknown')
                echo "$filename ($size bytes, $modified)"
            done
        else
            print_info "No history entries found"
        fi
    else
        print_info "No history directory found"
    fi
}

# Function to reset baseline
reset_baseline() {
    print_header "RESETTING BASELINE"
    
    print_warning "This will replace the current baseline with a new capture"
    capture_baseline true
}

# Main execution
main() {
    local command="${1:-}"
    local verbose=false
    local save_history=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                verbose=true
                shift
                ;;
            --save-history)
                save_history=true
                shift
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
        capture)
            capture_baseline "$verbose"
            ;;
        compare)
            compare_baseline "$verbose" "$save_history"
            ;;
        status)
            show_status
            ;;
        history)
            show_history
            ;;
        reset)
            reset_baseline
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