import { BaseExchangeAdapter } from "../base-exchange-adapter";
import WebSocket from "ws";
import { FeedCategory } from "@/common/types/core";
import type { ExchangeCapabilities, ExchangeConnectionConfig } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import { MockSetup, TestHelpers } from "@/__tests__/utils";

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

  describe("rate limiting queue", () => {
    it("executes immediately when queue is disabled", async () => {
      const requestFn = jest.fn().mockResolvedValue("ok");

      await expect((adapter as any).queueRequest(requestFn)).resolves.toBe("ok");
      expect(requestFn).toHaveBeenCalledTimes(1);
    });

    it("delays queued requests to enforce minimum interval", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

        const queued = new TestExchangeAdapter({
          connection: {
            rateLimiting: {
              enableQueue: true,
              queueInterval: 100,
            },
          },
        } as any);

        // Force the queue processor to wait
        (queued as any).lastRequestTime = Date.now();

        const requestFn = jest.fn().mockResolvedValue("ok");
        const p = (queued as any).queueRequest(requestFn);

        // Give the queue processor a chance to start
        await Promise.resolve();
        expect(requestFn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(100);
        await expect(p).resolves.toBe("ok");
        expect(requestFn).toHaveBeenCalledTimes(1);

        await queued.cleanup();
      });
    });

    it("wraps non-Error rejections as Error instances", async () => {
      const queued = new TestExchangeAdapter({
        connection: {
          rateLimiting: {
            enableQueue: true,
            queueInterval: 0,
          },
        },
      } as any);

      await expect(
        (queued as any).queueRequest(() => {
          throw "boom";
        })
      ).rejects.toBeInstanceOf(Error);

      await queued.cleanup();
    });
  });

  describe("reconnection scheduling", () => {
    it("schedules a reconnect attempt when wsConfig is present", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (adapter as any).wsConfig = { url: "wss://example.invalid" };
        const connectWsSpy = jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(undefined);

        // Ensure we hit the branch that clears any existing timer
        (adapter as any).reconnectTimer = setTimeout(() => undefined, 1000);

        (adapter as any).scheduleReconnect(10);
        expect((adapter as any).reconnectAttempts).toBe(1);

        jest.advanceTimersByTime(10);
        await Promise.resolve();

        expect(connectWsSpy).toHaveBeenCalledWith({ url: "wss://example.invalid" });
      });
    });

    it("logs an error when a reconnect attempt fails", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (adapter as any).wsConfig = { url: "wss://example.invalid" };

        const errorSpy = jest.spyOn((adapter as any).logger, "error");
        jest.spyOn(adapter as any, "connectWebSocket").mockRejectedValueOnce(new Error("reconnect failed"));

        (adapter as any).scheduleReconnect(10);
        jest.advanceTimersByTime(10);
        await Promise.resolve();

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Reconnection failed"), expect.anything());
      });
    });

    it("does not attempt reconnect if wsConfig is missing", async () => {
      await TestHelpers.withFakeTimersAsync(async () => {
        (adapter as any).wsConfig = undefined;
        const connectWsSpy = jest.spyOn(adapter as any, "connectWebSocket").mockResolvedValue(undefined);

        (adapter as any).scheduleReconnect(10);
        jest.advanceTimersByTime(10);
        await Promise.resolve();

        expect(connectWsSpy).not.toHaveBeenCalled();
      });
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

    describe("parseWebSocketData", () => {
      it("parses Buffer-shaped objects (JSON and control messages)", () => {
        const pongBytes = Array.from(Buffer.from("pong", "utf8"));
        const jsonBytes = Array.from(Buffer.from(JSON.stringify({ event: "pong" }), "utf8"));
        const nonJsonBytes = Array.from(Buffer.from("not-json", "utf8"));

        expect((adapter as any).parseWebSocketData({ type: "Buffer", data: pongBytes })).toBe("pong");
        expect((adapter as any).parseWebSocketData({ type: "Buffer", data: jsonBytes })).toEqual({ event: "pong" });

        const debugSpy = jest.spyOn((adapter as any).logger, "debug");
        expect((adapter as any).parseWebSocketData({ type: "Buffer", data: nonJsonBytes })).toBe("not-json");
        expect(debugSpy).toHaveBeenCalled();
      });

      it("parses raw arrays and array-like objects", () => {
        const jsonArray = Array.from(Buffer.from(JSON.stringify({ ok: true }), "utf8"));
        expect((adapter as any).parseWebSocketData(jsonArray)).toEqual({ ok: true });

        const arrayLike: Record<string, number> = {};
        jsonArray.forEach((b, i) => {
          arrayLike[String(i)] = b;
        });
        expect((adapter as any).parseWebSocketData(arrayLike)).toEqual({ ok: true });
      });

      it("returns string for non-JSON string payloads", () => {
        const debugSpy = jest.spyOn((adapter as any).logger, "debug");
        expect((adapter as any).parseWebSocketData("not-json")).toBe("not-json");
        expect(debugSpy).toHaveBeenCalled();
      });

      it("returns null on unexpected parsing errors", () => {
        const errorSpy = jest.spyOn((adapter as any).logger, "error");
        // Force an exception by passing a Proxy that throws on property access
        const throwing: any = new Proxy(
          {},
          {
            has() {
              throw new Error("proxy boom");
            },
          }
        );

        expect((adapter as any).parseWebSocketData(throwing)).toBeNull();
        expect(errorSpy).toHaveBeenCalled();
      });

      it("logs and returns non-JSON array and array-like payloads as strings", () => {
        const debugSpy = jest.spyOn((adapter as any).logger, "debug");

        const nonJsonArray = Array.from(Buffer.from("not-json", "utf8"));
        expect((adapter as any).parseWebSocketData(nonJsonArray)).toBe("not-json");
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Received non-JSON array message"));

        const arrayLike: Record<string, number> = {};
        nonJsonArray.forEach((b, i) => {
          arrayLike[String(i)] = b;
        });
        expect((adapter as any).parseWebSocketData(arrayLike)).toBe("not-json");
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Received non-JSON buffer message"));
      });
    });

    describe("parseWebSocketData", () => {
      it("parses Buffer-shaped objects containing JSON", () => {
        const payload = { a: 1 };
        const jsonString = JSON.stringify(payload);
        const bufferObj = { type: "Buffer", data: Array.from(Buffer.from(jsonString, "utf8")) };
        expect((adapter as any).parseWebSocketData(bufferObj)).toEqual(payload);
      });

      it("returns control messages without JSON parsing", () => {
        const bufferObj = { type: "Buffer", data: Array.from(Buffer.from("pong", "utf8")) };
        expect((adapter as any).parseWebSocketData(bufferObj)).toBe("pong");
        expect((adapter as any).parseWebSocketData("PING")).toBe("PING");
        expect((adapter as any).isControlMessage("heartbeat")).toBe(true);
      });

      it("returns non-JSON string payloads as-is", () => {
        const debugSpy = jest.spyOn((adapter as any).logger, "debug");
        expect((adapter as any).parseWebSocketData("not-json")).toBe("not-json");
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Received non-JSON string message"));
      });

      it("parses raw array data containing JSON", () => {
        const payload = { b: 2 };
        const arr = Array.from(Buffer.from(JSON.stringify(payload), "utf8"));
        expect((adapter as any).parseWebSocketData(arr)).toEqual(payload);
      });

      it("parses array-like objects with numeric keys", () => {
        const payload = { c: 3 };
        const bytes = Array.from(Buffer.from(JSON.stringify(payload), "utf8"));
        const arrayLike: Record<string, number> = {};
        bytes.forEach((v, i) => {
          arrayLike[String(i)] = v;
        });
        expect((adapter as any).parseWebSocketData(arrayLike)).toEqual(payload);
      });

      it("passes through already-parsed objects and primitives", () => {
        const obj = { d: 4 };
        expect((adapter as any).parseWebSocketData(obj)).toBe(obj);
        expect((adapter as any).parseWebSocketData(42)).toBe(42);
        expect((adapter as any).parseWebSocketData(true)).toBe(true);
      });

      it("returns null and logs when parsing throws", () => {
        const errorSpy = jest.spyOn((adapter as any).logger, "error");
        const boom = {
          type: "Buffer",
          get data() {
            throw new Error("boom");
          },
        } as any;
        expect((adapter as any).parseWebSocketData(boom)).toBeNull();
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Error parsing WebSocket data"),
          expect.anything()
        );
      });
    });

    describe("performHealthCheck", () => {
      it("returns true when recent data was received (skips doHealthCheck)", async () => {
        const doHealthCheckSpy = jest.spyOn(adapter as any, "doHealthCheck");
        (adapter as any).lastMessageReceived = Date.now() - 1000;
        await expect(adapter.performHealthCheck()).resolves.toBe(true);
        expect(doHealthCheckSpy).not.toHaveBeenCalled();
      });

      it("returns false when basic health check fails", async () => {
        const unhealthy = new (class extends TestExchangeAdapter {
          protected override async doHealthCheck(): Promise<boolean> {
            return false;
          }
        })();
        await expect(unhealthy.performHealthCheck()).resolves.toBe(false);
        await unhealthy.cleanup();
      });

      it("returns false when data is stale beyond tolerance", async () => {
        const debugSpy = jest.spyOn((adapter as any).logger, "debug");
        (adapter as any).lastMessageReceived = Date.now() - 900000 - 10;
        await expect(adapter.performHealthCheck()).resolves.toBe(false);
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("no fresh data"));
      });

      it("returns false when doHealthCheck throws", async () => {
        const throwing = new (class extends TestExchangeAdapter {
          protected override async doHealthCheck(): Promise<boolean> {
            throw new Error("boom");
          }
        })();
        await expect(throwing.performHealthCheck()).resolves.toBe(false);
        await throwing.cleanup();
      });
    });

    describe("connection health tracking", () => {
      it("degrades and logs debug then warn as health score drops", () => {
        const warnSpy = jest.spyOn((adapter as any).logger, "warn");
        const debugSpy = jest.spyOn((adapter as any).logger, "debug");
        (adapter as any).connectionHealthScore = 55;

        // Trigger enough disconnections to cross threshold twice
        for (let i = 0; i < 6; i++) {
          (adapter as any).trackDisconnection();
        }

        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("moderate degradation"));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Connection health degraded"));
      });

      it("recovers health score while connected", () => {
        TestHelpers.withFakeTimers(() => {
          const debugSpy = jest.spyOn((adapter as any).logger, "debug");
          (adapter as any).isConnected_ = true;
          (adapter as any).connectionHealthScore = 98;

          (adapter as any).startHealthRecoveryTimer();
          jest.advanceTimersByTime(60000);

          expect((adapter as any).connectionHealthScore).toBe(100);
          expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("health improved"));

          (adapter as any).stopHealthRecoveryTimer();
        });
      });
    });
  });

  describe("WebSocket error handling", () => {
    it("suppresses errors during shutdown", () => {
      const onErr = jest.fn();
      adapter.onError(onErr);
      (adapter as any).isShuttingDown = true;

      (adapter as any).handleWebSocketError(new Error("503 Service Unavailable"));

      expect(onErr).not.toHaveBeenCalled();
    });

    it("logs critical errors at error level", () => {
      const errorSpy = jest.spyOn((adapter as any).logger, "error");
      const warnSpy = jest.spyOn((adapter as any).logger, "warn");

      (adapter as any).handleWebSocketError(new Error("401 Unauthorized"));

      expect(errorSpy).toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("401 Unauthorized"));
    });

    it("logs high severity errors at warn level (503)", () => {
      const warnSpy = jest.spyOn((adapter as any).logger, "warn");
      (adapter as any).handleWebSocketError(new Error("Unexpected server response: 503"));
      expect(warnSpy).toHaveBeenCalled();
    });

    it("logs medium severity errors at warn level (timeout)", () => {
      const warnSpy = jest.spyOn((adapter as any).logger, "warn");
      (adapter as any).handleWebSocketError(new Error("request timed out"));
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("performHealthCheck", () => {
    it("returns true when recent messages were received even if doHealthCheck would fail", async () => {
      const failingAdapter = new (class extends TestExchangeAdapter {
        protected override async doHealthCheck(): Promise<boolean> {
          return false;
        }
      })();

      (failingAdapter as any).lastMessageReceived = Date.now() - 1000;
      await expect(failingAdapter.performHealthCheck()).resolves.toBe(true);

      await failingAdapter.cleanup();
    });

    it("returns false when doHealthCheck fails and no recent data", async () => {
      const failingAdapter = new (class extends TestExchangeAdapter {
        protected override async doHealthCheck(): Promise<boolean> {
          return false;
        }
      })();

      (failingAdapter as any).lastMessageReceived = 0;
      await expect(failingAdapter.performHealthCheck()).resolves.toBe(false);

      await failingAdapter.cleanup();
    });

    it("returns false when data is stale beyond the tolerance window", async () => {
      const okAdapter = new TestExchangeAdapter();
      const debugSpy = jest.spyOn((okAdapter as any).logger, "debug");

      (okAdapter as any).lastMessageReceived = Date.now() - 900000 - 1;
      await expect(okAdapter.performHealthCheck()).resolves.toBe(false);
      expect(debugSpy).toHaveBeenCalled();

      await okAdapter.cleanup();
    });

    it("returns false if doHealthCheck throws", async () => {
      const throwingAdapter = new (class extends TestExchangeAdapter {
        protected override async doHealthCheck(): Promise<boolean> {
          throw new Error("boom");
        }
      })();

      await expect(throwingAdapter.performHealthCheck()).resolves.toBe(false);
      await throwingAdapter.cleanup();
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

    it("validate() runs the built-in validation rule", () => {
      expect(() => adapter.validate("BTC/USD")).not.toThrow();
      expect(() => adapter.validate("INVALID")).toThrow();
      expect(() => adapter.validate(123 as any)).toThrow();
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

  describe("disconnect error handling", () => {
    it("logs string errors from disconnectWebSocket and doDisconnect", async () => {
      const warnSpy = jest.spyOn((adapter as any).logger, "warn");

      // Force the disconnect path to run.
      (adapter as any).isConnected_ = true;
      jest.spyOn(adapter as any, "isWebSocketConnected").mockReturnValue(true);
      jest.spyOn(adapter as any, "disconnectWebSocket").mockRejectedValueOnce("boom");
      jest.spyOn(adapter as any, "doDisconnect").mockRejectedValueOnce("boom");

      await expect(adapter.disconnect()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Error disconnecting WebSocket"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("adapter-specific disconnection"));
    });
  });

  describe("connection config updates", () => {
    it("updateConnectionConfig merges even when current connection is missing", () => {
      const cfgless = new TestExchangeAdapter({} as any);
      cfgless.updateConnectionConfig({
        websocketUrl: "wss://example.invalid",
        restApiUrl: "https://api.example.invalid",
      });

      const cfg = cfgless.getConfig() as any;
      expect(cfg.websocketUrl).toBe("wss://example.invalid");
      expect(cfg.restApiUrl).toBe("https://api.example.invalid");
    });
  });

  describe("REST error helpers", () => {
    it("handleRestApiError throws for array error messages and empty errors", () => {
      expect(() => (adapter as any).handleRestApiError({ error: ["a", "b"] }, "X")).toThrow("X API error: a, b");
      expect(() => (adapter as any).handleRestApiError({ error: "   " }, "X")).toThrow("Empty error message");
    });

    it("handleRestApiError throws for non-zero codes and non-ok statuses", () => {
      expect(() => (adapter as any).handleRestApiError({ code: 1, message: "bad" }, "X")).toThrow("X API error: bad");
      expect(() => (adapter as any).handleRestApiError({ status: "down" }, "X")).toThrow("X API error: down");
      expect(() => (adapter as any).handleRestApiError({ status: "ok" }, "X")).not.toThrow();
    });

    it("performStandardHealthCheck handles ok=false, /ping, API errors, and JSON parsing errors", async () => {
      const fetchSpy = jest.spyOn(adapter as any, "fetchRestApi");

      fetchSpy.mockResolvedValueOnce({ ok: false } as any);
      await expect((adapter as any).performStandardHealthCheck("https://x/health")).resolves.toBe(false);

      fetchSpy.mockResolvedValueOnce({ ok: true, json: jest.fn() } as any);
      await expect((adapter as any).performStandardHealthCheck("https://x/ping")).resolves.toBe(true);

      fetchSpy.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ error: "nope" }) } as any);
      await expect((adapter as any).performStandardHealthCheck("https://x/status")).resolves.toBe(false);

      fetchSpy.mockResolvedValueOnce({ ok: true, json: jest.fn().mockRejectedValue(new Error("bad json")) } as any);
      await expect((adapter as any).performStandardHealthCheck("https://x/status")).resolves.toBe(true);
    });
  });

  describe("WebSocket helpers", () => {
    it("sendWebSocketMessage returns true on send success, false otherwise", async () => {
      (adapter as any).ws = { readyState: WebSocket.OPEN, send: jest.fn() };
      await expect((adapter as any).sendWebSocketMessage("hi")).resolves.toBe(true);

      (adapter as any).ws = {
        readyState: WebSocket.OPEN,
        send: jest.fn(() => {
          throw new Error("boom");
        }),
      };
      await expect((adapter as any).sendWebSocketMessage("hi")).resolves.toBe(false);

      (adapter as any).ws = { readyState: WebSocket.CLOSED, send: jest.fn() };
      await expect((adapter as any).sendWebSocketMessage("hi")).resolves.toBe(false);
    });

    it("getWebSocketStats returns null without ws and details with ws", () => {
      (adapter as any).ws = undefined;
      expect((adapter as any).getWebSocketStats()).toBeNull();

      (adapter as any).ws = { readyState: WebSocket.OPEN, url: "wss://x", protocol: "p" };
      expect((adapter as any).getWebSocketStats()).toEqual(
        expect.objectContaining({ readyState: WebSocket.OPEN, url: "wss://x", protocol: "p" })
      );
    });

    it("setupPingTimer closes on pong timeout exceedance", () => {
      TestHelpers.withFakeTimers(() => {
        jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

        const closeSpy = jest.fn();
        (adapter as any).ws = { readyState: WebSocket.OPEN, close: closeSpy };
        (adapter as any).wsConfig = { pongTimeout: 1000 };
        (adapter as any).lastPongReceived = Date.now() - 10_000;
        (adapter as any).lastMessageReceived = Date.now() - 10_000;

        (adapter as any).setupPingTimer(1000);

        expect(closeSpy).toHaveBeenCalledWith(1001, "Pong timeout");
      });
    });

    it("setupPingTimer logs when ws is not ready and when ping send throws", () => {
      TestHelpers.withFakeTimers(() => {
        const debugSpy = jest.spyOn((adapter as any).logger, "debug");
        const warnSpy = jest.spyOn((adapter as any).logger, "warn");

        (adapter as any).ws = { readyState: WebSocket.CLOSED, close: jest.fn() };
        (adapter as any).setupPingTimer(1000);
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Ping timer fired"));

        // Now make it OPEN but force ping send to throw.
        (adapter as any).ws = { readyState: WebSocket.OPEN, close: jest.fn(), ping: jest.fn() };
        jest.spyOn(adapter as any, "sendPingMessage").mockImplementationOnce(() => {
          throw new Error("ping boom");
        });
        (adapter as any).setupPingTimer(1000);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to send ping"), expect.anything());
      });
    });

    it("setupPongTimeout keeps connection with recent data, otherwise closes", () => {
      TestHelpers.withFakeTimers(() => {
        const closeSpy = jest.fn();
        (adapter as any).ws = { readyState: WebSocket.OPEN, close: closeSpy };

        jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
        // Make last message appear in the future so, at timeout time, it is still "recent".
        (adapter as any).lastMessageReceived = Date.now() + 1000;
        (adapter as any).setupPongTimeout(1000);
        jest.advanceTimersByTime(1500);
        expect(closeSpy).not.toHaveBeenCalled();

        // Now force old data so we close.
        closeSpy.mockClear();
        jest.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
        (adapter as any).lastMessageReceived = Date.now() - 10_000;
        (adapter as any).setupPongTimeout(1000);
        jest.advanceTimersByTime(1500);
        expect(closeSpy).toHaveBeenCalledWith(1001, "Pong timeout");
      });
    });

    it("onPongReceived clears the pending pong timeout", () => {
      TestHelpers.withFakeTimers(() => {
        const clearTimeoutSpy = jest.spyOn(global, "clearTimeout");

        (adapter as any).pongTimer = setTimeout(() => undefined, 1000);
        (adapter as any).onPongReceived();

        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect((adapter as any).pongTimer).toBeUndefined();
      });
    });
  });
});
