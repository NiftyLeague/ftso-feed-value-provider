import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter } from "events";
import { ProductionIntegrationService } from "../production-integration.service";
import { RealTimeCacheService } from "../../cache/real-time-cache.service";
import { CacheWarmerService } from "../../cache/cache-warmer.service";
import { CachePerformanceMonitorService } from "../../cache/cache-performance-monitor.service";
import { RealTimeAggregationService } from "../../aggregators/real-time-aggregation.service";
import { EnhancedFeedId } from "../../types/enhanced-feed-id.types";
import { FeedCategory } from "../../types/feed-category.enum";
import { AggregatedPrice } from "../../aggregators/base/aggregation.interfaces";
import { PriceUpdate } from "../../interfaces/data-source.interface";

// Mock all the dependencies
jest.mock("../../data-manager/production-data-manager");
jest.mock("../../adapters/base/exchange-adapter.registry");
jest.mock("../../aggregators/consensus-aggregator");
jest.mock("../../monitoring/accuracy-monitor.service");
jest.mock("../../monitoring/performance-monitor.service");
jest.mock("../../monitoring/alerting.service");
jest.mock("../../error-handling/hybrid-error-handler.service");
jest.mock("../../error-handling/circuit-breaker.service");
jest.mock("../../error-handling/connection-recovery.service");
jest.mock("../../config/config.service");
jest.mock("../data-source.factory");

describe("Production Integration Service - Cache Integration", () => {
  let integrationService: ProductionIntegrationService;
  let cacheService: RealTimeCacheService;
  let cacheWarmerService: CacheWarmerService;
  let cachePerformanceMonitor: CachePerformanceMonitorService;
  let aggregationService: RealTimeAggregationService;

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

  const mockPriceUpdate: PriceUpdate = {
    symbol: "BTC/USD",
    price: 50000,
    timestamp: Date.now(),
    source: "binance",
    confidence: 0.95,
  };

  beforeEach(async () => {
    // Create mock aggregation service
    const mockAggregationService = new EventEmitter();
    (mockAggregationService as any).getAggregatedPrice = jest.fn().mockResolvedValue(mockAggregatedPrice);
    (mockAggregationService as any).processPriceUpdate = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealTimeCacheService,
        CacheWarmerService,
        CachePerformanceMonitorService,
        {
          provide: RealTimeAggregationService,
          useValue: mockAggregationService,
        },
        // Mock all other dependencies
        {
          provide: "ProductionDataManagerService",
          useValue: new EventEmitter(),
        },
        {
          provide: "ExchangeAdapterRegistry",
          useValue: {
            updateHealthStatus: jest.fn(),
            getStats: jest.fn().mockReturnValue({}),
          },
        },
        {
          provide: "ConsensusAggregator",
          useValue: {},
        },
        {
          provide: "AccuracyMonitorService",
          useValue: {
            recordPrice: jest.fn(),
          },
        },
        {
          provide: "PerformanceMonitorService",
          useValue: {
            recordPriceUpdate: jest.fn(),
            getCurrentPerformanceMetrics: jest.fn().mockReturnValue({
              responseLatency: 100,
              dataFreshness: 500,
              timestamp: Date.now(),
            }),
            getConnectionSummary: jest.fn().mockReturnValue({
              connectionRate: 0.8,
              connectedExchanges: 4,
              totalExchanges: 5,
            }),
            getErrorStats: jest.fn().mockReturnValue({
              errorRate: 0.1,
              totalErrors: 5,
            }),
            recordMetric: jest.fn(),
          },
        },
        {
          provide: "AlertingService",
          useValue: {
            evaluateMetric: jest.fn(),
          },
        },
        {
          provide: "HybridErrorHandlerService",
          useValue: {},
        },
        {
          provide: "CircuitBreakerService",
          useValue: {},
        },
        {
          provide: "ConnectionRecoveryService",
          useValue: {},
        },
        {
          provide: "ConfigService",
          useValue: {},
        },
        {
          provide: "DataSourceFactory",
          useValue: {},
        },
        // Create ProductionIntegrationService with manual constructor injection
        {
          provide: ProductionIntegrationService,
          useFactory: (
            dataManager: any,
            adapterRegistry: any,
            aggregationService: RealTimeAggregationService,
            consensusAggregator: any,
            cacheService: RealTimeCacheService,
            cacheWarmerService: CacheWarmerService,
            cachePerformanceMonitor: CachePerformanceMonitorService,
            accuracyMonitor: any,
            performanceMonitor: any,
            alertingService: any,
            errorHandler: any,
            circuitBreaker: any,
            connectionRecovery: any,
            configService: any,
            dataSourceFactory: any
          ) => {
            return new ProductionIntegrationService(
              dataManager,
              adapterRegistry,
              aggregationService,
              consensusAggregator,
              cacheService,
              cacheWarmerService,
              cachePerformanceMonitor,
              accuracyMonitor,
              performanceMonitor,
              alertingService,
              errorHandler,
              circuitBreaker,
              connectionRecovery,
              configService,
              dataSourceFactory
            );
          },
          inject: [
            "ProductionDataManagerService",
            "ExchangeAdapterRegistry",
            RealTimeAggregationService,
            "ConsensusAggregator",
            RealTimeCacheService,
            CacheWarmerService,
            CachePerformanceMonitorService,
            "AccuracyMonitorService",
            "PerformanceMonitorService",
            "AlertingService",
            "HybridErrorHandlerService",
            "CircuitBreakerService",
            "ConnectionRecoveryService",
            "ConfigService",
            "DataSourceFactory",
          ],
        },
      ],
    }).compile();

    integrationService = module.get<ProductionIntegrationService>(ProductionIntegrationService);
    cacheService = module.get<RealTimeCacheService>(RealTimeCacheService);
    cacheWarmerService = module.get<CacheWarmerService>(CacheWarmerService);
    cachePerformanceMonitor = module.get<CachePerformanceMonitorService>(CachePerformanceMonitorService);
    aggregationService = module.get<RealTimeAggregationService>(RealTimeAggregationService);

    // Wire the data flow connections for testing
    await (integrationService as any).wireDataFlow();
  });

  afterEach(() => {
    cacheService.destroy();
    cacheWarmerService.destroy();
    cachePerformanceMonitor.destroy();
  });

  describe("Cache Integration with Aggregated Prices", () => {
    it("should cache aggregated prices when aggregated price event is emitted", done => {
      // Set up event listener to verify the event is handled
      integrationService.once("priceReady", (price: AggregatedPrice) => {
        expect(price.symbol).toBe(mockAggregatedPrice.symbol);

        // Verify price was cached
        const cachedPrice = cacheService.getPrice(mockFeedId);
        expect(cachedPrice).toBeDefined();
        expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);
        expect(cachedPrice?.sources).toEqual(mockAggregatedPrice.sources);
        expect(cachedPrice?.confidence).toBe(mockAggregatedPrice.confidence);
        done();
      });

      // Emit aggregated price event from aggregation service
      aggregationService.emit("aggregatedPrice", mockAggregatedPrice);
    });

    it("should invalidate cache on price updates", done => {
      // Cache initial price
      cacheService.setPrice(mockFeedId, {
        value: 49000,
        timestamp: Date.now() - 1000,
        sources: ["old-source"],
        confidence: 0.8,
      });

      // Verify initial cache
      let cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice?.value).toBe(49000);

      // Set up event listener
      integrationService.once("priceReady", (price: AggregatedPrice) => {
        // Verify cache was updated and old entries invalidated
        cachedPrice = cacheService.getPrice(mockFeedId);
        expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);
        done();
      });

      // Emit new aggregated price event
      aggregationService.emit("aggregatedPrice", mockAggregatedPrice);
    });

    it("should track feed access for cache warming", () => {
      // Simulate price update handling
      (integrationService as any).handlePriceUpdate(mockPriceUpdate);

      // Verify feed access was tracked
      const popularFeeds = cacheWarmerService.getPopularFeeds();
      expect(popularFeeds.length).toBeGreaterThan(0);
      expect(popularFeeds[0].feedId.name).toBe(mockFeedId.name);
    });

    it("should record cache performance metrics", () => {
      // Simulate price update handling
      (integrationService as any).handlePriceUpdate(mockPriceUpdate);

      // Get performance metrics
      const metrics = cachePerformanceMonitor.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getCurrentPrice with Cache Integration", () => {
    it("should return cached price when available and fresh", async () => {
      // Set up fresh cached price
      const now = Date.now();
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: now,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      // Mock the integration service as initialized
      (integrationService as any).isInitialized = true;

      // Get current price
      const result = await integrationService.getCurrentPrice(mockFeedId);

      // Verify cached price was returned
      expect(result.price).toBe(mockAggregatedPrice.price);
      expect(result.sources).toEqual(mockAggregatedPrice.sources);

      // Verify aggregation service was not called (cache hit)
      expect(aggregationService.getAggregatedPrice).not.toHaveBeenCalled();
    });

    it("should fetch fresh price when cache is stale", async () => {
      // Set up stale cached price
      const staleTimestamp = Date.now() - 5000; // 5 seconds old
      cacheService.setPrice(mockFeedId, {
        value: 45000,
        timestamp: staleTimestamp,
        sources: ["old-source"],
        confidence: 0.7,
      });

      // Mock the integration service as initialized
      (integrationService as any).isInitialized = true;

      // Get current price
      const result = await integrationService.getCurrentPrice(mockFeedId);

      // Verify fresh price was fetched and returned
      expect(result.price).toBe(mockAggregatedPrice.price);
      expect(aggregationService.getAggregatedPrice).toHaveBeenCalledWith(mockFeedId);

      // Verify new price was cached (the getCurrentPrice method should have cached it)
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);
    });

    it("should track feed access and record performance metrics", async () => {
      // Mock the integration service as initialized
      (integrationService as any).isInitialized = true;

      // Get current price
      await integrationService.getCurrentPrice(mockFeedId);

      // Verify feed access was tracked
      const popularFeeds = cacheWarmerService.getPopularFeeds();
      expect(popularFeeds.length).toBeGreaterThan(0);

      // Verify performance metrics were recorded
      const metrics = cachePerformanceMonitor.getPerformanceMetrics();
      expect(metrics.averageResponseTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Cache Warmer Integration", () => {
    it("should configure cache warmer with data source callback", () => {
      // Verify cache warmer was configured with callback during wireDataFlow
      const spy = jest.spyOn(cacheWarmerService, "setDataSourceCallback");

      // Call wireDataFlow manually (normally called during initialization)
      (integrationService as any).wireDataFlow();

      expect(spy).toHaveBeenCalled();
    });

    it("should warm cache using aggregation service", async () => {
      // Configure cache warmer (simulate wireDataFlow)
      cacheWarmerService.setDataSourceCallback(async (feedId: EnhancedFeedId) => {
        return await aggregationService.getAggregatedPrice(feedId);
      });

      // Warm cache for feed
      await cacheWarmerService.warmFeedCache(mockFeedId);

      // Verify aggregation service was called
      expect(aggregationService.getAggregatedPrice).toHaveBeenCalledWith(mockFeedId);

      // Verify cache was populated
      const cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();
      expect(cachedPrice?.value).toBe(mockAggregatedPrice.price);
    });
  });

  describe("System Health with Cache Metrics", () => {
    it("should include cache metrics in system health", async () => {
      // Mock data manager health
      const mockDataManager = (integrationService as any).dataManager;
      mockDataManager.getConnectionHealth = jest.fn().mockResolvedValue({
        totalSources: 5,
        connectedSources: 4,
        averageLatency: 100,
        failedSources: ["failed-source"],
        healthScore: 80,
      });

      // Add some cache activity
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: Date.now(),
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      cacheService.getPrice(mockFeedId);
      cachePerformanceMonitor.recordResponseTime(10);
      cacheWarmerService.trackFeedAccess(mockFeedId);

      // Get system health
      const health = await integrationService.getSystemHealth();

      // Verify cache metrics are included
      expect(health.cache).toBeDefined();
      expect(health.cache.stats).toBeDefined();
      expect(health.cache.performance).toBeDefined();
      expect(health.cache.health).toBeDefined();
      expect(health.cache.warmup).toBeDefined();

      // Verify cache stats
      expect(health.cache.stats.totalEntries).toBeGreaterThan(0);
      expect(health.cache.stats.hitRate).toBeGreaterThanOrEqual(0);

      // Verify performance metrics
      expect(health.cache.performance.averageResponseTime).toBeGreaterThanOrEqual(0);

      // Verify health check
      expect(health.cache.health.overallHealthy).toBeDefined();

      // Verify warmup stats
      expect(health.cache.warmup.totalTrackedFeeds).toBeGreaterThan(0);
    });
  });

  describe("Cache TTL and Real-time Requirements", () => {
    it("should respect 1-second TTL maximum for real-time data", () => {
      const now = Date.now();

      // Set price (should be capped at 1-second TTL)
      cacheService.setPrice(mockFeedId, {
        value: mockAggregatedPrice.price,
        timestamp: now,
        sources: mockAggregatedPrice.sources,
        confidence: mockAggregatedPrice.confidence,
      });

      // Verify it's cached initially
      let cachedPrice = cacheService.getPrice(mockFeedId);
      expect(cachedPrice).toBeDefined();

      // Wait for TTL to expire
      return new Promise<void>(resolve => {
        setTimeout(() => {
          cachedPrice = cacheService.getPrice(mockFeedId);
          expect(cachedPrice).toBeNull(); // Should be expired
          resolve();
        }, 1100); // Wait slightly more than 1 second
      });
    });

    it("should invalidate cache immediately on new price updates", () => {
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

      return new Promise<void>(resolve => {
        // Set up event listener
        integrationService.once("priceReady", (price: AggregatedPrice) => {
          // Verify old voting round cache was invalidated
          expect(cacheService.getForVotingRound(mockFeedId, 123)).toBeNull();

          // Verify new price is cached
          const newCachedPrice = cacheService.getPrice(mockFeedId);
          expect(newCachedPrice?.value).toBe(mockAggregatedPrice.price);
          resolve();
        });

        // Emit new aggregated price event (which should call invalidateOnPriceUpdate)
        aggregationService.emit("aggregatedPrice", mockAggregatedPrice);
      });
    });
  });
});
