import { SymbolMappingUtils } from "../symbol-mapping.utils";
import { FeedCategory } from "@/types/feed-category.enum";

describe("SymbolMappingUtils", () => {
  describe("normalizeFeedSymbol", () => {
    it("should normalize common crypto symbols", () => {
      expect(SymbolMappingUtils.normalizeFeedSymbol("BTCUSD")).toBe("BTC/USD");
      expect(SymbolMappingUtils.normalizeFeedSymbol("ETHUSD")).toBe("ETH/USD");
      expect(SymbolMappingUtils.normalizeFeedSymbol("BTCUSDT")).toBe("BTC/USDT");
    });

    it("should handle Kraken's special symbols", () => {
      expect(SymbolMappingUtils.normalizeFeedSymbol("XBTUSD")).toBe("BTC/USD");
      expect(SymbolMappingUtils.normalizeFeedSymbol("XBTUSDT")).toBe("BTC/USDT");
    });

    it("should normalize forex symbols", () => {
      expect(SymbolMappingUtils.normalizeFeedSymbol("EURUSD")).toBe("EUR/USD");
      expect(SymbolMappingUtils.normalizeFeedSymbol("GBPUSD")).toBe("GBP/USD");
      expect(SymbolMappingUtils.normalizeFeedSymbol("USDJPY")).toBe("USD/JPY");
    });

    it("should normalize commodity symbols", () => {
      expect(SymbolMappingUtils.normalizeFeedSymbol("XAUUSD")).toBe("XAU/USD");
      expect(SymbolMappingUtils.normalizeFeedSymbol("XAGUSD")).toBe("XAG/USD");
      expect(SymbolMappingUtils.normalizeFeedSymbol("WTIUSD")).toBe("WTI/USD");
    });

    it("should preserve already normalized symbols", () => {
      expect(SymbolMappingUtils.normalizeFeedSymbol("BTC/USD")).toBe("BTC/USD");
      expect(SymbolMappingUtils.normalizeFeedSymbol("ETH/USDT")).toBe("ETH/USDT");
    });
  });

  describe("toExchangeFormat", () => {
    it("should convert to Coinbase format", () => {
      const conventions = SymbolMappingUtils.getExchangeConventions("coinbase");
      expect(SymbolMappingUtils.toExchangeFormat("BTC/USD", conventions)).toBe("BTC-USD");
      expect(SymbolMappingUtils.toExchangeFormat("ETH/USD", conventions)).toBe("ETH-USD");
    });

    it("should convert to Binance format", () => {
      const conventions = SymbolMappingUtils.getExchangeConventions("binance");
      expect(SymbolMappingUtils.toExchangeFormat("BTC/USDT", conventions)).toBe("BTCUSDT");
      expect(SymbolMappingUtils.toExchangeFormat("ETH/USDT", conventions)).toBe("ETHUSDT");
    });

    it("should convert to Kraken format with special mappings", () => {
      const conventions = SymbolMappingUtils.getExchangeConventions("kraken");
      expect(SymbolMappingUtils.toExchangeFormat("BTC/USD", conventions)).toBe("XBTUSD");
      expect(SymbolMappingUtils.toExchangeFormat("BTC/USDT", conventions)).toBe("XBTUSDT");
      expect(SymbolMappingUtils.toExchangeFormat("ETH/USD", conventions)).toBe("ETHUSD");
    });

    it("should convert to OKX format", () => {
      const conventions = SymbolMappingUtils.getExchangeConventions("okx");
      expect(SymbolMappingUtils.toExchangeFormat("BTC/USDT", conventions)).toBe("BTC-USDT");
      expect(SymbolMappingUtils.toExchangeFormat("ETH/USDT", conventions)).toBe("ETH-USDT");
    });

    it("should handle case formatting", () => {
      const lowerConventions = SymbolMappingUtils.createConventions("-", true, "lower");
      expect(SymbolMappingUtils.toExchangeFormat("BTC/USD", lowerConventions)).toBe("btc-usd");
    });

    it("should throw error for invalid symbols", () => {
      const conventions = SymbolMappingUtils.getExchangeConventions("binance");
      expect(() => SymbolMappingUtils.toExchangeFormat("INVALID", conventions)).toThrow();
    });
  });

  describe("getExchangeConventions", () => {
    it("should return correct conventions for known exchanges", () => {
      const coinbaseConventions = SymbolMappingUtils.getExchangeConventions("coinbase");
      expect(coinbaseConventions.separator).toBe("-");
      expect(coinbaseConventions.baseFirst).toBe(true);
      expect(coinbaseConventions.caseFormat).toBe("upper");

      const binanceConventions = SymbolMappingUtils.getExchangeConventions("binance");
      expect(binanceConventions.separator).toBe("");
      expect(binanceConventions.baseFirst).toBe(true);

      const krakenConventions = SymbolMappingUtils.getExchangeConventions("kraken");
      expect(krakenConventions.specialMappings).toBeDefined();
      expect(krakenConventions.specialMappings?.has("BTC/USD")).toBe(true);
    });

    it("should return default conventions for unknown exchanges", () => {
      const unknownConventions = SymbolMappingUtils.getExchangeConventions("unknown");
      expect(unknownConventions.separator).toBe("/");
      expect(unknownConventions.baseFirst).toBe(true);
      expect(unknownConventions.caseFormat).toBe("upper");
    });
  });

  describe("validateSymbolForCategory", () => {
    it("should validate crypto symbols", () => {
      expect(SymbolMappingUtils.validateSymbolForCategory("BTC/USD", FeedCategory.Crypto)).toBe(true);
      expect(SymbolMappingUtils.validateSymbolForCategory("ETH/USDT", FeedCategory.Crypto)).toBe(true);
      expect(SymbolMappingUtils.validateSymbolForCategory("DOGE/BTC", FeedCategory.Crypto)).toBe(true);
    });

    it("should validate forex symbols", () => {
      expect(SymbolMappingUtils.validateSymbolForCategory("EUR/USD", FeedCategory.Forex)).toBe(true);
      expect(SymbolMappingUtils.validateSymbolForCategory("GBP/USD", FeedCategory.Forex)).toBe(true);
      expect(SymbolMappingUtils.validateSymbolForCategory("USD/JPY", FeedCategory.Forex)).toBe(true);
    });

    it("should validate commodity symbols", () => {
      expect(SymbolMappingUtils.validateSymbolForCategory("XAU/USD", FeedCategory.Commodity)).toBe(true);
      expect(SymbolMappingUtils.validateSymbolForCategory("XAG/USD", FeedCategory.Commodity)).toBe(true);
      expect(SymbolMappingUtils.validateSymbolForCategory("WTI/USD", FeedCategory.Commodity)).toBe(true);
    });

    it("should validate stock symbols", () => {
      expect(SymbolMappingUtils.validateSymbolForCategory("AAPL/USD", FeedCategory.Stock)).toBe(true);
      expect(SymbolMappingUtils.validateSymbolForCategory("TSLA/USD", FeedCategory.Stock)).toBe(true);
    });

    it("should reject invalid symbols for categories", () => {
      expect(SymbolMappingUtils.validateSymbolForCategory("BTC/USD", FeedCategory.Forex)).toBe(false);
      expect(SymbolMappingUtils.validateSymbolForCategory("EUR/USD", FeedCategory.Crypto)).toBe(false);
      expect(SymbolMappingUtils.validateSymbolForCategory("XAU/USD", FeedCategory.Stock)).toBe(false);
    });
  });

  describe("createConventions", () => {
    it("should create custom conventions", () => {
      const customConventions = SymbolMappingUtils.createConventions("_", false, "lower");
      expect(customConventions.separator).toBe("_");
      expect(customConventions.baseFirst).toBe(false);
      expect(customConventions.caseFormat).toBe("lower");
    });

    it("should create conventions with special mappings", () => {
      const specialMappings = new Map([["BTC/USD", "BITCOIN_USD"]]);
      const conventions = SymbolMappingUtils.createConventions("-", true, "upper", specialMappings);
      expect(conventions.specialMappings).toBe(specialMappings);
    });
  });
});
