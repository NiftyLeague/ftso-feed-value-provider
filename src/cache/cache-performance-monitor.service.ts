import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { StandardService } from "@/common/base/composed.service";
import type { CachePerformanceMetrics, ResponseTimeMetric, MemoryUsageMetric } from "@/common/types/cache";

import { RealTimeCacheService } from "./real-time-cache.service";

@Injectable()
export class CachePerformanceMonitorService extends StandardService implements OnModuleDestroy {
  private readonly responseTimes: ResponseTimeMetric[] = [];
  private readonly memoryUsageHistory: MemoryUsageMetric[] = [];
  private readonly maxHistorySize = 1000; // Keep last 1000 measurements
  private monitoringInterval?: NodeJS.Timeout;
  private lastRequestCount = 0;
  private lastRequestTime = Date.now();

  private readonly monitoringIntervalMs = 5000; // 5 seconds

  constructor(private readonly cacheService: RealTimeCacheService) {
    super();
    this.startMonitoring();
  }

  // Record response time for cache operations
  recordResponseTime(responseTime: number): void {
    this.responseTimes.push({
      timestamp: Date.now(),
      responseTime,
    });

    // Keep only recent measurements
    if (this.responseTimes.length > this.maxHistorySize) {
      this.responseTimes.shift();
    }
  }

  // Get current performance metrics
  getPerformanceMetrics(): CachePerformanceMetrics {
    const cacheStats = this.cacheService.getStats();
    const currentTime = Date.now();
    const timeDiff = (currentTime - this.lastRequestTime) / 1000; // seconds
    const requestDiff = cacheStats.totalRequests - this.lastRequestCount;
    const requestsPerSecond = timeDiff > 0 ? requestDiff / timeDiff : 0;

    const metrics: CachePerformanceMetrics = {
      timestamp: currentTime,
      hitRate: cacheStats.hitRate,
      missRate: cacheStats.missRate,
      totalRequests: cacheStats.totalRequests,
      requestRate: requestsPerSecond,
      requestsPerSecond,
      averageGetTime: cacheStats.averageGetTime,
      averageResponseTime: this.calculateAverageResponseTime(),
      memoryUsage: cacheStats.memoryUsage,
      entryCount: cacheStats.totalEntries,
      evictionRate: this.calculateEvictionRate(),
    };

    // Update tracking variables
    this.lastRequestCount = cacheStats.totalRequests;
    this.lastRequestTime = currentTime;

    return metrics;
  }

  // Get detailed memory usage history
  getMemoryUsageHistory(minutes: number = 10): MemoryUsageMetric[] {
    const cutoffTime = Date.now() - minutes * 60 * 1000;
    return this.memoryUsageHistory.filter(metric => metric.timestamp >= cutoffTime);
  }

  // Get response time percentiles
  getResponseTimePercentiles(): {
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  } {
    if (this.responseTimes.length === 0) {
      return { p50: 0, p90: 0, p95: 0, p99: 0 };
    }

    const sortedTimes = this.responseTimes.map(metric => metric.responseTime).sort((a, b) => a - b);

    return {
      p50: this.getPercentile(sortedTimes, 50),
      p90: this.getPercentile(sortedTimes, 90),
      p95: this.getPercentile(sortedTimes, 95),
      p99: this.getPercentile(sortedTimes, 99),
    };
  }

  // Check if cache performance meets requirements
  checkPerformanceThresholds(): {
    hitRateOk: boolean;
    responseTimeOk: boolean;
    memoryUsageOk: boolean;
    overallHealthy: boolean;
  } {
    const metrics = this.getPerformanceMetrics();
    const percentiles = this.getResponseTimePercentiles();

    const hitRateOk = metrics.hitRate >= 0.8; // 80% hit rate target
    const responseTimeOk = percentiles.p95 <= 10; // 95th percentile under 10ms
    const memoryUsageOk = metrics.memoryUsage < 50 * 1024 * 1024; // Under 50MB

    return {
      hitRateOk,
      responseTimeOk,
      memoryUsageOk,
      overallHealthy: hitRateOk && responseTimeOk && memoryUsageOk,
    };
  }

  // Generate performance report
  generatePerformanceReport(): string {
    const metrics = this.getPerformanceMetrics();
    const percentiles = this.getResponseTimePercentiles();
    const health = this.checkPerformanceThresholds();

    return `
Cache Performance Report
========================
Hit Rate: ${(metrics.hitRate * 100).toFixed(2)}% ${health.hitRateOk ? "✓" : "✗"}
Miss Rate: ${(metrics.missRate * 100).toFixed(2)}%
Total Requests: ${metrics.totalRequests}
Requests/Second: ${metrics.requestsPerSecond.toFixed(2)}

Response Times:
- Average: ${metrics.averageResponseTime.toFixed(2)}ms
- 50th percentile: ${percentiles.p50.toFixed(2)}ms
- 90th percentile: ${percentiles.p90.toFixed(2)}ms
- 95th percentile: ${percentiles.p95.toFixed(2)}ms ${health.responseTimeOk ? "✓" : "✗"}
- 99th percentile: ${percentiles.p99.toFixed(2)}ms

Memory Usage: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB ${health.memoryUsageOk ? "✓" : "✗"}
Eviction Rate: ${metrics.evictionRate.toFixed(4)} evictions/request

Overall Health: ${health.overallHealthy ? "HEALTHY ✓" : "NEEDS ATTENTION ✗"}
    `.trim();
  }

  // Start continuous monitoring
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, this.monitoringIntervalMs);

    this.logger.debug(`Started cache performance monitoring with ${this.monitoringIntervalMs}ms interval`);
  }

  override async cleanup(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.logger.log("Cache performance monitor service destroyed");
  }

  // Manually trigger metrics collection (for testing)
  triggerCollection(): void {
    this.collectMetrics();
  }

  // Collect current metrics
  private collectMetrics(): void {
    const cacheStats = this.cacheService.getStats();

    // Record memory usage with entry count
    this.memoryUsageHistory.push({
      timestamp: Date.now(),
      usage: cacheStats.memoryUsage,
      entryCount: cacheStats.totalEntries,
    });

    // Keep only recent history
    if (this.memoryUsageHistory.length > this.maxHistorySize) {
      this.memoryUsageHistory.shift();
    }

    // Log performance warnings
    const health = this.checkPerformanceThresholds();
    if (!health.overallHealthy) {
      this.logger.warn("Cache performance degraded", {
        hitRate: cacheStats.hitRate,
        memoryUsage: cacheStats.memoryUsage,
        responseTime: this.calculateAverageResponseTime(),
      });
    }
  }

  // Calculate average response time from recent measurements
  private calculateAverageResponseTime(): number {
    if (this.responseTimes.length === 0) return 0;

    // Use only recent measurements (last 5 minutes)
    const cutoffTime = Date.now() - 5 * 60 * 1000;
    const recentTimes = this.responseTimes.filter(metric => metric.timestamp >= cutoffTime);

    if (recentTimes.length === 0) return 0;

    const sum = recentTimes.reduce((acc, metric) => acc + metric.responseTime, 0);
    return sum / recentTimes.length;
  }

  // Calculate eviction rate (evictions per request)
  private calculateEvictionRate(): number {
    const cacheStats = this.cacheService.getStats();
    return cacheStats.totalRequests > 0 ? 0 : 0; // Placeholder - would need eviction count from cache service
  }

  // Calculate percentile from sorted array
  private getPercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;

    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  // Stop monitoring and cleanup
  destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.responseTimes.length = 0;
    this.memoryUsageHistory.length = 0;

    this.logger.debug("Cache performance monitor destroyed");
  }
}
