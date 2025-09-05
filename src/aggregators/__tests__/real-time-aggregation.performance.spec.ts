import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@/config/config.service";

import type { AggregatedPrice } from "@/common/types/services";
import type { EnhancedFeedId, PriceUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";

import { RealTimeAggregationService } from "../real-time-aggregation.service";
import { ConsensusAggregator } from "../consensus-aggregator.service";

describe("RealTimeAggregationService Performance Tests", () => {
  let service: RealTimeAggregationService;
  let consensusAggregator: jest.Mocked<ConsensusAggregator>;
  let mockFeedId: EnhancedFeedId;

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

    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  describe("Performance Requirements", () => {
    it("should achieve sub-100ms response times for cached data", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      // Mock fast aggregation (simulate real-world performance)
      consensusAggregator.aggregate.mockImplementation(async () => {
        // Simulate minimal processing time
        await new Promise(resolve => setTimeout(resolve, 1));
        return mockAggregatedPrice;
      });

      const update: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
        confidence: 0.9,
      };

      service.addPriceUpdate(mockFeedId, update);

      // First call to populate cache
      await service.getAggregatedPrice(mockFeedId);

      // Measure cached response time
      const startTime = performance.now();
      const result = await service.getAggregatedPrice(mockFeedId);
      const responseTime = performance.now() - startTime;

      expect(result).toBeDefined();
      expect(responseTime).toBeLessThan(100); // Sub-100ms requirement
      expect(responseTime).toBeLessThan(10); // Cached responses should be very fast
    });

    it("should achieve sub-100ms response times for fresh aggregation", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance", "coinbase", "kraken"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      // Mock realistic aggregation time
      consensusAggregator.aggregate.mockImplementation(async () => {
        // Simulate realistic processing time for multiple sources
        await new Promise(resolve => setTimeout(resolve, 5));
        return mockAggregatedPrice;
      });

      const updates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: Date.now() - 500,
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50100,
          timestamp: Date.now() - 300,
          source: "coinbase",
          confidence: 0.85,
        },
        {
          symbol: "BTC/USD",
          price: 49950,
          timestamp: Date.now() - 200,
          source: "kraken",
          confidence: 0.8,
        },
      ];

      updates.forEach(update => service.addPriceUpdate(mockFeedId, update));

      // Measure fresh aggregation response time
      const startTime = performance.now();
      const result = await service.getAggregatedPrice(mockFeedId);
      const responseTime = performance.now() - startTime;

      expect(result).toBeDefined();
      expect(responseTime).toBeLessThan(100); // Sub-100ms requirement
    });

    it("should handle high-frequency updates efficiently", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      const startTime = performance.now();

      // Simulate high-frequency updates (100 updates)
      for (let i = 0; i < 100; i++) {
        const update: PriceUpdate = {
          symbol: "BTC/USD",
          price: 50000 + i,
          timestamp: Date.now() - (100 - i) * 10, // Spread over 1 second
          source: "binance",
          confidence: 0.9,
        };

        service.addPriceUpdate(mockFeedId, update);
      }

      const updateTime = performance.now() - startTime;

      // Should handle 100 updates quickly
      expect(updateTime).toBeLessThan(100); // Should process updates in under 100ms

      // Verify final aggregation is still fast
      const aggregationStart = performance.now();
      const result = await service.getAggregatedPrice(mockFeedId);
      const aggregationTime = performance.now() - aggregationStart;

      expect(result).toBeDefined();
      expect(aggregationTime).toBeLessThan(100);
    });

    it("should maintain performance with multiple concurrent feeds", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "TEST",
        price: 1000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      // Create multiple feed IDs
      const feedIds: EnhancedFeedId[] = [];
      for (let i = 0; i < 50; i++) {
        feedIds.push({
          category: FeedCategory.Crypto,
          name: `FEED${i}/USD`,
        });
      }

      // Add updates for all feeds
      feedIds.forEach((feedId, index) => {
        const update: PriceUpdate = {
          symbol: feedId.name,
          price: 1000 + index,
          timestamp: Date.now() - 500,
          source: "binance",
          confidence: 0.9,
        };

        service.addPriceUpdate(feedId, update);
      });

      // Measure concurrent aggregation performance
      const startTime = performance.now();

      const promises = feedIds.map(feedId => service.getAggregatedPrice(feedId));
      const results = await Promise.all(promises);

      const totalTime = performance.now() - startTime;
      const avgTimePerFeed = totalTime / feedIds.length;

      expect(results).toHaveLength(50);
      expect(results.every(result => result !== null)).toBe(true);
      expect(avgTimePerFeed).toBeLessThan(100); // Average should be sub-100ms
      expect(totalTime).toBeLessThan(1000); // Total time should be reasonable
    });

    it("should maintain cache performance under load", async () => {
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

      // Populate cache
      await service.getAggregatedPrice(mockFeedId);

      // Measure cache performance under load (1000 requests)
      const startTime = performance.now();

      const promises = [];
      for (let i = 0; i < 1000; i++) {
        promises.push(service.getAggregatedPrice(mockFeedId));
      }

      const results = await Promise.all(promises);
      const totalTime = performance.now() - startTime;
      const avgTimePerRequest = totalTime / 1000;

      expect(results).toHaveLength(1000);
      expect(results.every(result => result !== null)).toBe(true);
      expect(avgTimePerRequest).toBeLessThan(1); // Cached requests should be very fast
      expect(totalTime).toBeLessThan(100); // Total time for 1000 cached requests

      // Verify high cache hit rate
      const cacheStats = service.getCacheStats();
      expect(cacheStats.hitRate).toBeGreaterThan(0.9); // Should have >90% hit rate
    });

    it("should handle cache eviction efficiently", async () => {
      const mockAggregatedPrice: AggregatedPrice = {
        symbol: "TEST",
        price: 1000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.9,
        consensusScore: 0.85,
      };

      consensusAggregator.aggregate.mockResolvedValue(mockAggregatedPrice);

      // Fill cache beyond capacity to trigger LRU eviction
      const feedIds: EnhancedFeedId[] = [];
      for (let i = 0; i < 1200; i++) {
        // Exceed default cache size of 1000
        feedIds.push({
          category: FeedCategory.Crypto,
          name: `FEED${i}/USD`,
        });
      }

      const startTime = performance.now();

      // Add updates and get prices for all feeds
      for (const feedId of feedIds) {
        const update: PriceUpdate = {
          symbol: feedId.name,
          price: 1000,
          timestamp: Date.now() - 500,
          source: "binance",
          confidence: 0.9,
        };

        service.addPriceUpdate(feedId, update);
        await service.getAggregatedPrice(feedId);
      }

      const totalTime = performance.now() - startTime;
      const avgTimePerFeed = totalTime / feedIds.length;

      // Should handle cache eviction without significant performance degradation
      expect(avgTimePerFeed).toBeLessThan(100);

      // Verify cache stats show evictions occurred
      const cacheStats = service.getCacheStats();
      expect(cacheStats.evictionCount).toBeGreaterThan(0);
      expect(cacheStats.totalEntries).toBeLessThanOrEqual(1000); // Should not exceed max size
    });
  });

  describe("Quality Metrics Performance", () => {
    it("should calculate quality metrics efficiently", async () => {
      const updates: PriceUpdate[] = [];

      // Create multiple updates for comprehensive metrics
      for (let i = 0; i < 10; i++) {
        updates.push({
          symbol: "BTC/USD",
          price: 50000 + (Math.random() - 0.5) * 100,
          timestamp: Date.now() - i * 100,
          source: `exchange${i}`,
          confidence: 0.8 + Math.random() * 0.2,
        });
      }

      updates.forEach(update => service.addPriceUpdate(mockFeedId, update));

      const startTime = performance.now();
      const metrics = await service.getQualityMetrics(mockFeedId);
      const responseTime = performance.now() - startTime;

      expect(metrics).toBeDefined();
      expect(responseTime).toBeLessThan(50); // Quality metrics should be fast
    });
  });
});
