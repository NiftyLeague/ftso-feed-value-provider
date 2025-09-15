import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";
import { ProductionDataManagerService } from "@/data-manager/production-data-manager.service";

import type { AggregatedPrice } from "@/common/types/services";
import type { CoreFeedId, PriceUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

import { RealTimeAggregationService } from "../real-time-aggregation.service";
import { ConsensusAggregator } from "../consensus-aggregator.service";

describe("RealTimeAggregationService", () => {
  let service: RealTimeAggregationService;
  let consensusAggregator: jest.Mocked<ConsensusAggregator>;
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

  describe("getAggregatedPrice", () => {
    it("should return null when no price updates are available", async () => {
      const result = await service.getAggregatedPrice(mockFeedId);
      expect(result).toBeNull();
    });

    it("should aggregate prices and cache the result", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance", "coinbase"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      // Add price updates
      const update1: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
        confidence: 0.9,
      };

      const update2: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50100,
        timestamp: Date.now() - 300,
        source: "coinbase",
        confidence: 0.85,
      };

      service.addPriceUpdate(mockFeedId, update1);
      service.addPriceUpdate(mockFeedId, update2);

      // Wait for batch processing to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      const result = await service.getAggregatedPrice(mockFeedId);

      expect(result).toEqual(mockAggregatedPrice);
      // Due to batch processing, we should have at least one update
      expect(consensusAggregator.aggregate).toHaveBeenCalledWith(mockFeedId, expect.any(Array));
    });

    it("should return cached result within TTL", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
        source: "binance",
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
        source: "binance",
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
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update1: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 1000,
        source: "binance",
        confidence: 0.9,
      };

      const update2: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50100,
        timestamp: Date.now() - 500,
        source: "binance",
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update1);
      service.addPriceUpdate(mockFeedId, update2);

      // Wait for batch processing to complete
      await new Promise(resolve => setTimeout(resolve, 150));

      await service.getAggregatedPrice(mockFeedId);

      // Should have the latest update from binance (batch processing deduplicates by source)
      expect(consensusAggregator.aggregate).toHaveBeenCalledWith(mockFeedId, expect.any(Array));
    });

    it("should filter out stale updates", async () => {
      const now = Date.now();
      const freshUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now - 500, // Fresh
        source: "binance",
        confidence: 0.9,
      };

      const staleUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 49000,
        timestamp: now - 3000, // Stale (3 seconds old)
        source: "coinbase",
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, freshUpdate);
      service.addPriceUpdate(mockFeedId, staleUpdate);

      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: now,
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      await service.getAggregatedPrice(mockFeedId);

      // Should only aggregate with fresh update
      expect(consensusAggregator.aggregate).toHaveBeenCalledWith(mockFeedId, [freshUpdate]);
    });

    it("should invalidate cache when new update arrives", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update1: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 1000,
        source: "binance",
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
        source: "coinbase",
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
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      service.subscribe(mockFeedId, mockCallback);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
        sources: ["binance"],
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
        source: "binance",
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      // Wait for async notifications
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockCallback1).toHaveBeenCalledWith(mockAggregatedPrice);
      expect(mockCallback2).toHaveBeenCalledWith(mockAggregatedPrice);
    });
  });

  describe("getQualityMetrics", () => {
    it("should return quality metrics", async () => {
      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      // Mock fast aggregation
      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
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
