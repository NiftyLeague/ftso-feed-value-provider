import { BinanceAdapter } from "../binance.adapter";
import { CoinbaseAdapter } from "../coinbase.adapter";
import { KrakenAdapter } from "../kraken.adapter";
import { OkxAdapter } from "../okx.adapter";
import { CryptocomAdapter } from "../cryptocom.adapter";
import feedsConfig from "@/config/feeds.json";

describe("Symbol Mapping Integration Tests", () => {
  let binanceAdapter: BinanceAdapter;
  let coinbaseAdapter: CoinbaseAdapter;
  let krakenAdapter: KrakenAdapter;
  let okxAdapter: OkxAdapter;
  let cryptocomAdapter: CryptocomAdapter;

  beforeEach(() => {
    binanceAdapter = new BinanceAdapter();
    coinbaseAdapter = new CoinbaseAdapter();
    krakenAdapter = new KrakenAdapter();
    okxAdapter = new OkxAdapter();
    cryptocomAdapter = new CryptocomAdapter();
  });

  describe("Tier 1 Exchange Symbol Mappings", () => {
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];

    // Extract all symbols used by Tier 1 exchanges from feeds.json
    const tier1Symbols = new Set<string>();
    const exchangeSymbolMap = new Map<string, Set<string>>();

    beforeAll(() => {
      feedsConfig.forEach(feed => {
        feed.sources.forEach(source => {
          if (tier1Exchanges.includes(source.exchange)) {
            tier1Symbols.add(source.symbol);

            if (!exchangeSymbolMap.has(source.exchange)) {
              exchangeSymbolMap.set(source.exchange, new Set());
            }
            exchangeSymbolMap.get(source.exchange)!.add(source.symbol);
          }
        });
      });
    });

    it("should handle all Binance symbols from feeds.json", () => {
      const binanceSymbols = exchangeSymbolMap.get("binance") || new Set();

      binanceSymbols.forEach(symbol => {
        expect(() => {
          const mapped = binanceAdapter.getSymbolMapping(symbol);
          expect(mapped).toBeDefined();
          expect(mapped.length).toBeGreaterThan(0);

          // Binance should convert BTC/USDT -> BTCUSDT
          if (symbol === "BTC/USDT") {
            expect(mapped).toBe("BTCUSDT");
          }
          if (symbol === "ETH/USDT") {
            expect(mapped).toBe("ETHUSDT");
          }
        }).not.toThrow();
      });
    });

    it("should handle all Coinbase symbols from feeds.json", () => {
      const coinbaseSymbols = exchangeSymbolMap.get("coinbase") || new Set();

      coinbaseSymbols.forEach(symbol => {
        expect(() => {
          const mapped = coinbaseAdapter.getSymbolMapping(symbol);
          expect(mapped).toBeDefined();
          expect(mapped.length).toBeGreaterThan(0);

          // Coinbase should convert BTC/USD -> BTC-USD
          if (symbol === "BTC/USD") {
            expect(mapped).toBe("BTC-USD");
          }
          if (symbol === "ETH/USD") {
            expect(mapped).toBe("ETH-USD");
          }
        }).not.toThrow();
      });
    });

    it("should handle all Kraken symbols from feeds.json", () => {
      const krakenSymbols = exchangeSymbolMap.get("kraken") || new Set();

      krakenSymbols.forEach(symbol => {
        expect(() => {
          const mapped = krakenAdapter.getSymbolMapping(symbol);
          expect(mapped).toBeDefined();
          expect(mapped.length).toBeGreaterThan(0);

          // Kraken should convert BTC/USD -> XBTUSD
          if (symbol === "BTC/USD") {
            expect(mapped).toBe("XBTUSD");
          }
          if (symbol === "ETH/USD") {
            expect(mapped).toBe("ETHUSD");
          }
        }).not.toThrow();
      });
    });

    it("should handle all OKX symbols from feeds.json", () => {
      const okxSymbols = exchangeSymbolMap.get("okx") || new Set();

      okxSymbols.forEach(symbol => {
        expect(() => {
          const mapped = okxAdapter.getSymbolMapping(symbol);
          expect(mapped).toBeDefined();
          expect(mapped.length).toBeGreaterThan(0);

          // OKX should convert BTC/USDT -> BTC-USDT
          if (symbol === "BTC/USDT") {
            expect(mapped).toBe("BTC-USDT");
          }
          if (symbol === "ETH/USDT") {
            expect(mapped).toBe("ETH-USDT");
          }
        }).not.toThrow();
      });
    });

    it("should handle all Crypto.com symbols from feeds.json", () => {
      const cryptocomSymbols = exchangeSymbolMap.get("cryptocom") || new Set();

      cryptocomSymbols.forEach(symbol => {
        expect(() => {
          const mapped = cryptocomAdapter.getSymbolMapping(symbol);
          expect(mapped).toBeDefined();
          expect(mapped.length).toBeGreaterThan(0);

          // Crypto.com should convert BTC/USDT -> BTC_USDT
          if (symbol === "BTC/USDT") {
            expect(mapped).toBe("BTC_USDT");
          }
          if (symbol === "ETH/USDT") {
            expect(mapped).toBe("ETH_USDT");
          }
        }).not.toThrow();
      });
    });
  });

  describe("Symbol Validation", () => {
    it("should validate all Tier 1 symbols correctly", () => {
      const tier1Exchanges = [
        { name: "binance", adapter: binanceAdapter },
        { name: "coinbase", adapter: coinbaseAdapter },
        { name: "kraken", adapter: krakenAdapter },
        { name: "okx", adapter: okxAdapter },
        { name: "cryptocom", adapter: cryptocomAdapter },
      ];

      const failedValidations: Array<{ exchange: string; symbol: string; error?: string }> = [];

      feedsConfig.forEach(feed => {
        feed.sources.forEach(source => {
          const exchange = tier1Exchanges.find(ex => ex.name === source.exchange);
          if (exchange) {
            try {
              const isValid = exchange.adapter.validateSymbol(source.symbol);
              if (!isValid) {
                failedValidations.push({
                  exchange: source.exchange,
                  symbol: source.symbol,
                });
              }
            } catch (error) {
              failedValidations.push({
                exchange: source.exchange,
                symbol: source.symbol,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        });
      });

      if (failedValidations.length > 0) {
        console.log("Failed validations:", failedValidations.slice(0, 10)); // Show first 10
      }

      expect(failedValidations.length).toBe(0);
    });
  });

  describe("Reverse Symbol Mapping", () => {
    it("should correctly reverse map Binance symbols", () => {
      const testCases = [
        { exchange: "BTCUSDT", normalized: "BTC/USDT" },
        { exchange: "ETHUSDT", normalized: "ETH/USDT" },
        { exchange: "ADAUSDT", normalized: "ADA/USDT" },
        { exchange: "DOGEUSDT", normalized: "DOGE/USDT" },
      ];

      testCases.forEach(({ exchange, normalized }) => {
        // Test the private method through normalization
        const mockData = {
          e: "24hrTicker" as const,
          E: Date.now(),
          s: exchange,
          p: "1000",
          P: "2.0",
          w: "50000",
          x: "49000",
          c: "50000",
          Q: "0.1",
          b: "49999",
          B: "1.0",
          a: "50001",
          A: "1.0",
          o: "49000",
          h: "51000",
          l: "48000",
          v: "100",
          q: "5000000",
          O: Date.now() - 86400000,
          C: Date.now(),
          F: 1,
          L: 1000,
          n: 500,
        };

        const result = binanceAdapter.normalizePriceData(mockData);
        expect(result.symbol).toBe(normalized);
      });
    });

    it("should correctly reverse map Coinbase symbols", () => {
      const testCases = [
        { exchange: "BTC-USD", normalized: "BTC/USD" },
        { exchange: "ETH-USD", normalized: "ETH/USD" },
        { exchange: "ADA-USD", normalized: "ADA/USD" },
        { exchange: "DOGE-USD", normalized: "DOGE/USD" },
      ];

      testCases.forEach(({ exchange, normalized }) => {
        const mockData = {
          type: "ticker" as const,
          sequence: 1,
          product_id: exchange,
          price: "50000",
          open_24h: "49000",
          volume_24h: "100",
          low_24h: "48000",
          high_24h: "51000",
          volume_30d: "3000",
          best_bid: "49999",
          best_ask: "50001",
          side: "buy" as const,
          time: new Date().toISOString(),
          trade_id: 123,
          last_size: "0.1",
        };

        const result = coinbaseAdapter.normalizePriceData(mockData);
        expect(result.symbol).toBe(normalized);
      });
    });

    it("should correctly reverse map Kraken symbols", () => {
      const testCases = [
        { exchange: "XBTUSD", normalized: "BTC/USD" },
        { exchange: "ETHUSD", normalized: "ETH/USD" },
        { exchange: "ADAUSD", normalized: "ADA/USD" },
      ];

      testCases.forEach(({ exchange, normalized }) => {
        const mockData = {
          channelID: 1,
          channelName: "ticker",
          pair: exchange,
          data: {
            a: ["50001", "1", "1"] as [string, string, string],
            b: ["49999", "1", "1"] as [string, string, string],
            c: ["50000", "0.1"] as [string, string],
            v: ["100", "100"] as [string, string],
            p: ["50000", "50000"] as [string, string],
            t: [10, 10] as [number, number],
            l: ["48000", "48000"] as [string, string],
            h: ["51000", "51000"] as [string, string],
            o: ["49000", "49000"] as [string, string],
          },
        };

        const result = krakenAdapter.normalizePriceData(mockData);
        expect(result.symbol).toBe(normalized);
      });
    });

    it("should correctly reverse map OKX symbols", () => {
      const testCases = [
        { exchange: "BTC-USDT", normalized: "BTC/USDT" },
        { exchange: "ETH-USDT", normalized: "ETH/USDT" },
        { exchange: "ADA-USDT", normalized: "ADA/USDT" },
      ];

      testCases.forEach(({ exchange, normalized }) => {
        const mockData = {
          instType: "SPOT",
          instId: exchange,
          last: "50000",
          lastSz: "0.1",
          askPx: "50001",
          askSz: "1",
          bidPx: "49999",
          bidSz: "1",
          open24h: "49000",
          high24h: "51000",
          low24h: "48000",
          volCcy24h: "5000000",
          vol24h: "100",
          ts: Date.now().toString(),
          sodUtc0: "49000",
          sodUtc8: "49000",
        };

        const result = okxAdapter.normalizePriceData(mockData);
        expect(result.symbol).toBe(normalized);
      });
    });

    it("should correctly reverse map Crypto.com symbols", () => {
      const testCases = [
        { exchange: "BTC_USDT", normalized: "BTC/USDT" },
        { exchange: "ETH_USDT", normalized: "ETH/USDT" },
        { exchange: "ADA_USDT", normalized: "ADA/USDT" },
      ];

      testCases.forEach(({ exchange, normalized }) => {
        const mockData = {
          i: exchange,
          b: "49999",
          k: "50001",
          a: "50000",
          t: Date.now(),
          v: "100",
          h: "51000",
          l: "48000",
          c: "1000",
        };

        const result = cryptocomAdapter.normalizePriceData(mockData);
        expect(result.symbol).toBe(normalized);
      });
    });
  });

  describe("Data Format Consistency", () => {
    it("should return consistent PriceUpdate format across all adapters", () => {
      const adapters = [
        { name: "binance", adapter: binanceAdapter },
        { name: "coinbase", adapter: coinbaseAdapter },
        { name: "kraken", adapter: krakenAdapter },
        { name: "okx", adapter: okxAdapter },
        { name: "cryptocom", adapter: cryptocomAdapter },
      ];

      adapters.forEach(({ name, adapter }) => {
        // Create mock data for each adapter
        let mockData: any;

        switch (name) {
          case "binance":
            mockData = {
              e: "24hrTicker" as const,
              E: Date.now(),
              s: "BTCUSDT",
              p: "1000",
              P: "2.0",
              w: "50000",
              x: "49000",
              c: "50000",
              Q: "0.1",
              b: "49999",
              B: "1.0",
              a: "50001",
              A: "1.0",
              o: "49000",
              h: "51000",
              l: "48000",
              v: "100",
              q: "5000000",
              O: Date.now() - 86400000,
              C: Date.now(),
              F: 1,
              L: 1000,
              n: 500,
            };
            break;
          case "coinbase":
            mockData = {
              type: "ticker" as const,
              sequence: 1,
              product_id: "BTC-USD",
              price: "50000",
              open_24h: "49000",
              volume_24h: "100",
              low_24h: "48000",
              high_24h: "51000",
              volume_30d: "3000",
              best_bid: "49999",
              best_ask: "50001",
              side: "buy" as const,
              time: new Date().toISOString(),
              trade_id: 123,
              last_size: "0.1",
            };
            break;
          case "kraken":
            mockData = {
              channelID: 1,
              channelName: "ticker",
              pair: "XBTUSD",
              data: {
                a: ["50001", "1", "1"] as [string, string, string],
                b: ["49999", "1", "1"] as [string, string, string],
                c: ["50000", "0.1"] as [string, string],
                v: ["100", "100"] as [string, string],
                p: ["50000", "50000"] as [string, string],
                t: [10, 10] as [number, number],
                l: ["48000", "48000"] as [string, string],
                h: ["51000", "51000"] as [string, string],
                o: ["49000", "49000"] as [string, string],
              },
            };
            break;
          case "okx":
            mockData = {
              instType: "SPOT",
              instId: "BTC-USDT",
              last: "50000",
              lastSz: "0.1",
              askPx: "50001",
              askSz: "1",
              bidPx: "49999",
              bidSz: "1",
              open24h: "49000",
              high24h: "51000",
              low24h: "48000",
              volCcy24h: "5000000",
              vol24h: "100",
              ts: Date.now().toString(),
              sodUtc0: "49000",
              sodUtc8: "49000",
            };
            break;
          case "cryptocom":
            mockData = {
              i: "BTC_USDT",
              b: "49999",
              k: "50001",
              a: "50000",
              t: Date.now(),
              v: "100",
              h: "51000",
              l: "48000",
              c: "1000",
            };
            break;
        }

        const result = adapter.normalizePriceData(mockData);

        // Verify consistent structure
        expect(result).toHaveProperty("symbol");
        expect(result).toHaveProperty("price");
        expect(result).toHaveProperty("timestamp");
        expect(result).toHaveProperty("source");
        expect(result).toHaveProperty("confidence");

        // Verify data types
        expect(typeof result.symbol).toBe("string");
        expect(typeof result.price).toBe("number");
        expect(typeof result.timestamp).toBe("number");
        expect(typeof result.source).toBe("string");
        expect(typeof result.confidence).toBe("number");

        // Verify value ranges
        expect(result.price).toBeGreaterThan(0);
        expect(result.timestamp).toBeGreaterThan(0);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
        expect(result.source).toBe(name);

        // Verify symbol format (should be normalized to "BASE/QUOTE")
        expect(result.symbol).toMatch(/^[A-Z0-9]+\/[A-Z0-9]+$/);
      });
    });
  });

  describe("Special Symbol Cases", () => {
    it("should handle USDT/USD pairs correctly", () => {
      // USDT/USD is critical for USDT conversion
      const usdtUsdSources = feedsConfig
        .find(feed => feed.feed.name === "USDT/USD")
        ?.sources.filter(source => ["binance", "coinbase", "kraken", "okx", "cryptocom"].includes(source.exchange));

      expect(usdtUsdSources).toBeDefined();
      expect(usdtUsdSources!.length).toBeGreaterThan(0);

      usdtUsdSources!.forEach(source => {
        let adapter: any;
        switch (source.exchange) {
          case "coinbase":
            adapter = coinbaseAdapter;
            break;
          case "kraken":
            adapter = krakenAdapter;
            break;
          case "cryptocom":
            adapter = cryptocomAdapter;
            break;
        }

        if (adapter) {
          expect(() => {
            const mapped = adapter.getSymbolMapping(source.symbol);
            expect(mapped).toBeDefined();
          }).not.toThrow();
        }
      });
    });

    it("should handle both USD and USDT variants", () => {
      // Many feeds have both USD and USDT variants
      const dualCurrencyFeeds = feedsConfig.filter(feed => {
        const symbols = feed.sources.map(s => s.symbol);
        const hasUSD = symbols.some(s => s.endsWith("/USD"));
        const hasUSDT = symbols.some(s => s.endsWith("/USDT"));
        return hasUSD && hasUSDT;
      });

      expect(dualCurrencyFeeds.length).toBeGreaterThan(0);

      dualCurrencyFeeds.forEach(feed => {
        feed.sources.forEach(source => {
          if (["binance", "coinbase", "kraken", "okx", "cryptocom"].includes(source.exchange)) {
            let adapter: any;
            switch (source.exchange) {
              case "binance":
                adapter = binanceAdapter;
                break;
              case "coinbase":
                adapter = coinbaseAdapter;
                break;
              case "kraken":
                adapter = krakenAdapter;
                break;
              case "okx":
                adapter = okxAdapter;
                break;
              case "cryptocom":
                adapter = cryptocomAdapter;
                break;
            }

            if (adapter) {
              expect(() => {
                const mapped = adapter.getSymbolMapping(source.symbol);
                expect(mapped).toBeDefined();
                expect(mapped.length).toBeGreaterThan(0);
              }).not.toThrow();
            }
          }
        });
      });
    });
  });
});
