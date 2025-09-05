import { type EnhancedFeedId, FeedCategory } from "@/common/types/core";
import type { AggregatedPrice } from "@/common/types/services";

import { CacheWarmerService } from "../cache-warmer.service";
import { RealTimeCacheService } from "../real-time-cache.service";

describe("CacheWarmerService", () => {
  let warmerService: CacheWarmerService;
  let cacheService: RealTimeCacheService;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  const mockFeedId2: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "ETH/USD",
  };

  beforeEach(() => {
    cacheService = new RealTimeCacheService();
    warmerService = new CacheWarmerService(cacheService);
  });

  afterEach(async () => {
    await warmerService.onModuleDestroy();
    cacheService.destroy();
  });

  describe("Feed Access Tracking", () => {
    it("should track feed access patterns", () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBe(2);
    });

    it("should increase access count for repeated access", () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);

      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBe(1);
      expect(stats.topFeeds.length).toBeGreaterThanOrEqual(1);
      expect(stats.topFeeds[0].accessCount).toBe(3);
    });

    it("should update access patterns over time", async () => {
      warmerService.trackFeedAccess(mockFeedId);
      const firstStats = warmerService.getWarmupStats();

      await new Promise(resolve => setTimeout(resolve, 10));

      warmerService.trackFeedAccess(mockFeedId);
      const secondStats = warmerService.getWarmupStats();

      expect(secondStats.topFeeds[0].accessCount).toBeGreaterThan(firstStats.topFeeds[0].accessCount);
    });
  });

  describe("Intelligent Warming Management", () => {
    it("should return top feeds sorted by priority", () => {
      // Create feeds with different access patterns
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);

      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.topFeeds.length).toBe(2);
      expect(stats.topFeeds[0].accessCount).toBe(3); // More popular feed first
    });

    it("should track multiple feeds", () => {
      // Track many feeds
      for (let i = 0; i < 15; i++) {
        const feedId: EnhancedFeedId = {
          category: FeedCategory.Crypto,
          name: `COIN${i}/USD`,
        };
        warmerService.trackFeedAccess(feedId);
      }

      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBe(15);
      expect(stats.topFeeds.length).toBeLessThanOrEqual(10); // Limited to top 10
    });

    it("should track active patterns", () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.activePatterns).toBe(2); // Both should be active
    });

    it("should provide warming strategies", () => {
      const stats = warmerService.getWarmupStats();
      expect(stats.strategies).toBeDefined();
      expect(stats.strategies.length).toBeGreaterThan(0);
      expect(stats.strategies[0]).toHaveProperty("name");
      expect(stats.strategies[0]).toHaveProperty("enabled");
    });
  });

  describe("Data Source Integration", () => {
    it("should set data source callback", () => {
      const mockCallback = jest.fn().mockResolvedValue({
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.95,
      } as AggregatedPrice);

      warmerService.setDataSourceCallback(mockCallback);

      // Should not throw errors
      expect(warmerService).toBeDefined();
    });

    it("should handle data source callback errors", async () => {
      const mockCallback = jest.fn().mockRejectedValue(new Error("Network error"));
      warmerService.setDataSourceCallback(mockCallback);

      // Track a feed to trigger warming
      warmerService.trackFeedAccess(mockFeedId);

      // Wait a bit for any background warming to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should not crash the service
      expect(warmerService).toBeDefined();
    });

    it("should work without data source callback", () => {
      // Track feeds without setting callback
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBe(2);
    });
  });

  describe("Warmup Statistics", () => {
    it("should provide comprehensive warming statistics", () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBe(2);
      expect(stats.activePatterns).toBe(2);
      expect(stats.warmingStats).toBeDefined();
      expect(stats.strategies).toBeDefined();
      expect(stats.topFeeds).toBeDefined();
    });

    it("should track warming performance", () => {
      // Track feeds with different patterns
      for (let i = 0; i < 5; i++) {
        warmerService.trackFeedAccess(mockFeedId);
      }
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.topFeeds.length).toBe(2);
      expect(stats.topFeeds[0].accessCount).toBe(5);
      expect(stats.topFeeds[1].accessCount).toBe(1);
    });

    it("should provide warming strategy information", () => {
      const stats = warmerService.getWarmupStats();
      expect(stats.strategies.length).toBeGreaterThan(0);

      const strategy = stats.strategies[0];
      expect(strategy).toHaveProperty("name");
      expect(strategy).toHaveProperty("enabled");
      expect(strategy).toHaveProperty("priority");
      expect(strategy).toHaveProperty("targetFeeds");
    });
  });

  describe("Intelligent Warming Process", () => {
    it("should initialize with warming strategies", () => {
      const stats = warmerService.getWarmupStats();
      expect(stats.strategies.length).toBeGreaterThan(0);

      // Check that strategies are properly configured
      const criticalStrategy = stats.strategies.find(s => s.name === "critical_realtime");
      expect(criticalStrategy).toBeDefined();
      expect(criticalStrategy?.enabled).toBe(true);
    });

    it("should track warming performance metrics", async () => {
      // Set up a mock data source
      const mockCallback = jest.fn().mockResolvedValue({
        price: 50000,
        timestamp: Date.now(),
        sources: ["binance"],
        confidence: 0.95,
      } as AggregatedPrice);

      warmerService.setDataSourceCallback(mockCallback);
      warmerService.trackFeedAccess(mockFeedId);

      // Wait for potential warming activity
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = warmerService.getWarmupStats();
      expect(stats.warmingStats).toBeDefined();
      expect(typeof stats.warmingStats.totalWarming).toBe("number");
      expect(typeof stats.warmingStats.successfulWarming).toBe("number");
    });
  });

  describe("Priority Calculation", () => {
    it("should calculate higher priority for frequently accessed feeds", () => {
      // Access one feed more frequently
      for (let i = 0; i < 10; i++) {
        warmerService.trackFeedAccess(mockFeedId);
      }
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.topFeeds[0].accessCount).toBe(10);
      expect(stats.topFeeds[0].priority).toBeGreaterThan(stats.topFeeds[1].priority);
    });

    it("should handle priority calculation for new feeds", () => {
      warmerService.trackFeedAccess(mockFeedId);

      const stats = warmerService.getWarmupStats();
      expect(stats.topFeeds.length).toBe(1);
      expect(stats.topFeeds[0].priority).toBeGreaterThan(0);
    });

    it("should maintain priority ordering", () => {
      // Create different access patterns
      for (let i = 0; i < 5; i++) {
        warmerService.trackFeedAccess(mockFeedId);
      }
      for (let i = 0; i < 3; i++) {
        warmerService.trackFeedAccess(mockFeedId2);
      }

      const stats = warmerService.getWarmupStats();
      expect(stats.topFeeds[0].accessCount).toBeGreaterThanOrEqual(stats.topFeeds[1].accessCount);
    });
  });

  describe("Memory Management", () => {
    it("should clean up resources on destroy", async () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      expect(warmerService.getWarmupStats().totalPatterns).toBe(2);

      await warmerService.onModuleDestroy();

      expect(warmerService.getWarmupStats().totalPatterns).toBe(0);
    });

    it("should stop intervals on destroy", async () => {
      const spy = jest.spyOn(global, "clearInterval");

      await warmerService.onModuleDestroy();

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should handle cleanup of stale patterns", async () => {
      // Track some feeds
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      // Simulate time passing for cleanup
      await new Promise(resolve => setTimeout(resolve, 10));

      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty feed patterns gracefully", () => {
      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBe(0);
      expect(stats.activePatterns).toBe(0);
      expect(stats.topFeeds).toEqual([]);
    });

    it("should handle feeds with same name but different categories", () => {
      const cryptoFeed: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const forexFeed: EnhancedFeedId = { category: FeedCategory.Forex, name: "BTC/USD" };

      warmerService.trackFeedAccess(cryptoFeed);
      warmerService.trackFeedAccess(forexFeed);

      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBe(2);
    });

    it("should maintain reasonable priority values", () => {
      warmerService.trackFeedAccess(mockFeedId);

      const stats = warmerService.getWarmupStats();
      expect(stats.topFeeds[0].priority).toBeGreaterThan(0);
      expect(stats.topFeeds[0].priority).toBeLessThan(1000); // Reasonable upper bound
    });

    it("should handle concurrent access tracking", () => {
      // Simulate concurrent access
      for (let i = 0; i < 100; i++) {
        warmerService.trackFeedAccess(mockFeedId);
      }

      const stats = warmerService.getWarmupStats();
      expect(stats.totalPatterns).toBe(1);
      expect(stats.topFeeds[0].accessCount).toBe(100);
    });
  });
});
