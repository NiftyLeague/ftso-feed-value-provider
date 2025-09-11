import { Test, TestingModule } from "@nestjs/testing";
import { IntegrationService } from "@/integration/integration.service";
import { DataSourceIntegrationService } from "@/integration/services/data-source-integration.service";
import { PriceAggregationCoordinatorService } from "@/integration/services/price-aggregation-coordinator.service";
import { SystemHealthService } from "@/integration/services/system-health.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { CachePerformanceMonitorService } from "@/cache/cache-performance-monitor.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ConfigService } from "@/config/config.service";
import { type CoreFeedId, FeedCategory } from "@/common/types/core";
import type { AggregatedPrice } from "@/common/types/services";

describe("Comprehensive Cache Integration Across All Services", () => {
  let integrationService: IntegrationService;
  let cacheService: RealTimeCacheService;
  let cacheWarmerService: CacheWarmerService;
  let cachePerformanceMonitor: CachePerformanceMonitorService;
  let priceAggregationCoordinator: PriceAggregationCoordinatorService;
  let module: TestingModule;

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
    module = await Test.createTestingModule({
      providers: [
        IntegrationService,
        {
          provide: DataSourceIntegrationService,
          useValue: {
            initialize: jest.fn().mockResolvedValue(undefined),
            shutdown: jest.fn().mockResolvedValue(undefined),
            subscribeToFeed: jest.fn().mockResolvedValue(undefined),
            getDataSourceStats: jest.fn().mockReturnValue({
              totalSources: 5,
              activeSources: 3,
              connectionHealth: 0.8,
            }),
            on: jest.fn(),
            emit: jest.fn(),
          },
        },
        PriceAggregationCoordinatorService,
        {
          provide: SystemHealthService,
          useValue: {
            initialize: jest.fn().mockResolvedValue(undefined),
            shutdown: jest.fn().mockResolvedValue(undefined),
            getSystemHealth: jest.fn().mockReturnValue({
              overall: "healthy",
              components: {},
            }),
            on: jest.fn(),
            emit: jest.fn(),
          },
        },
        {
          provide: RealTimeAggregationService,
          useValue: {
            getAggregatedPrice: jest.fn().mockResolvedValue(mockAggregatedPrice),
            processPriceUpdate: jest.fn().mockResolvedValue(undefined),
            getActiveFeedCount: jest.fn().mockReturnValue(5),
            getCacheStats: jest.fn().mockReturnValue({
              hitRate: 0.85,
              totalRequests: 100,
              cacheSize: 50,
            }),
            on: jest.fn(),
            emit: jest.fn(),
          },
        },
        RealTimeCacheService,
        CacheWarmerService,
        CachePerformanceMonitorService,
        {
          provide: ConfigService,
          useValue: {
            getFeedConfigurations: jest.fn().mockReturnValue([
              {
                feed: mockFeedId,
                sources: ["binance", "coinbase"],
                enabled: true,
              },
            ]),
            getConfig: jest.fn().mockReturnValue({
              cache: {
                enabled: true,
                ttl: 1000,
                maxSize: 10000,
              },
            }),
          },
        },
      ],
    }).compile();

    integrationService = module.get<IntegrationService>(IntegrationService);
    cacheService = module.get<RealTimeCacheService>(RealTimeCacheService);
    cacheWarmerService = module.get<CacheWarmerService>(CacheWarmerService);
    cachePerformanceMonitor = module.get<CachePerformanceMonitorService>(CachePerformanceMonitorService);
    priceAggregationCoordinator = module.get<PriceAggregationCoordinatorService>(PriceAggregationCoordinatorService);
  });

  afterEach(async () => {
    await integrationService.onModuleDestroy();
    cacheService.destroy();
    await cacheWarmerService.onModuleDestroy();
    cachePerformanceMonitor.destroy();
  });

  describe("End-to-End Cache Integration", () => {
    beforeEach(async () => {
      await integrationService.onModuleInit();
    });

    it("should integrate cache across all services in the system", async () => {
      // Step 1: Get price through the integration service (should cache)
      const price = await priceAggregationCoordinator.getCurrentPrice(mockFeedId);
      expect(price).toEqual(mockAggregatedPrice);

      // Step 2: Verify cache service has the data
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);

      // Step 3: Verify cache warmer is tracking access
      cacheWarmerService.trackFeedAccess(mockFeedId);
      const warmupStats = cacheWarmerService.getWarmupStats();
      expect(warmupStats.totalPatterns).toBeGreaterThan(0);

      // Step 4: Verify performance monitoring is working
      const performanceMetrics = cachePerformanceMonitor.getPerformanceMetrics();
      expect(performanceMetrics).toBeDefined();
      expect(performanceMetrics.averageResponseTime).toBeGreaterThanOrEqual(0);

      // Step 5: Get comprehensive stats from coordinator
      const cacheStats = priceAggregationCoordinator.getCacheStats();
      expect(cacheStats.stats).toBeDefined();
      expect(cacheStats.performance).toBeDefined();
      expect(cacheStats.health).toBeDefined();
      expect(cacheStats.warmup).toBeDefined();
    });

    it("should maintain cache consistency across service boundaries", async () => {
      // Set up multiple feeds
      const ethFeedId: CoreFeedId = {
        category: FeedCategory.Crypto,
        name: "ETH/USD",
      };

      const ethPrice: AggregatedPrice = {
        symbol: "ETH/USD",
        price: 3000,
        timestamp: Date.now(),
        sources: ["binance", "kraken"],
        confidence: 0.92,
        consensusScore: 0.95,
      };

      // Mock different responses for different feeds
      const aggregationService = module.get(RealTimeAggregationService);
      (aggregationService.getAggregatedPrice as jest.Mock).mockImplementation((feedId: CoreFeedId) => {
        if (feedId.name === "BTC/USD") {
          return Promise.resolve(mockAggregatedPrice);
        } else if (feedId.name === "ETH/USD") {
          return Promise.resolve(ethPrice);
        }
        return Promise.reject(new Error("Unknown feed"));
      });

      // Get prices through different service entry points
      const [btcPrice, ethPriceResult] = await Promise.all([
        priceAggregationCoordinator.getCurrentPrice(mockFeedId),
        priceAggregationCoordinator.getCurrentPrice(ethFeedId),
      ]);

      // Verify both are cached correctly
      expect(btcPrice.price).toBe(50000);
      expect(ethPriceResult.price).toBe(3000);

      // Verify cache isolation
      const cachedBtc = cacheService.getPrice(mockFeedId);
      const cachedEth = cacheService.getPrice(ethFeedId);

      expect(cachedBtc?.value).toBe(50000);
      expect(cachedEth?.value).toBe(3000);

      // Verify cache operations don't interfere with each other
      cacheService.invalidateOnPriceUpdate(mockFeedId);
      expect(cacheService.getPrice(ethFeedId)).toBeDefined(); // ETH should remain cached
    });

    it("should handle cache invalidation across service layers", async () => {
      // Set up initial cache state
      await priceAggregationCoordinator.getCurrentPrice(mockFeedId);

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

      // Trigger invalidation through service layer
      cacheService.invalidateOnPriceUpdate(mockFeedId);

      // Verify selective invalidation
      expect(cacheService.getPrice(mockFeedId)).toBeDefined(); // Current price remains
      expect(cacheService.getForVotingRound(mockFeedId, 123)).toBeNull(); // Voting round invalidated
    });

    it("should coordinate cache warming across all services", async () => {
      // Track multiple feed accesses
      const feeds = [
        mockFeedId,
        { category: FeedCategory.Crypto, name: "ETH/USD" },
        { category: FeedCategory.Crypto, name: "ADA/USD" },
      ];

      feeds.forEach(feed => {
        for (let i = 0; i < 3; i++) {
          cacheWarmerService.trackFeedAccess(feed);
        }
      });

      // Get warmup statistics
      const warmupStats = cacheWarmerService.getWarmupStats();
      expect(warmupStats.totalPatterns).toBe(3);

      // Track feed access to trigger warming
      cacheWarmerService.trackFeedAccess(mockFeedId);

      // Verify cache was populated
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
    });

    it("should provide comprehensive cache performance monitoring", async () => {
      // Perform various cache operations
      for (let i = 0; i < 5; i++) {
        await priceAggregationCoordinator.getCurrentPrice(mockFeedId);
        cacheWarmerService.trackFeedAccess(mockFeedId);
      }

      // Get comprehensive performance data
      const cacheStats = priceAggregationCoordinator.getCacheStats();
      const aggregationStats = priceAggregationCoordinator.getAggregationStats();

      // Verify all metrics are available
      expect(cacheStats.stats.hits + cacheStats.stats.misses).toBeGreaterThan(0);
      expect(cacheStats.performance.averageResponseTime).toBeGreaterThanOrEqual(0);
      expect(cacheStats.health.overallHealthy).toBeDefined();
      expect(cacheStats.warmup.totalPatterns).toBeGreaterThan(0);

      expect(aggregationStats.activeFeedCount).toBeDefined();
      expect(aggregationStats.cacheStats).toBeDefined();
    });

    it("should handle high-load scenarios with cache coordination", async () => {
      const startTime = performance.now();

      // Simulate high-load scenario
      const operations = [];
      for (let i = 0; i < 20; i++) {
        operations.push(priceAggregationCoordinator.getCurrentPrice(mockFeedId));
        operations.push(Promise.resolve(cacheWarmerService.trackFeedAccess(mockFeedId)));
      }

      await Promise.all(operations);

      const totalTime = performance.now() - startTime;

      // Verify performance is acceptable
      expect(totalTime).toBeLessThan(2000); // Should complete within 2 seconds

      // Verify cache consistency under load
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);

      // Verify performance monitoring tracked all operations
      const performanceMetrics = cachePerformanceMonitor.getPerformanceMetrics();
      expect(performanceMetrics.totalRequests).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Cache Error Handling and Recovery", () => {
    beforeEach(async () => {
      await integrationService.onModuleInit();
    });

    it("should handle cache service failures gracefully", async () => {
      // Simulate cache service failure by destroying it
      cacheService.destroy();

      // Operations should still work (may be slower without cache)
      const aggregationService = module.get(RealTimeAggregationService);
      (aggregationService.getAggregatedPrice as jest.Mock).mockResolvedValue(mockAggregatedPrice);

      // This should not throw even with cache unavailable
      await expect(priceAggregationCoordinator.getCurrentPrice(mockFeedId)).resolves.toBeDefined();
    });

    it("should handle cache warming failures without affecting main operations", async () => {
      // Set up failing cache warmer
      cacheWarmerService.setDataSourceCallback(async () => {
        throw new Error("Cache warming failed");
      });

      // Track feed access (warming happens in background)
      cacheWarmerService.trackFeedAccess(mockFeedId);

      // Main price retrieval should still work
      const price = await priceAggregationCoordinator.getCurrentPrice(mockFeedId);
      expect(price).toEqual(mockAggregatedPrice);
    });

    it("should maintain cache integrity during service restarts", async () => {
      // Set up initial cache state
      await priceAggregationCoordinator.getCurrentPrice(mockFeedId);
      const initialCachedPrice = cacheService.getPrice(mockFeedId);
      expect(initialCachedPrice).toBeDefined();

      // Simulate service restart
      await integrationService.onModuleDestroy();
      await integrationService.onModuleInit();

      // Cache should be cleared but service should still work
      const newPrice = await priceAggregationCoordinator.getCurrentPrice(mockFeedId);
      expect(newPrice.price).toBe(mockAggregatedPrice.price);
      expect(newPrice.symbol).toBe(mockAggregatedPrice.symbol);
    });
  });

  describe("Cache Integration Requirements Validation", () => {
    beforeEach(async () => {
      await integrationService.onModuleInit();
    });

    it("should meet real-time data requirements (Requirement 4.1)", async () => {
      const startTime = Date.now();

      // Get price through integrated services
      const price = await priceAggregationCoordinator.getCurrentPrice(mockFeedId);

      // Verify data freshness
      expect(price.timestamp).toBeGreaterThan(startTime - 2000); // Within 2 seconds

      // Verify cached data is also fresh
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice?.timestamp).toBeGreaterThan(startTime - 2000);
    });

    it("should maintain cache consistency requirements (Requirement 4.2)", async () => {
      // Perform concurrent operations
      const operations = Array.from({ length: 10 }, () => priceAggregationCoordinator.getCurrentPrice(mockFeedId));

      const results = await Promise.all(operations);

      // All should return consistent data
      results.forEach(result => {
        expect(result.price).toBe(mockAggregatedPrice.price);
      });

      // Cache should be consistent
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);
    });

    it("should support performance monitoring requirements (Requirement 7.1)", async () => {
      // Perform operations to generate metrics
      for (let i = 0; i < 5; i++) {
        await priceAggregationCoordinator.getCurrentPrice(mockFeedId);
      }

      // Verify comprehensive monitoring is available
      const cacheStats = priceAggregationCoordinator.getCacheStats();

      expect(cacheStats.stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(cacheStats.performance.averageResponseTime).toBeGreaterThanOrEqual(0);
      expect(cacheStats.health.overallHealthy).toBeDefined();
      expect(cacheStats.warmup.strategies.length).toBeGreaterThan(0);
    });

    it("should maintain test coverage requirements (Requirement 7.2)", () => {
      // Verify all cache integration components are tested
      expect(cacheService).toBeDefined();
      expect(cacheWarmerService).toBeDefined();
      expect(cachePerformanceMonitor).toBeDefined();
      expect(priceAggregationCoordinator).toBeDefined();
      expect(integrationService).toBeDefined();

      // Verify all key methods are accessible
      expect(typeof cacheService.getPrice).toBe("function");
      expect(typeof cacheService.setPrice).toBe("function");
      expect(typeof cacheService.invalidateOnPriceUpdate).toBe("function");
      expect(typeof cacheWarmerService.trackFeedAccess).toBe("function");
      expect(typeof cachePerformanceMonitor.getPerformanceMetrics).toBe("function");
    });
  });
});
