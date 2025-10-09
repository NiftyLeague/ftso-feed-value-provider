# Ticker Management Scripts

This directory contains scripts for managing ticker data and feed generation.

## Overview

The ticker system consists of:

- **Exchange data fetching**: Collects available symbols from each exchange
- **Supported tickers**: Base list of tickers we want to support (without
  exchange info)
- **Feed generation**: Combines supported tickers with exchange data to create
  the final feeds

## Files

### Core Files

- `generate.sh` - Main orchestration script for the full pipeline (includes
  exchange fetching)
- `generate-feeds.ts` - TypeScript script that generates feeds (both
  \_feeds.json and src/config/feeds.json)
- `fetch-tickers.ts` - TypeScript script that handles the actual ticker fetching
  using CCXT

### Configuration

- `supported/tickers.json` - Base list of all supported tickers (category + name
  only)
- `supported/exchanges.json` - Exchange configuration organized by categories
- `generated/` - Directory containing exchange data files and final \_feeds.json
- `src/config/feeds.json` - Main feeds configuration file (automatically
  updated)

## Usage

### Feed Generation Pipeline

```bash
# Full pipeline: fetch exchange data and generate feeds
./generate.sh

# Only fetch exchange data
./generate.sh --fetch-only

# Only generate feeds (using existing exchange data)
./generate.sh --feeds-only

# Show help
./generate.sh --help
```

### Manual Operations

```bash
# Generate feeds directly
npx tsx generate-feeds.ts
```

### Via npm scripts

```bash
# Full pipeline: fetch exchange data and generate feeds
npm run tickers:generate

# Only fetch exchange data
npm run tickers:fetch

# Only generate feeds (using existing exchange data)
npm run tickers:feeds

# Show help
npm run tickers:help
```

## Exchange Categories

Exchanges are organized by categories in `supported/exchanges.json`:

- **Category 1**: Cryptocurrency Exchanges (18 exchanges)
  - binance, bitget, bitmart, bitmex, bitrue, bitstamp, bybit, coinbase, coinex
  - cryptocom, gate, htx, kraken, kucoin, mexc, okx, probit, upbit
- **Category 2**: Forex/Traditional Markets (empty - reserved for future use)
- **Category 3**: Commodities (empty - reserved for future use)
- **Category 4**: Derivatives (empty - reserved for future use)

## Output Format

Each exchange JSON file contains:

- `exchange`: Exchange name
- `timestamp`: When the data was fetched
- `count`: Number of active trading pairs
- `symbols`: Array of all trading pair symbols
- `markets`: Detailed market information for each symbol

## Requirements

- Node.js
- CCXT library (`npm install ccxt`)
- TypeScript support (`npx tsx`)

## How It Works

1. **Exchange Configuration**: `supported/exchanges.json` defines which
   exchanges to fetch from each category
2. **Exchange Data**: Each exchange file (e.g., `binance.json`) contains all
   available symbols
3. **Supported Tickers**: `supported/tickers.json` defines which tickers we want
   to support
4. **Feed Generation**: The system matches supported tickers against exchange
   data to find sources
5. **Symbol Normalization**: USDT pairs are normalized to USD for matching
   (e.g., BTC/USDT → BTC/USD)
6. **Dual Output**: Feeds are written to both `generated/_feeds.json` and
   `src/config/feeds.json` to keep them in sync

## Adding New Tickers

1. Add the ticker to the appropriate category in `supported/tickers.json`:

```json
{
  "categories": {
    "1": {
      "name": "Cryptocurrency Pairs",
      "description": "Cryptocurrency trading pairs against USD",
      "tickers": ["BTC/USD", "NEWTOKEN/USD"]
    }
  }
}
```

2. Run the generation:

```bash
./generate.sh --feeds-only
# or
npm run tickers:feeds
```

## Adding New Exchanges

1. Add the exchange to the appropriate category in `supported/exchanges.json`:

```json
{
  "categories": {
    "1": {
      "name": "Cryptocurrency Exchanges",
      "description": "Major cryptocurrency exchanges providing spot trading data",
      "exchanges": ["binance", "newexchange"]
    }
  }
}
```

2. Ensure the exchange is supported by CCXT library
3. Run the full pipeline:

```bash
./generate.sh
```

## File Structure

```
scripts/tickers/
├── generate.sh                 # Main orchestration script
├── generate-feeds.ts           # Feed generation logic
├── fetch-tickers.ts           # TypeScript fetching implementation
├── supported/
│   ├── tickers.json           # Base ticker definitions
│   └── exchanges.json         # Exchange configuration by category
└── generated/
    ├── _feeds.json            # Final generated feeds (copy)
    ├── _summary.json          # Exchange fetch summary
    ├── binance.json           # Exchange data files
    ├── coinbase.json
    └── ...

# Note: The main feeds.json is located at src/config/feeds.json and is automatically updated
```

## Notes

- The script includes rate limiting (1 second delay between exchanges)
- Only active markets are included in the results
- Files are automatically created in the `generated/` subdirectory
- A summary file is generated after each exchange fetch run
- Exchange fetching functionality is now integrated into `generate.sh`
