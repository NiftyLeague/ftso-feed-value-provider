#!/usr/bin/env node

import * as fs from "fs";
import * as path from "path";

interface SupportedTicker {
  category: number;
  name: string;
}

interface TickersConfig {
  categories: {
    [key: string]: {
      name: string;
      description: string;
      tickers: string[];
    };
  };
}

interface ExchangeData {
  exchange: string;
  timestamp: number;
  count: number;
  symbols: string[];
}

interface FeedSource {
  exchange: string;
  symbol: string;
}

interface Feed {
  feed: SupportedTicker;
  sources: FeedSource[];
}

const GENERATED_DIR = path.join(__dirname, "generated");
const SUPPORTED_DIR = path.join(__dirname, "supported");
const TICKERS_FILE = path.join(SUPPORTED_DIR, "tickers.json");
const FEEDS_OUTPUT = path.join(GENERATED_DIR, "_feeds.json");
const MAIN_FEEDS_OUTPUT = path.join(__dirname, "..", "..", "src", "config", "feeds.json");

/**
 * Check if a symbol should be filtered out.
 */
function shouldFilterSymbol(_exchange: string, symbol: string): boolean {
  // Filter out symbols with :USDT format (these cause WebSocket subscription errors)
  return symbol.includes(":USDT");
}

/**
 * Normalize symbol format for comparison
 * Converts USDT pairs to USD for matching
 */
function normalizeSymbol(symbol: string): string {
  return symbol.replace("/USDT", "/USD").replace(":USDT", "").replace(":USDC", "");
}

/**
 * Load supported tickers from supported/tickers.json
 */
function loadSupportedTickers(): SupportedTicker[] {
  try {
    const data = fs.readFileSync(TICKERS_FILE, "utf8");
    const config: TickersConfig = JSON.parse(data);

    const tickers: SupportedTicker[] = [];

    // Convert categorized structure to flat array
    for (const [categoryId, categoryData] of Object.entries(config.categories)) {
      for (const tickerName of categoryData.tickers) {
        tickers.push({
          category: parseInt(categoryId),
          name: tickerName,
        });
      }
    }

    return tickers;
  } catch (error) {
    console.error("Error loading supported tickers:", error);
    process.exit(1);
  }
}

/**
 * Load exchange data from generated files
 */
function loadExchangeData(): Map<string, ExchangeData> {
  const exchanges = new Map<string, ExchangeData>();

  const files = fs.readdirSync(GENERATED_DIR);

  for (const file of files) {
    if (file.endsWith(".json") && !file.startsWith("_")) {
      const exchangeName = file.replace(".json", "");
      const filePath = path.join(GENERATED_DIR, file);

      try {
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
        exchanges.set(exchangeName, data);
      } catch (error) {
        console.warn(`Warning: Could not load ${file}:`, error);
      }
    }
  }

  return exchanges;
}

/**
 * Find matching symbols for a ticker across all exchanges
 */
function findMatchingSources(ticker: SupportedTicker, exchanges: Map<string, ExchangeData>): FeedSource[] {
  const sources: FeedSource[] = [];
  const seenSymbolsPerExchange = new Map<string, Set<string>>();
  const targetSymbol = ticker.name;

  for (const [exchangeName, exchangeData] of exchanges) {
    if (!seenSymbolsPerExchange.has(exchangeName)) {
      seenSymbolsPerExchange.set(exchangeName, new Set());
    }
    const seenSymbols = seenSymbolsPerExchange.get(exchangeName)!;

    for (const symbol of exchangeData.symbols) {
      // Skip complex derivatives but allow simple perpetual swaps (e.g., "LEO/USDT:USDT")
      if (symbol.includes(":") && !symbol.match(/^[A-Z]+\/USDT:USDT$/)) {
        continue;
      }

      // Filter out problematic OKX symbols
      if (shouldFilterSymbol(exchangeName, symbol)) {
        continue;
      }

      const normalizedSymbol = normalizeSymbol(symbol);

      if (normalizedSymbol === targetSymbol) {
        // Allow multiple symbols per exchange (e.g., both LEO/USD and LEO/USDT from OKX)
        if (!seenSymbols.has(symbol)) {
          seenSymbols.add(symbol);
          sources.push({
            exchange: exchangeName,
            symbol: symbol,
          });
        }
      }
    }
  }

  // Sort sources by exchange name, then by symbol for consistency
  return sources.sort((a, b) => {
    const exchangeCompare = a.exchange.localeCompare(b.exchange);
    if (exchangeCompare !== 0) return exchangeCompare;
    return a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Generate feeds.json from supported tickers and exchange data
 */
function generateFeeds(): void {
  console.log("Loading supported tickers...");
  const supportedTickers = loadSupportedTickers();

  console.log("Loading exchange data...");
  const exchanges = loadExchangeData();
  console.log(`Loaded ${exchanges.size} exchanges`);

  console.log("Generating feeds...");
  const feeds: Feed[] = [];

  for (const ticker of supportedTickers) {
    const sources = findMatchingSources(ticker, exchanges);

    if (sources.length > 0) {
      feeds.push({
        feed: ticker,
        sources: sources,
      });
      console.log(`✓ ${ticker.name}: ${sources.length} sources`);
    } else {
      console.warn(`⚠ ${ticker.name}: No sources found`);
    }
  }

  console.log(`\nWriting ${feeds.length} feeds to output files...`);

  // Write with custom formatting - each source on its own line, but each object is single line
  let output = "[\n";
  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    output += "  {\n";
    output += `    "feed": { "category": ${feed.feed.category}, "name": "${feed.feed.name}" },\n`;
    output += '    "sources": [\n';

    for (let j = 0; j < feed.sources.length; j++) {
      const source = feed.sources[j];
      output += `      { "exchange": "${source.exchange}", "symbol": "${source.symbol}" }`;
      if (j < feed.sources.length - 1) {
        output += ",";
      }
      output += "\n";
    }

    output += "    ]\n";
    output += "  }";
    if (i < feeds.length - 1) {
      output += ",";
    }
    output += "\n";
  }
  output += "]\n";

  // Write to both locations
  fs.writeFileSync(FEEDS_OUTPUT, output);
  console.log(`✓ Written to ${FEEDS_OUTPUT}`);

  fs.writeFileSync(MAIN_FEEDS_OUTPUT, output);
  console.log(`✓ Written to ${MAIN_FEEDS_OUTPUT}`);

  console.log("✅ Feeds generation complete!");
}

if (require.main === module) {
  generateFeeds();
}

export { generateFeeds };
