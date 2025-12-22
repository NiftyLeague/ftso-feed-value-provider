import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import { ProductionDataManagerService } from "@/data-manager/production-data-manager.service";

import type { AggregatedPrice } from "@/common/types/services";
import type { CoreFeedId, PriceUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";
import { ExchangeId } from "@/common/types/adapters";
import { TestHelpers } from "@/__tests__/utils";

import { RealTimeAggregationService } from "../real-time-aggregation.service";
import { ConsensusAggregator } from "../consensus-aggregator.service";

describe("RealTimeAggregationService", () => {
  let service: RealTimeAggregationService;
  let consensusAggregator: jest.Mocked<ConsensusAggregator>;
  let dataManager: { getPriceUpdatesForFeed: jest.Mock };
  let mockFeedId: CoreFeedId;

  beforeEach(async () => {
    const mockConsensusAggregator = {
      aggregate: jest.fn(),
      validateUpdate: jest.fn(),
      getQualityMetrics: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn(),
      getConfig: jest.fn(),
    };

    const mockDataManager = {
      getPriceUpdatesForFeed: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealTimeAggregationService,
        {
          provide: ConsensusAggregator,
          useValue: mockConsensusAggregator,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: ProductionDataManagerService,
          useValue: mockDataManager,
        },
      ],
    }).compile();

    service = module.get<RealTimeAggregationService>(RealTimeAggregationService);
    consensusAggregator = module.get(ConsensusAggregator);
    dataManager = module.get(ProductionDataManagerService) as unknown as { getPriceUpdatesForFeed: jest.Mock };

    // Stabilize logging assertions (avoid relying on Nest's logger wiring)
    (service as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    (service as any).enhancedLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      logPriceUpdate: jest.fn(),
      logDataFlow: jest.fn(),
      logAggregation: jest.fn(),
    };

    mockFeedId = {
      category: FeedCategory.Crypto,
      name: "BTC/USD",
    };

    // Setup default mock behaviors
    consensusAggregator.validateUpdate.mockReturnValue(true);
    consensusAggregator.getQualityMetrics.mockResolvedValue({
      accuracy: 0.95,
      latency: 100,
      coverage: 0.8,
      reliability: 0.9,
      consensusAlignment: 0.85,
    });
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe("internal helpers and maintenance", () => {
    it("cleanupExpiredCache removes expired entries and logs once", () => {
      const now = Date.now();

      // Insert an expired entry directly
      (service as any).cache.set("1:BTC/USD", {
        value: {
          symbol: "BTC/USD",
          price: 1,
          timestamp: now - 10_000,
          sources: [ExchangeId.Binance],
          confidence: 0.9,
          consensusScore: 0.5,
        },
        timestamp: now - 10_000,
        ttl: 1,
        sources: [ExchangeId.Binance],
        confidence: 0.9,
      });
      (service as any).cacheAccessOrder.set("1:BTC/USD", now - 10_000);

      (service as any).cleanupExpiredCache();

      expect((service as any).cache.size).toBe(0);
      expect((service as any).logger.debug).toHaveBeenCalledWith(expect.stringContaining("Cleaned up"));
    });

    it("recordPerformance trims oldest samples in batches", () => {
      const feedKey = `${FeedCategory.Crypto}:BTC/USD`;
      for (let i = 0; i < 201; i++) {
        (service as any).recordPerformance(feedKey, 10 + i);
      }

      const metrics = (service as any).performanceMetrics.get(feedKey);
      expect(metrics).toBeDefined();
      expect(metrics.length).toBe(151);
    });

    it("getCompositeSource logs debug for target symbols", () => {
      const update: PriceUpdate = {
        symbol: "ADA/USD",
        price: 1,
        timestamp: Date.now(),
        source: ExchangeId.Coinbase,
        confidence: 0.9,
      };

      const composite = (service as any).getCompositeSource(update);
      expect(composite).toBe(`${ExchangeId.Coinbase}:ADA/USD`);
      expect((service as any).logger.debug).toHaveBeenCalledWith(expect.stringContaining("Composite source created"));
    });
  });

  describe("getAggregatedPrice", () => {
    it("should return null when no price updates are available", async () => {
      const result = await service.getAggregatedPrice(mockFeedId);
      expect(result).toBeNull();
      expect(dataManager.getPriceUpdatesForFeed).toHaveBeenCalledWith(mockFeedId);
    });

    it("should return null if an aggregation is already in progress for the feed", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      let release: (() => void) | undefined;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });

      consensusAggregator.aggregate.mockImplementation(async () => {
        await gate;
        return mockAggregatedPrice;
      });

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      const p1 = service.getAggregatedPrice(mockFeedId);
      const p2 = service.getAggregatedPrice(mockFeedId);

      await expect(p2).resolves.toBeNull();
      release?.();
      await expect(p1).resolves.toEqual(mockAggregatedPrice);
      expect(consensusAggregator.aggregate).toHaveBeenCalledTimes(1);
    });

    it("should fall back to dataManager when no active updates exist", async () => {
      const now = Date.now();
      const freshUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      dataManager.getPriceUpdatesForFeed.mockResolvedValueOnce([freshUpdate]);

      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now,
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValueOnce(mockAggregatedPrice);

      const result = await service.getAggregatedPrice(mockFeedId);
      expect(result).toEqual(mockAggregatedPrice);
      expect(dataManager.getPriceUpdatesForFeed).toHaveBeenCalledWith(mockFeedId);
      expect(consensusAggregator.aggregate).toHaveBeenCalledWith(mockFeedId, [freshUpdate], false);
    });

    it("returns null when dataManager throws and there are no cached/active updates", async () => {
      dataManager.getPriceUpdatesForFeed.mockRejectedValueOnce(new Error("fetch failed"));
      const result = await service.getAggregatedPrice(mockFeedId);
      expect(result).toBeNull();
    });

    it("logs startup no-data errors as debug (no emit)", async () => {
      (service as any).isInitialized = false;

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };
      service.addPriceUpdate(mockFeedId, update);

      consensusAggregator.aggregate.mockRejectedValueOnce(new Error("No valid price data available"));

      const emitSpy = jest.spyOn(service, "emit");
      const result = await service.getAggregatedPrice(mockFeedId);
      expect(result).toBeNull();

      expect((service as any).enhancedLogger.debug).toHaveBeenCalled();
      expect((service as any).enhancedLogger.error).not.toHaveBeenCalled();
      expect(emitSpy).not.toHaveBeenCalledWith("error", expect.anything());
    });

    it("logs a critical performance warning when response time exceeds critical threshold", async () => {
      (service as any).isInitialized = true;
      (service as any).serviceStartTime = Date.now() - 200_000;

      const baseThreshold = (service as any).aggregationConfig.performanceTargetMs;
      jest.spyOn(service as any, "startTimer").mockImplementation(() => undefined);
      jest.spyOn(service as any, "endTimer").mockReturnValue(baseThreshold * 200);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };
      service.addPriceUpdate(mockFeedId, update);

      consensusAggregator.aggregate.mockResolvedValueOnce({
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      });

      await expect(service.getAggregatedPrice(mockFeedId)).resolves.toBeTruthy();
      expect((service as any).enhancedLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Critical aggregation performance"),
        expect.any(Object)
      );
    });

    it("logs performance debug when response time exceeds dynamic threshold but not critical", async () => {
      (service as any).isInitialized = true;
      (service as any).adaptiveProcessing = false;

      const baseThreshold = (service as any).aggregationConfig.performanceTargetMs;
      jest.spyOn(service as any, "startTimer").mockImplementation(() => undefined);
      jest.spyOn(service as any, "endTimer").mockReturnValue(baseThreshold + 1);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };
      service.addPriceUpdate(mockFeedId, update);

      consensusAggregator.aggregate.mockResolvedValueOnce({
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      });

      await expect(service.getAggregatedPrice(mockFeedId)).resolves.toBeTruthy();
      expect((service as any).enhancedLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining("Aggregation performance:")
      );
    });

    it("logs post-startup errors as error and emits an error event", async () => {
      (service as any).isInitialized = true;

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };
      service.addPriceUpdate(mockFeedId, update);

      consensusAggregator.aggregate.mockRejectedValueOnce(new Error("boom"));

      const emitSpy = jest.spyOn(service, "emit");
      const result = await service.getAggregatedPrice(mockFeedId);
      expect(result).toBeNull();

      expect((service as any).enhancedLogger.error).toHaveBeenCalled();
      expect(emitSpy).toHaveBeenCalledWith("error", expect.any(Error));
    });

    describe("processImmediateUpdate staleness logging", () => {
      it("warns when all updates are stale (kept=0 or dropRatio high)", async () => {
        await TestHelpers.withMockedNowAsync(1_000_000, async () => {
          jest.spyOn(service as any, "notifySubscribers").mockResolvedValue(undefined);

          const feedKey = `${FeedCategory.Crypto}:BTC/USD`;
          (service as any).staleDropLastLogged.set(feedKey, 0);
          (service as any).activePriceUpdates.set(feedKey, [
            {
              symbol: "BTC/USD",
              price: 1,
              timestamp: 0,
              source: ExchangeId.Binance,
              confidence: 1,
            },
          ]);

          await (service as any).processImmediateUpdate(
            mockFeedId,
            {
              symbol: "BTC/USD",
              price: 2,
              timestamp: 0,
              source: ExchangeId.Coinbase,
              confidence: 1,
            },
            feedKey
          );

          expect((service as any).logger.warn).toHaveBeenCalledWith(
            expect.stringContaining("Dropped stale updates"),
            expect.any(Object)
          );
        });
      });

      it("debug-logs when some updates are dropped but not severely", async () => {
        await TestHelpers.withMockedNowAsync(2_000_000, async () => {
          jest.spyOn(service as any, "notifySubscribers").mockResolvedValue(undefined);

          const feedKey = `${FeedCategory.Crypto}:BTC/USD`;
          (service as any).staleDropLastLogged.set(feedKey, 0);
          (service as any).activePriceUpdates.set(feedKey, [
            {
              symbol: "BTC/USD",
              price: 100,
              timestamp: 2_000_000,
              source: ExchangeId.Binance,
              confidence: 1,
            },
            {
              symbol: "BTC/USD",
              price: 101,
              timestamp: 0,
              source: ExchangeId.Coinbase,
              confidence: 1,
            },
          ]);

          await (service as any).processImmediateUpdate(
            mockFeedId,
            {
              symbol: "BTC/USD",
              price: 102,
              timestamp: 2_000_000,
              source: ExchangeId.Kraken,
              confidence: 1,
            },
            feedKey
          );

          expect((service as any).logger.debug).toHaveBeenCalledWith(
            expect.stringContaining("Dropped stale updates"),
            expect.any(Object)
          );
        });
      });
    });

    it("should aggregate prices and cache the result", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance, ExchangeId.Coinbase],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      // Add price updates
      const update1: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      const update2: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50100,
        timestamp: Date.now() - 300,
        source: ExchangeId.Coinbase,
        confidence: 0.85,
      };

      service.addPriceUpdate(mockFeedId, update1);
      service.addPriceUpdate(mockFeedId, update2);

      // Wait for batch processing to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await service.getAggregatedPrice(mockFeedId);

      expect(result).toEqual(mockAggregatedPrice);
      // Due to batch processing, we should have at least one update
      expect(consensusAggregator.aggregate).toHaveBeenCalledWith(mockFeedId, expect.any(Array), false);
    });

    it("should return cached result within TTL", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      // First call should aggregate and cache
      const result1 = await service.getAggregatedPrice(mockFeedId);
      expect(result1).toEqual(mockAggregatedPrice);
      expect(consensusAggregator.aggregate).toHaveBeenCalledTimes(1);

      // Second call should return cached result
      const result2 = await service.getAggregatedPrice(mockFeedId);
      expect(result2).toEqual(mockAggregatedPrice);
      expect(consensusAggregator.aggregate).toHaveBeenCalledTimes(1); // Still only called once
    });

    it("should recalculate after cache TTL expires", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      // First call
      await service.getAggregatedPrice(mockFeedId);
      expect(consensusAggregator.aggregate).toHaveBeenCalledTimes(1);

      // Wait for cache to expire (simulate by clearing cache)
      service.clearCache();

      // Second call should recalculate
      await service.getAggregatedPrice(mockFeedId);
      expect(consensusAggregator.aggregate).toHaveBeenCalledTimes(2);
    });

    it("should measure and log performance metrics", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);
      await service.getAggregatedPrice(mockFeedId);

      const performanceMetrics = service.getFeedPerformanceMetrics(mockFeedId);
      expect(performanceMetrics.sampleCount).toBe(1);
      expect(performanceMetrics.averageResponseTime).toBeGreaterThan(0);
    });
  });

  describe("addPriceUpdate", () => {
    it("should add valid price updates", () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      // Verify the update was added by checking if aggregation works
      expect(consensusAggregator.validateUpdate).toHaveBeenCalledWith(update);
    });

    it("should reject invalid price updates", () => {
      consensusAggregator.validateUpdate.mockReturnValue(false);

      const invalidUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: -100, // Invalid negative price
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, invalidUpdate);

      expect(consensusAggregator.validateUpdate).toHaveBeenCalledWith(invalidUpdate);
      // The update should be rejected and not stored
    });

    it("should replace updates from the same source", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50100,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update1: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 1000,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      const update2: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50100,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update1);
      service.addPriceUpdate(mockFeedId, update2);

      // Wait for batch processing to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      await service.getAggregatedPrice(mockFeedId);

      // Should have the latest update from binance (batch processing deduplicates by source)
      expect(consensusAggregator.aggregate).toHaveBeenCalledWith(mockFeedId, expect.any(Array), false);
    });

    it("should filter out stale updates", async () => {
      const now = Date.now();
      const freshUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now - 500, // Fresh
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      const staleUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 49000,
        timestamp: now - 3000, // Stale (3 seconds old)
        source: ExchangeId.Coinbase,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, freshUpdate);
      service.addPriceUpdate(mockFeedId, staleUpdate);

      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now,
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      await service.getAggregatedPrice(mockFeedId);

      // Should only aggregate with fresh update
      expect(consensusAggregator.aggregate).toHaveBeenCalledWith(mockFeedId, [freshUpdate], false);
    });

    it("should invalidate cache when new update arrives", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update1: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 1000,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update1);

      // First call should cache the result
      await service.getAggregatedPrice(mockFeedId);
      expect(consensusAggregator.aggregate).toHaveBeenCalledTimes(1);

      // Add new update (should invalidate cache)
      const update2: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50100,
        timestamp: Date.now() - 500,
        source: ExchangeId.Coinbase,
        confidence: 0.85,
      };

      service.addPriceUpdate(mockFeedId, update2);

      // Next call should recalculate due to cache invalidation
      await service.getAggregatedPrice(mockFeedId);
      expect(consensusAggregator.aggregate).toHaveBeenCalledTimes(2);
    });
  });

  describe("subscribe", () => {
    it("should allow subscribing to price updates", async () => {
      const mockCallback = jest.fn();
      const unsubscribe = service.subscribe(mockFeedId, mockCallback);

      expect(typeof unsubscribe).toBe("function");
      expect(service.getSubscriptionCount()).toBe(1);

      // Clean up
      unsubscribe();
      expect(service.getSubscriptionCount()).toBe(0);
    });

    it("should notify subscribers when new prices are available", async () => {
      const mockCallback = jest.fn();
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      service.subscribe(mockFeedId, mockCallback);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      // Wait a bit for async notification
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockCallback).toHaveBeenCalledWith(mockAggregatedPrice);
    });

    it("should handle multiple subscribers", async () => {
      const mockCallback1 = jest.fn();
      const mockCallback2 = jest.fn();
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      service.subscribe(mockFeedId, mockCallback1);
      service.subscribe(mockFeedId, mockCallback2);

      expect(service.getSubscriptionCount()).toBe(2);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      // Wait for async notifications
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockCallback1).toHaveBeenCalledWith(mockAggregatedPrice);
      expect(mockCallback2).toHaveBeenCalledWith(mockAggregatedPrice);
    });

    it("should continue notifying other subscribers if one callback throws", async () => {
      const badCallback = jest.fn(() => {
        throw new Error("callback failed");
      });
      const goodCallback = jest.fn();

      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };
      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      service.subscribe(mockFeedId, badCallback);
      service.subscribe(mockFeedId, goodCallback);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 10,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };
      service.addPriceUpdate(mockFeedId, update);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(badCallback).toHaveBeenCalled();
      expect(goodCallback).toHaveBeenCalledWith(mockAggregatedPrice);
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error notifying subscriber"),
        expect.anything()
      );
    });
  });

  describe("batch processing", () => {
    it("processBatchedUpdates is a no-op when no batched updates exist", async () => {
      await (service as any).processBatchedUpdates();
      expect((service as any).logger.error).not.toHaveBeenCalled();
    });

    it("processBatchedUpdates merges, de-duplicates by composite source, and clears processed batches", async () => {
      const feedKey = `${mockFeedId.category}:${mockFeedId.name}`;
      const now = Date.now();

      // Existing update
      (service as any).activePriceUpdates.set(feedKey, [
        {
          symbol: "BTC/USD",
          price: 100,
          timestamp: now - 50,
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
      ]);

      // Batched updates includes a newer Binance update and a Coinbase update
      (service as any).batchProcessor.set(feedKey, [
        {
          symbol: "BTC/USD",
          price: 101,
          timestamp: now - 10,
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 99,
          timestamp: now - 20,
          source: ExchangeId.Coinbase,
          confidence: 0.8,
        },
      ]);

      // No subscribers, but parseFeedKey should succeed
      await (service as any).processBatchedUpdates();

      const updates = (service as any).activePriceUpdates.get(feedKey) as PriceUpdate[];
      expect(Array.isArray(updates)).toBe(true);

      // Should contain only latest per composite source
      const bySource = new Map<string, PriceUpdate>();
      for (const update of updates) {
        bySource.set(update.source, update);
      }

      expect(bySource.get(ExchangeId.Binance as unknown as string)?.price).toBe(101);
      expect(bySource.get(ExchangeId.Coinbase as unknown as string)?.price).toBe(99);

      expect((service as any).batchProcessor.size).toBe(0);
    });

    it("processBatchedUpdates logs warn when nearly all updates are stale", async () => {
      const feedKey = `${mockFeedId.category}:${mockFeedId.name}`;
      const now = Date.now();

      // Make staleness severe (kept === 0 / dropRatio >= 0.9) by using stale timestamps
      (service as any).batchProcessor.set(feedKey, [
        {
          symbol: "BTC/USD",
          price: 100,
          timestamp: now - 1_000_000,
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 101,
          timestamp: now - 1_000_000,
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        },
      ]);

      await (service as any).processBatchedUpdates();

      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Dropped stale updates"),
        expect.anything()
      );
    });
  });

  describe("optimizePerformance", () => {
    it("switches to event-driven processing and adjusts cache size based on metrics", () => {
      // Force metrics:
      // - averageBatchTime > 25 => switch to event-driven
      // - cacheOptimization (hitRate) < 0.85 => increase cache
      // - batchEfficiency < 0.7 => optimized event-driven path

      (service as any).performanceBuffer.splice(0, (service as any).performanceBuffer.length, 30);
      (service as any).cacheStats = { hits: 1, misses: 9, evictions: 0, totalRequests: 10 };

      const feedKey = `${mockFeedId.category}:${mockFeedId.name}`;
      // batchProcessor.size drives batchEfficiency = 1 - size/100
      (service as any).batchProcessor.set(feedKey, [
        {
          symbol: "BTC/USD",
          price: 1,
          timestamp: Date.now(),
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
      ]);
      for (let i = 0; i < 80; i++) {
        (service as any).batchProcessor.set(`${feedKey}_${i}`, []);
      }

      const stopBatchSpy = jest.spyOn(service as any, "stopBatchProcessing").mockImplementation(() => undefined);
      const scheduler = jest.fn();
      (service as any).createEventDrivenScheduler = jest.fn(() => scheduler);

      const onSpy = jest.spyOn(service, "on");
      (service as any).updateConfig = jest.fn();

      service.optimizePerformance();

      expect(stopBatchSpy).toHaveBeenCalled();
      expect((service as any).createEventDrivenScheduler).toHaveBeenCalled();
      expect(onSpy).toHaveBeenCalledWith("batchUpdateReceived", scheduler);
      expect(onSpy).toHaveBeenCalledWith("subscriptionAdded", scheduler);
      expect((service as any).updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ maxCacheSize: expect.any(Number) })
      );
      expect((service as any).adaptiveProcessing).toBe(true);
    });
  });

  describe("processPriceUpdate", () => {
    it("returns early for unknown symbols (no aggregation)", async () => {
      const update: PriceUpdate = {
        symbol: "UNKNOWN/PAIR",
        price: 1,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      const addSpy = jest.spyOn(service, "addPriceUpdate");
      await service.processPriceUpdate(update);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it("skips duplicate updates already being processed", async () => {
      const update: PriceUpdate = {
        symbol: mockFeedId.name,
        price: 1,
        timestamp: 123,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };
      const updateKey = `${update.symbol}_${update.source}_${update.timestamp}_${update.price}_${update.confidence || 0}`;
      (service as any).processingUpdates.add(updateKey);

      const addSpy = jest.spyOn(service, "addPriceUpdate");
      await service.processPriceUpdate(update);
      expect(addSpy).not.toHaveBeenCalled();
    });

    it("emits aggregatedPrice when aggregation succeeds", async () => {
      const aggregated: AggregatedPrice = {
        symbol: mockFeedId.name,
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      jest.spyOn(service, "getAggregatedPrice").mockResolvedValueOnce(aggregated);
      const emitSpy = jest.spyOn(service, "emit");

      const update: PriceUpdate = {
        symbol: mockFeedId.name,
        price: 49900,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      await service.processPriceUpdate(update);
      expect(emitSpy).toHaveBeenCalledWith("aggregatedPrice", aggregated);
    });

    it("rate-limits aggregation failure debug logs", async () => {
      jest.spyOn(service, "getAggregatedPrice").mockResolvedValue(null);

      const update: PriceUpdate = {
        symbol: mockFeedId.name,
        price: 1,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      await service.processPriceUpdate(update);
      await service.processPriceUpdate(update);

      const debugCalls = (service as any).enhancedLogger.debug.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes("Failed to generate aggregated price")
      );
      expect(debugCalls.length).toBe(1);
    });

    it("emits error and rethrows on processing exceptions", async () => {
      const err = new Error("kaboom");
      jest.spyOn(service, "addPriceUpdate").mockImplementation(() => {
        throw err;
      });

      const emitSpy = jest.spyOn(service, "emit");
      const update: PriceUpdate = {
        symbol: mockFeedId.name,
        price: 1,
        timestamp: Date.now(),
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      await expect(service.processPriceUpdate(update)).rejects.toThrow("kaboom");
      expect(emitSpy).toHaveBeenCalledWith("error", err);
    });
  });

  describe("getQualityMetrics", () => {
    it("should return quality metrics", async () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      const metrics = await service.getQualityMetrics(mockFeedId);

      expect(metrics).toBeDefined();
      expect(metrics.accuracy).toBeGreaterThanOrEqual(0);
      expect(metrics.accuracy).toBeLessThanOrEqual(1);
      expect(metrics.latency).toBeGreaterThanOrEqual(0);
      expect(metrics.coverage).toBeGreaterThanOrEqual(0);
      expect(metrics.coverage).toBeLessThanOrEqual(1);
      expect(metrics.reliability).toBeGreaterThanOrEqual(0);
      expect(metrics.reliability).toBeLessThanOrEqual(1);
      expect(metrics.consensusAlignment).toBeGreaterThanOrEqual(0);
      expect(metrics.consensusAlignment).toBeLessThanOrEqual(1);
    });
  });

  describe("getCacheStats", () => {
    it("should return cache statistics", async () => {
      const stats = service.getCacheStats();

      expect(stats).toBeDefined();
      expect(stats.totalEntries).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeLessThanOrEqual(1);
      expect(stats.missRate).toBeGreaterThanOrEqual(0);
      expect(stats.missRate).toBeLessThanOrEqual(1);
      expect(stats.evictionCount).toBeGreaterThanOrEqual(0);
      expect(stats.averageAge).toBeGreaterThanOrEqual(0);
    });

    it("should track cache hits and misses", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      // First call should be a cache miss
      await service.getAggregatedPrice(mockFeedId);
      let stats = service.getCacheStats();
      expect(stats.hitRate).toBe(0); // First call is always a miss

      // Second call should be a cache hit
      await service.getAggregatedPrice(mockFeedId);
      stats = service.getCacheStats();
      expect(stats.hitRate).toBe(0.5); // 1 hit out of 2 total requests
    });
  });

  describe("performance", () => {
    it("should track performance metrics", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);
      await service.getAggregatedPrice(mockFeedId);

      const performanceMetrics = service.getFeedPerformanceMetrics(mockFeedId);
      expect(performanceMetrics.sampleCount).toBe(1);
      expect(performanceMetrics.averageResponseTime).toBeGreaterThan(0);
      expect(performanceMetrics.averageResponseTime).toBeLessThan(1000); // Should be fast
    });

    it("should target sub-100ms response times", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      // Mock fast aggregation
      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      const startTime = performance.now();
      await service.getAggregatedPrice(mockFeedId);
      const responseTime = performance.now() - startTime;

      // Should be reasonably fast (allowing for test overhead)
      expect(responseTime).toBeLessThan(100);
    });
  });

  describe("cache management", () => {
    it("should clear cache when requested", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);
      await service.getAggregatedPrice(mockFeedId);

      let stats = service.getCacheStats();
      expect(stats.totalEntries).toBeGreaterThan(0);

      service.clearCache();

      stats = service.getCacheStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.missRate).toBe(0);
    });

    it("should evict LRU entries when cache exceeds max size", async () => {
      (service as any).config.maxCacheSize = 1;

      const feed2: CoreFeedId = { category: FeedCategory.Crypto, name: "ETH/USD" };

      consensusAggregator.aggregate.mockImplementation(async (feedId: CoreFeedId) => {
        return {
          symbol: feedId.name,
          price: 1,
          timestamp: Date.now(),
          sources: [ExchangeId.Binance],
          confidence: 0.9,
          consensusScore: 0.85,
        } as AggregatedPrice;
      });

      service.addPriceUpdate(mockFeedId, {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      });

      service.addPriceUpdate(feed2, {
        symbol: "ETH/USD",
        price: 3000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      });

      await service.getAggregatedPrice(mockFeedId);
      await service.getAggregatedPrice(feed2);

      const stats = service.getCacheStats();
      expect(stats.totalEntries).toBe(1);
      expect(stats.evictionCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("performance optimization", () => {
    it("should provide optimization metrics", () => {
      const metrics = service.getOptimizationMetrics();

      expect(metrics.averageBatchTime).toBeGreaterThanOrEqual(0);
      expect(metrics.batchEfficiency).toBeGreaterThanOrEqual(0);
      expect(metrics.batchEfficiency).toBeLessThanOrEqual(1);
      expect(metrics.cacheOptimization).toBeGreaterThanOrEqual(0);
      expect(metrics.cacheOptimization).toBeLessThanOrEqual(1);
      expect(metrics.throughputImprovement).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(metrics.recommendations)).toBe(true);
    });

    it("should optimize performance", () => {
      // Should not throw errors
      expect(() => service.optimizePerformance()).not.toThrow();
    });

    it("should calculate efficiency score", () => {
      const efficiency = service.getEfficiencyScore();
      expect(efficiency).toBeGreaterThanOrEqual(0);
      expect(efficiency).toBeLessThanOrEqual(1);
    });
  });

  describe("service lifecycle", () => {
    it("should initialize and destroy properly", async () => {
      await service.onModuleInit();
      expect(service.getActiveFeedCount()).toBe(0);
      expect(service.getSubscriptionCount()).toBe(0);

      await service.onModuleDestroy();
      // Should not throw errors
    });
  });
});
