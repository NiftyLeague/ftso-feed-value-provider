import type { CacheEntry } from "@/common/types/cache";
import { type EnhancedFeedId, FeedCategory } from "@/common/types/core";

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

  const mockCacheEntry: CacheEntry = {
    value: 50000,
    timestamp: Date.now(),
    sources: ["binance", "coinbase"],
    confidence: 0.95,
  };

  beforeEach(() => {
    cacheService = new RealTimeCacheService();
    warmerService = new CacheWarmerService(cacheService);
    warmerService.stopWarmupProcess(); // Disable auto-warmup for tests
    (warmerService as any).config.enabled = false; // Set enabled to false for tests
  });

  afterEach(() => {
    warmerService.destroy();
    cacheService.destroy();
  });

  describe("Feed Access Tracking", () => {
    it("should track feed access patterns", () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.totalTrackedFeeds).toBe(2);
    });

    it("should increase request count for repeated access", () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);

      const popularFeeds = warmerService.getPopularFeeds();
      expect(popularFeeds.length).toBe(1);
      expect(popularFeeds[0].requestCount).toBe(3);
    });

    it("should update last requested timestamp", async () => {
      warmerService.trackFeedAccess(mockFeedId);
      const firstAccess = warmerService.getPopularFeeds()[0].lastRequested;

      await new Promise(resolve => setTimeout(resolve, 10));

      warmerService.trackFeedAccess(mockFeedId);
      const secondAccess = warmerService.getPopularFeeds()[0].lastRequested;

      expect(secondAccess).toBeGreaterThan(firstAccess);
    });
  });

  describe("Popular Feeds Management", () => {
    it("should return popular feeds sorted by priority", () => {
      // Create feeds with different access patterns
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId);

      warmerService.trackFeedAccess(mockFeedId2);

      const popularFeeds = warmerService.getPopularFeeds();
      expect(popularFeeds.length).toBe(2);
      expect(popularFeeds[0].feedId).toEqual(mockFeedId); // More popular feed first
      expect(popularFeeds[0].requestCount).toBe(3);
    });

    it("should limit the number of popular feeds returned", () => {
      // Track many feeds
      for (let i = 0; i < 15; i++) {
        const feedId: EnhancedFeedId = {
          category: FeedCategory.Crypto,
          name: `COIN${i}/USD`,
        };
        warmerService.trackFeedAccess(feedId);
      }

      const popularFeeds = warmerService.getPopularFeeds(5);
      expect(popularFeeds.length).toBe(5);
    });

    it("should filter out stale metrics", async () => {
      warmerService.trackFeedAccess(mockFeedId);

      // Mock old timestamp (more than 1 hour ago)
      const popularFeeds = warmerService.getPopularFeeds();
      if (popularFeeds.length > 0) {
        popularFeeds[0].lastRequested = Date.now() - 3700000; // 1 hour and 10 minutes ago
      }

      const recentFeeds = warmerService.getPopularFeeds();
      expect(recentFeeds.length).toBe(0);
    });

    it("should set popular feeds manually", () => {
      const manualFeeds = [mockFeedId, mockFeedId2];
      warmerService.setPopularFeeds(manualFeeds);

      const popularFeeds = warmerService.getPopularFeeds();
      expect(popularFeeds.length).toBe(2);
      expect(popularFeeds[0].priority).toBe(5); // Higher priority for manual feeds
    });
  });

  describe("Cache Warming", () => {
    it("should warm cache for a specific feed", async () => {
      await warmerService.warmFeedCache(mockFeedId);

      const cachedData = cacheService.getPrice(mockFeedId);
      expect(cachedData).toBeDefined();
      expect(cachedData?.value).toBeGreaterThan(0);
      expect(cachedData?.sources).toEqual(["mock-source"]);
    });

    it("should skip warming if cache is already fresh", async () => {
      // Pre-populate cache with fresh data
      const freshEntry: CacheEntry = {
        ...mockCacheEntry,
        timestamp: Date.now(),
      };
      cacheService.setPrice(mockFeedId, freshEntry);

      const spy = jest.spyOn(warmerService as any, "fetchFreshData");

      await warmerService.warmFeedCache(mockFeedId);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("should warm cache for popular feeds", async () => {
      // Track some feeds to make them popular
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      await warmerService.warmPopularFeeds();

      const cachedData1 = cacheService.getPrice(mockFeedId);
      const cachedData2 = cacheService.getPrice(mockFeedId2);

      expect(cachedData1).toBeDefined();
      expect(cachedData2).toBeDefined();
    });

    it("should handle warming errors gracefully", async () => {
      // Mock fetchFreshData to throw an error
      const spy = jest.spyOn(warmerService as any, "fetchFreshData").mockRejectedValue(new Error("Network error"));

      await expect(warmerService.warmFeedCache(mockFeedId)).rejects.toThrow("Network error");

      spy.mockRestore();
    });

    it("should continue warming other feeds if one fails", async () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      // Mock fetchFreshData to fail for first feed but succeed for second
      const spy = jest.spyOn(warmerService as any, "fetchFreshData").mockImplementation((feedId: any) => {
        if (feedId.name === "BTC/USD") {
          return Promise.reject(new Error("Network error"));
        }
        return Promise.resolve({
          value: 3000,
          timestamp: Date.now(),
          sources: ["mock-source"],
          confidence: 0.95,
        });
      });

      await warmerService.warmPopularFeeds();

      const cachedData1 = cacheService.getPrice(mockFeedId);
      const cachedData2 = cacheService.getPrice(mockFeedId2);

      expect(cachedData1).toBeNull(); // Failed to warm
      expect(cachedData2).toBeDefined(); // Successfully warmed

      spy.mockRestore();
    });
  });

  describe("Warmup Statistics", () => {
    it("should provide warmup statistics", () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.totalTrackedFeeds).toBe(2);
      expect(stats.popularFeeds).toBe(2);
      expect(stats.warmupEnabled).toBe(false);
    });

    it("should show correct popular feeds count", () => {
      // Track feeds with different patterns
      for (let i = 0; i < 5; i++) {
        warmerService.trackFeedAccess(mockFeedId);
      }
      warmerService.trackFeedAccess(mockFeedId2);

      const stats = warmerService.getWarmupStats();
      expect(stats.popularFeeds).toBe(2);
    });
  });

  describe("Automatic Warmup Process", () => {
    it("should start and stop warmup process", () => {
      const autoWarmerService = new CacheWarmerService(cacheService);

      expect(autoWarmerService.getWarmupStats().warmupEnabled).toBe(true);

      autoWarmerService.stopWarmupProcess();
      autoWarmerService.destroy();
    });

    it("should run warmup at specified intervals", async () => {
      const spy = jest.spyOn(CacheWarmerService.prototype, "warmPopularFeeds").mockResolvedValue();

      const autoWarmerService = new CacheWarmerService(cacheService);
      // Set a shorter interval for testing
      (autoWarmerService as any).config.warmupInterval = 50;
      // Restart the warmup process with the new interval
      autoWarmerService.stopWarmupProcess();
      (autoWarmerService as any).startWarmupProcess();

      // Wait for at least one interval
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(spy).toHaveBeenCalled();

      autoWarmerService.destroy();
      spy.mockRestore();
    });
  });

  describe("Priority Calculation", () => {
    it("should calculate higher priority for frequently accessed feeds", () => {
      // Access one feed more frequently
      for (let i = 0; i < 10; i++) {
        warmerService.trackFeedAccess(mockFeedId);
      }
      warmerService.trackFeedAccess(mockFeedId2);

      const popularFeeds = warmerService.getPopularFeeds();
      expect(popularFeeds[0].feedId).toEqual(mockFeedId);
      expect(popularFeeds[0].priority).toBeGreaterThan(popularFeeds[1].priority);
    });

    it("should decay priority over time", async () => {
      warmerService.trackFeedAccess(mockFeedId);
      const initialPriority = warmerService.getPopularFeeds()[0].priority;

      // Mock old timestamp to simulate time decay
      const popularFeeds = warmerService.getPopularFeeds();
      popularFeeds[0].lastRequested = Date.now() - 86400000; // 24 hours ago

      // Access the private method to recalculate priority
      const calculatePriority = (warmerService as any).calculatePriority;
      const decayedPriority = calculatePriority(popularFeeds[0]);

      expect(decayedPriority).toBeLessThan(initialPriority);
    });
  });

  describe("Memory Management", () => {
    it("should clean up resources on destroy", () => {
      warmerService.trackFeedAccess(mockFeedId);
      warmerService.trackFeedAccess(mockFeedId2);

      expect(warmerService.getWarmupStats().totalTrackedFeeds).toBe(2);

      warmerService.destroy();

      expect(warmerService.getWarmupStats().totalTrackedFeeds).toBe(0);
    });

    it("should stop intervals on destroy", () => {
      const autoWarmerService = new CacheWarmerService(cacheService);

      const spy = jest.spyOn(global, "clearInterval");

      autoWarmerService.destroy();

      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty popular feeds list", async () => {
      await expect(warmerService.warmPopularFeeds()).resolves.not.toThrow();
    });

    it("should handle feeds with same name but different categories", () => {
      const cryptoFeed: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const forexFeed: EnhancedFeedId = { category: FeedCategory.Forex, name: "BTC/USD" };

      warmerService.trackFeedAccess(cryptoFeed);
      warmerService.trackFeedAccess(forexFeed);

      const stats = warmerService.getWarmupStats();
      expect(stats.totalTrackedFeeds).toBe(2);
    });

    it("should maintain minimum priority", () => {
      warmerService.trackFeedAccess(mockFeedId);
      const popularFeeds = warmerService.getPopularFeeds();

      // Mock very old timestamp
      popularFeeds[0].lastRequested = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago

      // Recalculate priority
      warmerService.trackFeedAccess(mockFeedId);
      const updatedFeeds = warmerService.getPopularFeeds();

      expect(updatedFeeds[0].priority).toBeGreaterThanOrEqual(0.1);
    });
  });
});
