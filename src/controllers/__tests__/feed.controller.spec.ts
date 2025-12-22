import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";
import { FtsoProviderService } from "@/app.service";
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { FeedCategory } from "@/common/types/core";
import { ExchangeId } from "@/common/types/adapters";
import { ENV } from "@/config/environment.constants";
import { MockFactory, TestModuleBuilder, TestDataBuilder, TestHelpers } from "@/__tests__/utils";

import { FeedController } from "../feed.controller";

describe("FeedController - Feed Value Endpoints", () => {
  let controller: FeedController;
  let module: any;
  let providerService: jest.Mocked<FtsoProviderService>;
  let cacheService: jest.Mocked<RealTimeCacheService>;
  let aggregationService: jest.Mocked<RealTimeAggregationService>;
  let apiMonitor: jest.Mocked<ApiMonitorService>;

  const mockFeedId = TestDataBuilder.createCoreFeedId({ category: FeedCategory.Crypto, name: "BTC/USD" });
  const mockVolumeData = { feed: mockFeedId, volumes: [{ exchange: ExchangeId.Binance, volume: 1000000 }] };

  beforeEach(async () => {
    module = await new TestModuleBuilder()
      .addController(FeedController)
      .addCommonMocks()
      .addProvider("FTSO_PROVIDER_SERVICE", {
        getValue: jest.fn(),
        getValues: jest.fn(),
        getVolumes: jest.fn(),
        getPerformanceMetrics: jest.fn(),
        healthCheck: jest.fn(),
      })
      .addProvider(RealTimeCacheService, {
        getPrice: jest.fn(),
        setPrice: jest.fn(),
        getForVotingRound: jest.fn(),
        setForVotingRound: jest.fn(),
        invalidateOnPriceUpdate: jest.fn(),
        getStats: jest.fn(),
      })
      .addProvider(RealTimeAggregationService, {
        getAggregatedPrice: jest.fn(),
        addPriceUpdate: jest.fn(),
        getCacheStats: jest.fn(),
        getActiveFeedCount: jest.fn(),
        getPerformanceMetrics: jest.fn(),
      })
      .addProvider(RateLimiterService, {
        checkRateLimit: jest.fn().mockReturnValue({
          totalHits: 1,
          totalHitsInWindow: 1,
          remainingPoints: 999,
          msBeforeNext: 0,
          isBlocked: false,
        }),
        recordRequest: jest.fn(),
        getConfig: jest.fn().mockReturnValue({ maxRequests: 1000, windowMs: 60000 }),
      })
      .addProvider(RateLimitGuard, {
        canActivate: jest.fn().mockReturnValue(true),
      })
      .addProvider(ApiMonitorService, {
        recordApiRequest: jest.fn(),
        getApiHealthMetrics: jest.fn().mockReturnValue({
          totalRequests: 0,
          requestsPerMinute: 0,
          averageResponseTime: 0,
          errorRate: 0,
          slowRequestRate: 0,
          criticalRequestRate: 0,
          topEndpoints: [],
          recentErrors: [],
        }),
        getAllEndpointStats: jest.fn().mockReturnValue([]),
        getPerformanceMetrics: jest.fn().mockReturnValue({
          requestCount: 0,
          averageResponseTime: 0,
          errorRate: 0,
          throughput: 0,
          responseTimes: [],
        }),
        getErrorAnalysis: jest.fn().mockReturnValue({
          totalErrors: 0,
          errorsByStatusCode: {},
          errorsByEndpoint: {},
          recentErrorTrends: [],
        }),
        getMetricsCount: jest.fn().mockReturnValue(0),
      })

      .addProvider(StandardizedErrorHandlerService, {
        executeWithStandardizedHandling: jest.fn().mockImplementation(operation => operation()),
        handleValidationError: jest.fn(),
        handleAuthenticationError: jest.fn(),
        handleRateLimitError: jest.fn(),
        handleExternalServiceError: jest.fn(),
        getErrorStatistics: jest.fn().mockReturnValue({}),
      })
      .addProvider(UniversalRetryService, {
        executeWithRetry: jest.fn().mockImplementation(operation => operation()),
        executeHttpWithRetry: jest.fn().mockImplementation(operation => operation()),
        executeDatabaseWithRetry: jest.fn().mockImplementation(operation => operation()),
        executeCacheWithRetry: jest.fn().mockImplementation(operation => operation()),
        executeExternalApiWithRetry: jest.fn().mockImplementation(operation => operation()),
        configureRetrySettings: jest.fn(),
        getRetryStatistics: jest.fn().mockReturnValue({}),
      })
      .build();

    controller = TestHelpers.getService(module, FeedController);
    providerService = TestHelpers.getMockedService(module, "FTSO_PROVIDER_SERVICE");
    cacheService = TestHelpers.getMockedService(module, RealTimeCacheService);
    aggregationService = TestHelpers.getMockedService(module, RealTimeAggregationService);
    apiMonitor = TestHelpers.getMockedService(module, ApiMonitorService);

    // Silence controller logs for unit tests
    (controller as any).logger = MockFactory.createLogger();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    if (module) {
      await module.close?.();
    }
  });

  describe("getCurrentFeedValues", () => {
    it("should return current feed values with real-time data", async () => {
      cacheService.getPrice.mockReturnValue(null);

      const mockAggregatedPrice = TestDataBuilder.createAggregatedPrice({
        symbol: "BTC/USD",
        price: 50000,
        sources: [ExchangeId.Binance, ExchangeId.Coinbase],
        confidence: 0.95,
        consensusScore: 0.98,
      });
      aggregationService.getAggregatedPrice.mockResolvedValue(mockAggregatedPrice);

      const request = { feeds: [mockFeedId] };
      const result = await controller.getCurrentFeedValues(request);

      expect(result).toEqual({
        data: [
          {
            feed: mockFeedId,
            value: 50000,
            source: "aggregated",
            timestamp: expect.any(Number),
            confidence: 0.95,
          },
        ],
      });
      expect(cacheService.setPrice).toHaveBeenCalledWith(mockFeedId, {
        value: 50000,
        timestamp: mockAggregatedPrice.timestamp,
        sources: [ExchangeId.Binance, ExchangeId.Coinbase],
        confidence: 0.95,
      });
    });

    it("should use cached data when available and fresh", async () => {
      const cachedEntry = {
        value: 49500,
        timestamp: Date.now() - 1000,
        sources: [ExchangeId.Binance],
        confidence: 0.9,
      };
      cacheService.getPrice.mockReturnValue(cachedEntry);

      const request = { feeds: [mockFeedId] };
      const result = await controller.getCurrentFeedValues(request);

      expect(result).toEqual({
        data: [
          {
            feed: mockFeedId,
            value: 49500,
            source: "cache",
            timestamp: expect.any(Number),
            confidence: 0.9,
          },
        ],
      });
      expect(aggregationService.getAggregatedPrice).not.toHaveBeenCalled();
    });

    it("should validate feed requests and throw error for invalid feeds", async () => {
      const invalidRequest = { feeds: [{ category: 999, name: "" }] };

      await expect(controller.getCurrentFeedValues(invalidRequest)).rejects.toThrow();
    });

    it("should handle empty feed requests", async () => {
      const emptyRequest = { feeds: [] };

      await expect(controller.getCurrentFeedValues(emptyRequest)).rejects.toThrow();
    });
  });

  describe("getFeedValues (historical)", () => {
    it("should return historical feed values for voting round", async () => {
      const votingRoundId = 12345;

      const cachedEntry = {
        value: 48000,
        timestamp: Date.now() - 300000,
        sources: ["historical"],
        confidence: 1.0,
        votingRound: votingRoundId,
      };
      cacheService.getForVotingRound.mockReturnValue(cachedEntry);

      const request = { feeds: [mockFeedId] };
      const result = await controller.getFeedValues(votingRoundId, request);

      expect(result).toEqual({
        votingRoundId,
        data: [{ feed: mockFeedId, value: 48000 }],
      });
      expect(cacheService.getForVotingRound).toHaveBeenCalledWith(mockFeedId, votingRoundId);
    });

    it("should validate voting round ID", async () => {
      const invalidVotingRoundId = -1;
      const request = { feeds: [mockFeedId] };

      await expect(controller.getFeedValues(invalidVotingRoundId, request)).rejects.toThrow();
    });
  });

  describe("getFeedVolumes", () => {
    it("should return volume data with USDT conversion", async () => {
      providerService.getVolumes.mockResolvedValue([mockVolumeData]);

      const request = { feeds: [mockFeedId] };
      const windowSec = 60;
      const result = await controller.getFeedVolumes(request, windowSec);

      expect(result).toEqual({
        data: [mockVolumeData],
        windowSec: 60,
      });
      expect(providerService.getVolumes).toHaveBeenCalledWith([mockFeedId], windowSec);
    });

    it("should validate time window parameters", async () => {
      const request = { feeds: [mockFeedId] };
      const invalidWindow = 0;

      await expect(controller.getFeedVolumes(request, invalidWindow)).rejects.toThrow();
    });
  });

  describe("internal helpers", () => {
    it("getRealTimeFeedValues ignores stale cache and uses aggregated price", async () => {
      await TestHelpers.withMockedNowAsync(1_700_000_000_000, async () => {
        cacheService.getPrice.mockReturnValue({
          value: 123,
          timestamp: Date.now() - ENV.DATA_FRESHNESS.FRESH_DATA_MS - 1,
          sources: [ExchangeId.Binance],
          confidence: 0.5,
        });

        const agg = TestDataBuilder.createAggregatedPrice({
          symbol: "BTC/USD",
          price: 50_000,
          sources: [ExchangeId.Binance],
          confidence: 0.9,
          consensusScore: 0.9,
        });
        aggregationService.getAggregatedPrice.mockResolvedValueOnce(agg);

        const result = await (controller as any).getRealTimeFeedValues([mockFeedId]);

        expect(result).toEqual([
          expect.objectContaining({
            feed: mockFeedId,
            value: 50_000,
            source: "aggregated",
            timestamp: agg.timestamp,
            confidence: 0.9,
          }),
        ]);

        expect(aggregationService.getAggregatedPrice).toHaveBeenCalledWith(mockFeedId);
      });
    });

    it("getRealTimeFeedValues returns fallback data when aggregation returns null", async () => {
      await TestHelpers.withMockedNowAsync(1_700_000_000_000, async () => {
        cacheService.getPrice.mockReturnValue(null);
        aggregationService.getAggregatedPrice.mockResolvedValueOnce(null as any);
        providerService.getValue.mockResolvedValueOnce({ feed: mockFeedId, value: 49_000 } as any);

        const result = await (controller as any).getRealTimeFeedValues([mockFeedId]);

        expect(result).toEqual([
          expect.objectContaining({
            feed: mockFeedId,
            value: 49_000,
            source: "fallback",
            timestamp: 1_700_000_000_000,
            confidence: 0.8,
          }),
        ]);
      });
    });

    it("getRealTimeFeedValues logs debug on temporary data unavailability and returns fallback_error data", async () => {
      await TestHelpers.withMockedNowAsync(1_700_000_000_000, async () => {
        cacheService.getPrice.mockReturnValue(null);
        aggregationService.getAggregatedPrice.mockRejectedValueOnce(new Error("No price data available yet"));
        providerService.getValue.mockResolvedValueOnce({ feed: mockFeedId, value: 48_000 } as any);

        const debugSpy = (controller as any).logger.debug as jest.Mock;
        const warnSpy = (controller as any).logger.warn as jest.Mock;

        const result = await (controller as any).getRealTimeFeedValues([mockFeedId]);

        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Price data temporarily unavailable"));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Used fallback service for failed feed"));
        expect(result).toEqual([
          expect.objectContaining({
            feed: mockFeedId,
            value: 48_000,
            source: "fallback_error",
            timestamp: 1_700_000_000_000,
            confidence: 0.6,
          }),
        ]);
      });
    });

    it("getRealTimeFeedValues logs error on unexpected aggregation failure and returns missing value when fallback returns null", async () => {
      cacheService.getPrice.mockReturnValue(null);
      aggregationService.getAggregatedPrice.mockRejectedValueOnce(new Error("boom"));
      providerService.getValue.mockResolvedValueOnce(null as any);

      const errorSpy = (controller as any).logger.error as jest.Mock;
      const debugSpy = (controller as any).logger.debug as jest.Mock;
      const warnSpy = (controller as any).logger.warn as jest.Mock;

      const result = await (controller as any).getRealTimeFeedValues([mockFeedId]);

      expect(debugSpy).not.toHaveBeenCalledWith(expect.stringContaining("temporarily unavailable"));
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error getting real-time value"),
        expect.anything()
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Used fallback service for failed feed"));
      expect(result).toEqual([{ feed: mockFeedId }]);
    });

    it("getRealTimeFeedValues debug-logs when fallback is also unavailable", async () => {
      cacheService.getPrice.mockReturnValue(null);
      aggregationService.getAggregatedPrice.mockRejectedValueOnce(new Error("boom"));
      providerService.getValue.mockRejectedValueOnce(new Error("data not yet available"));

      const debugSpy = (controller as any).logger.debug as jest.Mock;

      const result = await (controller as any).getRealTimeFeedValues([mockFeedId]);

      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Fallback data unavailable"));
      expect(result).toEqual([{ feed: mockFeedId }]);
    });

    it("getRealTimeFeedValues warn-logs when fallback fails with a non-data error", async () => {
      cacheService.getPrice.mockReturnValue(null);
      aggregationService.getAggregatedPrice.mockRejectedValueOnce(new Error("boom"));
      providerService.getValue.mockRejectedValueOnce(new Error("socket hang up"));

      const warnSpy = (controller as any).logger.warn as jest.Mock;

      const result = await (controller as any).getRealTimeFeedValues([mockFeedId]);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Fallback also failed"), expect.anything());
      expect(result).toEqual([{ feed: mockFeedId }]);
    });

    it("getRealTimeFeedValues logs debug for partial missing values and rate-limits by key", async () => {
      const ethFeedId = TestDataBuilder.createCoreFeedId({ category: FeedCategory.Crypto, name: "ETH/USD" });
      (controller as any).missingValuesWarningLastLogged = new Map();
      cacheService.getPrice.mockReturnValue(null);

      aggregationService.getAggregatedPrice
        .mockResolvedValueOnce(
          TestDataBuilder.createAggregatedPrice({
            symbol: "BTC/USD",
            price: 50000,
            sources: [ExchangeId.Binance],
            confidence: 0.9,
            consensusScore: 0.9,
          })
        )
        .mockResolvedValueOnce(null as any);

      providerService.getValue.mockResolvedValueOnce(null as any);

      const debugSpy = jest.spyOn((controller as any).logger, "debug");
      const warnSpy = jest.spyOn((controller as any).logger, "warn");

      await TestHelpers.withMockedNowAsync(1_700_000_000_000, async () => {
        const result = await (controller as any).getRealTimeFeedValues([mockFeedId, ethFeedId]);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual(expect.objectContaining({ feed: mockFeedId, value: 50000 }));
        expect(result[1]).toEqual({ feed: ethFeedId });

        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining("feeds returned without values"),
          expect.anything()
        );
        expect(debugSpy).toHaveBeenCalledWith(
          expect.stringContaining("1 out of 2 feeds returned without values"),
          expect.objectContaining({ missingFeeds: ["ETH/USD"] })
        );
      });
    });

    it("getRealTimeFeedValues warns when all feeds are missing values, then debug-logs inside cooldown", async () => {
      const ethFeedId = TestDataBuilder.createCoreFeedId({ category: FeedCategory.Crypto, name: "ETH/USD" });
      (controller as any).missingValuesWarningLastLogged = new Map();
      cacheService.getPrice.mockReturnValue(null);

      aggregationService.getAggregatedPrice.mockResolvedValue(null as any);
      providerService.getValue.mockResolvedValue(null as any);

      const debugSpy = jest.spyOn((controller as any).logger, "debug");
      const warnSpy = jest.spyOn((controller as any).logger, "warn");

      let now = 1_700_000_000_000;

      await TestHelpers.withMockedNowAsync(
        () => now,
        async () => {
          await (controller as any).getRealTimeFeedValues([mockFeedId, ethFeedId]);
          expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("2 out of 2 feeds returned without values"),
            expect.objectContaining({ missingFeeds: expect.arrayContaining(["BTC/USD", "ETH/USD"]) })
          );

          warnSpy.mockClear();

          // Within cooldown -> debug log instead of warn
          now += 1;
          await (controller as any).getRealTimeFeedValues([mockFeedId, ethFeedId]);
          expect(warnSpy).not.toHaveBeenCalled();
          expect(debugSpy).toHaveBeenCalledWith(
            expect.stringContaining("2 out of 2 feeds returned without values"),
            expect.objectContaining({ missingFeeds: expect.arrayContaining(["BTC/USD", "ETH/USD"]) })
          );
        }
      );
    });

    it("combineHistoricalResults returns cached results when no missing feeds", () => {
      const allFeeds = [mockFeedId];
      const cachedResults = [{ feed: mockFeedId, value: 123 }];

      const result = (controller as any).combineHistoricalResults(allFeeds, cachedResults, [], []);

      expect(result).toEqual([{ feed: mockFeedId, value: 123 }]);
      expect((controller as any).logger.warn).not.toHaveBeenCalled();
    });

    it("combineHistoricalResults warns when missing feeds exist but fresh data is empty", () => {
      const anotherFeed = TestDataBuilder.createCoreFeedId({ category: FeedCategory.Crypto, name: "ETH/USD" });
      const allFeeds = [mockFeedId, anotherFeed];
      const cachedResults = [{ feed: mockFeedId, value: 123 }, { feed: anotherFeed }];
      const missingFeeds = [anotherFeed];

      const result = (controller as any).combineHistoricalResults(allFeeds, cachedResults, missingFeeds, []);

      expect(result).toHaveLength(2);
      expect((controller as any).logger.warn).toHaveBeenCalled();
    });

    it("combineHistoricalResults warns when some missing feeds remain unresolved", () => {
      const eth = TestDataBuilder.createCoreFeedId({ category: FeedCategory.Crypto, name: "ETH/USD" });
      const sol = TestDataBuilder.createCoreFeedId({ category: FeedCategory.Crypto, name: "SOL/USD" });

      const allFeeds = [mockFeedId, eth, sol];
      const cachedResults = [{ feed: mockFeedId, value: 123 }, { feed: eth }, { feed: sol }];
      const missingFeeds = [eth, sol];
      const freshData = [{ feed: eth, value: 999 }];

      const result = (controller as any).combineHistoricalResults(allFeeds, cachedResults, missingFeeds, freshData);

      expect(result[1]).toEqual({ feed: eth, value: 999 });
      expect(result[2]).toEqual({ feed: sol });
      expect((controller as any).logger.warn).toHaveBeenCalled();
    });

    it("cacheHistoricalData caches only entries with feed and value", async () => {
      const votingRoundId = 123;
      await (controller as any).cacheHistoricalData(
        [{ feed: mockFeedId, value: 123 }, { feed: mockFeedId }, {} as any],
        votingRoundId
      );

      expect(cacheService.setForVotingRound).toHaveBeenCalledTimes(1);
      expect(cacheService.setForVotingRound).toHaveBeenCalledWith(
        mockFeedId,
        votingRoundId,
        expect.objectContaining({
          value: 123,
          sources: ["historical"],
          confidence: 1.0,
          votingRound: votingRoundId,
        }),
        expect.any(Number)
      );
    });

    it("getOptimizedVolumes rejects invalid feeds input", async () => {
      await expect((controller as any).getOptimizedVolumes(null, 60)).rejects.toThrow();
    });

    it("getOptimizedVolumes rejects empty feeds array", async () => {
      await expect((controller as any).getOptimizedVolumes([], 60)).rejects.toThrow();
    });

    it("getOptimizedVolumes returns empty volumes when provider returns no data", async () => {
      providerService.getVolumes.mockResolvedValue([]);

      const result = await (controller as any).getOptimizedVolumes([mockFeedId], 60);

      expect(result).toEqual([{ feed: mockFeedId, volumes: [] }]);
    });

    it("getOptimizedVolumes warns on feed count mismatch", async () => {
      providerService.getVolumes.mockResolvedValue([mockVolumeData] as any);
      const extraFeed = TestDataBuilder.createCoreFeedId({ category: FeedCategory.Crypto, name: "ETH/USD" });

      const result = await (controller as any).getOptimizedVolumes([mockFeedId, extraFeed], 60);

      expect(result).toEqual([mockVolumeData]);
      expect((controller as any).logger.warn).toHaveBeenCalled();
    });

    it("getOptimizedVolumes rethrows HttpExceptions from provider", async () => {
      const httpError = new (require("@nestjs/common").HttpException)("bad", 400);
      providerService.getVolumes.mockRejectedValue(httpError);

      await expect((controller as any).getOptimizedVolumes([mockFeedId], 60)).rejects.toBe(httpError);
    });

    it("getOptimizedVolumes wraps unknown errors", async () => {
      providerService.getVolumes.mockRejectedValue(new Error("boom"));

      await expect((controller as any).getOptimizedVolumes([mockFeedId], 60)).rejects.toThrow(
        "Failed to fetch volume data"
      );
    });

    it("isFreshData uses configured freshness threshold", () => {
      const now = Date.now();
      expect((controller as any).isFreshData(now)).toBe(true);
      expect((controller as any).isFreshData(now - ENV.DATA_FRESHNESS.FRESH_DATA_MS - 1)).toBe(false);
    });

    it("logApiResponse records metrics with errorRate depending on statusCode", () => {
      (controller as any).logApiResponse("GET", "/feed-values", 200, 10, 100, "req-1");
      expect(apiMonitor.recordApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: "/feed-values", statusCode: 200, errorRate: 0 })
      );

      (controller as any).logApiResponse("GET", "/feed-values", 500, 10, 100, "req-2", "err");
      expect(apiMonitor.recordApiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: "/feed-values", statusCode: 500, errorRate: 100, error: "err" })
      );
    });
  });
});
