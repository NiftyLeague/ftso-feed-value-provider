import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "../config.service";

describe("ConfigService", () => {
  let service: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfigService],
    }).compile();

    service = module.get<ConfigService>(ConfigService);
  });

  describe("adapter detection", () => {
    it("should detect custom adapter exchanges", () => {
      expect(service.hasCustomAdapter("binance")).toBe(true);
      expect(service.hasCustomAdapter("coinbase")).toBe(true);
      expect(service.hasCustomAdapter("cryptocom")).toBe(true);
      expect(service.hasCustomAdapter("kraken")).toBe(true);
      expect(service.hasCustomAdapter("okx")).toBe(true);
    });

    it("should detect CCXT exchanges", () => {
      expect(service.hasCustomAdapter("bitmart")).toBe(false);
      expect(service.hasCustomAdapter("bybit")).toBe(false);
      expect(service.hasCustomAdapter("gate")).toBe(false);
      expect(service.hasCustomAdapter("kucoin")).toBe(false);
    });

    it("should return false for unknown exchanges", () => {
      expect(service.hasCustomAdapter("unknown-exchange")).toBe(false);
    });
  });

  describe("adapter class mapping", () => {
    it("should return adapter classes for custom adapter exchanges", () => {
      expect(service.getAdapterClass("binance")).toBe("BinanceAdapter");
      expect(service.getAdapterClass("coinbase")).toBe("CoinbaseAdapter");
      expect(service.getAdapterClass("cryptocom")).toBe("CryptocomAdapter");
      expect(service.getAdapterClass("kraken")).toBe("KrakenAdapter");
      expect(service.getAdapterClass("okx")).toBe("OkxAdapter");
    });

    it("should return undefined for CCXT exchanges", () => {
      expect(service.getAdapterClass("bitmart")).toBeUndefined();
      expect(service.getAdapterClass("bybit")).toBeUndefined();
    });
  });

  describe("CCXT ID mapping", () => {
    it("should return CCXT IDs for CCXT exchanges", () => {
      expect(service.getCcxtId("bitmart")).toBe("bitmart");
      expect(service.getCcxtId("bybit")).toBe("bybit");
      expect(service.getCcxtId("gate")).toBe("gate");
      expect(service.getCcxtId("kucoin")).toBe("kucoin");
    });

    it("should return undefined for custom adapter exchanges", () => {
      expect(service.getCcxtId("binance")).toBeUndefined();
      expect(service.getCcxtId("coinbase")).toBeUndefined();
    });
  });

  describe("exchange lists", () => {
    it("should return list of custom adapter exchanges", () => {
      const customExchanges = service.getCustomAdapterExchanges();
      expect(customExchanges).toContain("binance");
      expect(customExchanges).toContain("coinbase");
      expect(customExchanges).toContain("cryptocom");
      expect(customExchanges).toContain("kraken");
      expect(customExchanges).toContain("okx");
      expect(customExchanges).toHaveLength(5);
    });

    it("should return list of CCXT exchanges", () => {
      const ccxtExchanges = service.getCcxtExchanges();
      expect(ccxtExchanges).toContain("bitmart");
      expect(ccxtExchanges).toContain("bybit");
      expect(ccxtExchanges).toContain("gate");
      expect(ccxtExchanges).toContain("kucoin");
      expect(ccxtExchanges.length).toBeGreaterThan(5);
    });
  });

  describe("hybrid summary", () => {
    it("should generate hybrid summary for mixed sources", () => {
      const sources = [
        { exchange: "binance", symbol: "BTC/USDT" },
        { exchange: "coinbase", symbol: "BTC/USD" },
        { exchange: "bitmart", symbol: "BTC/USDT" },
        { exchange: "bybit", symbol: "BTC/USDT" },
      ];

      const summary = service.getHybridSummary(sources);

      expect(summary.customAdapterSources).toEqual(["binance", "coinbase"]);
      expect(summary.ccxtSources).toEqual(["bitmart", "bybit"]);
      expect(summary.totalSources).toBe(4);
      expect(summary.hybridMode).toBe(true);
    });

    it("should detect non-hybrid mode for custom adapters only", () => {
      const sources = [
        { exchange: "binance", symbol: "BTC/USDT" },
        { exchange: "coinbase", symbol: "BTC/USD" },
      ];

      const summary = service.getHybridSummary(sources);

      expect(summary.customAdapterSources).toEqual(["binance", "coinbase"]);
      expect(summary.ccxtSources).toEqual([]);
      expect(summary.hybridMode).toBe(false);
    });

    it("should detect non-hybrid mode for CCXT only", () => {
      const sources = [
        { exchange: "bitmart", symbol: "BTC/USDT" },
        { exchange: "bybit", symbol: "BTC/USDT" },
      ];

      const summary = service.getHybridSummary(sources);

      expect(summary.customAdapterSources).toEqual([]);
      expect(summary.ccxtSources).toEqual(["bitmart", "bybit"]);
      expect(summary.hybridMode).toBe(false);
    });
  });

  describe("source validation", () => {
    it("should validate known sources successfully", () => {
      const sources = [
        { exchange: "binance", symbol: "BTC/USDT" },
        { exchange: "bitmart", symbol: "BTC/USDT" },
      ];

      const validation = service.validateSources(sources);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("should warn about unknown exchanges and auto-add them", () => {
      const sources = [
        { exchange: "binance", symbol: "BTC/USDT" },
        { exchange: "unknown-exchange", symbol: "BTC/USDT" },
      ];

      const validation = service.validateSources(sources);

      expect(validation.isValid).toBe(true);
      expect(validation.warnings.some(w => w.includes("unknown-exchange"))).toBe(true);

      // Should auto-add the unknown exchange as CCXT
      expect(service.getCcxtId("unknown-exchange")).toBe("unknown-exchange");
    });
  });

  describe("dynamic configuration", () => {
    it("should add new custom adapter exchange", () => {
      service.addExchange("new-custom", true, "NewCustomAdapter");

      expect(service.hasCustomAdapter("new-custom")).toBe(true);
      expect(service.getAdapterClass("new-custom")).toBe("NewCustomAdapter");
      expect(service.getCcxtId("new-custom")).toBeUndefined();
    });

    it("should add new CCXT exchange", () => {
      service.addExchange("new-ccxt", false, undefined, "newccxt");

      expect(service.hasCustomAdapter("new-ccxt")).toBe(false);
      expect(service.getAdapterClass("new-ccxt")).toBeUndefined();
      expect(service.getCcxtId("new-ccxt")).toBe("newccxt");
    });
  });

  describe("hybrid provider config", () => {
    it("should return hybrid provider configuration", () => {
      const config = service.getHybridProviderConfig();

      expect(config.customAdapterExchanges).toContain("binance");
      expect(config.customAdapterExchanges).toContain("coinbase");
      expect(config.ccxtExchanges).toContain("bitmart");
      expect(config.ccxtExchanges).toContain("bybit");

      expect(config.ccxtParameters.lambda).toBe(0.00005);
      expect(config.ccxtParameters.tradesLimit).toBe(1000);
      expect(config.ccxtParameters.retryBackoffMs).toBe(10000);
    });
  });
});
