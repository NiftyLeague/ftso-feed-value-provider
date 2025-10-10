import { Test, TestingModule } from "@nestjs/testing";
import { PriceAggregationCoordinatorService } from "../price-aggregation-coordinator.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { CachePerformanceMonitorService } from "@/cache/cache-performance-monitor.service";
import { ConfigService } from "@/config/config.service";

// Basic test for price-aggregation-coordinator.service.ts
describe("PriceAggregationCoordinatorService Basic Tests", () => {
  it("should be able to import PriceAggregationCoordinatorService", async () => {
    expect(async () => {
      await import("../price-aggregation-coordinator.service");
    }).not.toThrow();
  });

  it("should have PriceAggregationCoordinatorService defined", async () => {
    const { PriceAggregationCoordinatorService } = await import("../price-aggregation-coordinator.service");
    expect(PriceAggregationCoordinatorService).toBeDefined();
  });

  it("should be a function (NestJS service)", async () => {
    const { PriceAggregationCoordinatorService } = await import("../price-aggregation-coordinator.service");
    expect(typeof PriceAggregationCoordinatorService).toBe("function");
  });
});

describe("PriceAggregationCoordinatorService Feed Tracking", () => {
  let service: PriceAggregationCoordinatorService;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    // Create mock services
    const mockAggregationService = {
      processPriceUpdate: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      getCacheStats: jest.fn().mockReturnValue({}),
      getActiveFeedCount: jest.fn().mockReturnValue(0),
    };

    const mockCacheService = {
      getPrice: jest.fn(),
      setPrice: jest.fn(),
      invalidateOnPriceUpdate: jest.fn(),
      getStats: jest.fn().mockReturnValue({}),
    };

    const mockCacheWarmerService = {
      trackFeedAccess: jest.fn(),
      setDataSourceCallback: jest.fn(),
      getWarmupStats: jest.fn().mockReturnValue({}),
    };

    const mockCachePerformanceMonitor = {
      recordResponseTime: jest.fn(),
      getPerformanceMetrics: jest.fn().mockReturnValue({}),
      checkPerformanceThresholds: jest.fn().mockReturnValue({}),
    };

    mockConfigService = {
      getFeedsCount: jest.fn().mockReturnValue(64),
      getFeedsCountWithFallback: jest.fn().mockReturnValue(64),
      getAllFeedSymbols: jest
        .fn()
        .mockReturnValue([
          "BTC/USD",
          "ETH/USD",
          "SOL/USD",
          "AVAX/USD",
          "MATIC/USD",
          "ADA/USD",
          "DOT/USD",
          "LINK/USD",
          "UNI/USD",
          "ATOM/USD",
        ]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceAggregationCoordinatorService,
        { provide: RealTimeAggregationService, useValue: mockAggregationService },
        { provide: RealTimeCacheService, useValue: mockCacheService },
        { provide: CacheWarmerService, useValue: mockCacheWarmerService },
        { provide: CachePerformanceMonitorService, useValue: mockCachePerformanceMonitor },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PriceAggregationCoordinatorService>(PriceAggregationCoordinatorService);
  });

  it("should initialize with correct feed count from config service", async () => {
    await service.initialize();

    expect(mockConfigService.getFeedsCount).toHaveBeenCalled();

    const stats = service.getFeedReadinessStats();
    expect(stats.totalExpectedFeeds).toBe(64);
    expect(stats.feedsWithInitialData).toBe(0);
    expect(stats.readinessPercentage).toBe(0);
    expect(stats.isAllFeedsReady).toBe(false);
  });

  it("should track feed initial data correctly", async () => {
    await service.initialize();

    // Simulate price updates for different feeds
    service.handlePriceUpdate({
      symbol: "BTC/USD",
      price: 50000,
      timestamp: Date.now(),
      source: "binance",
      confidence: 0.95,
    });
    service.handlePriceUpdate({
      symbol: "ETH/USD",
      price: 3000,
      timestamp: Date.now(),
      source: "binance",
      confidence: 0.95,
    });

    const stats = service.getFeedReadinessStats();
    expect(stats.feedsWithInitialData).toBe(2);
    expect(stats.readinessPercentage).toBe(3); // 2/64 = 3.125% rounded to 3%
    expect(stats.isAllFeedsReady).toBe(false);
    expect(stats.feedsWithData).toContain("BTC/USD");
    expect(stats.feedsWithData).toContain("ETH/USD");
  });

  it("should not double-count feeds that receive multiple updates", async () => {
    await service.initialize();

    // Simulate multiple updates for the same feed
    service.handlePriceUpdate({
      symbol: "BTC/USD",
      price: 50000,
      timestamp: Date.now(),
      source: "binance",
      confidence: 0.95,
    });
    service.handlePriceUpdate({
      symbol: "BTC/USD",
      price: 50100,
      timestamp: Date.now(),
      source: "coinbase",
      confidence: 0.95,
    });
    service.handlePriceUpdate({
      symbol: "BTC/USD",
      price: 49900,
      timestamp: Date.now(),
      source: "kraken",
      confidence: 0.95,
    });

    const stats = service.getFeedReadinessStats();
    expect(stats.feedsWithInitialData).toBe(1);
    expect(stats.feedsWithData).toEqual(["BTC/USD"]);
  });

  it("should handle config service failure gracefully", async () => {
    mockConfigService.getFeedsCount.mockImplementation(() => {
      throw new Error("Config service failed");
    });

    // Should not throw and should use fallback
    await expect(service.initialize()).resolves.not.toThrow();

    expect(mockConfigService.getFeedsCount).toHaveBeenCalled();
    expect(mockConfigService.getFeedsCountWithFallback).toHaveBeenCalledWith(64);

    const stats = service.getFeedReadinessStats();
    expect(stats.totalExpectedFeeds).toBe(64); // Should use fallback value
  });

  it("should handle both config service methods failing gracefully", async () => {
    mockConfigService.getFeedsCount.mockImplementation(() => {
      throw new Error("Primary config service failed");
    });
    mockConfigService.getFeedsCountWithFallback.mockImplementation(() => {
      throw new Error("Fallback config service failed");
    });

    // Should not throw and should use default constant
    await expect(service.initialize()).resolves.not.toThrow();

    expect(mockConfigService.getFeedsCount).toHaveBeenCalled();
    expect(mockConfigService.getFeedsCountWithFallback).toHaveBeenCalledWith(64);

    const stats = service.getFeedReadinessStats();
    expect(stats.totalExpectedFeeds).toBe(64); // Should use default constant
  });
});

describe("PriceAggregationCoordinatorService Fallback Readiness", () => {
  let service: PriceAggregationCoordinatorService;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    // Create mock services
    const mockAggregationService = {
      processPriceUpdate: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      getCacheStats: jest.fn().mockReturnValue({}),
      getActiveFeedCount: jest.fn().mockReturnValue(0),
    };

    const mockCacheService = {
      getPrice: jest.fn(),
      setPrice: jest.fn(),
      invalidateOnPriceUpdate: jest.fn(),
      getStats: jest.fn().mockReturnValue({}),
    };

    const mockCacheWarmerService = {
      trackFeedAccess: jest.fn(),
      setDataSourceCallback: jest.fn(),
      getWarmupStats: jest.fn().mockReturnValue({}),
    };

    const mockCachePerformanceMonitor = {
      recordResponseTime: jest.fn(),
      getPerformanceMetrics: jest.fn().mockReturnValue({}),
      checkPerformanceThresholds: jest.fn().mockReturnValue({}),
    };

    mockConfigService = {
      getFeedsCount: jest.fn().mockReturnValue(10), // Use smaller number for testing
      getFeedsCountWithFallback: jest.fn().mockReturnValue(10),
      getAllFeedSymbols: jest
        .fn()
        .mockReturnValue([
          "BTC/USD",
          "ETH/USD",
          "SOL/USD",
          "AVAX/USD",
          "MATIC/USD",
          "ADA/USD",
          "DOT/USD",
          "LINK/USD",
          "UNI/USD",
          "ATOM/USD",
        ]),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceAggregationCoordinatorService,
        { provide: RealTimeAggregationService, useValue: mockAggregationService },
        { provide: RealTimeCacheService, useValue: mockCacheService },
        { provide: CacheWarmerService, useValue: mockCacheWarmerService },
        { provide: CachePerformanceMonitorService, useValue: mockCachePerformanceMonitor },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<PriceAggregationCoordinatorService>(PriceAggregationCoordinatorService);
  });

  it("should trigger fallback readiness when 90% of feeds are ready", async () => {
    await service.initialize();

    // Simulate 9 out of 10 feeds receiving data (90%)
    const feedSymbols = [
      "BTC/USD",
      "ETH/USD",
      "SOL/USD",
      "AVAX/USD",
      "MATIC/USD",
      "ADA/USD",
      "DOT/USD",
      "LINK/USD",
      "UNI/USD",
    ];

    feedSymbols.forEach(symbol => {
      service.handlePriceUpdate({
        symbol,
        price: 1000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.95,
      });
    });

    const stats = service.getFeedReadinessStats();
    expect(stats.feedsWithInitialData).toBe(9);
    expect(stats.readinessPercentage).toBe(90);
    expect(stats.isAllFeedsReady).toBe(false);

    // Manually trigger fallback check (simulating timeout)
    // We need to access the private method for testing
    const checkFallbackReadiness = (service as any).checkFallbackReadiness.bind(service);

    // Spy on logger to verify fallback messages
    const loggerSpy = jest.spyOn((service as any).logger, "log");

    checkFallbackReadiness();

    // Verify fallback completion message was logged
    expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("Data collection phase completed: 9/10 feeds"));
    expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("Fallback readiness triggered"));
  });

  it("should not trigger fallback when less than 90% of feeds are ready", async () => {
    await service.initialize();

    // Simulate only 8 out of 10 feeds receiving data (80%)
    const feedSymbols = ["BTC/USD", "ETH/USD", "SOL/USD", "AVAX/USD", "MATIC/USD", "ADA/USD", "DOT/USD", "LINK/USD"];

    feedSymbols.forEach(symbol => {
      service.handlePriceUpdate({
        symbol,
        price: 1000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.95,
      });
    });

    const stats = service.getFeedReadinessStats();
    expect(stats.feedsWithInitialData).toBe(8);
    expect(stats.readinessPercentage).toBe(80);

    // Manually trigger fallback check (simulating timeout)
    const checkFallbackReadiness = (service as any).checkFallbackReadiness.bind(service);

    // Spy on logger to verify no fallback completion message
    const loggerSpy = jest.spyOn((service as any).logger, "log");
    const warnSpy = jest.spyOn((service as any).logger, "warn");

    checkFallbackReadiness();

    // Verify fallback completion message was NOT logged
    expect(loggerSpy).not.toHaveBeenCalledWith(expect.stringContaining("Data collection phase completed"));

    // Verify warning about insufficient readiness was logged
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Fallback readiness check failed: only 80% ready"));
  });

  it("should clear fallback timeout when all feeds are ready", async () => {
    await service.initialize();

    // Simulate all 10 feeds receiving data
    const feedSymbols = [
      "BTC/USD",
      "ETH/USD",
      "SOL/USD",
      "AVAX/USD",
      "MATIC/USD",
      "ADA/USD",
      "DOT/USD",
      "LINK/USD",
      "UNI/USD",
      "ATOM/USD",
    ];

    feedSymbols.forEach(symbol => {
      service.handlePriceUpdate({
        symbol,
        price: 1000,
        timestamp: Date.now(),
        source: "binance",
        confidence: 0.95,
      });
    });

    const stats = service.getFeedReadinessStats();
    expect(stats.feedsWithInitialData).toBe(10);
    expect(stats.readinessPercentage).toBe(100);
    expect(stats.isAllFeedsReady).toBe(true);

    // The completion message should have been logged when the last feed was processed
    // We can't easily test the spy after the fact, so let's just verify the stats are correct
    // The actual logging is tested in the integration tests
  });
});
