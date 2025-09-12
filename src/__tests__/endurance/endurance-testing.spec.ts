import { FeedCategory } from "@/common/types/core";

// Resource monitoring utilities
interface IResourceSnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
  activeHandles: number;
  activeRequests: number;
}

class ResourceMonitor {
  private snapshots: IResourceSnapshot[] = [];
  private initialSnapshot: IResourceSnapshot | null = null;

  takeSnapshot(): IResourceSnapshot {
    const memUsage = process.memoryUsage();
    const snapshot: IResourceSnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      rss: memUsage.rss,
      external: memUsage.external,
      activeHandles: (process as any)._getActiveHandles?.()?.length || 0,
      activeRequests: (process as any)._getActiveRequests?.()?.length || 0,
    };

    if (!this.initialSnapshot) {
      this.initialSnapshot = snapshot;
    }

    this.snapshots.push(snapshot);
    return snapshot;
  }

  getMemoryGrowth(): number {
    if (!this.initialSnapshot || this.snapshots.length === 0) return 0;
    const latest = this.snapshots[this.snapshots.length - 1];
    return (latest.heapUsed - this.initialSnapshot.heapUsed) / 1024 / 1024; // MB
  }

  getMaxMemoryUsage(): number {
    if (this.snapshots.length === 0) return 0;
    return Math.max(...this.snapshots.map(s => s.heapUsed)) / 1024 / 1024; // MB
  }

  getHandleLeak(): number {
    if (!this.initialSnapshot || this.snapshots.length === 0) return 0;
    const latest = this.snapshots[this.snapshots.length - 1];
    return latest.activeHandles - this.initialSnapshot.activeHandles;
  }

  cleanup(): void {
    this.snapshots = [];
    this.initialSnapshot = null;

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
  }
}

// Mock HTTP server for endurance testing
class MockEnduranceServer {
  private requestCount = 0;
  private startTime = Date.now();
  private responseDelay = 50;
  private errorRate = 0;

  async handleRequest(requestBody: any): Promise<any> {
    this.requestCount++;
    const requestStartTime = Date.now();

    const delay = this.responseDelay + (Math.random() - 0.5) * 20;
    await new Promise(resolve => setTimeout(resolve, Math.max(1, delay)));

    if (Math.random() < this.errorRate) {
      return {
        status: 500,
        body: { error: "Internal server error" },
        responseTime: Date.now() - requestStartTime,
      };
    }

    if (!requestBody.feeds || !Array.isArray(requestBody.feeds)) {
      return {
        status: 400,
        body: { error: "Invalid request" },
        responseTime: Date.now() - requestStartTime,
      };
    }

    const feeds = requestBody.feeds.map((feed: any) => ({
      feedId: { category: feed.category, name: feed.name },
      value: Math.floor(Math.random() * 100000),
      decimals: 8,
    }));

    return {
      status: 200,
      body: {
        feeds,
        timestamp: Date.now(),
      },
      responseTime: Date.now() - requestStartTime,
    };
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  getUptime(): number {
    return Date.now() - this.startTime;
  }

  setResponseDelay(delay: number): void {
    this.responseDelay = delay;
  }

  setErrorRate(rate: number): void {
    this.errorRate = Math.max(0, Math.min(1, rate));
  }

  reset(): void {
    this.requestCount = 0;
    this.startTime = Date.now();
    this.responseDelay = 50;
    this.errorRate = 0;
  }
}

describe("Endurance Testing", () => {
  let mockServer: MockEnduranceServer;
  let resourceMonitor: ResourceMonitor;

  beforeAll(() => {
    mockServer = new MockEnduranceServer();
    resourceMonitor = new ResourceMonitor();
  });

  beforeEach(() => {
    mockServer.reset();
    resourceMonitor.cleanup();
    resourceMonitor.takeSnapshot(); // Initial snapshot
  });

  afterEach(() => {
    // Cleanup resources after each test
    resourceMonitor.cleanup();
  });

  describe("Long-term Stability Tests", () => {
    it("should maintain performance over extended operation", async () => {
      const testDurationMs = 15000; // 15 seconds for faster execution
      const requestIntervalMs = 500; // More frequent requests for better sampling
      const maxRequests = Math.floor(testDurationMs / requestIntervalMs);

      const requestBody = {
        feeds: [
          { category: FeedCategory.Crypto, name: "BTC/USD" },
          { category: FeedCategory.Crypto, name: "ETH/USD" },
        ],
      };

      const results: any[] = [];
      const startTime = Date.now();
      let requestCount = 0;

      // Batch requests for efficiency
      const batchSize = 5;
      const batches = Math.ceil(maxRequests / batchSize);

      for (let batch = 0; batch < batches && Date.now() - startTime < testDurationMs; batch++) {
        const batchPromises: Promise<any>[] = [];

        for (let i = 0; i < batchSize && requestCount < maxRequests; i++) {
          batchPromises.push(
            mockServer.handleRequest(requestBody).then(response => ({
              requestNumber: requestCount + i + 1,
              timestamp: Date.now(),
              responseTime: response.responseTime,
              status: response.status,
              success: response.status === 200,
            }))
          );
        }

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        requestCount += batchResults.length;

        // Take resource snapshot periodically
        if (batch % 3 === 0) {
          resourceMonitor.takeSnapshot();
        }

        // Small delay between batches to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, requestIntervalMs));
      }

      const successfulRequests = results.filter(r => r.success);
      const overallSuccessRate = successfulRequests.length / results.length;

      const responseTimes = successfulRequests.map(r => r.responseTime);
      const averageResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);

      // Check performance drift using first and last quarters
      const quarterSize = Math.floor(successfulRequests.length / 4);
      const firstQuarter = successfulRequests.slice(0, quarterSize);
      const lastQuarter = successfulRequests.slice(-quarterSize);

      const firstQuarterAvg = firstQuarter.reduce((sum, r) => sum + r.responseTime, 0) / firstQuarter.length;
      const lastQuarterAvg = lastQuarter.reduce((sum, r) => sum + r.responseTime, 0) / lastQuarter.length;
      const performanceDrift = ((lastQuarterAvg - firstQuarterAvg) / firstQuarterAvg) * 100;

      // Check memory usage
      const memoryGrowth = resourceMonitor.getMemoryGrowth();

      expect(overallSuccessRate).toBeGreaterThan(0.95);
      expect(averageResponseTime).toBeLessThan(200);
      expect(maxResponseTime).toBeLessThan(1000);
      expect(Math.abs(performanceDrift)).toBeLessThan(30);
      expect(memoryGrowth).toBeLessThan(50); // Less than 50MB growth
    }, 20000); // 20 second timeout

    it("should handle memory usage efficiently over time", async () => {
      const testDurationMs = 10000; // 10 seconds for faster execution
      const requestBatchSize = 10;
      const memoryCheckIntervalMs = 2000; // Check every 2 seconds

      const requestBody = {
        feeds: Array(10) // Reduced from 20 to 10 feeds
          .fill(null)
          .map((_, i) => ({
            category: FeedCategory.Crypto,
            name: `SYMBOL${i}/USD`,
          })),
      };

      const startTime = Date.now();
      const endTime = startTime + testDurationMs;
      let requestCount = 0;
      let lastMemoryCheck = startTime;

      // Take initial snapshot
      resourceMonitor.takeSnapshot();

      while (Date.now() < endTime) {
        // Process requests in batches for efficiency
        const batchPromises: Promise<any>[] = [];
        for (let i = 0; i < requestBatchSize; i++) {
          batchPromises.push(mockServer.handleRequest(requestBody).catch(() => ({ status: 500 })));
        }

        await Promise.all(batchPromises);
        requestCount += requestBatchSize;

        const now = Date.now();
        if (now - lastMemoryCheck >= memoryCheckIntervalMs) {
          resourceMonitor.takeSnapshot();
          lastMemoryCheck = now;

          // Force garbage collection if available
          if (global.gc) {
            global.gc();
          }
        }

        // Small delay to prevent overwhelming
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Final snapshot
      resourceMonitor.takeSnapshot();

      const memoryGrowth = resourceMonitor.getMemoryGrowth();
      const maxMemoryUsage = resourceMonitor.getMaxMemoryUsage();
      const handleLeak = resourceMonitor.getHandleLeak();

      expect(memoryGrowth).toBeLessThan(100); // Less than 100MB growth
      expect(maxMemoryUsage).toBeLessThan(800); // Less than 800MB max usage
      expect(handleLeak).toBeLessThan(10); // Less than 10 handle leaks
      expect(requestCount).toBeGreaterThan(50); // Ensure we processed enough requests
    }, 15000); // 15 second timeout

    it("should maintain connection stability over extended periods", async () => {
      const testDurationMs = 8000; // 8 seconds for faster execution
      const connectionCheckIntervalMs = 2000; // Check every 2 seconds
      const connectionsPerCheck = 5; // Reduced from 10 to 5

      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      const connectionResults: any[] = [];
      const startTime = Date.now();
      const endTime = startTime + testDurationMs;

      while (Date.now() < endTime) {
        const checkStartTime = Date.now();

        // Run connection tests in parallel for efficiency
        const connectionTests = Array(connectionsPerCheck)
          .fill(null)
          .map(() =>
            mockServer
              .handleRequest(requestBody)
              .then(response => ({
                success: response.status === 200,
                responseTime: response.responseTime,
                status: response.status,
              }))
              .catch(() => ({
                success: false,
                responseTime: Date.now() - checkStartTime,
                error: "Connection failed",
              }))
          );

        const testResults = await Promise.all(connectionTests);
        const successfulConnections = testResults.filter(r => r.success).length;
        const averageResponseTime =
          successfulConnections > 0
            ? testResults.filter(r => r.success).reduce((sum, r) => sum + r.responseTime, 0) / successfulConnections
            : 0;

        connectionResults.push({
          timestamp: Date.now(),
          successfulConnections,
          totalConnections: testResults.length,
          connectionSuccessRate: successfulConnections / testResults.length,
          averageResponseTime,
        });

        // Take resource snapshot
        resourceMonitor.takeSnapshot();

        await new Promise(resolve => setTimeout(resolve, connectionCheckIntervalMs));
      }

      const overallSuccessRate =
        connectionResults.length > 0
          ? connectionResults.reduce((sum, r) => sum + r.connectionSuccessRate, 0) / connectionResults.length
          : 0;
      const minSuccessRate =
        connectionResults.length > 0 ? Math.min(...connectionResults.map(r => r.connectionSuccessRate)) : 0;
      const avgResponseTime =
        connectionResults.length > 0
          ? connectionResults.reduce((sum, r) => sum + r.averageResponseTime, 0) / connectionResults.length
          : 0;

      // Check for stability over time
      const firstHalf = connectionResults.slice(0, Math.floor(connectionResults.length / 2));
      const secondHalf = connectionResults.slice(Math.floor(connectionResults.length / 2));

      const firstHalfSuccessRate =
        firstHalf.length > 0 ? firstHalf.reduce((sum, r) => sum + r.connectionSuccessRate, 0) / firstHalf.length : 1;
      const secondHalfSuccessRate =
        secondHalf.length > 0 ? secondHalf.reduce((sum, r) => sum + r.connectionSuccessRate, 0) / secondHalf.length : 1;

      expect(overallSuccessRate).toBeGreaterThan(0.95);
      expect(minSuccessRate).toBeGreaterThan(0.8);
      expect(avgResponseTime).toBeLessThan(300);
      expect(Math.abs(secondHalfSuccessRate - firstHalfSuccessRate)).toBeLessThan(0.1);
      expect(connectionResults.length).toBeGreaterThan(2); // Ensure we had multiple checks
    }, 12000); // 12 second timeout
  });

  describe("Resource Leak Detection", () => {
    it("should detect and prevent file descriptor leaks", async () => {
      const testDurationMs = 6000; // 6 seconds for faster execution
      const batchSize = 20; // Process requests in batches
      const batchIntervalMs = 1000; // 1 second between batches

      const requestBody = {
        feeds: [{ category: FeedCategory.Crypto, name: "BTC/USD" }],
      };

      // Take initial resource snapshot
      const initialSnapshot = resourceMonitor.takeSnapshot();
      let requestCount = 0;

      const startTime = Date.now();
      const endTime = startTime + testDurationMs;

      while (Date.now() < endTime) {
        // Process batch of requests
        const batchPromises = Array(batchSize)
          .fill(null)
          .map(() => mockServer.handleRequest(requestBody).catch(() => ({ status: 500 })));

        await Promise.all(batchPromises);
        requestCount += batchSize;

        // Take resource snapshot
        resourceMonitor.takeSnapshot();

        // Force cleanup
        if (global.gc) {
          global.gc();
        }

        await new Promise(resolve => setTimeout(resolve, batchIntervalMs));
      }

      // Final cleanup and snapshot
      await new Promise(resolve => setTimeout(resolve, 1000));
      const finalSnapshot = resourceMonitor.takeSnapshot();

      const handleLeak = resourceMonitor.getHandleLeak();
      const memoryGrowth = resourceMonitor.getMemoryGrowth();

      expect(handleLeak).toBeLessThan(20); // Less than 20 handle leaks
      expect(memoryGrowth).toBeLessThan(50); // Less than 50MB memory growth
      expect(requestCount).toBeGreaterThan(50); // Ensure we processed enough requests
      expect(finalSnapshot.activeRequests - initialSnapshot.activeRequests).toBeLessThan(10);
    }, 10000); // 10 second timeout

    it("should handle graceful shutdown after extended operation", async () => {
      const operationDurationMs = 5000; // 5 seconds for faster execution
      const requestIntervalMs = 500; // More frequent requests

      const requestBody = {
        feeds: [
          { category: FeedCategory.Crypto, name: "BTC/USD" },
          { category: FeedCategory.Crypto, name: "ETH/USD" },
        ],
      };

      const startTime = Date.now();
      const endTime = startTime + operationDurationMs;
      let requestCount = 0;

      // Run operation with concurrent requests for efficiency
      const operationPromises: Promise<any>[] = [];

      while (Date.now() < endTime) {
        operationPromises.push(
          mockServer
            .handleRequest(requestBody)
            .then(() => {
              requestCount++;
            })
            .catch(() => {
              /* Continue on error */
            })
        );

        await new Promise(resolve => setTimeout(resolve, requestIntervalMs));
      }

      // Wait for all operations to complete
      await Promise.all(operationPromises);

      // Test graceful shutdown - system should still be responsive
      const shutdownStart = Date.now();
      const finalResponse = await mockServer.handleRequest(requestBody);
      const shutdownTime = Date.now() - shutdownStart;

      // Verify system responsiveness
      expect(finalResponse.status).toBe(200);
      expect(shutdownTime).toBeLessThan(2000); // Should respond within 2 seconds
      expect(requestCount).toBeGreaterThan(5); // Ensure we processed some requests

      // Check resource cleanup
      const memoryGrowth = resourceMonitor.getMemoryGrowth();
      expect(memoryGrowth).toBeLessThan(30); // Less than 30MB growth
    }, 8000); // 8 second timeout
  });

  describe("Data Consistency Over Time", () => {
    it("should maintain data consistency during extended operation", async () => {
      const testDurationMs = 6000; // 6 seconds for faster execution
      const checkIntervalMs = 2000; // Check every 2 seconds
      const requestsPerCheck = 3; // Reduced from 5 to 3

      const feeds = [
        { category: FeedCategory.Crypto, name: "BTC/USD" },
        { category: FeedCategory.Crypto, name: "ETH/USD" },
      ];

      const consistencyResults: any[] = [];
      const startTime = Date.now();
      const endTime = startTime + testDurationMs;

      while (Date.now() < endTime) {
        // Run consistency check
        const requests = Array(requestsPerCheck)
          .fill(null)
          .map(() => mockServer.handleRequest({ feeds }));

        const responses = await Promise.all(requests);
        const successfulResponses = responses.filter(r => r.status === 200);

        if (successfulResponses.length >= 2) {
          // Check structural consistency
          const firstResponse = successfulResponses[0].body;
          let consistentResponses = 0;

          for (const response of successfulResponses) {
            let isConsistent = true;

            // Validate response structure
            if (
              firstResponse.feeds &&
              response.body.feeds &&
              firstResponse.feeds.length === response.body.feeds.length
            ) {
              for (let j = 0; j < firstResponse.feeds.length; j++) {
                const feed1 = firstResponse.feeds[j];
                const feed2 = response.body.feeds[j];

                // Check structural consistency
                if (
                  !feed1 ||
                  !feed2 ||
                  !feed1.feedId ||
                  !feed2.feedId ||
                  feed1.feedId.category !== feed2.feedId.category ||
                  feed1.feedId.name !== feed2.feedId.name ||
                  typeof feed1.value !== "number" ||
                  typeof feed2.value !== "number" ||
                  feed1.value <= 0 ||
                  feed2.value <= 0
                ) {
                  isConsistent = false;
                  break;
                }
              }
            } else {
              isConsistent = false;
            }

            if (isConsistent) {
              consistentResponses++;
            }
          }

          const consistencyRate = consistentResponses / successfulResponses.length;
          consistencyResults.push({
            timestamp: Date.now(),
            totalResponses: responses.length,
            successfulResponses: successfulResponses.length,
            consistentResponses,
            consistencyRate,
          });
        }

        // Take resource snapshot
        resourceMonitor.takeSnapshot();

        await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
      }

      const overallConsistencyRate =
        consistencyResults.length > 0
          ? consistencyResults.reduce((sum, r) => sum + r.consistencyRate, 0) / consistencyResults.length
          : 0;
      const minConsistencyRate =
        consistencyResults.length > 0 ? Math.min(...consistencyResults.map(r => r.consistencyRate)) : 0;

      expect(overallConsistencyRate).toBeGreaterThan(0.9);
      expect(minConsistencyRate).toBeGreaterThan(0.7);
      expect(consistencyResults.length).toBeGreaterThan(1); // Ensure we had multiple checks
    }, 8000); // 8 second timeout
  });
});
