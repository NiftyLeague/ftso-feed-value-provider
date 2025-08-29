import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { FtsoProviderController } from "./app.controller";
import { FtsoProviderService } from "./app.service";
import { RealTimeCacheService } from "./cache/real-time-cache.service";
import { RealTimeAggregationService } from "./aggregators/real-time-aggregation.service";
import { ApiErrorHandlerService } from "./error-handling/api-error-handler.service";
import { RateLimitGuard } from "./guards/rate-limit.guard";
import { RateLimiterService } from "./middleware/rate-limiter.service";
import { FeedCategory } from "./types/feed-category.enum";

describe("FtsoProviderController - Production API Endpoints", () => {
  let controller: FtsoProviderController;
  let providerService: jest.Mocked<FtsoProviderService>;
  let cacheService: jest.Mocked<RealTimeCacheService>;
  let aggregationService: jest.Mocked<RealTimeAggregationService>;
  let errorHandler: ApiErrorHandlerService;

  const mockFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
  const mockFeedValue = { feed: mockFeedId, value: 50000 };
  const mockVolumeData = { feed: mockFeedId, volumes: [{ exchange: "binance", volume: 1000000 }] };

  beforeEach(async () => {
    const mockProviderService = {
      getValue: jest.fn(),
      getValues: jest.fn(),
      getVolumes: jest.fn(),
      getPerformanceMetrics: jest.fn(),
      healthCheck: jest.fn(),
    };

    const mockCacheService = {
      getPrice: jest.fn(),
      setPrice: jest.fn(),
      getForVotingRound: jest.fn(),
      setForVotingRound: jest.fn(),
      invalidateOnPriceUpdate: jest.fn(),
      getStats: jest.fn(),
    };

    const mockAggregationService = {
      getAggregatedPrice: jest.fn(),
      addPriceUpdate: jest.fn(),
      getCacheStats: jest.fn(),
      getActiveFeedCount: jest.fn(),
      getPerformanceMetrics: jest.fn(),
    };

    const mockRateLimiterService = {
      checkRateLimit: jest.fn().mockReturnValue({
        totalHits: 1,
        totalHitsInWindow: 1,
        remainingPoints: 999,
        msBeforeNext: 0,
        isBlocked: false,
      }),
      recordRequest: jest.fn(),
      getConfig: jest.fn().mockReturnValue({ maxRequests: 1000, windowMs: 60000 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FtsoProviderController],
      providers: [
        {
          provide: "FTSO_PROVIDER_SERVICE",
          useValue: mockProviderService,
        },
        {
          provide: RealTimeCacheService,
          useValue: mockCacheService,
        },
        {
          provide: RealTimeAggregationService,
          useValue: mockAggregationService,
        },
        {
          provide: ApiErrorHandlerService,
          useClass: ApiErrorHandlerService,
        },
        {
          provide: RateLimitGuard,
          useValue: {
            canActivate: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: RateLimiterService,
          useValue: mockRateLimiterService,
        },
      ],
    }).compile();

    controller = module.get<FtsoProviderController>(FtsoProviderController);
    providerService = module.get("FTSO_PROVIDER_SERVICE");
    cacheService = module.get(RealTimeCacheService);
    aggregationService = module.get(RealTimeAggregationService);
    errorHandler = module.get(ApiErrorHandlerService);
  });

  afterEach(() => {
    // Restore console methods after each test
    jest.restoreAllMocks();
  });

  describe("getCurrentFeedValues", () => {
    it("should return current feed values with real-time data", async () => {
      // Mock cache miss to force real-time aggregation
      cacheService.getPrice.mockReturnValue(null);

      // Mock aggregated price
      const mockAggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance", "coinbase"],
        confidence: 0.95,
        consensusScore: 0.98,
      };
      aggregationService.getAggregatedPrice.mockResolvedValue(mockAggregatedPrice);

      const request = { feeds: [mockFeedId] };
      const result = await controller.getCurrentFeedValues(request);

      expect(result).toEqual({
        data: [{ feed: mockFeedId, value: 50000 }],
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
        timestamp: Date.now() - 1000, // 1 second old (fresh)
        sources: ["binance"],
        confidence: 0.9,
      };
      cacheService.getPrice.mockReturnValue(cachedEntry);

      const request = { feeds: [mockFeedId] };
      const result = await controller.getCurrentFeedValues(request);

      expect(result).toEqual({
        data: [{ feed: mockFeedId, value: 49500 }],
      });
      expect(aggregationService.getAggregatedPrice).not.toHaveBeenCalled();
    });

    it("should fallback to provider service when aggregation fails", async () => {
      cacheService.getPrice.mockReturnValue(null);
      aggregationService.getAggregatedPrice.mockResolvedValue(null);
      providerService.getValue.mockResolvedValue(mockFeedValue);

      const request = { feeds: [mockFeedId] };
      const result = await controller.getCurrentFeedValues(request);

      expect(result).toEqual({
        data: [mockFeedValue],
      });
      expect(providerService.getValue).toHaveBeenCalledWith(mockFeedId);
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

      // Mock cached historical data
      const cachedEntry = {
        value: 48000,
        timestamp: Date.now() - 300000, // 5 minutes old
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

    it("should fetch fresh data when historical cache miss", async () => {
      const votingRoundId = 12345;
      cacheService.getForVotingRound.mockReturnValue(null);
      providerService.getValues.mockResolvedValue([mockFeedValue]);

      const request = { feeds: [mockFeedId] };
      const result = await controller.getFeedValues(votingRoundId, request);

      expect(result).toEqual({
        votingRoundId,
        data: [mockFeedValue],
      });
      expect(providerService.getValues).toHaveBeenCalledWith([mockFeedId]);
      expect(cacheService.setForVotingRound).toHaveBeenCalled();
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

    it("should validate maximum time window", async () => {
      const request = { feeds: [mockFeedId] };
      const tooLargeWindow = 3601; // Over 1 hour

      await expect(controller.getFeedVolumes(request, tooLargeWindow)).rejects.toThrow();
    });
  });

  describe("Performance Requirements", () => {
    it("should complete current feed values request within 100ms", async () => {
      const cachedEntry = {
        value: 50000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.9,
      };
      cacheService.getPrice.mockReturnValue(cachedEntry);

      const request = { feeds: [mockFeedId] };
      const startTime = performance.now();

      await controller.getCurrentFeedValues(request);

      const responseTime = performance.now() - startTime;
      expect(responseTime).toBeLessThan(100);
    });

    it("should handle multiple feeds efficiently", async () => {
      const multipleFeeds = [
        { category: FeedCategory.Crypto, name: "BTC/USD" },
        { category: FeedCategory.Crypto, name: "ETH/USD" },
        { category: FeedCategory.Crypto, name: "ADA/USD" },
      ];

      // Mock cached data for all feeds
      cacheService.getPrice.mockReturnValue({
        value: 1000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.9,
      });

      const request = { feeds: multipleFeeds };
      const startTime = performance.now();

      const result = await controller.getCurrentFeedValues(request);

      const responseTime = performance.now() - startTime;
      expect(responseTime).toBeLessThan(100);
      expect(result.data).toHaveLength(3);
    });
  });

  describe("Error Handling", () => {
    it("should handle provider service errors gracefully", async () => {
      cacheService.getPrice.mockReturnValue(null);
      aggregationService.getAggregatedPrice.mockResolvedValue(null);
      providerService.getValue.mockRejectedValue(new Error("Provider service error"));

      const request = { feeds: [mockFeedId] };

      await expect(controller.getCurrentFeedValues(request)).rejects.toThrow();
    });

    it("should handle cache service errors gracefully", async () => {
      // Reset mocks for this test
      cacheService.getPrice.mockReset();
      aggregationService.getAggregatedPrice.mockReset();
      providerService.getValue.mockReset();

      cacheService.getPrice.mockImplementation(() => {
        throw new Error("Cache error");
      });

      // Should fallback to aggregation service
      const mockAggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.95,
        consensusScore: 0.98,
      };
      aggregationService.getAggregatedPrice.mockResolvedValue(mockAggregatedPrice);

      // Mock provider service as final fallback
      providerService.getValue.mockResolvedValue({
        feed: mockFeedId,
        value: 50000,
      });

      const request = { feeds: [mockFeedId] };
      const result = await controller.getCurrentFeedValues(request);

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        feed: mockFeedId,
        value: 50000,
      });
    });

    it("should return proper error codes for invalid requests", async () => {
      const invalidRequest = { feeds: null };

      try {
        await controller.getCurrentFeedValues(invalidRequest as any);
        fail("Should have thrown an error");
      } catch (error) {
        expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect(error.getResponse()).toMatchObject({
          error: expect.any(String),
          code: expect.any(Number),
          message: expect.any(String),
          timestamp: expect.any(Number),
          requestId: expect.any(String),
        });
      }
    });
  });

  describe("Caching Behavior", () => {
    it("should respect 1-second TTL for price data", async () => {
      const staleEntry = {
        value: 49000,
        timestamp: Date.now() - 3000, // 3 seconds old (stale)
        sources: ["binance"],
        confidence: 0.9,
      };
      cacheService.getPrice.mockReturnValue(staleEntry);

      // Should not use stale data, should fetch fresh
      const mockAggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance", "coinbase"],
        confidence: 0.95,
        consensusScore: 0.98,
      };
      aggregationService.getAggregatedPrice.mockResolvedValue(mockAggregatedPrice);

      const request = { feeds: [mockFeedId] };
      const result = await controller.getCurrentFeedValues(request);

      expect(result.data[0].value).toBe(50000); // Fresh data, not stale
      expect(aggregationService.getAggregatedPrice).toHaveBeenCalled();
    });

    it("should cache fresh aggregated prices", async () => {
      cacheService.getPrice.mockReturnValue(null);

      const mockAggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance", "coinbase"],
        confidence: 0.95,
        consensusScore: 0.98,
      };
      aggregationService.getAggregatedPrice.mockResolvedValue(mockAggregatedPrice);

      const request = { feeds: [mockFeedId] };
      await controller.getCurrentFeedValues(request);

      expect(cacheService.setPrice).toHaveBeenCalledWith(mockFeedId, {
        value: 50000,
        timestamp: mockAggregatedPrice.timestamp,
        sources: ["binance", "coinbase"],
        confidence: 0.95,
      });
    });
  });
});
