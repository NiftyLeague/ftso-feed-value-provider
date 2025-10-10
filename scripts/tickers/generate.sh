#!/bin/bash

# Tickers Generation Script
# This script fetches exchange ticker data and generates the _feeds.json file

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Starting ticker data generation..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Function to fetch tickers for a single exchange
fetch_single_exchange() {
    local exchange=$1
    local output_file="$SCRIPT_DIR/generated/${exchange}.json"
    
    log "Fetching tickers for $exchange..."
    
    # Use the dedicated TypeScript script
    local node_script="$SCRIPT_DIR/fetch-tickers.ts"
    
    # Run the TypeScript script and save output
    if npx ts-node "$node_script" "$exchange" > "$output_file" 2>/dev/null; then
        local count=$(node -e "const data = require('$output_file'); console.log(data.count || 0);")
        success "Fetched $count tickers for $exchange"
        return 0
    else
        error "Failed to fetch tickers for $exchange"
        # Create empty file with error info
        echo "{" > "$output_file"
        echo "  \"exchange\": \"$exchange\"," >> "$output_file"
        echo "  \"timestamp\": $(date +%s)000," >> "$output_file"
        echo "  \"error\": \"Failed to fetch tickers\"," >> "$output_file"
        echo "  \"count\": 0," >> "$output_file"
        echo "  \"symbols\": []," >> "$output_file"
        echo "  \"markets\": {}" >> "$output_file"
        echo "}" >> "$output_file"
        return 1
    fi
}

# Function to fetch exchange tickers
fetch_exchange_tickers() {
    echo "📡 Fetching exchange ticker data..."
    
    # Load exchanges from supported/exchanges.json
    local exchanges_file="$SCRIPT_DIR/supported/exchanges.json"
    
    if [ ! -f "$exchanges_file" ]; then
        error "exchanges.json not found at $exchanges_file"
        exit 1
    fi
    
    # Check if Node.js and CCXT are available
    if ! command -v node &> /dev/null; then
        error "Node.js is not installed or not in PATH"
        exit 1
    fi
    
    # Check if CCXT is available
    if ! node -e "const ccxt = require('ccxt'); console.log('CCXT available');" 2>/dev/null; then
        error "CCXT library is not installed. Please run: npm install ccxt"
        exit 1
    fi
    
    # Extract category 1 exchanges from exchanges.json
    local exchanges=($(node -e "
        const data = require('$exchanges_file');
        const category1 = data.categories['1'];
        if (category1 && category1.exchanges) {
            console.log(category1.exchanges.join(' '));
        }
    "))
    
    local total=${#exchanges[@]}
    local current=0
    local successful=0
    local failed=0
    
    log "Processing $total exchanges from category 1..."
    
    for exchange in "${exchanges[@]}"; do
        current=$((current + 1))
        log "[$current/$total] Processing $exchange..."
        
        if fetch_single_exchange "$exchange"; then
            successful=$((successful + 1))
        else
            failed=$((failed + 1))
        fi
        
        # Check if we should continue instead of fixed delay
        if [ $((processed % 10)) -eq 0 ]; then
            echo "Processed $processed tickers..."
        fi
    done
    
    log "Ticker fetch completed!"
    success "Successfully processed: $successful exchanges"
    if [ $failed -gt 0 ]; then
        warn "Failed to process: $failed exchanges"
    fi
    
    # Generate summary
    log "Generating summary..."
    local summary_file="$SCRIPT_DIR/generated/_summary.json"
    
    echo "{" > "$summary_file"
    echo "  \"timestamp\": $(date +%s)000," >> "$summary_file"
    echo "  \"total_exchanges\": $total," >> "$summary_file"
    echo "  \"successful\": $successful," >> "$summary_file"
    echo "  \"failed\": $failed," >> "$summary_file"
    echo "  \"exchanges\": [" >> "$summary_file"
    
    local first=true
    for exchange in "${exchanges[@]}"; do
        local ticker_file="$SCRIPT_DIR/generated/${exchange}.json"
        if [ -f "$ticker_file" ]; then
            local count=$(node -e "try { const data = require('$ticker_file'); console.log(data.count || 0); } catch(e) { console.log(0); }" 2>/dev/null || echo "0")
            local status="success"
            if [ "$count" = "0" ]; then
                status="failed"
            fi
            
            if [ "$first" = true ]; then
                first=false
            else
                echo "," >> "$summary_file"
            fi
            
            echo "    {" >> "$summary_file"
            echo "      \"name\": \"$exchange\"," >> "$summary_file"
            echo "      \"status\": \"$status\"," >> "$summary_file"
            echo "      \"ticker_count\": $count," >> "$summary_file"
            echo "      \"file\": \"${exchange}.json\"" >> "$summary_file"
            echo -n "    }" >> "$summary_file"
        fi
    done
    
    echo "" >> "$summary_file"
    echo "  ]" >> "$summary_file"
    echo "}" >> "$summary_file"
    
    success "Summary saved to _summary.json"
    
    echo "✅ Exchange ticker fetch complete"
}

# Function to generate feeds
generate_feeds() {
    echo "🔧 Generating feeds from ticker data..."
    
    # Check if supported/tickers.json exists
    if [ ! -f "supported/tickers.json" ]; then
        echo "❌ supported/tickers.json not found!"
        echo "   Please ensure supported/tickers.json exists with your desired ticker list"
        exit 1
    fi
    
    # Check if we have exchange data
    if [ ! -d "generated" ] || [ -z "$(ls -A generated/*.json 2>/dev/null | grep -v '_')" ]; then
        echo "❌ No exchange data files found in generated/ directory!"
        echo "   Please run fetch_exchange_tickers first or ensure exchange data exists"
        exit 1
    fi
    
    # Run the feed generation
    echo "Running feed generation script..."
    npx tsx generate-feeds.ts
    
    echo "✅ Feed generation complete"
}

# Function to copy exchanges.json to src/config
copy_exchanges_config() {
    echo "📋 Copying exchanges configuration..."
    
    local source_file="$SCRIPT_DIR/supported/exchanges.json"
    local dest_file="$SCRIPT_DIR/../../src/config/exchanges.json"
    
    if [ ! -f "$source_file" ]; then
        error "Source exchanges.json not found at $source_file"
        return 1
    fi
    
    # Create destination directory if it doesn't exist
    mkdir -p "$(dirname "$dest_file")"
    
    # Copy the file
    if cp "$source_file" "$dest_file"; then
        success "Copied exchanges.json to src/config/"
    else
        error "Failed to copy exchanges.json to src/config/"
        return 1
    fi
}

# Main execution
main() {
    echo "Starting at $(date)"
    
    # Step 1: Fetch exchange tickers
    fetch_exchange_tickers
    
    # Step 2: Generate feeds
    generate_feeds
    
    # Step 3: Copy exchanges configuration
    copy_exchanges_config
    
    echo ""
    echo "🎉 All done! Generated files:"
    echo "   - supported/tickers.json (base ticker list)"
    echo "   - supported/exchanges.json (exchange configuration)"
    echo "   - generated/_feeds.json (final feeds with exchange sources)"
    echo "   - src/config/feeds.json (main feeds configuration - updated automatically)"
    echo "   - src/config/exchanges.json (exchange configuration - copied from supported/)"
    echo ""
    echo "Completed at $(date)"
}

# Check for help flag
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Ticker Generation Script"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --help, -h          Show this help message"
    echo "  --feeds-only        Skip exchange data fetch, only generate feeds"
    echo "  --fetch-only        Only fetch exchange data, skip feed generation"
    echo "  --copy-config       Only copy exchanges.json to src/config"
    echo ""
    echo "This script:"
    echo "1. Fetches ticker data from all configured exchanges"
    echo "2. Generates _feeds.json using supported.json and exchange data"
    echo "3. Copies exchanges.json to src/config for application use"
    echo ""
    exit 0
fi

# Handle specific flags
if [[ "$1" == "--feeds-only" ]]; then
    echo "🔧 Running feeds generation only..."
    generate_feeds
elif [[ "$1" == "--fetch-only" ]]; then
    echo "📡 Running exchange data fetch only..."
    fetch_exchange_tickers
elif [[ "$1" == "--copy-config" ]]; then
    echo "📋 Copying exchanges configuration only..."
    copy_exchanges_config
else
    # Run full pipeline
    main
fi