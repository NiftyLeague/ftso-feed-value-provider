import { ExchangeAdapterRegistry } from "../exchange-adapter.registry";
import type { IExchangeAdapter, ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { RawPriceData, RawVolumeData } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";
import { ExchangeId } from "@/common/types/adapters";

// Mock adapter for testing
class MockExchangeAdapter implements IExchangeAdapter {
  readonly exchangeName: string;
  readonly category: FeedCategory;
  readonly capabilities: ExchangeCapabilities;

  constructor(name: string, category: FeedCategory, capabilities: ExchangeCapabilities) {
    this.exchangeName = name;
    this.category = category;
    this.capabilities = capabilities;
  }

  async connect(): Promise<void> {
    // Mock implementation
  }

  async disconnect(): Promise<void> {
    // Mock implementation
  }

  isConnected(): boolean {
    return true;
  }

  normalizePriceData(_rawData: RawPriceData): PriceUpdate {
    return {
      symbol: "BTC/USD",
      price: 50000,
      timestamp: Date.now(),
      source: this.exchangeName,
      confidence: 1.0,
    };
  }

  normalizeVolumeData(_rawData: RawVolumeData): VolumeUpdate {
    return {
      symbol: "BTC/USD",
      volume: 1000,
      timestamp: Date.now(),
      source: this.exchangeName,
    };
  }

  validateResponse(_rawData: unknown): boolean {
    return true;
  }

  async subscribe(_symbols: string[]): Promise<void> {
    // Mock implementation
  }

  async unsubscribe(_symbols: string[]): Promise<void> {
    // Mock implementation
  }

  onPriceUpdate(_callback: (update: PriceUpdate) => void): void {
    // Mock implementation
  }

  validateSymbol(_feedSymbol: string): boolean {
    return true;
  }

  getSymbolMapping(feedSymbol: string): string {
    return feedSymbol;
  }

  getConfig(): ExchangeConnectionConfig | undefined {
    return undefined;
  }

  updateConfig(_config: ExchangeConnectionConfig): void {
    // Mock implementation
  }
}

describe("ExchangeAdapterRegistry", () => {
  let registry: ExchangeAdapterRegistry;
  let mockCryptoAdapter: MockExchangeAdapter;
  let mockForexAdapter: MockExchangeAdapter;

  beforeEach(() => {
    registry = new ExchangeAdapterRegistry();

    mockCryptoAdapter = new MockExchangeAdapter(ExchangeId.Binance, FeedCategory.Crypto, {
      supportsWebSocket: true,
      supportsREST: true,
      supportsVolume: true,
      supportsOrderBook: false,
      supportedCategories: [FeedCategory.Crypto],
    });

    mockForexAdapter = new MockExchangeAdapter("oanda", FeedCategory.Forex, {
      supportsWebSocket: false,
      supportsREST: true,
      supportsVolume: false,
      supportsOrderBook: true,
      supportedCategories: [FeedCategory.Forex],
    });
  });

  describe("register", () => {
    it("should register an adapter successfully", () => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
      expect(registry.has(ExchangeId.Binance)).toBe(true);
      expect(registry.size()).toBe(1);
    });

    it("should throw error when registering duplicate adapter", () => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
      expect(() => registry.register(ExchangeId.Binance, mockCryptoAdapter)).toThrow(
        "Adapter 'binance' is already registered"
      );
    });

    it("should handle case-insensitive names", () => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
      expect(registry.has(ExchangeId.Binance)).toBe(true);
      expect(registry.has(ExchangeId.Binance)).toBe(true);
    });
  });

  describe("get", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
    });

    it("should retrieve registered adapter", () => {
      const adapter = registry.get(ExchangeId.Binance);
      expect(adapter).toBe(mockCryptoAdapter);
    });

    it("should return undefined for non-existent adapter", () => {
      const adapter = registry.get("nonexistent");
      expect(adapter).toBeUndefined();
    });

    it("should return undefined for inactive adapter", () => {
      registry.setActive(ExchangeId.Binance, false);
      const adapter = registry.get(ExchangeId.Binance);
      expect(adapter).toBeUndefined();
    });
  });

  describe("getByCategory", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
      registry.register("oanda", mockForexAdapter);
    });

    it("should return adapters for specific category", () => {
      const cryptoAdapters = registry.getByCategory(FeedCategory.Crypto);
      expect(cryptoAdapters).toHaveLength(1);
      expect(cryptoAdapters[0]).toBe(mockCryptoAdapter);

      const forexAdapters = registry.getByCategory(FeedCategory.Forex);
      expect(forexAdapters).toHaveLength(1);
      expect(forexAdapters[0]).toBe(mockForexAdapter);
    });

    it("should return empty array for category with no adapters", () => {
      const commodityAdapters = registry.getByCategory(FeedCategory.Commodity);
      expect(commodityAdapters).toHaveLength(0);
    });
  });

  describe("getByCapabilities", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
      registry.register("oanda", mockForexAdapter);
    });

    it("should filter by WebSocket support", () => {
      const wsAdapters = registry.getByCapabilities({ supportsWebSocket: true });
      expect(wsAdapters).toHaveLength(1);
      expect(wsAdapters[0]).toBe(mockCryptoAdapter);
    });

    it("should filter by REST support", () => {
      const restAdapters = registry.getByCapabilities({ supportsREST: true });
      expect(restAdapters).toHaveLength(2);
    });

    it("should filter by volume support", () => {
      const volumeAdapters = registry.getByCapabilities({ supportsVolume: true });
      expect(volumeAdapters).toHaveLength(1);
      expect(volumeAdapters[0]).toBe(mockCryptoAdapter);
    });
  });

  describe("setActive", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
    });

    it("should deactivate adapter", () => {
      expect(registry.isActive(ExchangeId.Binance)).toBe(true);
      registry.setActive(ExchangeId.Binance, false);
      expect(registry.isActive(ExchangeId.Binance)).toBe(false);
    });

    it("should reactivate adapter", () => {
      registry.setActive(ExchangeId.Binance, false);
      registry.setActive(ExchangeId.Binance, true);
      expect(registry.isActive(ExchangeId.Binance)).toBe(true);
    });

    it("should return false for non-existent adapter", () => {
      const result = registry.setActive("nonexistent", false);
      expect(result).toBe(false);
    });
  });

  describe("updateHealthStatus", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
    });

    it("should update health status", () => {
      registry.updateHealthStatus(ExchangeId.Binance, "degraded");
      expect(registry.getHealthStatus(ExchangeId.Binance)).toBe("degraded");
    });

    it("should return false for non-existent adapter", () => {
      const result = registry.updateHealthStatus("nonexistent", "healthy");
      expect(result).toBe(false);
    });
  });

  describe("findBestAdapter", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
      registry.register("oanda", mockForexAdapter);
    });

    it("should find adapter for valid symbol and category", () => {
      const adapter = registry.findBestAdapter("BTC/USD", FeedCategory.Crypto);
      expect(adapter).toBe(mockCryptoAdapter);
    });

    it("should return undefined for unsupported category", () => {
      const adapter = registry.findBestAdapter("BTC/USD", FeedCategory.Commodity);
      expect(adapter).toBeUndefined();
    });

    it("should prefer healthy adapters over degraded ones", () => {
      const mockCryptoAdapter2 = new MockExchangeAdapter(
        ExchangeId.Coinbase,
        FeedCategory.Crypto,
        mockCryptoAdapter.capabilities
      );

      registry.register(ExchangeId.Coinbase, mockCryptoAdapter2);
      registry.updateHealthStatus(ExchangeId.Binance, "degraded");
      registry.updateHealthStatus(ExchangeId.Coinbase, "healthy");

      const adapter = registry.findBestAdapter("BTC/USD", FeedCategory.Crypto);
      expect(adapter).toBe(mockCryptoAdapter2);
    });

    it("should exclude unhealthy adapters", () => {
      registry.updateHealthStatus(ExchangeId.Binance, "unhealthy");
      const adapter = registry.findBestAdapter("BTC/USD", FeedCategory.Crypto);
      expect(adapter).toBeUndefined();
    });
  });

  describe("getStats", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
      registry.register("oanda", mockForexAdapter);
      registry.updateHealthStatus(ExchangeId.Binance, "healthy");
      registry.updateHealthStatus("oanda", "degraded");
    });

    it("should return correct statistics", () => {
      const stats = registry.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(2);
      expect(stats.byCategory[FeedCategory.Crypto]).toBe(1);
      expect(stats.byCategory[FeedCategory.Forex]).toBe(1);
      expect(stats.byHealth.healthy).toBe(1);
      expect(stats.byHealth.degraded).toBe(1);
    });

    it("should exclude inactive adapters from active count", () => {
      registry.setActive(ExchangeId.Binance, false);
      const stats = registry.getStats();
      expect(stats.total).toBe(2);
      expect(stats.active).toBe(1);
    });
  });

  describe("unregister", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
    });

    it("should remove adapter", () => {
      expect(registry.has(ExchangeId.Binance)).toBe(true);
      const result = registry.unregister(ExchangeId.Binance);
      expect(result).toBe(true);
      expect(registry.has(ExchangeId.Binance)).toBe(false);
    });

    it("should return false for non-existent adapter", () => {
      const result = registry.unregister("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("clear", () => {
    beforeEach(() => {
      registry.register(ExchangeId.Binance, mockCryptoAdapter);
      registry.register("oanda", mockForexAdapter);
    });

    it("should remove all adapters", () => {
      expect(registry.size()).toBe(2);
      registry.clear();
      expect(registry.size()).toBe(0);
    });
  });
});
