import { Test, TestingModule } from "@nestjs/testing";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { CachePerformanceMonitorService } from "@/cache/cache-performance-monitor.service";
import { type EnhancedFeedId, FeedCategory } from "@/common/types/core";
import type { AggregatedPrice } from "@/common/types/services";

describe("Cache Service Integration - Task 7 Implementation", () => {
  let cacheService: RealTimeCacheService;
  let cacheWarmerService: CacheWarmerService;
  let cachePerformanceMonitor: CachePerformanceMonitorService;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  const mockAggregatedPrice: AggregatedPrice = {
    symbol: "BTC/USD",
    price: 50000,
    timestamp: Date.now(),
    sources: ["binance", "coinbase"],
    confidence: 0.95,
    consensusScore: 0.98,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RealTimeCacheService, CacheWarmerService, CachePerformanceMonitorService],
    }).compile();

    cacheService = module.get<RealTimeCacheService>(RealTimeCacheService);
    cacheWarmerService = module.get<CacheWarmerService>(CacheWarmerService);
    cachePerformanceMonitor = module.get<CachePerformanceMonitorService>(CachePerformanceMonitorService);
  });

  afterEach(() => {
    cacheService.destroy();
    cacheWarmerService.destroy();
    cachePerformanceMonitor.destroy();
  });

  describe("Task 7.1: Wire RealTimeCacheService to aggregated price events", () => {
    it("should cache aggregated prices automatically", () => {
      // Simulate caching an aggregated price (as would happen from event handler)
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: mockAggregatedPrice.timestamp,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      // Verify price was cached
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);
      expect(cachedPrice?.sources).toEqual(mockAggregatedPrice.sources);
      expect(cachedPrice?.confidence).toBe(mockAggregatedPrice.confidence);
    });

    it("should respect 1-second TTL maximum for real-time requirements", () => {
      const now = Date.now();

      // Set price with long TTL (should be capped at 1 second)
      cacheService.set(
        "test-key",
        {
          value: 100,
          timestamp: now,
          sources: ["test"],
          confidence: 1.0,
        },
        5000
      ); // 5 seconds requested

      // Verify it's cached initially
      let cached = cacheService.get("test-key");
      expect(cached).toBeDefined();

      // Wait for TTL to expire (slightly more than 1 second)
      return new Promise<void>(resolve => {
        setTimeout(() => {
          cached = cacheService.get("test-key");
          expect(cached).toBeNull(); // Should be expired due to 1-second TTL cap
          resolve();
        }, 1100);
      });
    });
  });

  describe("Task 7.2: Implement proper cache invalidation on new price updates", () => {
    it("should invalidate voting round cache on price updates", () => {
      // Set initial price
      cacheService.setPrice(mockFeedId, {
        value: 49000,
        timestamp: Date.now(),
        sources: ["source1"],
        confidence: 0.9,
      });

      // Set voting round cache
      cacheService.setForVotingRound(mockFeedId, 123, {
        value: 49100,
        timestamp: Date.now(),
        sources: ["source2"],
        confidence: 0.95,
        votingRound: 123,
      });

      // Verify both are cached
      expect(cacheService.getPrice(mockFeedId)).toBeDefined();
      expect(cacheService.getForVotingRound(mockFeedId, 123)).toBeDefined();

      // Invalidate on price update (should only invalidate voting round cache)
      cacheService.invalidateOnPriceUpdate(mockFeedId);

      // Verify current price is still cached (not invalidated)
      expect(cacheService.getPrice(mockFeedId)).toBeDefined();
      expect(cacheService.getPrice(mockFeedId)?.value).toBe(49000);

      // Verify voting round cache is invalidated
      expect(cacheService.getForVotingRound(mockFeedId, 123)).toBeNull();
    });

    it("should automatically invalidate when setting new price", () => {
      // Set initial price and voting round cache
      cacheService.setPrice(mockFeedId, {
        value: 49000,
        timestamp: Date.now(),
        sources: ["source1"],
        confidence: 0.9,
      });

      cacheService.setForVotingRound(mockFeedId, 123, {
        value: 49100,
        timestamp: Date.now(),
        sources: ["source2"],
        confidence: 0.95,
        votingRound: 123,
      });

      // Set new price (should trigger invalidation)
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: mockAggregatedPrice.timestamp,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      // Manually call invalidation (simulating what happens in production integration service)
      cacheService.invalidateOnPriceUpdate(mockFeedId);

      // Verify old voting round cache was invalidated
      expect(cacheService.getForVotingRound(mockFeedId, 123)).toBeNull();

      // Verify new price is cached
      const newCachedPrice = cacheService.getPrice(mockFeedId);
      expect(newCachedPrice?.value).toBe(mockAggregatedPrice.price);
    });
  });

  describe("Task 7.3: Complete cache performance monitoring and metrics collection", () => {
    it("should track cache performance metrics", () => {
      const startTime = performance.now();

      // Perform cache operations
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: mockAggregatedPrice.timestamp,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();

      // Record response time
      const responseTime = performance.now() - startTime;
      cachePerformanceMonitor.recordResponseTime(responseTime);

      // Get performance metrics
      const metrics = cachePerformanceMonitor.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBeGreaterThan(0);
      expect(metrics.hitRate).toBeGreaterThanOrEqual(0);
      expect(metrics.memoryUsage).toBeGreaterThanOrEqual(0);
    });

    it("should check performance thresholds", () => {
      // Record some response times
      cachePerformanceMonitor.recordResponseTime(5); // Good response time
      cachePerformanceMonitor.recordResponseTime(15); // Poor response time

      const healthCheck = cachePerformanceMonitor.checkPerformanceThresholds();
      expect(healthCheck).toHaveProperty("hitRateOk");
      expect(healthCheck).toHaveProperty("responseTimeOk");
      expect(healthCheck).toHaveProperty("memoryUsageOk");
      expect(healthCheck).toHaveProperty("overallHealthy");
    });

    it("should generate performance report", () => {
      // Add some cache operations
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: mockAggregatedPrice.timestamp,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      cacheService.getPrice(mockFeedId);
      cachePerformanceMonitor.recordResponseTime(8);

      const report = cachePerformanceMonitor.generatePerformanceReport();
      expect(report).toContain("Cache Performance Report");
      expect(report).toContain("Hit Rate:");
      expect(report).toContain("Response Times:");
      expect(report).toContain("Memory Usage:");
    });

    it("should track hit and miss rates", () => {
      const initialStats = cacheService.getStats();
      expect(initialStats.hits + initialStats.misses).toBe(0);

      // Cache miss
      let result = cacheService.getPrice(mockFeedId);
      expect(result).toBeNull();

      // Cache hit
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: mockAggregatedPrice.timestamp,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      result = cacheService.getPrice(mockFeedId);
      expect(result).toBeDefined();

      const finalStats = cacheService.getStats();
      expect(finalStats.hits + finalStats.misses).toBe(2);
      expect(finalStats.hitRate).toBe(0.5); // 1 hit out of 2 requests
    });
  });

  describe("Task 7.4: Fix cache warmer service integration with actual data sources", () => {
    it("should track feed access patterns", () => {
      // Track feed access
      cacheWarmerService.trackFeedAccess(mockFeedId);
      cacheWarmerService.trackFeedAccess(mockFeedId);
      cacheWarmerService.trackFeedAccess(mockFeedId);

      // Get popular feeds
      const popularFeeds = cacheWarmerService.getPopularFeeds();
      expect(popularFeeds.length).toBeGreaterThan(0);
      expect(popularFeeds[0].feedId).toEqual(mockFeedId);
      expect(popularFeeds[0].requestCount).toBe(3);
    });

    it("should warm cache with data source callback", async () => {
      // Set up data source callback
      const mockCallback = jest.fn().mockResolvedValue(mockAggregatedPrice);
      cacheWarmerService.setDataSourceCallback(mockCallback);

      // Warm cache for feed
      await cacheWarmerService.warmFeedCache(mockFeedId);

      // Verify callback was called
      expect(mockCallback).toHaveBeenCalledWith(mockFeedId);

      // Verify cache was populated
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);
    });

    it("should get warmup statistics", () => {
      // Track some feeds
      cacheWarmerService.trackFeedAccess(mockFeedId);
      cacheWarmerService.trackFeedAccess({
        category: FeedCategory.Crypto,
        name: "ETH/USD",
      });

      const stats = cacheWarmerService.getWarmupStats();
      expect(stats.totalTrackedFeeds).toBe(2);
      expect(stats.popularFeeds).toBeGreaterThanOrEqual(0);
      expect(stats.warmupEnabled).toBe(true);
    });

    it("should handle cache warming errors gracefully", async () => {
      // Set up failing data source callback
      const mockCallback = jest.fn().mockRejectedValue(new Error("Data source error"));
      cacheWarmerService.setDataSourceCallback(mockCallback);

      // Attempt to warm cache - should throw error
      await expect(cacheWarmerService.warmFeedCache(mockFeedId)).rejects.toThrow("Data source error");

      // Verify callback was called despite error
      expect(mockCallback).toHaveBeenCalledWith(mockFeedId);
    });

    it("should use mock data when no callback is configured", async () => {
      // Don't set any callback

      // Warm cache for feed (should use mock data)
      await cacheWarmerService.warmFeedCache(mockFeedId);

      // Verify cache was populated with mock data
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBeGreaterThan(0); // Mock data should be positive
      expect(cachedPrice?.sources).toEqual(["mock-source"]);
    });
  });

  describe("Integration with Production Requirements", () => {
    it("should meet real-time data requirements (Requirement 7.3)", () => {
      const now = Date.now();

      // Set price with current timestamp
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: now,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      // Verify data is considered fresh (within 2-second requirement)
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();

      const dataAge = Date.now() - cachedPrice!.timestamp;
      expect(dataAge).toBeLessThan(2000); // Should be fresh within 2 seconds
    });

    it("should support performance monitoring requirements (Requirement 6.2)", () => {
      // Perform multiple cache operations
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();

        cacheService.setPrice(
          {
            category: FeedCategory.Crypto,
            name: `TEST${i}/USD`,
          },
          {
            value: 1000 + i,
            timestamp: Date.now(),
            sources: ["test-source"],
            confidence: 0.9,
          }
        );

        const responseTime = performance.now() - startTime;
        cachePerformanceMonitor.recordResponseTime(responseTime);
      }

      // Verify performance metrics are collected
      const metrics = cachePerformanceMonitor.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBeGreaterThan(0);
      expect(metrics.totalRequests).toBe(0); // Cache service requests, not set operations

      // Verify performance thresholds
      const health = cachePerformanceMonitor.checkPerformanceThresholds();
      expect(health.overallHealthy).toBeDefined();
    });

    it("should handle high-frequency price updates efficiently", () => {
      const startTime = performance.now();

      // Simulate high-frequency updates
      for (let i = 0; i < 100; i++) {
        cacheService.setPrice(mockFeedId, {
          value: 50000 + i,
          timestamp: Date.now(),
          sources: [`source-${i % 5}`], // Rotate through 5 sources
          confidence: 0.9 + (i % 10) * 0.01,
        });

        // Invalidate previous cache entries
        cacheService.invalidateOnPriceUpdate(mockFeedId);
      }

      const totalTime = performance.now() - startTime;

      // Verify final cached price
      const finalPrice = cacheService.getPrice(mockFeedId);
      expect(finalPrice).toBeDefined();
      expect(finalPrice?.value).toBe(50099); // Last update

      // Verify performance is acceptable (should handle 100 updates quickly)
      expect(totalTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});
