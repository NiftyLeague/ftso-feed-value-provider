import { ApiErrorHandlerService } from "@/error-handling/api-error-handler.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";
import { FtsoProviderService } from "@/app.service";
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { FeedCategory } from "@/common/types/core";
import { TestModuleBuilder, TestDataBuilder, TestHelpers } from "@/__tests__/utils";

import { FeedController } from "../feed.controller";

describe("FeedController - Feed Value Endpoints", () => {
  let controller: FeedController;
  let providerService: jest.Mocked<FtsoProviderService>;
  let cacheService: jest.Mocked<RealTimeCacheService>;
  let aggregationService: jest.Mocked<RealTimeAggregationService>;

  const mockFeedId = TestDataBuilder.createFeedId({ category: FeedCategory.Crypto, name: "BTC/USD" });
  const mockVolumeData = { feed: mockFeedId, volumes: [{ exchange: "binance", volume: 1000000 }] };

  beforeEach(async () => {
    const module = await new TestModuleBuilder()
      .addController(FeedController)
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
      .addProvider(ApiErrorHandlerService)
      .build();

    controller = TestHelpers.getService(module, FeedController);
    providerService = TestHelpers.getMockedService(module, "FTSO_PROVIDER_SERVICE");
    cacheService = TestHelpers.getMockedService(module, RealTimeCacheService);
    aggregationService = TestHelpers.getMockedService(module, RealTimeAggregationService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getCurrentFeedValues", () => {
    it("should return current feed values with real-time data", async () => {
      cacheService.getPrice.mockReturnValue(null);

      const mockAggregatedPrice = TestDataBuilder.createAggregatedPrice({
        symbol: "BTC/USD",
        price: 50000,
        sources: ["binance", "coinbase"],
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
        sources: ["binance", "coinbase"],
        confidence: 0.95,
      });
    });

    it("should use cached data when available and fresh", async () => {
      const cachedEntry = {
        value: 49500,
        timestamp: Date.now() - 1000,
        sources: ["binance"],
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
      });
      expect(providerService.getVolumes).toHaveBeenCalledWith([mockFeedId], windowSec);
    });

    it("should validate time window parameters", async () => {
      const request = { feeds: [mockFeedId] };
      const invalidWindow = 0;

      await expect(controller.getFeedVolumes(request, invalidWindow)).rejects.toThrow();
    });
  });
});
