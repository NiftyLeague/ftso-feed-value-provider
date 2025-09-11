import { ConsensusAggregator } from "../consensus-aggregator.service";
import type { CoreFeedId, PriceUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";
import { TestDataBuilder } from "@/__tests__/utils";

describe("ConsensusAggregator", () => {
  let aggregator: ConsensusAggregator;
  let mockFeedId: CoreFeedId;

  beforeEach(() => {
    aggregator = new ConsensusAggregator();
    mockFeedId = TestDataBuilder.createCoreFeedId({ category: FeedCategory.Crypto, name: "BTC/USD" });
  });

  describe("aggregate", () => {
    it("should aggregate prices using weighted median with time decay", async () => {
      const now = Date.now();
      const updates: PriceUpdate[] = [
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 500,
          source: "binance",
          confidence: 0.9,
          volume: 1000,
        }),
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50100,
          timestamp: now - 1000,
          source: "coinbase",
          confidence: 0.85,
          volume: 800,
        }),
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 49950,
          timestamp: now - 200,
          source: "kraken",
          confidence: 0.8,
          volume: 600,
        }),
      ];

      const result = await aggregator.aggregate(mockFeedId, updates);

      expect(result).toBeDefined();
      expect(result.symbol).toBe("BTC/USD");
      expect(result.price).toBeGreaterThan(49900);
      expect(result.price).toBeLessThan(50200);
      expect(result.sources).toHaveLength(3);
      expect(result.sources).toContain("binance");
      expect(result.sources).toContain("coinbase");
      expect(result.sources).toContain("kraken");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.consensusScore).toBeGreaterThan(0);
      expect(result.consensusScore).toBeLessThanOrEqual(1);
    });

    it("should handle tier-based weight adjustment", async () => {
      const now = Date.now();
      const updates: PriceUpdate[] = [
        // Tier 1 exchange (custom adapter)
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 500,
          source: "binance",
          confidence: 0.9,
        },
        // Tier 2 exchange (CCXT individual)
        {
          symbol: "BTC/USD",
          price: 50200,
          timestamp: now - 500,
          source: "bitmart",
          confidence: 0.9,
        },
      ];

      const result = await aggregator.aggregate(mockFeedId, updates);

      // The result should be closer to the Tier 1 exchange price due to higher weight
      expect(result.price).toBeCloserTo(50000, 50200);
    });

    it("should reject stale data beyond threshold", async () => {
      const now = Date.now();
      const updates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 500, // Fresh data
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50010,
          timestamp: now - 400, // Fresh data
          source: "kraken",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 60000, // Outlier price
          timestamp: now - 3000, // Stale data (3 seconds old)
          source: "coinbase",
          confidence: 0.9,
        },
      ];

      const result = await aggregator.aggregate(mockFeedId, updates);

      // Should only use the fresh data (2 sources)
      expect(result.sources).toHaveLength(2);
      expect(result.sources).toContain("binance");
      expect(result.sources).toContain("kraken");
      expect(result.sources).not.toContain("coinbase");
      expect(result.price).toBeGreaterThan(49990);
      expect(result.price).toBeLessThan(50020);
    });

    it("should handle empty updates array", async () => {
      const updates: PriceUpdate[] = [];

      await expect(aggregator.aggregate(mockFeedId, updates)).rejects.toThrow(
        "No price updates available for feed BTC/USD"
      );
    });

    it("should handle all invalid updates", async () => {
      const now = Date.now();
      const updates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: -100, // Invalid negative price
          timestamp: now - 500,
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 5000, // Too stale
          source: "coinbase",
          confidence: 0.9,
        },
      ];

      await expect(aggregator.aggregate(mockFeedId, updates)).rejects.toThrow(
        "No valid price data available for feed BTC/USD"
      );
    });

    it("should calculate consensus score correctly", async () => {
      const now = Date.now();

      // Test with prices close together (high consensus)
      const highConsensusUpdates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 500,
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50010,
          timestamp: now - 500,
          source: "coinbase",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 49990,
          timestamp: now - 500,
          source: "kraken",
          confidence: 0.9,
        },
      ];

      const highConsensusResult = await aggregator.aggregate(mockFeedId, highConsensusUpdates);

      // Test with prices far apart (low consensus)
      const lowConsensusUpdates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 500,
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 52000,
          timestamp: now - 500,
          source: "coinbase",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 48000,
          timestamp: now - 500,
          source: "kraken",
          confidence: 0.9,
        },
      ];

      const lowConsensusResult = await aggregator.aggregate(mockFeedId, lowConsensusUpdates);

      expect(highConsensusResult.consensusScore).toBeGreaterThan(lowConsensusResult.consensusScore);
    });

    it("should apply exponential time decay correctly", async () => {
      const now = Date.now();

      // Two identical prices, one much fresher
      const updates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 100, // Very fresh
          source: "binance",
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 1500, // Older but still valid
          source: "coinbase",
          confidence: 0.9,
        },
      ];

      const result = await aggregator.aggregate(mockFeedId, updates);

      // The fresher data should have more influence
      expect(result.price).toBe(50000);
      expect(result.sources).toContain("binance");
      expect(result.sources).toContain("coinbase");
    });
  });

  describe("validateUpdate", () => {
    it("should validate fresh, valid updates", () => {
      const validUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
        confidence: 0.9,
      };

      expect(aggregator.validateUpdate(validUpdate)).toBe(true);
    });

    it("should reject stale updates", () => {
      const staleUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 3000, // 3 seconds old
        source: "binance",
        confidence: 0.9,
      };

      expect(aggregator.validateUpdate(staleUpdate)).toBe(false);
    });

    it("should reject invalid prices", () => {
      const invalidPriceUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: -100,
        timestamp: Date.now() - 500,
        source: "binance",
        confidence: 0.9,
      };

      expect(aggregator.validateUpdate(invalidPriceUpdate)).toBe(false);
    });

    it("should reject invalid confidence values", () => {
      const invalidConfidenceUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: "binance",
        confidence: 1.5, // > 1.0
      };

      expect(aggregator.validateUpdate(invalidConfidenceUpdate)).toBe(false);
    });
  });

  describe("getQualityMetrics", () => {
    it("should return quality metrics structure", async () => {
      const metrics = await aggregator.getQualityMetrics(mockFeedId);

      expect(metrics).toBeDefined();
      expect(metrics.accuracy).toBeGreaterThanOrEqual(0);
      expect(metrics.accuracy).toBeLessThanOrEqual(1);
      expect(metrics.latency).toBeGreaterThanOrEqual(0);
      expect(metrics.coverage).toBeGreaterThanOrEqual(0);
      expect(metrics.coverage).toBeLessThanOrEqual(1);
      expect(metrics.reliability).toBeGreaterThanOrEqual(0);
      expect(metrics.reliability).toBeLessThanOrEqual(1);
      expect(metrics.consensusAlignment).toBeGreaterThanOrEqual(0);
      expect(metrics.consensusAlignment).toBeLessThanOrEqual(1);
    });
  });

  describe("configuration", () => {
    it("should provide performance statistics", () => {
      const stats = aggregator.getOptimizedPerformanceStats();

      expect(stats.totalAggregations).toBeDefined();
      expect(stats.averageTime).toBeDefined();
      expect(stats.cacheHitRate).toBeDefined();
    });
  });
});

// Helper function for testing
expect.extend({
  toBeCloserTo(received: number, expected1: number, expected2: number) {
    const diff1 = Math.abs(received - expected1);
    const diff2 = Math.abs(received - expected2);
    const pass = diff1 < diff2;

    return {
      message: () => `expected ${received} to be closer to ${expected1} than to ${expected2}`,
      pass,
    };
  },
});

declare global {
  namespace jest {
    interface Matchers<R> {
      toBeCloserTo(expected1: number, expected2: number): R;
    }
  }
}
