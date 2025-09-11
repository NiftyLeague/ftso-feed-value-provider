import { Test, TestingModule } from "@nestjs/testing";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { CachePerformanceMonitorService } from "@/cache/cache-performance-monitor.service";
import { type CoreFeedId, FeedCategory } from "@/common/types/core";
import type { AggregatedPrice } from "@/common/types/services";

describe("Cache Service Integration", () => {
  let cacheService: RealTimeCacheService;
  let cacheWarmerService: CacheWarmerService;
  let cachePerformanceMonitor: CachePerformanceMonitorService;

  const mockFeedId: CoreFeedId = {
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

  afterEach(async () => {
    cacheService.destroy();
    await cacheWarmerService.onModuleDestroy();
    cachePerformanceMonitor.destroy();
  });

  describe("Cache Service Integration with Aggregated Prices", () => {
    it("should cache aggregated price and handle invalidation", () => {
      // Set price in cache
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: mockAggregatedPrice.timestamp,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      // Set voting round cache
      cacheService.setForVotingRound(mockFeedId, 123, {
        value: mockAggregatedPrice.price + 100,
        timestamp: mockAggregatedPrice.timestamp,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
        votingRound: 123,
      });

      // Verify both are cached
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);
      expect(cachedPrice?.sources).toEqual(mockAggregatedPrice.sources);

      const votingRoundPrice = cacheService.getForVotingRound(mockFeedId, 123);
      expect(votingRoundPrice).toBeDefined();

      // Test cache invalidation on price update (should only invalidate voting round cache)
      cacheService.invalidateOnPriceUpdate(mockFeedId);

      // Verify current price is still cached
      const currentPrice = cacheService.getPrice(mockFeedId);
      expect(currentPrice).toBeDefined();
      expect(currentPrice?.value).toBe(mockAggregatedPrice.price);

      // Verify voting round cache is invalidated
      const invalidatedVotingRound = cacheService.getForVotingRound(mockFeedId, 123);
      expect(invalidatedVotingRound).toBeNull();
    });

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
  });

  describe("Cache Warmer Integration", () => {
    it("should track feed access patterns", () => {
      // Track feed access
      cacheWarmerService.trackFeedAccess(mockFeedId);
      cacheWarmerService.trackFeedAccess(mockFeedId);
      cacheWarmerService.trackFeedAccess(mockFeedId);

      // Get warming stats
      const warmupStats = cacheWarmerService.getWarmupStats();
      expect(warmupStats.totalPatterns).toBeGreaterThan(0);
      expect(warmupStats.topFeeds[0].accessCount).toBeGreaterThan(0);
    });

    it("should warm cache with data source callback", async () => {
      // Set up data source callback
      const mockCallback = jest.fn().mockResolvedValue(mockAggregatedPrice);
      cacheWarmerService.setDataSourceCallback(mockCallback);

      // Track feed access to trigger warming
      cacheWarmerService.trackFeedAccess(mockFeedId);

      // Wait for asynchronous warming to complete
      await new Promise(resolve => setTimeout(resolve, 50));

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
      expect(stats.totalPatterns).toBe(2);
      expect(stats.strategies.length).toBeGreaterThan(0);
    });

    it("should handle cache warming errors gracefully", async () => {
      // Set up failing data source callback
      const mockCallback = jest.fn().mockRejectedValue(new Error("Data source error"));
      cacheWarmerService.setDataSourceCallback(mockCallback);

      // Track feed access (warming happens in background)
      cacheWarmerService.trackFeedAccess(mockFeedId);

      // Wait for asynchronous warming to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify callback was called despite error
      expect(mockCallback).toHaveBeenCalledWith(mockFeedId);
    });
  });

  describe("Cache TTL and Freshness", () => {
    it("should respect 1-second TTL maximum", () => {
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

    it("should handle cache invalidation properly", () => {
      // Set multiple prices for the same feed
      cacheService.setPrice(mockFeedId, {
        value: 50000,
        timestamp: Date.now(),
        sources: ["source1"],
        confidence: 0.9,
      });

      cacheService.setForVotingRound(mockFeedId, 123, {
        value: 50100,
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

      // Verify current price is still cached
      expect(cacheService.getPrice(mockFeedId)).toBeDefined();
      expect(cacheService.getPrice(mockFeedId)?.value).toBe(50000);

      // Verify voting round cache is invalidated
      expect(cacheService.getForVotingRound(mockFeedId, 123)).toBeNull();
    });
  });

  describe("Cache Statistics", () => {
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
});
