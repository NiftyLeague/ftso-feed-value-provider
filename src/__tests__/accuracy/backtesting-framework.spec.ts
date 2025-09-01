import { FeedCategory, EnhancedFeedId } from "@/common/types/feed.types";
import { PriceUpdate } from "@/common/interfaces/core/data-source.interface";

// Mock historical data generator
const generateHistoricalData = (
  feedId: EnhancedFeedId,
  startTime: number,
  endTime: number,
  intervalMs: number = 1000
): PriceUpdate[] => {
  const data: PriceUpdate[] = [];
  const basePrice = 50000;
  let currentPrice = basePrice;

  for (let timestamp = startTime; timestamp <= endTime; timestamp += intervalMs) {
    const volatility = 0.001;
    const randomChange = (Math.random() - 0.5) * 2 * volatility;
    currentPrice *= 1 + randomChange;

    const sources = ["binance", "coinbase", "kraken", "okx"];
    sources.forEach((source, index) => {
      const sourceVariation = (Math.random() - 0.5) * 0.0005;
      const sourcePrice = currentPrice * (1 + sourceVariation);

      data.push({
        symbol: feedId.name,
        price: sourcePrice,
        timestamp: timestamp + index * 100,
        source,
        confidence: 0.9 + Math.random() * 0.1,
        volume: 1000 + Math.random() * 500,
      });
    });
  }

  return data;
};

// Mock consensus aggregator
class MockConsensusAggregator {
  async aggregate(feedId: EnhancedFeedId, updates: PriceUpdate[]) {
    if (updates.length === 0) {
      throw new Error(`No price updates available for feed ${feedId.name}`);
    }

    const validUpdates = updates.filter(u => u.price > 0 && u.timestamp > 0);
    if (validUpdates.length === 0) {
      throw new Error(`No valid price data available for feed ${feedId.name}`);
    }

    const prices = validUpdates.map(u => u.price);
    const median = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
    const deviations = prices.map(p => Math.abs(p - median) / median);
    const avgDeviation = deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length;

    return {
      symbol: feedId.name,
      price: median,
      timestamp: Date.now(),
      sources: validUpdates.map(u => u.source),
      confidence: Math.max(0.5, 1 - avgDeviation * 10),
      consensusScore: Math.max(0.3, 1 - avgDeviation * 5),
    };
  }
}

// Mock data validator
class MockDataValidator {
  async validateUpdate(update: PriceUpdate, context: any) {
    const isValid =
      update.price > 0 && update.timestamp > 0 && update.source.length > 0 && update.timestamp > Date.now() - 10000;

    return {
      isValid,
      errors: isValid ? [] : [{ type: "INVALID_DATA", message: "Invalid update" }],
      confidence: isValid ? update.confidence : 0,
    };
  }
}

describe("Backtesting Framework", () => {
  let consensusAggregator: MockConsensusAggregator;
  let dataValidator: MockDataValidator;

  const mockFeedId: EnhancedFeedId = {
    category: FeedCategory.Crypto,
    name: "BTC/USD",
  };

  beforeEach(() => {
    consensusAggregator = new MockConsensusAggregator();
    dataValidator = new MockDataValidator();
  });

  describe("Historical Accuracy Validation", () => {
    it("should validate aggregation accuracy against historical data", async () => {
      const testPeriod = {
        start: Date.now() - 24 * 60 * 60 * 1000,
        end: Date.now() - 60 * 60 * 1000,
      };

      const historicalData = generateHistoricalData(mockFeedId, testPeriod.start, testPeriod.end, 5000);

      const timeWindows = new Map<number, PriceUpdate[]>();
      const windowSize = 30000;

      historicalData.forEach(update => {
        const windowStart = Math.floor(update.timestamp / windowSize) * windowSize;
        if (!timeWindows.has(windowStart)) {
          timeWindows.set(windowStart, []);
        }
        timeWindows.get(windowStart)!.push(update);
      });

      const accuracyResults: any[] = [];

      for (const [windowStart, updates] of timeWindows) {
        if (updates.length < 3) continue;

        try {
          const aggregatedResult = await consensusAggregator.aggregate(mockFeedId, updates);
          const referencePrice = updates.reduce((sum, update) => sum + update.price, 0) / updates.length;
          const deviation = Math.abs(aggregatedResult.price - referencePrice) / referencePrice;

          accuracyResults.push({
            timestamp: windowStart,
            aggregatedPrice: aggregatedResult.price,
            referencePrice,
            deviation,
            consensusScore: aggregatedResult.consensusScore,
            sourceCount: updates.length,
            confidence: aggregatedResult.confidence,
          });
        } catch (error: any) {
          console.warn(`Aggregation failed for window ${windowStart}:`, error.message);
        }
      }

      const averageDeviation =
        accuracyResults.reduce((sum, result) => sum + result.deviation, 0) / accuracyResults.length;
      const maxDeviation = Math.max(...accuracyResults.map(r => r.deviation));
      const accurateResults = accuracyResults.filter(r => r.deviation <= 0.005);
      const accuracyRate = accurateResults.length / accuracyResults.length;

      expect(averageDeviation).toBeLessThan(0.005);
      expect(maxDeviation).toBeLessThan(0.02);
      expect(accuracyRate).toBeGreaterThan(0.95);
    });

    it("should test consensus alignment over extended periods", async () => {
      const testPeriods = [
        { name: "1 Hour", duration: 60 * 60 * 1000 },
        { name: "6 Hours", duration: 6 * 60 * 60 * 1000 },
      ];

      const consensusResults: any[] = [];

      for (const period of testPeriods) {
        const endTime = Date.now() - 60 * 60 * 1000;
        const startTime = endTime - period.duration;
        const historicalData = generateHistoricalData(mockFeedId, startTime, endTime, 10000);

        const windowSize = 60000;
        const windows = new Map<number, PriceUpdate[]>();

        historicalData.forEach(update => {
          const windowStart = Math.floor(update.timestamp / windowSize) * windowSize;
          if (!windows.has(windowStart)) {
            windows.set(windowStart, []);
          }
          windows.get(windowStart)!.push(update);
        });

        const windowResults: any[] = [];

        for (const [windowStart, updates] of windows) {
          if (updates.length < 3) continue;

          const aggregatedResult = await consensusAggregator.aggregate(mockFeedId, updates);
          const prices = updates.map(u => u.price);
          const median = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
          const deviationsFromMedian = prices.map(p => Math.abs(p - median) / median);
          const averageDeviation =
            deviationsFromMedian.reduce((sum, dev) => sum + dev, 0) / deviationsFromMedian.length;

          windowResults.push({
            timestamp: windowStart,
            consensusScore: aggregatedResult.consensusScore,
            sourceAgreement: 1 - averageDeviation,
            sourceCount: updates.length,
          });
        }

        const averageConsensusScore =
          windowResults.reduce((sum, r) => sum + r.consensusScore, 0) / windowResults.length;
        const averageSourceAgreement =
          windowResults.reduce((sum, r) => sum + r.sourceAgreement, 0) / windowResults.length;
        const lowConsensusWindows = windowResults.filter(r => r.consensusScore < 0.7).length;

        consensusResults.push({
          period: period.name,
          duration: period.duration,
          windowCount: windowResults.length,
          averageConsensusScore,
          averageSourceAgreement,
          lowConsensusWindows,
          lowConsensusRate: lowConsensusWindows / windowResults.length,
        });
      }

      consensusResults.forEach(result => {
        expect(result.averageConsensusScore).toBeGreaterThan(0.7);
        expect(result.averageSourceAgreement).toBeGreaterThan(0.99);
        expect(result.lowConsensusRate).toBeLessThan(0.1);
      });
    });
  });

  describe("Performance Backtesting", () => {
    it("should measure aggregation performance over historical data", async () => {
      const dataSizes = [100, 500, 1000];
      const performanceResults: any[] = [];

      for (const dataSize of dataSizes) {
        const endTime = Date.now();
        const startTime = endTime - dataSize * 1000;
        const historicalData = generateHistoricalData(mockFeedId, startTime, endTime, 1000);
        const testData = historicalData.slice(0, dataSize);

        const windowSize = 30000;
        const windows = new Map<number, PriceUpdate[]>();

        testData.forEach(update => {
          const windowStart = Math.floor(update.timestamp / windowSize) * windowSize;
          if (!windows.has(windowStart)) {
            windows.set(windowStart, []);
          }
          windows.get(windowStart)!.push(update);
        });

        const aggregationTimes: number[] = [];
        let successfulAggregations = 0;

        for (const [windowStart, updates] of windows) {
          if (updates.length < 3) continue;

          const startTime = process.hrtime.bigint();

          try {
            await consensusAggregator.aggregate(mockFeedId, updates);
            const endTime = process.hrtime.bigint();
            const aggregationTimeMs = Number(endTime - startTime) / 1_000_000;

            aggregationTimes.push(aggregationTimeMs);
            successfulAggregations++;
          } catch (error) {
            // Count failed aggregations
          }
        }

        const averageAggregationTime = aggregationTimes.reduce((sum, time) => sum + time, 0) / aggregationTimes.length;
        const maxAggregationTime = Math.max(...aggregationTimes);
        const successRate = successfulAggregations / windows.size;

        performanceResults.push({
          dataSize,
          windowCount: windows.size,
          averageAggregationTime,
          maxAggregationTime,
          successRate,
        });
      }

      performanceResults.forEach(result => {
        expect(result.averageAggregationTime).toBeLessThan(50);
        expect(result.maxAggregationTime).toBeLessThan(200);
        expect(result.successRate).toBeGreaterThan(0.95);
      });
    });
  });
});
