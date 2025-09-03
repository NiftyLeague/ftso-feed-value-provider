import { FeedCategory } from "@/common/types/core";
import type { MockRequestBody, MockResponse } from "@/common/types/utils";

// Mock HTTP server for load testing
class MockHttpServer {
  private requestCount = 0;
  private responseDelay = 50;

  async handleRequest(requestBody: MockRequestBody): Promise<MockResponse> {
    this.requestCount++;

    // Simulate processing delay
    await new Promise(resolve => setTimeout(resolve, this.responseDelay + Math.random() * 20));

    // Validate request
    if (!requestBody.feeds || !Array.isArray(requestBody.feeds)) {
      return {
        statusCode: 400,
        body: { error: "Invalid request" },
      };
    }

    // Process feeds
    const feeds = requestBody.feeds.map(feed => ({
      feedId: { category: feed.category, name: feed.name },
      value: Math.floor(Math.random() * 100000),
      decimals: 8,
    }));

    return {
      statusCode: 200,
      body: {
        feeds,
        timestamp: Date.now(),
      },
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  setResponseDelay(delay: number): void {
    this.responseDelay = delay;
  }

  reset(): void {
    this.requestCount = 0;
    this.responseDelay = 50;
  }
}

describe("Load Testing", () => {
  let mockServer: MockHttpServer;

  beforeAll(() => {
    mockServer = new MockHttpServer();
  });

  beforeEach(() => {
    mockServer.reset();
  });

  describe("High Request Volume Tests", () => {
    it("should handle 1000 concurrent requests within acceptable time", async () => {
      const requestBody = {
        feeds: [
          { category: FeedCategory.Crypto, name: "BTC/USD" },
          { category: FeedCategory.Crypto, name: "ETH/USD" },
        ],
      };

      const concurrentRequests = 1000;
      const startTime = Date.now();

      const requests = Array(concurrentRequests)
        .fill(null)
        .map(() => mockServer.handleRequest(requestBody));

      const responses = await Promise.allSettled<MockResponse>(requests);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      const successful = responses.filter(
        r => r.status === "fulfilled" && (r as PromiseFulfilledResult<MockResponse>).value.statusCode === 200
      );
      const failed = responses.filter(
        r => r.status === "rejected" || (r as PromiseFulfilledResult<MockResponse>).value?.statusCode !== 200
      );

      console.log(`Load Test Results:
        - Total Requests: ${concurrentRequests}
        - Successful: ${successful.length}
        - Failed: ${failed.length}
        - Total Time: ${totalTime}ms
        - Requests/Second: ${(concurrentRequests / totalTime) * 1000}
        - Average Response Time: ${totalTime / concurrentRequests}ms
      `);

      expect(successful.length).toBeGreaterThan(concurrentRequests * 0.95);
      expect(totalTime).toBeLessThan(30000);
      expect(totalTime / concurrentRequests).toBeLessThan(100);
    });

    it("should maintain response quality under sustained load", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const requestsPerSecond = 100;
      const durationSeconds = 10;
      const totalRequests = requestsPerSecond * durationSeconds;

      const responses: PromiseSettledResult<MockResponse>[] = [];
      const startTime = Date.now();

      for (let second = 0; second < durationSeconds; second++) {
        const secondStart = Date.now();

        const secondRequests = Array(requestsPerSecond)
          .fill(null)
          .map(async () => {
            const response = await mockServer.handleRequest(requestBody);
            return response;
          });

        const secondResponses = await Promise.allSettled<MockResponse>(secondRequests);
        responses.push(...secondResponses);

        const elapsed = Date.now() - secondStart;
        if (elapsed < 1000) {
          await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
        }
      }

      const endTime = Date.now();
      const actualDuration = endTime - startTime;

      const successful = responses.filter(
        r => r.status === "fulfilled" && (r as PromiseFulfilledResult<MockResponse>).value.statusCode === 200
      );
      const actualRps = (successful.length / actualDuration) * 1000;

      console.log(`Sustained Load Test Results:
        - Target RPS: ${requestsPerSecond}
        - Actual RPS: ${actualRps.toFixed(2)}
        - Success Rate: ${((successful.length / responses.length) * 100).toFixed(2)}%
        - Duration: ${actualDuration}ms
      `);

      expect(successful.length).toBeGreaterThan(totalRequests * 0.9);
      expect(actualRps).toBeGreaterThan(requestsPerSecond * 0.8);
    }, 15000);

    it("should handle burst traffic patterns", async () => {
      const requestBody = {
        feeds: [
          { category: FeedCategory.Crypto, name: "BTC/USD" },
          { category: FeedCategory.Crypto, name: "ETH/USD" },
          { category: FeedCategory.Crypto, name: "LTC/USD" },
        ],
      };

      const burstSizes = [50, 100, 200, 500, 100, 50];
      type BurstTestResult = {
        size: number;
        duration: number;
        successful: number;
        successRate: number;
        rps: number;
      };
      const results: BurstTestResult[] = [];

      for (const burstSize of burstSizes) {
        const burstStart = Date.now();

        const burstRequests = Array(burstSize)
          .fill(null)
          .map(() => mockServer.handleRequest(requestBody));

        const burstResponses = await Promise.allSettled<MockResponse>(burstRequests);
        const burstEnd = Date.now();
        const burstDuration = burstEnd - burstStart;

        const successful = burstResponses.filter(
          r => r.status === "fulfilled" && (r as PromiseFulfilledResult<MockResponse>).value.statusCode === 200
        );

        results.push({
          size: burstSize,
          duration: burstDuration,
          successful: successful.length,
          successRate: successful.length / burstSize,
          rps: (successful.length / burstDuration) * 1000,
        });

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      console.log("Burst Traffic Results:", results);

      results.forEach(result => {
        expect(result.successRate).toBeGreaterThan(0.8);
        expect(result.duration).toBeLessThan(10000);
      });
    }, 15000);
  });

  describe("Memory and Resource Usage Tests", () => {
    it("should maintain stable memory usage under load", async () => {
      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const initialMemory = process.memoryUsage();
      console.log("Initial Memory Usage:", initialMemory);

      for (let batch = 0; batch < 10; batch++) {
        const batchRequests = Array(100)
          .fill(null)
          .map(() => mockServer.handleRequest(requestBody));

        await Promise.allSettled(batchRequests);

        if (global.gc) {
          global.gc();
        }

        const currentMemory = process.memoryUsage();
        const memoryIncrease = currentMemory.heapUsed - initialMemory.heapUsed;
        const memoryIncreaseMB = memoryIncrease / 1024 / 1024;

        console.log(`Batch ${batch + 1} Memory Usage:`, {
          heapUsed: `${(currentMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
          increase: `${memoryIncreaseMB.toFixed(2)}MB`,
        });

        expect(memoryIncreaseMB).toBeLessThan(100);
      }

      const finalMemory = process.memoryUsage();
      const totalIncrease = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;

      console.log("Final Memory Usage:", finalMemory);
      console.log(`Total Memory Increase: ${totalIncrease.toFixed(2)}MB`);

      expect(totalIncrease).toBeLessThan(200);
    });

    it("should handle resource cleanup properly", async () => {
      const requestBody = {
        feeds: Array(50)
          .fill(null)
          .map((_, i) => ({
            category: FeedCategory.Crypto,
            name: `SYMBOL${i}/USD`,
          })),
      };

      const initialHandles = (process as any)._getActiveHandles?.()?.length || 0;
      const initialRequests = (process as any)._getActiveRequests?.()?.length || 0;

      console.log("Initial Active Handles:", initialHandles);
      console.log("Initial Active Requests:", initialRequests);

      const requests = Array(100)
        .fill(null)
        .map(() => mockServer.handleRequest(requestBody));

      await Promise.allSettled(requests);

      await new Promise(resolve => setTimeout(resolve, 2000));

      const finalHandles = (process as any)._getActiveHandles?.()?.length || 0;
      const finalRequests = (process as any)._getActiveRequests?.()?.length || 0;

      console.log("Final Active Handles:", finalHandles);
      console.log("Final Active Requests:", finalRequests);

      expect(finalHandles).toBeLessThanOrEqual(initialHandles + 10);
      expect(finalRequests).toBeLessThanOrEqual(initialRequests + 5);
    });
  });

  describe("Error Handling Under Load", () => {
    it("should handle mixed valid and invalid requests gracefully", async () => {
      const validRequest = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const invalidRequests = [
        { feeds: [{ category: 999, name: "BTC/USD" }] },
        { feeds: [{ category: FeedCategory.Crypto, name: "" }] },
        { feeds: "invalid" },
        {},
      ];

      const allRequests = [
        ...Array(500).fill(validRequest),
        ...Array(100).fill(invalidRequests[0]),
        ...Array(100).fill(invalidRequests[1]),
        ...Array(100).fill(invalidRequests[2]),
        ...Array(100).fill(invalidRequests[3]),
      ];

      for (let i = allRequests.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allRequests[i], allRequests[j]] = [allRequests[j], allRequests[i]];
      }

      const startTime = Date.now();
      const responses = await Promise.allSettled<MockResponse>(allRequests.map(req => mockServer.handleRequest(req)));
      const totalTime = Date.now() - startTime;

      const statusCounts: Record<number, number> = {};
      responses.forEach(response => {
        if (response.status === "fulfilled") {
          const status = (response as PromiseFulfilledResult<MockResponse>).value.statusCode;
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
      });

      console.log(
        `Mixed Load Test Results:
        - Total Requests: ${allRequests.length}
        - Total Time: ${totalTime}ms
        - Status Distribution:`,
        statusCounts
      );

      expect(responses.length).toBe(allRequests.length);
      expect(statusCounts[200]).toBeGreaterThan(400);
      expect(statusCounts[400]).toBeGreaterThan(150);
      expect(totalTime).toBeLessThan(30000);
    });
  });

  describe("Scalability Tests", () => {
    it("should demonstrate linear scalability with feed count", async () => {
      const feedCounts = [1, 5, 10, 25, 50];
      type ScalabilityResult = {
        feedCount: number;
        responseTime: number;
        statusCode: number;
        responseTimePerFeed: number;
      };
      const results: ScalabilityResult[] = [];

      for (const feedCount of feedCounts) {
        const feeds = Array(feedCount)
          .fill(null)
          .map((_, i) => ({
            category: FeedCategory.Crypto,
            name: `SYMBOL${i}/USD`,
          }));

        const requestBody = { feeds };

        const startTime = Date.now();
        const response = await mockServer.handleRequest(requestBody);
        const responseTime = Date.now() - startTime;

        results.push({
          feedCount,
          responseTime,
          statusCode: response.statusCode,
          responseTimePerFeed: responseTime / feedCount,
        });
      }

      console.log("Scalability Test Results:", results);

      results.forEach(result => {
        expect(result.statusCode).toBe(200);
        expect(result.responseTimePerFeed).toBeLessThan(100);
      });

      const maxResponseTime = Math.max(...results.map(r => r.responseTime));
      expect(maxResponseTime).toBeLessThan(1000);
    });
  });
});
