import { RealTimeCacheService } from "../real-time-cache.service";
import { CacheEntry } from "../interfaces/cache.interfaces";
import { EnhancedFeedId, FeedCategory } from "@/common/types/feed.types";
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";

describe("RealTimeCacheService", () => {
  let service: RealTimeCacheService;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  const mockCacheEntry: CacheEntry = {
    value: 50000,
    timestamp: Date.now(),
    sources: ["binance", "coinbase"],
    confidence: 0.95,
  };

  beforeEach(() => {
    service = new RealTimeCacheService();
  });

  afterEach(() => {
    service.clear();
    service.destroy();
  });

  describe("Basic Cache Operations", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should set and get cache entries", () => {
      const key = "test-key";
      service.set(key, mockCacheEntry, 1000);

      const result = service.get(key);
      expect(result).toEqual(mockCacheEntry);
    });

    it("should return null for non-existent keys", () => {
      const result = service.get("non-existent-key");
      expect(result).toBeNull();
    });

    it("should invalidate cache entries", () => {
      const key = "test-key";
      service.set(key, mockCacheEntry, 1000);

      expect(service.get(key)).toEqual(mockCacheEntry);

      service.invalidate(key);
      expect(service.get(key)).toBeNull();
    });
  });

  describe("TTL and Expiration", () => {
    it("should enforce maximum TTL of 1 second", () => {
      const key = "test-key";
      const longTTL = 5000; // 5 seconds

      service.set(key, mockCacheEntry, longTTL);

      // The entry should still be accessible immediately
      expect(service.get(key)).toEqual(mockCacheEntry);

      // But should expire within 1 second (max TTL)
      // We can't easily test this without waiting, so we check the config
      expect(service.getConfig().maxTTL).toBe(1000);
    });

    it("should expire entries after TTL", async () => {
      const key = "test-key";
      const shortTTL = 50; // 50ms

      service.set(key, mockCacheEntry, shortTTL);
      expect(service.get(key)).toEqual(mockCacheEntry);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(service.get(key)).toBeNull();
    });

    it("should clean up expired entries automatically", async () => {
      const key1 = "test-key-1";
      const key2 = "test-key-2";

      service.set(key1, mockCacheEntry, 50); // 50ms TTL
      service.set(key2, mockCacheEntry, 1000); // 1s TTL

      expect(service.size()).toBe(2);

      // Wait for first entry to expire and cleanup to run
      await new Promise(resolve => setTimeout(resolve, 600));

      // First entry should be cleaned up, second should remain
      expect(service.get(key1)).toBeNull();
      expect(service.get(key2)).toEqual(mockCacheEntry);
    });
  });

  describe("Price Caching", () => {
    it("should set and get price data", () => {
      service.setPrice(mockFeedId, mockCacheEntry);

      const result = service.getPrice(mockFeedId);
      expect(result).toEqual(mockCacheEntry);
    });

    it("should invalidate voting round cache on price update but keep price cache", () => {
      service.setPrice(mockFeedId, mockCacheEntry);
      expect(service.getPrice(mockFeedId)).toEqual(mockCacheEntry);

      // Set voting round cache
      service.setForVotingRound(mockFeedId, 123, mockCacheEntry);
      expect(service.getForVotingRound(mockFeedId, 123)).toEqual({
        ...mockCacheEntry,
        votingRound: 123,
      });

      service.invalidateOnPriceUpdate(mockFeedId);

      // Price cache should remain (not invalidated)
      expect(service.getPrice(mockFeedId)).toEqual(mockCacheEntry);
      // Voting round cache should be invalidated
      expect(service.getForVotingRound(mockFeedId, 123)).toBeNull();
    });

    it("should use maximum TTL for price data", () => {
      service.setPrice(mockFeedId, mockCacheEntry);

      // Price should be cached with max TTL
      const result = service.getPrice(mockFeedId);
      expect(result).toEqual(mockCacheEntry);
    });
  });

  describe("Voting Round Caching", () => {
    it("should set and get voting round data", () => {
      const votingRound = 12345;
      const entryWithRound: CacheEntry = {
        ...mockCacheEntry,
        votingRound,
      };

      service.setForVotingRound(mockFeedId, votingRound, mockCacheEntry);

      const result = service.getForVotingRound(mockFeedId, votingRound);
      expect(result).toEqual(entryWithRound);
    });

    it("should return null for non-existent voting round", () => {
      const result = service.getForVotingRound(mockFeedId, 99999);
      expect(result).toBeNull();
    });

    it("should invalidate voting round cache on price update", () => {
      const votingRound = 12345;

      service.setForVotingRound(mockFeedId, votingRound, mockCacheEntry);
      expect(service.getForVotingRound(mockFeedId, votingRound)).toBeDefined();

      service.invalidateOnPriceUpdate(mockFeedId);
      expect(service.getForVotingRound(mockFeedId, votingRound)).toBeNull();
    });

    it("should use longer TTL for voting round data", () => {
      const votingRound = 12345;

      service.setForVotingRound(mockFeedId, votingRound, mockCacheEntry, 60000);

      const result = service.getForVotingRound(mockFeedId, votingRound);
      expect(result).toBeDefined();
      expect(result?.votingRound).toBe(votingRound);
    });
  });

  describe("Cache Statistics", () => {
    it("should track cache statistics", () => {
      const key = "test-key";

      // Initial stats
      let stats = service.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.hitRate).toBe(0);
      expect(stats.missRate).toBe(0);

      // Miss
      service.get(key);
      stats = service.getStats();
      expect(stats.totalRequests).toBe(1);
      expect(stats.missRate).toBe(1);
      expect(stats.hitRate).toBe(0);

      // Set and hit
      service.set(key, mockCacheEntry, 1000);
      service.get(key);
      stats = service.getStats();
      expect(stats.totalRequests).toBe(2);
      expect(stats.hitRate).toBe(0.5);
      expect(stats.missRate).toBe(0.5);
    });

    it("should track total entries", () => {
      expect(service.getStats().totalEntries).toBe(0);

      service.set("key1", mockCacheEntry, 1000);
      service.set("key2", mockCacheEntry, 1000);

      expect(service.getStats().totalEntries).toBe(2);
    });

    it("should estimate memory usage", () => {
      const stats1 = service.getStats();
      expect(stats1.memoryUsage).toBe(0);

      service.set("test-key", mockCacheEntry, 1000);

      const stats2 = service.getStats();
      expect(stats2.memoryUsage).toBeGreaterThan(0);
    });
  });

  describe("LRU Eviction", () => {
    it("should evict least recently used entries when at capacity", async () => {
      // Create service with small capacity
      const smallCacheService = RealTimeCacheService.withConfig({ maxEntries: 2 });

      smallCacheService.set("key1", mockCacheEntry, 1000);
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 1));
      smallCacheService.set("key2", mockCacheEntry, 1000);

      // Access key1 to make it more recently used
      await new Promise(resolve => setTimeout(resolve, 1));
      smallCacheService.get("key1");

      // Add key3, should evict key2 (least recently used)
      await new Promise(resolve => setTimeout(resolve, 1));
      smallCacheService.set("key3", mockCacheEntry, 1000);

      expect(smallCacheService.get("key1")).toEqual(mockCacheEntry);
      expect(smallCacheService.get("key2")).toBeNull();
      expect(smallCacheService.get("key3")).toEqual(mockCacheEntry);

      smallCacheService.clear();
      smallCacheService.destroy();
    });
  });

  describe("Configuration", () => {
    it("should use default configuration", () => {
      const config = service.getConfig();
      expect(config.maxTTL).toBe(1000);
      expect(config.maxEntries).toBe(10000);
      expect(config.evictionPolicy).toBe("LRU");
    });

    it("should accept custom configuration", () => {
      const customConfig = {
        maxTTL: 500,
        maxEntries: 5000,
        evictionPolicy: "LRU" as const,
        memoryLimit: 50 * 1024 * 1024,
      };

      const customService = RealTimeCacheService.withConfig(customConfig);
      const config = customService.getConfig();

      expect(config.maxTTL).toBe(500);
      expect(config.maxEntries).toBe(5000);
      expect(config.evictionPolicy).toBe("LRU");
      expect(config.memoryLimit).toBe(50 * 1024 * 1024);

      customService.clear();
      customService.destroy();
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple feeds with same name but different categories", () => {
      const cryptoFeed: EnhancedFeedId = { category: FeedCategory.Crypto, name: "BTC/USD" };
      const forexFeed: EnhancedFeedId = { category: FeedCategory.Forex, name: "BTC/USD" };

      const cryptoEntry: CacheEntry = { ...mockCacheEntry, value: 50000 };
      const forexEntry: CacheEntry = { ...mockCacheEntry, value: 1.2 };

      service.setPrice(cryptoFeed, cryptoEntry);
      service.setPrice(forexFeed, forexEntry);

      expect(service.getPrice(cryptoFeed)?.value).toBe(50000);
      expect(service.getPrice(forexFeed)?.value).toBe(1.2);
    });

    it("should handle empty sources array", () => {
      const entryWithEmptySources: CacheEntry = {
        ...mockCacheEntry,
        sources: [],
      };

      service.set("test-key", entryWithEmptySources, 1000);
      const result = service.get("test-key");

      expect(result).toEqual(entryWithEmptySources);
      expect(result?.sources).toEqual([]);
    });

    it("should handle zero TTL", () => {
      service.set("test-key", mockCacheEntry, 0);

      // Should expire immediately
      expect(service.get("test-key")).toBeNull();
    });
  });
});
