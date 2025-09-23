#!/bin/bash

# Log Management Utility
# Provides tools for cleaning, archiving, and analyzing logs

echo "📁 FTSO Log Management Utility"
echo "=============================="

# Ensure logs directory exists
mkdir -p logs

# Function to show usage
show_usage() {
    echo "Usage: $0 [command] [options]"
    echo ""
    echo "Commands:"
    echo "  clean     - Clean old log files"
    echo "  archive   - Archive logs to compressed file"
    echo "  analyze   - Quick analysis of recent logs"
    echo "  size      - Show log directory size"
    echo "  list      - List all log files"
    echo "  tail      - Tail the most recent log file"
    echo "  help      - Show this help message"
    echo ""
    echo "Options:"
    echo "  --days N  - For clean: keep logs newer than N days (default: 7)"
    echo "  --file F  - For tail: specify log file to tail"
    echo ""
    echo "Examples:"
    echo "  $0 clean --days 3    # Keep only logs from last 3 days"
    echo "  $0 archive           # Archive all logs"
    echo "  $0 tail --file startup.log  # Tail specific log file"
}

# Function to clean old logs
clean_logs() {
    local days=${1:-7}
    echo "🧹 Cleaning logs older than $days days..."
    
    if [ ! -d "logs" ]; then
        echo "❌ Logs directory not found"
        return 1
    fi
    
    # Find and remove old log files
    local count=$(find logs -name "*.log" -type f -mtime +$days | wc -l | tr -d ' ')
    
    if [ "$count" -gt 0 ]; then
        echo "📊 Found $count old log files to remove:"
        find logs -name "*.log" -type f -mtime +$days -exec basename {} \;
        
        read -p "🗑️  Proceed with deletion? (y/N): " confirm
        if [[ $confirm =~ ^[Yy]$ ]]; then
            find logs -name "*.log" -type f -mtime +$days -delete
            echo "✅ Cleaned $count old log files"
        else
            echo "❌ Cleanup cancelled"
        fi
    else
        echo "✅ No old log files found (older than $days days)"
    fi
}

# Function to archive logs
archive_logs() {
    echo "📦 Archiving logs..."
    
    if [ ! -d "logs" ] || [ -z "$(ls -A logs 2>/dev/null)" ]; then
        echo "❌ No logs to archive"
        return 1
    fi
    
    local timestamp=$(date +"%Y%m%d_%H%M%S")
    local archive_name="logs_archive_$timestamp.tar.gz"
    
    echo "📁 Creating archive: $archive_name"
    
    # Create archive
    tar -czf "$archive_name" logs/
    
    if [ $? -eq 0 ]; then
        local size=$(du -h "$archive_name" | cut -f1)
        echo "✅ Archive created successfully: $archive_name ($size)"
        
        read -p "🗑️  Remove original logs after archiving? (y/N): " confirm
        if [[ $confirm =~ ^[Yy]$ ]]; then
            rm -rf logs/*
            echo "✅ Original logs removed"
        fi
    else
        echo "❌ Failed to create archive"
        return 1
    fi
}

# Function to analyze logs
analyze_logs() {
    echo "📊 Quick Log Analysis"
    echo "===================="
    
    if [ ! -d "logs" ] || [ -z "$(ls -A logs 2>/dev/null)" ]; then
        echo "❌ No logs to analyze"
        return 1
    fi
    
    echo "📁 Log Directory Overview:"
    echo "-------------------------"
    
    # Count files by type
    local log_count=$(find logs -name "*.log" -type f | wc -l | tr -d ' ')
    local json_count=$(find logs -name "*.json" -type f | wc -l | tr -d ' ')
    local total_size=$(du -sh logs 2>/dev/null | cut -f1)
    
    echo "📊 Log files: $log_count"
    echo "📊 JSON files: $json_count"
    echo "💾 Total size: $total_size"
    
    echo ""
    echo "📅 Recent Activity:"
    echo "------------------"
    
    # Show most recent files
    echo "Most recent log files:"
    ls -lt logs/*.log 2>/dev/null | head -5 | awk '{print "📄 " $9 " (" $6 " " $7 " " $8 ")"}'
    
    echo ""
    echo "🔍 Error Summary:"
    echo "----------------"
    
    # Quick error analysis across all logs
    local total_errors=0
    local total_warnings=0
    
    for logfile in logs/*.log; do
        if [ -f "$logfile" ]; then
            local errors=$(grep -c "ERROR\|Error" "$logfile" 2>/dev/null || echo "0")
            local warnings=$(grep -c "WARN\|Warning" "$logfile" 2>/dev/null || echo "0")
            
            total_errors=$((total_errors + errors))
            total_warnings=$((total_warnings + warnings))
            
            if [ $errors -gt 0 ] || [ $warnings -gt 0 ]; then
                echo "📄 $(basename "$logfile"): $errors errors, $warnings warnings"
            fi
        fi
    done
    
    echo ""
    echo "📊 Total across all logs: $total_errors errors, $total_warnings warnings"
    
    if [ $total_errors -gt 0 ]; then
        echo ""
        echo "🚨 Recent Error Patterns:"
        echo "------------------------"
        
        # Show most common error patterns
        grep -h "ERROR\|Error" logs/*.log 2>/dev/null | \
            sed 's/\[[0-9:]*\s*[AP]M\]//g' | \
            sed 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}.*[AP]M//g' | \
            sort | uniq -c | sort -nr | head -3
    fi
}

# Function to show log directory size
show_size() {
    echo "💾 Log Directory Size Analysis"
    echo "============================="
    
    if [ ! -d "logs" ]; then
        echo "❌ Logs directory not found"
        return 1
    fi
    
    echo "📊 Overall size:"
    du -sh logs
    
    echo ""
    echo "📁 Size by file type:"
    echo "--------------------"
    
    # Size by file extension
    for ext in log json txt; do
        local size=$(find logs -name "*.$ext" -exec du -ch {} + 2>/dev/null | tail -1 | cut -f1)
        local count=$(find logs -name "*.$ext" | wc -l | tr -d ' ')
        
        if [ "$count" -gt 0 ]; then
            echo "📄 .$ext files: $size ($count files)"
        fi
    done
    
    echo ""
    echo "📊 Largest files:"
    echo "----------------"
    
    # Show largest files
    find logs -type f -exec du -h {} + 2>/dev/null | sort -hr | head -10
}

# Function to list log files
list_logs() {
    echo "📋 Log Files Listing"
    echo "==================="
    
    if [ ! -d "logs" ] || [ -z "$(ls -A logs 2>/dev/null)" ]; then
        echo "❌ No log files found"
        return 1
    fi
    
    echo "📁 All log files (sorted by date):"
    echo "----------------------------------"
    
    ls -lth logs/ | grep -v "^total" | while read -r line; do
        echo "📄 $line"
    done
}

# Function to tail log files
tail_logs() {
    local file=$1
    
    if [ -n "$file" ]; then
        # Tail specific file
        local filepath="logs/$file"
        
        if [ ! -f "$filepath" ]; then
            echo "❌ Log file not found: $filepath"
            return 1
        fi
        
        echo "📄 Tailing: $filepath"
        echo "======================"
        tail -f "$filepath"
    else
        # Find most recent log file
        local recent_log=$(ls -t logs/*.log 2>/dev/null | head -1)
        
        if [ -z "$recent_log" ]; then
            echo "❌ No log files found"
            return 1
        fi
        
        echo "📄 Tailing most recent log: $recent_log"
        echo "========================================"
        tail -f "$recent_log"
    fi
}

# Parse command line arguments
COMMAND=$1
shift

# Parse options
DAYS=7
FILE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --days)
            DAYS="$2"
            shift 2
            ;;
        --file)
            FILE="$2"
            shift 2
            ;;
        *)
            echo "❌ Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Execute command
case $COMMAND in
    clean)
        clean_logs $DAYS
        ;;
    archive)
        archive_logs
        ;;
    analyze)
        analyze_logs
        ;;
    size)
        show_size
        ;;
    list)
        list_logs
        ;;
    tail)
        tail_logs "$FILE"
        ;;
    help|--help|-h)
        show_usage
        ;;
    "")
        echo "❌ No command specified"
        echo ""
        show_usage
        exit 1
        ;;
    *)
        echo "❌ Unknown command: $COMMAND"
        echo ""
        show_usage
        exit 1
        ;;
esac