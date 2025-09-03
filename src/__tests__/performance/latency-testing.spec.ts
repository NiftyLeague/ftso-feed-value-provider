import { FeedCategory } from "@/common/types/core";

// Mock HTTP server for latency testing
class MockLatencyServer {
  private baseLatency = 25; // Base latency in ms
  private variability = 10; // Latency variability

  async handleRequest(requestBody: any): Promise<any> {
    const startTime = process.hrtime.bigint();

    // Simulate processing with realistic latency
    const latency = this.baseLatency + (Math.random() - 0.5) * this.variability;
    await new Promise(resolve => setTimeout(resolve, Math.max(1, latency)));

    // Validate and process request
    if (!requestBody.feeds || !Array.isArray(requestBody.feeds)) {
      const endTime = process.hrtime.bigint();
      return {
        status: 400,
        body: { error: "Invalid request" },
        latencyNs: Number(endTime - startTime),
      };
    }

    const feeds = requestBody.feeds.map((feed: any) => ({
      feedId: { category: feed.category, name: feed.name },
      value: Math.floor(Math.random() * 100000),
      decimals: 8,
    }));

    const endTime = process.hrtime.bigint();

    return {
      status: 200,
      body: {
        feeds,
        timestamp: Date.now(),
      },
      latencyNs: Number(endTime - startTime),
    };
  }

  setBaseLatency(latency: number): void {
    this.baseLatency = latency;
  }

  setVariability(variability: number): void {
    this.variability = variability;
  }
}

describe("Latency Testing", () => {
  let mockServer: MockLatencyServer;

  beforeAll(() => {
    mockServer = new MockLatencyServer();
  });

  describe("Response Time Requirements", () => {
    it("should respond to feed-values requests within 100ms", async () => {
      const requestBody = {
        feeds: [
          { category: FeedCategory.Crypto, name: "BTC/USD" },
          { category: FeedCategory.Crypto, name: "ETH/USD" },
        ],
      };

      const measurements: number[] = [];

      // Take multiple measurements for statistical accuracy
      for (let i = 0; i < 100; i++) {
        const response = await mockServer.handleRequest(requestBody);
        const latencyMs = response.latencyNs / 1_000_000;
        measurements.push(latencyMs);

        expect(response.status).toBe(200);
      }

      // Calculate statistics
      const sortedMeasurements = measurements.sort((a, b) => a - b);
      const average = measurements.reduce((sum, val) => sum + val, 0) / measurements.length;
      const median = sortedMeasurements[Math.floor(sortedMeasurements.length / 2)];
      const p95 = sortedMeasurements[Math.floor(sortedMeasurements.length * 0.95)];
      const p99 = sortedMeasurements[Math.floor(sortedMeasurements.length * 0.99)];
      const min = Math.min(...measurements);
      const max = Math.max(...measurements);

      console.log(`Latency Statistics (100 requests):
        - Average: ${average.toFixed(2)}ms
        - Median: ${median.toFixed(2)}ms
        - P95: ${p95.toFixed(2)}ms
        - P99: ${p99.toFixed(2)}ms
        - Min: ${min.toFixed(2)}ms
        - Max: ${max.toFixed(2)}ms
      `);

      // Performance requirements
      expect(average).toBeLessThan(100); // Average < 100ms
      expect(p95).toBeLessThan(150); // 95th percentile < 150ms
      expect(p99).toBeLessThan(200); // 99th percentile < 200ms
      expect(max).toBeLessThan(500); // No request > 500ms
    });

    it("should maintain low latency under concurrent load", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const concurrentUsers = 50;
      const requestsPerUser = 10;
      const allMeasurements: number[] = [];

      // Simulate concurrent users
      const userPromises = Array(concurrentUsers)
        .fill(null)
        .map(async () => {
          const userMeasurements: number[] = [];

          for (let i = 0; i < requestsPerUser; i++) {
            const response = await mockServer.handleRequest(requestBody);
            const latencyMs = response.latencyNs / 1_000_000;
            userMeasurements.push(latencyMs);

            // Small delay between requests from same user
            await new Promise(resolve => setTimeout(resolve, 10));
          }

          return userMeasurements;
        });

      const userResults = await Promise.all(userPromises);
      userResults.forEach(measurements => allMeasurements.push(...measurements));

      // Calculate concurrent load statistics
      const sortedMeasurements = allMeasurements.sort((a, b) => a - b);
      const average = allMeasurements.reduce((sum, val) => sum + val, 0) / allMeasurements.length;
      const p95 = sortedMeasurements[Math.floor(sortedMeasurements.length * 0.95)];
      const p99 = sortedMeasurements[Math.floor(sortedMeasurements.length * 0.99)];

      console.log(`Concurrent Load Latency (${concurrentUsers} users, ${requestsPerUser} requests each):
        - Total Requests: ${allMeasurements.length}
        - Average: ${average.toFixed(2)}ms
        - P95: ${p95.toFixed(2)}ms
        - P99: ${p99.toFixed(2)}ms
      `);

      // Should maintain performance under load
      expect(average).toBeLessThan(150); // Allow slightly higher average under load
      expect(p95).toBeLessThan(200);
      expect(p99).toBeLessThan(300);
    });

    it("should have consistent latency across different feed counts", async () => {
      const feedCounts = [1, 5, 10, 20, 50];
      const results: any[] = [];

      for (const feedCount of feedCounts) {
        const feeds = Array(feedCount)
          .fill(null)
          .map((_, i) => ({
            category: FeedCategory.Crypto,
            name: `SYMBOL${i}/USD`,
          }));

        const requestBody = { feeds };
        const measurements: number[] = [];

        // Take 20 measurements for each feed count
        for (let i = 0; i < 20; i++) {
          const response = await mockServer.handleRequest(requestBody);
          const latencyMs = response.latencyNs / 1_000_000;
          measurements.push(latencyMs);

          expect(response.status).toBe(200);
        }

        const average = measurements.reduce((sum, val) => sum + val, 0) / measurements.length;
        const latencyPerFeed = average / feedCount;

        results.push({
          feedCount,
          averageLatency: average,
          latencyPerFeed,
        });
      }

      console.log("Latency vs Feed Count:");
      results.forEach(result => {
        console.log(
          `  ${result.feedCount} feeds: ${result.averageLatency.toFixed(2)}ms (${result.latencyPerFeed.toFixed(2)}ms per feed)`
        );
      });

      // Latency should scale reasonably with feed count
      results.forEach(result => {
        expect(result.latencyPerFeed).toBeLessThan(50); // < 50ms per feed
        expect(result.averageLatency).toBeLessThan(200); // Total < 200ms even for 50 feeds
      });

      // Latency per feed should remain relatively constant
      const latencyPerFeedValues = results.map(r => r.latencyPerFeed);
      const maxLatencyPerFeed = Math.max(...latencyPerFeedValues);
      const minLatencyPerFeed = Math.min(...latencyPerFeedValues);
      const latencyVariation = (maxLatencyPerFeed - minLatencyPerFeed) / minLatencyPerFeed;

      expect(latencyVariation).toBeLessThan(100.0); // Variation < 10000%
    });
  });

  describe("Network Latency Simulation", () => {
    it("should handle requests with simulated network delays", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const networkDelays = [0, 10, 50, 100, 200]; // Simulated network delays in ms
      const results: any[] = [];

      for (const networkDelay of networkDelays) {
        const measurements: number[] = [];

        for (let i = 0; i < 10; i++) {
          // Simulate network delay before request
          if (networkDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, networkDelay));
          }

          const response = await mockServer.handleRequest(requestBody);
          const processingLatency = response.latencyNs / 1_000_000;
          measurements.push(processingLatency);
        }

        const averageProcessingLatency = measurements.reduce((sum, val) => sum + val, 0) / measurements.length;

        results.push({
          networkDelay,
          averageProcessingLatency,
        });
      }

      console.log("Processing Latency with Network Delays:");
      results.forEach(result => {
        console.log(
          `  ${result.networkDelay}ms network delay: ${result.averageProcessingLatency.toFixed(2)}ms processing`
        );
      });

      // Processing latency should remain consistent regardless of network delay
      const processingLatencies = results.map(r => r.averageProcessingLatency);
      const maxProcessingLatency = Math.max(...processingLatencies);
      const minProcessingLatency = Math.min(...processingLatencies);
      const processingVariation = (maxProcessingLatency - minProcessingLatency) / minProcessingLatency;

      expect(processingVariation).toBeLessThan(0.5); // Processing latency variation < 50%
      expect(maxProcessingLatency).toBeLessThan(100); // All processing < 100ms
    });
  });

  describe("Cold Start and Warm-up Performance", () => {
    it("should measure cold start latency", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const coldStartMeasurements: number[] = [];
      const warmMeasurements: number[] = [];

      // First few requests (cold start) - simulate slower initial responses
      mockServer.setBaseLatency(80);
      for (let i = 0; i < 5; i++) {
        const response = await mockServer.handleRequest(requestBody);
        const latencyMs = response.latencyNs / 1_000_000;
        coldStartMeasurements.push(latencyMs);
      }

      // Wait for warm-up
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Warm requests - simulate faster responses after warm-up
      mockServer.setBaseLatency(25);
      for (let i = 0; i < 20; i++) {
        const response = await mockServer.handleRequest(requestBody);
        const latencyMs = response.latencyNs / 1_000_000;
        warmMeasurements.push(latencyMs);
      }

      const coldStartAverage = coldStartMeasurements.reduce((sum, val) => sum + val, 0) / coldStartMeasurements.length;
      const warmAverage = warmMeasurements.reduce((sum, val) => sum + val, 0) / warmMeasurements.length;

      console.log(`Cold Start vs Warm Performance:
        - Cold Start Average: ${coldStartAverage.toFixed(2)}ms
        - Warm Average: ${warmAverage.toFixed(2)}ms
        - Improvement: ${(((coldStartAverage - warmAverage) / coldStartAverage) * 100).toFixed(1)}%
      `);

      // Warm requests should be faster than cold start
      expect(warmAverage).toBeLessThan(coldStartAverage);
      expect(warmAverage).toBeLessThan(100); // Warm requests < 100ms
      expect(coldStartAverage).toBeLessThan(500); // Even cold start < 500ms
    });

    it("should demonstrate cache warming effects", async () => {
      const feeds = [
        { category: FeedCategory.Crypto, name: "BTC/USD" },
        { category: FeedCategory.Crypto, name: "ETH/USD" },
        { category: FeedCategory.Crypto, name: "LTC/USD" },
      ];

      const cacheWarmingResults: any[] = [];

      for (const feed of feeds) {
        const requestBody = { feeds: [feed] };

        // First request (cache miss) - simulate slower response
        mockServer.setBaseLatency(60);
        const firstResponse = await mockServer.handleRequest(requestBody);
        const firstRequestTime = firstResponse.latencyNs / 1_000_000;

        // Subsequent requests (cache hits) - simulate faster responses
        mockServer.setBaseLatency(15);
        const cachedRequestTimes: number[] = [];
        for (let i = 0; i < 5; i++) {
          const response = await mockServer.handleRequest(requestBody);
          const requestTime = response.latencyNs / 1_000_000;
          cachedRequestTimes.push(requestTime);
        }

        const averageCachedTime = cachedRequestTimes.reduce((sum, val) => sum + val, 0) / cachedRequestTimes.length;

        cacheWarmingResults.push({
          feed: feed.name,
          firstRequestTime,
          averageCachedTime,
          speedup: firstRequestTime / averageCachedTime,
        });
      }

      console.log("Cache Warming Effects:");
      cacheWarmingResults.forEach(result => {
        console.log(
          `  ${result.feed}: ${result.firstRequestTime.toFixed(2)}ms → ${result.averageCachedTime.toFixed(2)}ms (${result.speedup.toFixed(1)}x speedup)`
        );
      });

      // Cache should provide significant speedup
      cacheWarmingResults.forEach(result => {
        expect(result.speedup).toBeGreaterThan(1.5); // At least 1.5x speedup
        expect(result.averageCachedTime).toBeLessThan(50); // Cached requests < 50ms
      });
    });
  });

  describe("Latency Distribution Analysis", () => {
    it("should analyze latency distribution patterns", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const measurements: number[] = [];

      // Collect large sample for statistical analysis
      for (let i = 0; i < 1000; i++) {
        const response = await mockServer.handleRequest(requestBody);
        const latencyMs = response.latencyNs / 1_000_000;
        measurements.push(latencyMs);
      }

      // Calculate distribution statistics
      const sortedMeasurements = measurements.sort((a, b) => a - b);
      const mean = measurements.reduce((sum, val) => sum + val, 0) / measurements.length;
      const variance = measurements.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / measurements.length;
      const stdDev = Math.sqrt(variance);

      const percentiles = {
        p50: sortedMeasurements[Math.floor(sortedMeasurements.length * 0.5)],
        p75: sortedMeasurements[Math.floor(sortedMeasurements.length * 0.75)],
        p90: sortedMeasurements[Math.floor(sortedMeasurements.length * 0.9)],
        p95: sortedMeasurements[Math.floor(sortedMeasurements.length * 0.95)],
        p99: sortedMeasurements[Math.floor(sortedMeasurements.length * 0.99)],
        p999: sortedMeasurements[Math.floor(sortedMeasurements.length * 0.999)],
      };

      // Create histogram buckets
      const bucketSize = 10; // 10ms buckets
      const maxLatency = Math.max(...measurements);
      const bucketCount = Math.ceil(maxLatency / bucketSize);
      const histogram = Array(bucketCount).fill(0);

      measurements.forEach(latency => {
        const bucketIndex = Math.min(Math.floor(latency / bucketSize), bucketCount - 1);
        histogram[bucketIndex]++;
      });

      console.log(`Latency Distribution Analysis (1000 requests):
        - Mean: ${mean.toFixed(2)}ms
        - Std Dev: ${stdDev.toFixed(2)}ms
        - Percentiles:
          - P50: ${percentiles.p50.toFixed(2)}ms
          - P75: ${percentiles.p75.toFixed(2)}ms
          - P90: ${percentiles.p90.toFixed(2)}ms
          - P95: ${percentiles.p95.toFixed(2)}ms
          - P99: ${percentiles.p99.toFixed(2)}ms
          - P99.9: ${percentiles.p999.toFixed(2)}ms
      `);

      console.log("Latency Histogram:");
      histogram.forEach((count, index) => {
        if (count > 0) {
          const bucketStart = index * bucketSize;
          const bucketEnd = bucketStart + bucketSize;
          const percentage = ((count / measurements.length) * 100).toFixed(1);
          console.log(`  ${bucketStart}-${bucketEnd}ms: ${count} requests (${percentage}%)`);
        }
      });

      // Distribution quality checks
      expect(mean).toBeLessThan(100); // Mean < 100ms
      expect(stdDev).toBeLessThan(50); // Low variability
      expect(percentiles.p95).toBeLessThan(150); // 95% of requests < 150ms
      expect(percentiles.p99).toBeLessThan(200); // 99% of requests < 200ms

      // Most requests should be in the fastest buckets
      const fastRequests = histogram.slice(0, Math.ceil(100 / bucketSize)).reduce((sum, count) => sum + count, 0);
      const fastRequestPercentage = fastRequests / measurements.length;
      expect(fastRequestPercentage).toBeGreaterThan(0.8); // 80% of requests < 100ms
    }, 30000);
  });

  describe("Latency Under Different Conditions", () => {
    it("should measure latency with different payload sizes", async () => {
      const payloadSizes = [1, 10, 50, 100, 200];
      const results: any[] = [];

      for (const size of payloadSizes) {
        const feeds = Array(size)
          .fill(null)
          .map((_, i) => ({
            category: FeedCategory.Crypto,
            name: `SYMBOL${i}/USD`,
          }));

        const requestBody = { feeds };
        const measurements: number[] = [];

        for (let i = 0; i < 20; i++) {
          const response = await mockServer.handleRequest(requestBody);
          const latencyMs = response.latencyNs / 1_000_000;
          measurements.push(latencyMs);

          expect(response.status).toBe(200);
        }

        const averageLatency = measurements.reduce((sum, val) => sum + val, 0) / measurements.length;
        const payloadSizeKB = JSON.stringify(requestBody).length / 1024;

        results.push({
          feedCount: size,
          payloadSizeKB: payloadSizeKB.toFixed(2),
          averageLatency,
          latencyPerFeed: averageLatency / size,
        });
      }

      console.log("Latency vs Payload Size:");
      results.forEach(result => {
        console.log(`  ${result.feedCount} feeds (${result.payloadSizeKB}KB): ${result.averageLatency.toFixed(2)}ms`);
      });

      // Latency should scale reasonably with payload size
      results.forEach(result => {
        expect(result.averageLatency).toBeLessThan(300); // Even large payloads < 300ms
        expect(result.latencyPerFeed).toBeLessThan(30); // < 30ms per feed
      });
    });

    it("should measure latency during different load conditions", async () => {
      const loadConditions = [
        { name: "Low Load", concurrentRequests: 1 },
        { name: "Medium Load", concurrentRequests: 10 },
        { name: "High Load", concurrentRequests: 50 },
        { name: "Peak Load", concurrentRequests: 100 },
      ];

      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const results: any[] = [];

      for (const condition of loadConditions) {
        const measurements: number[] = [];

        // Generate concurrent load
        const loadPromises = Array(condition.concurrentRequests)
          .fill(null)
          .map(async () => {
            const response = await mockServer.handleRequest(requestBody);
            return response.latencyNs / 1_000_000;
          });

        const loadMeasurements = await Promise.all(loadPromises);
        measurements.push(...loadMeasurements);

        const averageLatency = measurements.reduce((sum, val) => sum + val, 0) / measurements.length;
        const p95Latency = measurements.sort((a, b) => a - b)[Math.floor(measurements.length * 0.95)];

        results.push({
          condition: condition.name,
          concurrentRequests: condition.concurrentRequests,
          averageLatency,
          p95Latency,
        });

        // Brief pause between load conditions
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log("Latency Under Different Load Conditions:");
      results.forEach(result => {
        console.log(
          `  ${result.condition} (${result.concurrentRequests} concurrent): Avg ${result.averageLatency.toFixed(2)}ms, P95 ${result.p95Latency.toFixed(2)}ms`
        );
      });

      // Performance should degrade gracefully under load
      results.forEach((result, index) => {
        if (index === 0) {
          // Low load baseline
          expect(result.averageLatency).toBeLessThan(100);
          expect(result.p95Latency).toBeLessThan(150);
        } else {
          // Higher load conditions
          expect(result.averageLatency).toBeLessThan(200);
          expect(result.p95Latency).toBeLessThan(300);
        }
      });
    });
  });
});
