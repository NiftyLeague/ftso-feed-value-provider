/**
 * Configuration Example
 *
 * This demonstrates the simplified approach:
 * 1. Keep feeds.json as-is (no complex tier/priority/weight fields)
 * 2. Automatic adapter detection (custom vs CCXT)
 * 3. Use existing weighted median from ccxt-provider-service
 * 4. Adapters handle their own endpoints/rate limits
 *
 * Requirements: 1.1, 1.4
 */

import { ConfigService } from "./config.service";

export class ConfigExample {
  constructor(private readonly config: ConfigService) {}

  /**
   * Example: How existing feeds.json works with hybrid detection
   */
  demonstrateExistingFeedsJson() {
    // This is how feeds.json looks now (unchanged)
    const btcFeedConfig = {
      feed: { category: 1, name: "BTC/USD" },
      sources: [
        { exchange: "binance", symbol: "BTC/USDT" }, // Will use BinanceAdapter (custom)
        { exchange: "coinbase", symbol: "BTC/USD" }, // Will use CoinbaseAdapter (custom)
        { exchange: "cryptocom", symbol: "BTC/USDT" }, // Will use CryptocomAdapter (custom)
        { exchange: "bitmart", symbol: "BTC/USDT" }, // Will use CCXT
        { exchange: "bybit", symbol: "BTC/USDT" }, // Will use CCXT
        { exchange: "gate", symbol: "BTC/USDT" }, // Will use CCXT
        { exchange: "kucoin", symbol: "BTC/USDT" }, // Will use CCXT
      ],
    };

    // Automatic hybrid detection
    const summary = this.config.getHybridSummary(btcFeedConfig.sources);

    console.log("BTC/USD Feed Analysis:");
    console.log(`- Custom Adapter Sources: ${summary.customAdapterSources.join(", ")}`);
    console.log(`- CCXT Sources: ${summary.ccxtSources.join(", ")}`);
    console.log(`- Total Sources: ${summary.totalSources}`);
    console.log(`- Hybrid Mode: ${summary.hybridMode}`);

    return {
      feedConfig: btcFeedConfig,
      analysis: summary,
      customAdapters: summary.customAdapterSources.map(exchange => ({
        exchange,
        adapterClass: this.config.getAdapterClass(exchange),
      })),
      ccxtExchanges: summary.ccxtSources.map(exchange => ({
        exchange,
        ccxtId: this.config.getCcxtId(exchange),
      })),
    };
  }

  /**
   * Example: Data flow with simplified hybrid approach
   */
  getSimplifiedDataFlow() {
    return {
      description: "Simplified hybrid data flow using existing weighted median",

      // Step 1: Automatic adapter selection
      adapterSelection: {
        binance: "Custom BinanceAdapter (WebSocket + REST fallback)",
        coinbase: "Custom CoinbaseAdapter (WebSocket + REST fallback)",
        cryptocom: "Custom CryptocomAdapter (WebSocket + REST fallback)",
        bitmart: "CCXT Pro (existing implementation)",
        bybit: "CCXT Pro (existing implementation)",
        gate: "CCXT Pro (existing implementation)",
      },

      // Step 2: Price collection (same as existing)
      priceCollection: {
        customAdapters: "Return individual PriceInfo objects with {value, time, exchange}",
        ccxtSources: "Return individual PriceInfo objects with {value, time, exchange}",
        usdtConversion: "Automatic USDT/USD conversion using existing logic",
      },

      // Step 3: Unified aggregation (reuse existing weightedMedian)
      aggregation: {
        method: "Existing weightedMedian() function from ccxt-provider-service.ts",
        lambda: "0.00005 (same exponential decay parameter)",
        sorting: "Sort by timestamp, apply exponential weights, find weighted median",
        result: "Single aggregated price with confidence score",
      },

      // Step 4: Benefits
      benefits: [
        "No changes to feeds.json required",
        "Automatic detection of custom vs CCXT adapters",
        "Reuse proven weighted median algorithm",
        "Adapters handle their own connection details",
        "Backward compatible with existing configuration",
        "Easy to add new exchanges (just add to feeds.json)",
      ],
    };
  }

  /**
   * Example: Adding a new exchange
   */
  demonstrateAddingNewExchange() {
    // Adding a new exchange is simple - just add to feeds.json
    const newExchangeExample = {
      feed: { category: 1, name: "ETH/USD" },
      sources: [
        { exchange: "binance", symbol: "ETH/USDT" }, // Custom adapter
        { exchange: "coinbase", symbol: "ETH/USD" }, // Custom adapter
        { exchange: "huobi", symbol: "ETH/USDT" }, // Will auto-detect as CCXT
        { exchange: "poloniex", symbol: "ETH/USDT" }, // Will auto-detect as CCXT
      ],
    };

    // The system will automatically:
    // 1. Detect binance/coinbase as custom adapters
    // 2. Detect huobi/poloniex as CCXT (unknown = CCXT)
    // 3. Use existing weighted median for all sources

    const validation = this.config.validateSources(newExchangeExample.sources);

    return {
      feedConfig: newExchangeExample,
      validation,
      autoDetection: "Unknown exchanges automatically use CCXT with exchange name as CCXT ID",
    };
  }

  /**
   * Example: Migration from current CCXT-only to hybrid
   */
  demonstrateMigrationPath() {
    return {
      description: "Migration path from current CCXT-only to hybrid approach",

      currentState: {
        approach: "All exchanges use CCXT Pro",
        aggregation: "Existing weightedMedian() function",
        configuration: "feeds.json with exchange/symbol pairs",
      },

      hybridState: {
        approach: "Custom adapters for top 5 exchanges, CCXT for others",
        aggregation: "Same weightedMedian() function (no changes)",
        configuration: "Same feeds.json format (no changes required)",
        detection: "Automatic based on available custom adapters",
      },

      migrationSteps: [
        "1. Deploy ConfigService",
        "2. Implement custom adapters (BinanceAdapter, CoinbaseAdapter, etc.)",
        "3. Update data provider to use hybrid detection",
        "4. No changes to feeds.json required",
        "5. Gradual rollout - can enable/disable custom adapters per exchange",
      ],

      benefits: [
        "Zero configuration changes required",
        "Backward compatible with existing setup",
        "Can migrate one exchange at a time",
        "Reuse all existing CCXT infrastructure",
        "Keep proven weighted median algorithm",
      ],
    };
  }
}

/**
 * Usage example
 */
export function demonstrateConfig() {
  const config = new ConfigService();
  const example = new ConfigExample(config);

  console.log("=== Configuration Demo ===\n");

  // Show how existing feeds.json works
  const feedsDemo = example.demonstrateExistingFeedsJson();
  console.log("1. Existing feeds.json analysis:");
  console.log(JSON.stringify(feedsDemo, null, 2));
  console.log("\n");

  // Show data flow
  const dataFlow = example.getSimplifiedDataFlow();
  console.log("2. Simplified data flow:");
  console.log(JSON.stringify(dataFlow, null, 2));
  console.log("\n");

  // Show adding new exchange
  const newExchange = example.demonstrateAddingNewExchange();
  console.log("3. Adding new exchange:");
  console.log(JSON.stringify(newExchange, null, 2));
  console.log("\n");

  // Show migration path
  const migration = example.demonstrateMigrationPath();
  console.log("4. Migration path:");
  console.log(JSON.stringify(migration, null, 2));

  return {
    feedsDemo,
    dataFlow,
    newExchange,
    migration,
  };
}

/**
 * Example showing the key difference:
 * Complex vs Simplified approach
 */
export function compareApproaches() {
  return {
    complexApproach: {
      feedsJson: {
        sources: [
          {
            exchange: "binance",
            symbol: "BTC/USDT",
            tier: 1,
            priority: 1,
            weight: 0.25,
            websocketEndpoint: "wss://...",
            restEndpoint: "https://...",
            rateLimit: 1200,
          },
        ],
        hybridConfig: {
          /* complex config */
        },
        ccxtConfig: {
          /* complex config */
        },
      },
      pros: ["Fine-grained control", "Explicit configuration"],
      cons: ["Complex configuration", "Maintenance overhead", "Error-prone"],
    },

    simplifiedApproach: {
      feedsJson: {
        sources: [
          {
            exchange: "binance",
            symbol: "BTC/USDT",
          },
        ],
      },
      detection: "Automatic: binance -> BinanceAdapter, unknown -> CCXT",
      aggregation: "Reuse existing weightedMedian() function",
      pros: [
        "Zero configuration changes",
        "Automatic adapter detection",
        "Reuse proven algorithms",
        "Easy maintenance",
        "Backward compatible",
      ],
      cons: ["Less fine-grained control (but do we need it?)"],
    },

    recommendation: "Use simplified approach - it's cleaner, easier to maintain, and meets all requirements",
  };
}
