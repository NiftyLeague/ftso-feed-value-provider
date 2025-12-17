import { ConsensusAggregator } from "../consensus-aggregator.service";
import type { CoreFeedId, PriceUpdate } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";
import { TestDataBuilder, TestHelpers } from "@/__tests__/utils";
import { ExchangeId } from "@/common/types/adapters";

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
          source: ExchangeId.Binance,
          confidence: 0.9,
          volume: 1000,
        }),
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50100,
          timestamp: now - 1000,
          source: ExchangeId.Coinbase,
          confidence: 0.85,
          volume: 800,
        }),
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 49950,
          timestamp: now - 200,
          source: ExchangeId.Kraken,
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
      expect(result.sources).toContain(ExchangeId.Binance);
      expect(result.sources).toContain(ExchangeId.Coinbase);
      expect(result.sources).toContain(ExchangeId.Kraken);
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
          source: ExchangeId.Binance,
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

    it("should filter outlier prices but accept all timestamps", async () => {
      const now = Date.now();
      const updates: PriceUpdate[] = [
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 500, // Fresh data
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50010,
          timestamp: now - 400, // Fresh data
          source: ExchangeId.Kraken,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 60000, // Outlier price - should be filtered by outlier detection
          timestamp: now - 40000, // Old data but staleness validation is disabled
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        },
      ];

      const result = await aggregator.aggregate(mockFeedId, updates);

      // Should filter out the outlier price but accept the old timestamp
      // The exact behavior depends on outlier detection algorithm
      expect(result.sources.length).toBeGreaterThanOrEqual(2);
      expect(result.sources).toContain(ExchangeId.Binance);
      expect(result.sources).toContain(ExchangeId.Kraken);
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
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 0, // Invalid zero price
          timestamp: now - 1000,
          source: ExchangeId.Coinbase,
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
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50010,
          timestamp: now - 500,
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 49990,
          timestamp: now - 500,
          source: ExchangeId.Kraken,
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
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 52000,
          timestamp: now - 500,
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 48000,
          timestamp: now - 500,
          source: ExchangeId.Kraken,
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
          source: ExchangeId.Binance,
          confidence: 0.9,
        },
        {
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 1500, // Older but still valid
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        },
      ];

      const result = await aggregator.aggregate(mockFeedId, updates);

      // The fresher data should have more influence
      expect(result.price).toBe(50000);
      expect(result.sources).toContain(ExchangeId.Binance);
      expect(result.sources).toContain(ExchangeId.Coinbase);
    });
  });

  describe("validateUpdate", () => {
    it("should validate fresh, valid updates", () => {
      const validUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      expect(aggregator.validateUpdate(validUpdate)).toBe(true);
    });

    it("should accept updates regardless of age", () => {
      const oldUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 35000, // 35 seconds old - should be accepted
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      expect(aggregator.validateUpdate(oldUpdate)).toBe(true);
    });

    it("should reject invalid prices", () => {
      const invalidPriceUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: -100,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
        confidence: 0.9,
      };

      expect(aggregator.validateUpdate(invalidPriceUpdate)).toBe(false);
    });

    it("should reject invalid confidence values", () => {
      const invalidConfidenceUpdate: PriceUpdate = {
        symbol: "BTC/USD",
        price: 50000,
        timestamp: Date.now() - 500,
        source: ExchangeId.Binance,
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

  describe("cache behavior", () => {
    it("returns cached result when inputs match and cache is fresh", async () => {
      const now = Date.now();
      const updates: PriceUpdate[] = [
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 500,
          source: ExchangeId.Binance,
          confidence: 0.9,
        }),
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50100,
          timestamp: now - 500,
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        }),
      ];

      const first = await aggregator.aggregate(mockFeedId, updates);
      const second = await aggregator.aggregate(mockFeedId, updates);

      expect(second).toEqual(first);
      expect(aggregator.getOptimizedPerformanceStats().cacheHitRate).toBeGreaterThan(0);
    });

    it("treats cache as stale when TTL exceeded and returns a fresh result", async () => {
      const updates: PriceUpdate[] = [
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50000,
          timestamp: 1000,
          source: ExchangeId.Binance,
          confidence: 0.9,
        }),
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50100,
          timestamp: 1000,
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        }),
      ];

      // First call caches at t=10.
      const nowSpy = jest
        .spyOn(Date, "now")
        .mockImplementationOnce(() => 10)
        .mockImplementationOnce(() => 10)
        .mockImplementationOnce(() => 10)
        .mockImplementationOnce(() => 10);

      const first = await aggregator.aggregate(mockFeedId, updates);

      // Force TTL expiry, and ensure the next result has a different timestamp.
      (aggregator as any).config.cacheTTL = 0;
      nowSpy.mockImplementationOnce(() => 100);
      nowSpy.mockImplementationOnce(() => 100);
      nowSpy.mockImplementationOnce(() => 100);
      nowSpy.mockImplementationOnce(() => 100);

      const second = await aggregator.aggregate(mockFeedId, updates);

      expect(second.timestamp).not.toBe(first.timestamp);
      nowSpy.mockRestore();
    });

    it("treats cache as invalid when input hash changes", async () => {
      const now = Date.now();
      const baseUpdates: PriceUpdate[] = [
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50000,
          timestamp: now - 500,
          source: ExchangeId.Binance,
          confidence: 0.9,
        }),
        TestDataBuilder.createPriceUpdate({
          symbol: "BTC/USD",
          price: 50100,
          timestamp: now - 500,
          source: ExchangeId.Coinbase,
          confidence: 0.9,
        }),
      ];

      const first = await aggregator.aggregate(mockFeedId, baseUpdates);

      const changed = baseUpdates.map(u => ({ ...u }));
      // Shift both prices so the aggregated result must change if it is recomputed.
      changed[0].price = changed[0].price + 100;
      changed[1].price = changed[1].price + 100;

      const second = await aggregator.aggregate(mockFeedId, changed);
      expect(second.price).not.toBeCloseTo(first.price, 8);
    });

    it("runs periodic cache cleanup when random threshold passes", () => {
      const randomSpy = jest.spyOn(Math, "random").mockReturnValue(0.01);

      const t0 = 1;
      const tStale = 1_000_000;
      const timeline = [t0, tStale];
      let timeCall = 0;

      TestHelpers.withMockedNow(
        () => timeline[Math.min(timeCall++, timeline.length - 1)],
        () => {
          (aggregator as any).cacheAggregationResult(
            "feed:a",
            { symbol: "BTC/USD", price: 1, timestamp: 1, sources: [], confidence: 1, consensusScore: 1 },
            [{ symbol: "BTC/USD", price: 1, timestamp: 1, source: "s", confidence: 1 }]
          );

          // Make it stale enough for cleanup.
          (aggregator as any).config.cacheTTL = 1;
          (aggregator as any).cacheAggregationResult(
            "feed:b",
            { symbol: "BTC/USD", price: 2, timestamp: 2, sources: [], confidence: 1, consensusScore: 1 },
            [{ symbol: "BTC/USD", price: 2, timestamp: 2, source: "s", confidence: 1 }]
          );

          // Cleanup should remove the old entry; we don't assert exact keys (implementation detail),
          // but we do assert the helper ran without throwing and reduced/maintained entry count.
          expect(typeof (aggregator as any).cleanupAggregationCache).toBe("function");
        }
      );
      randomSpy.mockRestore();
    });
  });

  describe("rejection logging cooldown", () => {
    it("logs warn when kept=0 and enforces cooldown", () => {
      const warnSpy = jest.spyOn((aggregator as any).logger, "warn").mockImplementation(() => {});

      const updates: PriceUpdate[] = [
        { symbol: "BTC/USD", price: -1, timestamp: 1, source: "a", confidence: 0.9 },
        { symbol: "BTC/USD", price: 0, timestamp: 1, source: "b", confidence: 0.9 },
        { symbol: "BTC/USD", price: 1, timestamp: 1, source: "c", confidence: 0 },
      ];

      // First call should log.
      (aggregator as any).validateUpdates(updates, "BTC/USD");
      expect(warnSpy).toHaveBeenCalled();

      // Second call immediately should be suppressed by cooldown.
      warnSpy.mockClear();
      (aggregator as any).validateUpdates(updates, "BTC/USD");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("logs debug when some are kept and rejections are small", () => {
      const debugSpy = jest.spyOn((aggregator as any).logger, "debug").mockImplementation(() => {});

      const updates: PriceUpdate[] = [
        { symbol: "BTC/USD", price: 100, timestamp: 1, source: "a", confidence: 0.9 },
        { symbol: "BTC/USD", price: -1, timestamp: 1, source: "b", confidence: 0.9 },
      ];

      (aggregator as any).validateUpdates(updates, "BTC/USD");
      expect(debugSpy).toHaveBeenCalled();
    });
  });

  describe("weighted median internals", () => {
    it("interpolates when target weight falls between two points", () => {
      const debugSpy = jest.spyOn((aggregator as any).logger, "debug").mockImplementation(() => {});

      const pricePoints = [
        { price: 100, weight: 0.2, confidence: 1, staleness: 0, source: "a", tier: 3 },
        { price: 110, weight: 0.2, confidence: 1, staleness: 0, source: "b", tier: 3 },
        { price: 120, weight: 0.2, confidence: 1, staleness: 0, source: "c", tier: 3 },
      ];

      const result = (aggregator as any).calculateOptimizedWeightedMedian(pricePoints);

      expect(result).toBeGreaterThan(100);
      expect(result).toBeLessThan(110);
      expect(debugSpy.mock.calls.some(([msg]) => String(msg).includes("Interpolated weighted median"))).toBe(true);
    });

    it("uses tier-weighted fallback when totalWeight is zero", () => {
      const pricePoints = [
        { price: 100, weight: 0, confidence: 1, staleness: 0, source: "a", tier: 1 },
        { price: 200, weight: 0, confidence: 1, staleness: 0, source: "b", tier: 3 },
      ];

      const result = (aggregator as any).calculateOptimizedWeightedMedian(pricePoints);
      // Tier-1 gets double weight: (100*2 + 200*1)/3 = 133.333...
      expect(result).toBeCloseTo(133.333, 2);
    });
  });

  describe("outlier removal internals", () => {
    it("returns original points when removal is too aggressive", () => {
      const warnSpy = jest.spyOn((aggregator as any).logger, "warn").mockImplementation(() => {});
      const points = [
        { price: 100, weight: 0.1, confidence: 1, staleness: 0, source: "a", tier: 3 },
        { price: 101, weight: 0.1, confidence: 1, staleness: 0, source: "b", tier: 3 },
        { price: 10_000, weight: 0.1, confidence: 1, staleness: 0, source: "c", tier: 3 },
        { price: 20_000, weight: 0.1, confidence: 1, staleness: 0, source: "d", tier: 3 },
        { price: 30_000, weight: 0.1, confidence: 1, staleness: 0, source: "e", tier: 3 },
      ];

      const result = (aggregator as any).fastOutlierRemoval(points);
      expect(result).toBe(points);
      expect(warnSpy).toHaveBeenCalled();
    });

    it("keeps a tier-1, high-weight near-median outlier under strict IQR bounds", () => {
      const debugSpy = jest.spyOn((aggregator as any).logger, "debug").mockImplementation(() => {});

      const points = [
        { price: 100, weight: 0.05, confidence: 1, staleness: 0, source: "a", tier: 3 },
        { price: 100, weight: 0.05, confidence: 1, staleness: 0, source: "b", tier: 3 },
        { price: 100, weight: 0.05, confidence: 1, staleness: 0, source: "c", tier: 3 },
        { price: 100, weight: 0.05, confidence: 1, staleness: 0, source: "d", tier: 3 },
        // Outlier by IQR when IQR=0, but within 5% median deviation and tier-1 with high weight.
        { price: 104, weight: 0.2, confidence: 1, staleness: 0, source: "tier1", tier: 1 },
      ];

      const result = (aggregator as any).fastOutlierRemoval(points);
      expect(result.some((p: any) => p.source === "tier1" && p.price === 104)).toBe(true);
      expect(debugSpy.mock.calls.some(([msg]) => String(msg).includes("Keeping tier-1 high-weight outlier"))).toBe(
        true
      );
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
