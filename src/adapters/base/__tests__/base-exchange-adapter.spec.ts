import { BaseExchangeAdapter } from "../base-exchange-adapter";
import { FeedCategory } from "@/common/types/core";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { MockSetup } from "@/__tests__/utils";

// Mock fetch globally
global.fetch = jest.fn();

// Concrete test implementation of BaseExchangeAdapter
class TestExchangeAdapter extends BaseExchangeAdapter {
  readonly exchangeName = "test-exchange";
  readonly category = FeedCategory.Crypto;
  readonly capabilities: ExchangeCapabilities = {
    supportsWebSocket: true,
    supportsREST: true,
    supportsVolume: true,
    supportsOrderBook: false,
    supportedCategories: [FeedCategory.Crypto],
  };

  normalizePriceData(rawData: any): PriceUpdate {
    return {
      symbol: rawData.symbol || "BTC/USD",
      price: parseFloat(rawData.price || "50000"),
      timestamp: rawData.timestamp || Date.now(),
      source: this.exchangeName,
      confidence: 1.0,
    };
  }

  normalizeVolumeData(rawData: any): VolumeUpdate {
    return {
      symbol: rawData.symbol || "BTC/USD",
      volume: parseFloat(rawData.volume || "1000"),
      timestamp: rawData.timestamp || Date.now(),
      source: this.exchangeName,
    };
  }

  validateResponse(rawData: unknown): boolean {
    return rawData !== null && typeof rawData === "object";
  }

  protected async doConnect(): Promise<void> {
    // Mock connection logic
    return Promise.resolve();
  }

  protected async doDisconnect(): Promise<void> {
    // Mock disconnection logic
    return Promise.resolve();
  }

  protected async doSubscribe(_symbols: string[]): Promise<void> {
    // Mock subscription logic
    return Promise.resolve();
  }

  protected async doUnsubscribe(_symbols: string[]): Promise<void> {
    // Mock unsubscription logic
    return Promise.resolve();
  }

  protected async doHealthCheck(): Promise<boolean> {
    return true;
  }
}

describe("BaseExchangeAdapter", () => {
  let adapter: TestExchangeAdapter;

  beforeEach(() => {
    MockSetup.setupAll();
    adapter = new TestExchangeAdapter();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    try {
      // Force immediate disconnection
      (adapter as any).connected = false;

      // Force cleanup with very short timeout
      await Promise.race([adapter.cleanup(), new Promise(resolve => setTimeout(resolve, 50))]);
    } catch (error) {
      // Ignore cleanup errors in tests
    }

    MockSetup.cleanup();
    jest.clearAllTimers();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe("initialization", () => {
    it("should initialize with default configuration", () => {
      expect(adapter.exchangeName).toBe("test-exchange");
      expect(adapter.category).toBe(FeedCategory.Crypto);
      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getSubscriptions()).toEqual([]);
    });

    it("should initialize with custom configuration", () => {
      const config: ExchangeConnectionConfig = {
        websocketUrl: "wss://custom.example.com",
        restApiUrl: "https://api.custom.com",
      };

      const customAdapter = new TestExchangeAdapter({ connection: config });
      const adapterConfig = customAdapter.getConfig();

      expect(adapterConfig.websocketUrl).toBe("wss://custom.example.com");
      expect(adapterConfig.restApiUrl).toBe("https://api.custom.com");
    });
  });

  describe("connection management", () => {
    it("should handle successful connection", async () => {
      const connectionSpy = jest.fn();
      adapter.onConnectionChange(connectionSpy);

      await adapter.connect();

      expect(adapter.isConnected()).toBe(true);
      expect(connectionSpy).toHaveBeenCalledWith(true);
    });

    it("should handle connection retry logic", async () => {
      let attempts = 0;
      const failingAdapter = new (class extends TestExchangeAdapter {
        protected override async doConnect(): Promise<void> {
          attempts++;
          if (attempts < 3) {
            throw new Error("Connection failed");
          }
        }
      })();

      // Temporarily enable retries for this test
      (failingAdapter as any).maxRetries = 2;
      (failingAdapter as any).retryDelay = 1; // Very short delay for testing

      // Mock the sleep method to avoid delays in tests
      (failingAdapter as any).sleep = jest.fn().mockResolvedValue(undefined);

      await failingAdapter.connect();
      expect(attempts).toBe(3);
      expect(failingAdapter.isConnected()).toBe(true);

      // Cleanup
      await failingAdapter.cleanup();
    });

    it("should handle disconnection", async () => {
      const connectionSpy = jest.fn();
      adapter.onConnectionChange(connectionSpy);

      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
      expect(connectionSpy).toHaveBeenCalledWith(false);
    });
  });

  describe("subscription management", () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    afterEach(async () => {
      await adapter.disconnect();
    });

    it("should handle valid subscriptions", async () => {
      await adapter.subscribe(["BTC/USD", "ETH/USD"]);

      const subscriptions = adapter.getSubscriptions();
      expect(subscriptions).toContain("BTC/USD");
      expect(subscriptions).toContain("ETH/USD");
    });

    it("should filter invalid symbols", async () => {
      const warnSpy = jest.spyOn((adapter as any).logger, "warn");

      await adapter.subscribe(["BTC/USD", "INVALID", "ETH/USD"]);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Some symbols were invalid and skipped"));
    });

    it("should handle subscription when not connected", async () => {
      await adapter.disconnect();

      await expect(adapter.subscribe(["BTC/USD"])).rejects.toThrow("not connected");
    });

    it("should handle empty symbol arrays", async () => {
      await expect(adapter.subscribe([])).rejects.toThrow("No valid symbols provided");
      await expect(adapter.unsubscribe([])).resolves.toBeUndefined();
    });
  });

  describe("utility methods", () => {
    describe("parseNumber", () => {
      it("should parse valid numbers", () => {
        expect((adapter as any).parseNumber(42)).toBe(42);
        expect((adapter as any).parseNumber("42.5")).toBe(42.5);
        expect((adapter as any).parseNumber("0")).toBe(0);
      });

      it("should handle invalid numbers", () => {
        expect(() => (adapter as any).parseNumber("invalid")).toThrow("Invalid numeric value");
        expect(() => (adapter as any).parseNumber(null)).toThrow("Cannot parse number from");
        expect(() => (adapter as any).parseNumber({})).toThrow("Cannot parse number from");
      });
    });

    describe("normalizeTimestamp", () => {
      it("should handle different timestamp formats", () => {
        const now = Date.now();
        const nowSeconds = Math.floor(now / 1000);

        expect((adapter as any).normalizeTimestamp(now)).toBe(now);
        expect((adapter as any).normalizeTimestamp(nowSeconds)).toBe(nowSeconds * 1000);
        expect((adapter as any).normalizeTimestamp(new Date(now))).toBe(now);
        expect((adapter as any).normalizeTimestamp(new Date(now).toISOString())).toBe(now);
      });

      it("should fallback to current time for invalid timestamps", () => {
        const before = Date.now();
        const result = (adapter as any).normalizeTimestamp("invalid");
        const after = Date.now();

        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThanOrEqual(after);
      });
    });

    describe("fetchRestApi", () => {
      it("should handle successful REST API calls", async () => {
        const mockResponse = { ok: true, json: () => Promise.resolve({ data: "test" }) };
        (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse);

        const response = await (adapter as any).fetchRestApi("https://api.test.com", "Test API call");
        expect(response).toBe(mockResponse);
      });

      it("should handle HTTP errors", async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });

        await expect((adapter as any).fetchRestApi("https://api.test.com", "Test API call")).rejects.toThrow(
          "HTTP 404: Not Found"
        );
      });

      it("should handle network errors", async () => {
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("Network error"));

        await expect((adapter as any).fetchRestApi("https://api.test.com", "Test API call")).rejects.toThrow(
          "Network error"
        );
      });
    });

    describe("calculateSpreadPercent", () => {
      it("should calculate spread percentage correctly", () => {
        expect((adapter as any).calculateSpreadPercent(99, 101, 100)).toBe(2);
        expect((adapter as any).calculateSpreadPercent(49999, 50001, 50000)).toBe(0.004);
        expect((adapter as any).calculateSpreadPercent(0, 0, 100)).toBe(0);
      });

      it("should handle edge cases", () => {
        expect((adapter as any).calculateSpreadPercent(100, 100, 100)).toBe(0);
        expect((adapter as any).calculateSpreadPercent(50, 150, 100)).toBe(100);
      });
    });

    describe("addSlashToSymbol", () => {
      it("should add slash to symbols without slash", () => {
        expect((adapter as any).addSlashToSymbol("BTCUSDT")).toBe("BTC/USDT");
        expect((adapter as any).addSlashToSymbol("ETHUSD")).toBe("ETH/USD");
        expect((adapter as any).addSlashToSymbol("LTCEUR")).toBe("LTC/EUR");
      });

      it("should return symbols with slash unchanged", () => {
        expect((adapter as any).addSlashToSymbol("BTC/USDT")).toBe("BTC/USDT");
        expect((adapter as any).addSlashToSymbol("ETH/USD")).toBe("ETH/USD");
      });

      it("should handle custom quote currencies", () => {
        expect((adapter as any).addSlashToSymbol("BTCJPY", ["JPY"])).toBe("BTC/JPY");
        expect((adapter as any).addSlashToSymbol("ETHGBP", ["GBP"])).toBe("ETH/GBP");
      });

      it("should handle unrecognized symbols", () => {
        expect((adapter as any).addSlashToSymbol("UNKNOWN")).toBe("UNKNOWN");
        expect((adapter as any).addSlashToSymbol("")).toBe("");
      });
    });
  });

  describe("health check", () => {
    it("should return true when connected", async () => {
      await adapter.connect();
      const isHealthy = await adapter.healthCheck();
      expect(isHealthy).toBe(true);
    });

    it("should delegate to doHealthCheck when not connected", async () => {
      const healthCheckSpy = jest.spyOn(adapter as any, "doHealthCheck");

      const isHealthy = await adapter.healthCheck();

      expect(healthCheckSpy).toHaveBeenCalled();
      expect(isHealthy).toBe(true);
    });

    it("should handle health check errors", async () => {
      const failingAdapter = new (class extends TestExchangeAdapter {
        protected override async doHealthCheck(): Promise<boolean> {
          throw new Error("Health check failed");
        }
      })();

      const isHealthy = await failingAdapter.healthCheck();
      expect(isHealthy).toBe(false);

      // Cleanup
      await failingAdapter.cleanup();
    });
  });

  describe("event callbacks", () => {
    it("should register and call price update callbacks", () => {
      const priceUpdateSpy = jest.fn();
      adapter.onPriceUpdate(priceUpdateSpy);

      const mockUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: "test-exchange",
        confidence: 1.0,
      };

      (adapter as any).onPriceUpdateCallback?.(mockUpdate);
      expect(priceUpdateSpy).toHaveBeenCalledWith(mockUpdate);
    });

    it("should register and call error callbacks", () => {
      const errorSpy = jest.fn();
      adapter.onError(errorSpy);

      const mockError = new Error("Test error");
      (adapter as any).onErrorCallback?.(mockError);
      expect(errorSpy).toHaveBeenCalledWith(mockError);
    });
  });

  describe("cleanup", () => {
    it("should cleanup properly", async () => {
      await adapter.connect();
      await adapter.subscribe(["BTC/USD"]);

      await adapter.cleanup();

      expect(adapter.isConnected()).toBe(false);
      expect(adapter.getSubscriptions()).toHaveLength(0);
    });

    it("should handle cleanup when not connected", async () => {
      await expect(adapter.cleanup()).resolves.toBeUndefined();
    });
  });

  describe("symbol validation", () => {
    it("should validate correct symbols", () => {
      expect(adapter.validateSymbol("BTC/USD")).toBe(true);
      expect(adapter.validateSymbol("ETH/USDT")).toBe(true);
      expect(adapter.validateSymbol("LTC/EUR")).toBe(true);
    });

    it("should reject invalid symbols", () => {
      expect(adapter.validateSymbol("INVALID")).toBe(false);
      expect(adapter.validateSymbol("BTC")).toBe(false);
      expect(adapter.validateSymbol("BTC/USD/EUR")).toBe(false);
      expect(adapter.validateSymbol("")).toBe(false);
    });

    it("should handle symbol validation errors", () => {
      const errorAdapter = new (class extends TestExchangeAdapter {
        override getSymbolMapping(_symbol: string): string {
          throw new Error("Symbol mapping error");
        }
      })();

      expect(errorAdapter.validateSymbol("BTC/USD")).toBe(false);
    });
  });
});
