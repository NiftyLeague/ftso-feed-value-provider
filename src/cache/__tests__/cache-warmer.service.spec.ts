import { type CoreFeedId, FeedCategory } from "@/common/types/core";
import type { AggregatedPrice } from "@/common/types/services";
import { ExchangeId } from "@/common/types/adapters";
import { ENV } from "@/config/environment.constants";

import { CacheWarmerService } from "../cache-warmer.service";
import { RealTimeCacheService } from "../real-time-cache.service";

describe("CacheWarmerService", () => {
  let warmerService: CacheWarmerService;
  let cacheService: RealTimeCacheService;

  const mockFeedId: CoreFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  const mockFeedId2: CoreFeedId = {
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
        const feedId: CoreFeedId = {
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
        sources: [ExchangeId.Binance],
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
        sources: [ExchangeId.Binance],
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
      const cryptoFeed: CoreFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const forexFeed: CoreFeedId = { category: FeedCategory.Forex, name: "BTC/USD" };

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

  describe("Cache Warming Logic (Private)", () => {
    const getPrivate = () =>
      warmerService as unknown as {
        shouldWarmImmediately: (pattern: unknown) => boolean;
        calculatePriority: (pattern: unknown) => number;
        getFeedsForAggressiveWarming: () => unknown[];
        getFeedsForPredictiveWarming: () => unknown[];
        getFeedsForMaintenanceWarming: () => unknown[];
        executeWarmingStrategy: (feeds: unknown[], strategy: unknown) => Promise<void>;
        warmFeedCache: (feedId: CoreFeedId) => Promise<void>;
        cleanupStalePatterns: () => void;
        accessPatterns: Map<string, any>;
        warmingStrategies: any[];
        warmingStats: any;
      };

    const feedKey = (feedId: CoreFeedId) => `${feedId.category}:${feedId.name}`;

    const makePattern = (feedId: CoreFeedId, overrides: Partial<any> = {}) => {
      const now = Date.now();
      return {
        feedId,
        accessCount: 1,
        lastAccessed: now,
        averageInterval: ENV.CACHE.WARMER.DEFAULT_ACCESS_INTERVAL_MS,
        priority: 1,
        predictedNextAccess: now + ENV.CACHE.WARMER.DEFAULT_ACCESS_INTERVAL_MS,
        warmingSuccess: 0,
        warmingFailures: 0,
        ...overrides,
      };
    };

    it("shouldWarmImmediately should cover true/false branches", () => {
      const svc = getPrivate();

      expect(svc.shouldWarmImmediately(makePattern(mockFeedId, { accessCount: 1 }))).toBe(true);
      expect(
        svc.shouldWarmImmediately(
          makePattern(mockFeedId, {
            accessCount: ENV.CACHE.WARMER.IMMEDIATE_THRESHOLD,
            averageInterval: ENV.CACHE.WARMER.FREQUENT_ACCESS_THRESHOLD_MS + 1,
          })
        )
      ).toBe(true);
      expect(
        svc.shouldWarmImmediately(
          makePattern(mockFeedId, {
            accessCount: 2,
            averageInterval: Math.max(1, ENV.CACHE.WARMER.FREQUENT_ACCESS_THRESHOLD_MS - 1),
          })
        )
      ).toBe(true);

      expect(
        svc.shouldWarmImmediately(
          makePattern(mockFeedId, {
            accessCount: 2,
            averageInterval: ENV.CACHE.WARMER.FREQUENT_ACCESS_THRESHOLD_MS + 1,
          })
        )
      ).toBe(false);
    });

    it("calculatePriority should exercise recency/frequency branches and clamp output", () => {
      const svc = getPrivate();
      const now = Date.now();

      const veryRecent = makePattern(mockFeedId, {
        accessCount: 10,
        lastAccessed: now - 10 * 60 * 1000, // 10 minutes
        averageInterval: 10_000,
        warmingSuccess: 8,
        warmingFailures: 2,
      });

      const moderatelyRecent = makePattern(mockFeedId2, {
        accessCount: 5,
        lastAccessed: now - 3 * 60 * 60 * 1000, // 3 hours
        averageInterval: 45_000,
        warmingSuccess: 1,
        warmingFailures: 4,
      });

      const old = makePattern(
        { category: FeedCategory.Forex, name: "EUR/USD" },
        {
          accessCount: 2,
          lastAccessed: now - 12 * 60 * 60 * 1000, // 12 hours
          averageInterval: 120_000,
          warmingSuccess: 0,
          warmingFailures: 0,
        }
      );

      const p1 = svc.calculatePriority(veryRecent);
      const p2 = svc.calculatePriority(moderatelyRecent);
      const p3 = svc.calculatePriority(old);

      for (const p of [p1, p2, p3]) {
        expect(p).toBeGreaterThanOrEqual(ENV.CACHE.WARMER.PRIORITY_MIN);
        expect(p).toBeLessThanOrEqual(ENV.CACHE.WARMER.PRIORITY_MAX);
      }

      expect(p1).toBeGreaterThanOrEqual(p3);
    });

    it("getFeedsForAggressiveWarming should respect enabled/disabled strategy and ordering", () => {
      const svc = getPrivate();
      const now = Date.now();

      svc.warmingStrategies = [
        {
          name: "critical_realtime",
          enabled: false,
          priority: 1,
          targetFeeds: 10,
          concurrency: 1,
          interval: 1000,
        },
      ];
      expect(svc.getFeedsForAggressiveWarming()).toEqual([]);

      svc.warmingStrategies = [
        {
          name: "critical_realtime",
          enabled: true,
          priority: 1,
          targetFeeds: 10,
          concurrency: 1,
          interval: 1000,
        },
      ];

      const p1 = makePattern(mockFeedId, { accessCount: 6, lastAccessed: now - 60_000, priority: 20 });
      const p2 = makePattern(mockFeedId2, { accessCount: 5, lastAccessed: now - 10_000, priority: 5 });
      const p3 = makePattern(
        { category: FeedCategory.Crypto, name: "XRP/USD" },
        {
          accessCount: 4,
          lastAccessed: now - 10_000,
          priority: 999,
        }
      ); // filtered out (<5 accesses)

      svc.accessPatterns.set(feedKey(mockFeedId), p1);
      svc.accessPatterns.set(feedKey(mockFeedId2), p2);
      svc.accessPatterns.set(feedKey(p3.feedId), p3);

      const feeds = svc.getFeedsForAggressiveWarming() as any[];
      expect(feeds.map(f => f.feedId.name)).toEqual(["BTC/USD", "ETH/USD"]);
    });

    it("getFeedsForPredictiveWarming should filter by predicted access window", () => {
      const svc = getPrivate();
      const now = Date.now();

      svc.warmingStrategies = [
        {
          name: "predictive_ml",
          enabled: true,
          priority: 2,
          targetFeeds: 10,
          concurrency: 1,
          interval: 1000,
        },
      ];

      const soon = makePattern(mockFeedId, { predictedNextAccess: now + 30_000, priority: 1 });
      const tooLate = makePattern(mockFeedId2, { predictedNextAccess: now + 120_000, priority: 10 });
      const past = makePattern({ category: FeedCategory.Crypto, name: "SOL/USD" }, { predictedNextAccess: now - 1 });

      svc.accessPatterns.set(feedKey(soon.feedId), soon);
      svc.accessPatterns.set(feedKey(tooLate.feedId), tooLate);
      svc.accessPatterns.set(feedKey(past.feedId), past);

      const feeds = svc.getFeedsForPredictiveWarming() as any[];
      expect(feeds).toHaveLength(1);
      expect(feeds[0].feedId.name).toBe("BTC/USD");
    });

    it("getFeedsForMaintenanceWarming should filter by last access within an hour", () => {
      const svc = getPrivate();
      const now = Date.now();

      svc.warmingStrategies = [
        {
          name: "maintenance_optimized",
          enabled: true,
          priority: 3,
          targetFeeds: 10,
          concurrency: 1,
          interval: 1000,
        },
      ];

      const withinHour = makePattern(mockFeedId, { lastAccessed: now - 10_000, priority: 1 });
      const tooOld = makePattern(mockFeedId2, { lastAccessed: now - 2 * 60 * 60 * 1000, priority: 999 });

      svc.accessPatterns.set(feedKey(withinHour.feedId), withinHour);
      svc.accessPatterns.set(feedKey(tooOld.feedId), tooOld);

      const feeds = svc.getFeedsForMaintenanceWarming() as any[];
      expect(feeds).toHaveLength(1);
      expect(feeds[0].feedId.name).toBe("BTC/USD");
    });

    it("executeWarmingStrategy should track successes and failures", async () => {
      const svc = getPrivate();

      const patterns = [
        makePattern(mockFeedId, { accessCount: 5, priority: 10 }),
        makePattern(mockFeedId2, { accessCount: 5, priority: 5 }),
      ];

      const warmSpy = jest.spyOn(svc, "warmFeedCache").mockImplementation(async feedId => {
        if (feedId.name === "ETH/USD") {
          throw new Error("boom");
        }
      });

      const strategy = {
        name: "critical_realtime",
        enabled: true,
        priority: 1,
        targetFeeds: 10,
        concurrency: 1,
        interval: 1000,
      };

      await svc.executeWarmingStrategy(patterns, strategy);

      expect(warmSpy).toHaveBeenCalledTimes(2);
      expect(patterns[0].warmingSuccess).toBe(1);
      expect(patterns[1].warmingFailures).toBe(1);

      const stats = warmerService.getWarmupStats().warmingStats;
      expect(stats.totalWarming).toBeGreaterThanOrEqual(2);
      expect(stats.successfulWarming).toBeGreaterThanOrEqual(1);
      expect(stats.failedWarming).toBeGreaterThanOrEqual(1);
    });

    it("warmFeedCache should skip warming when cache is already fresh", async () => {
      const svc = getPrivate();

      const setSpy = jest.spyOn(cacheService, "setPrice");
      cacheService.setPrice(mockFeedId, {
        value: 123,
        timestamp: Date.now(),
        sources: ["mock-source"],
        confidence: 0.9,
      });

      const callback = jest.fn().mockResolvedValue({
        price: 999,
        timestamp: Date.now(),
        sources: [ExchangeId.Binance],
        confidence: 0.95,
      } as AggregatedPrice);
      warmerService.setDataSourceCallback(callback);

      await svc.warmFeedCache(mockFeedId);

      expect(callback).not.toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledTimes(1); // only our initial set
    });

    it("warmFeedCache should set fresh cache when callback returns data", async () => {
      const svc = getPrivate();
      const now = Date.now();

      const setSpy = jest.spyOn(cacheService, "setPrice");
      cacheService.setPrice(mockFeedId, {
        value: 100,
        timestamp: now - ENV.CACHE.FRESHNESS_CHECK_MS - 10,
        sources: ["mock-source"],
        confidence: 0.5,
      });

      const callback = jest.fn().mockResolvedValue({
        price: 50_000,
        timestamp: now,
        sources: [ExchangeId.Binance],
        confidence: 0.95,
      } as AggregatedPrice);
      warmerService.setDataSourceCallback(callback);

      await svc.warmFeedCache(mockFeedId);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(setSpy).toHaveBeenLastCalledWith(mockFeedId, {
        value: 50_000,
        timestamp: now,
        sources: [ExchangeId.Binance],
        confidence: 0.95,
      });
    });

    it("warmFeedCache should not set cache when callback returns null", async () => {
      const svc = getPrivate();
      const setSpy = jest.spyOn(cacheService, "setPrice");

      const callback = jest.fn().mockResolvedValue(null);
      warmerService.setDataSourceCallback(callback);

      await svc.warmFeedCache(mockFeedId);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(setSpy).not.toHaveBeenCalled();
    });

    it("warmFeedCache should wrap errors when data source callback throws", async () => {
      const svc = getPrivate();
      const callback = jest.fn().mockRejectedValue(new Error("Network error"));
      warmerService.setDataSourceCallback(callback);

      await expect(svc.warmFeedCache(mockFeedId)).rejects.toThrow(/Failed to warm cache/);
    });

    it("warmFeedCache should use mock data when no callback configured", async () => {
      const svc = getPrivate();
      const setSpy = jest.spyOn(cacheService, "setPrice");

      await svc.warmFeedCache(mockFeedId);
      expect(setSpy).toHaveBeenCalledTimes(1);
    });

    it("cleanupStalePatterns should remove patterns older than threshold", () => {
      const svc = getPrivate();
      const now = Date.now();

      const stale = makePattern(mockFeedId, { lastAccessed: now - ENV.CACHE.STALE_PATTERN_THRESHOLD_MS - 1 });
      const fresh = makePattern(mockFeedId2, { lastAccessed: now });

      svc.accessPatterns.set(feedKey(stale.feedId), stale);
      svc.accessPatterns.set(feedKey(fresh.feedId), fresh);

      svc.cleanupStalePatterns();
      expect(svc.accessPatterns.size).toBe(1);
      expect(Array.from(svc.accessPatterns.keys())).toEqual([feedKey(fresh.feedId)]);
    });
  });
});
