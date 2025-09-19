import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import type { EndpointStats, SlowResponseData, ServerErrorData, HighErrorRateData } from "@/common/types/monitoring";
import type { ApiMetrics, ApiHealthMetrics } from "@/common/types/monitoring";
import { ENV } from "@/config";

@Injectable()
export class ApiMonitorService extends EventDrivenService {
  private readonly apiMetrics: ApiMetrics[] = [];
  private readonly endpointStats = new Map<string, EndpointStats>();
  private readonly recentErrors = new Map<string, { count: number; lastSeen: number; error: string }>();
  private readonly maxMetricsHistory = 10000; // Keep last 10k requests
  private readonly maxErrorHistory = 1000; // Keep last 1k errors

  constructor() {
    super({ useEnhancedLogging: true });
    this.startPeriodicCleanup();
  }

  /**
   * Record API request metrics
   */
  recordApiRequest(metrics: ApiMetrics): void {
    try {
      // Add to metrics history
      this.apiMetrics.push(metrics);

      // Maintain metrics history size
      if (this.apiMetrics.length > this.maxMetricsHistory) {
        this.apiMetrics.splice(0, this.apiMetrics.length - this.maxMetricsHistory);
      }

      // Update endpoint statistics
      this.updateEndpointStats(metrics);

      // Track errors and successes using monitoring mixin
      if (metrics.statusCode >= 400) {
        this.trackError(metrics);
      } else {
        this.incrementCounter(`api_success_${metrics.endpoint}`);
        this.incrementCounter("total_api_success");
      }

      // Record response time metric
      this.recordMetric(`${metrics.endpoint}_response_time_ms`, metrics.responseTime);

      // Emit events for real-time monitoring
      this.emit("apiRequest", metrics);

      // Emit alerts for critical issues
      this.checkAndEmitAlerts(metrics);

      this.logger.debug(
        `Recorded API metrics: ${metrics.method} ${metrics.endpoint} - ${metrics.statusCode} - ${metrics.responseTime}ms`
      );
    } catch (error) {
      this.logger.error("Error recording API metrics:", error);
    }
  }

  /**
   * Get statistics for a specific endpoint
   */
  getEndpointStats(endpoint: string): EndpointStats | null {
    return this.endpointStats.get(endpoint) || null;
  }

  /**
   * Get statistics for all endpoints
   */
  getAllEndpointStats(): EndpointStats[] {
    return Array.from(this.endpointStats.values()).sort((a, b) => b.totalRequests - a.totalRequests);
  }

  /**
   * Get overall API health metrics
   */
  getApiHealthMetrics(): ApiHealthMetrics {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentMetrics = this.apiMetrics.filter(m => m.timestamp > oneMinuteAgo);

    const totalRequests = this.apiMetrics.length;
    const requestsPerMinute = recentMetrics.length;

    const responseTimes = this.apiMetrics.map(m => m.responseTime);
    const averageResponseTime =
      responseTimes.length > 0 ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length : 0;

    const errorCount = this.apiMetrics.filter(m => m.statusCode >= 400).length;
    const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

    const slowRequestCount = this.apiMetrics.filter(m => m.responseTime > 100).length;
    const slowRequestRate = totalRequests > 0 ? (slowRequestCount / totalRequests) * 100 : 0;

    const criticalRequestCount = this.apiMetrics.filter(m => m.responseTime > 1000).length;
    const criticalRequestRate = totalRequests > 0 ? (criticalRequestCount / totalRequests) * 100 : 0;

    // Get top endpoints by request count
    const topEndpoints = Array.from(this.endpointStats.values())
      .sort((a, b) => b.totalRequests - a.totalRequests)
      .slice(0, 10)
      .map(stats => ({
        endpoint: stats.endpoint,
        requests: stats.totalRequests,
        avgResponseTime: stats.averageResponseTime,
      }));

    // Get recent errors
    const recentErrors = Array.from(this.recentErrors.entries())
      .map(([key, data]) => ({
        endpoint: key.split(":")[0],
        error: data.error,
        timestamp: data.lastSeen,
        count: data.count,
      }))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20);

    return {
      timestamp: Date.now(),
      totalRequests,
      requestsPerMinute,
      averageResponseTime,
      errorRate,
      slowRequestRate,
      criticalRequestRate,
      topEndpoints,
      recentErrors,
    };
  }

  /**
   * Get performance metrics for the last N minutes
   */
  getPerformanceMetrics(minutes: number = 5): {
    requestCount: number;
    averageResponseTime: number;
    errorRate: number;
    throughput: number;
    responseTimes: number[];
  } {
    const now = Date.now();
    const timeWindow = minutes * 60000;
    const windowStart = now - timeWindow;

    const windowMetrics = this.apiMetrics.filter(m => m.timestamp > windowStart);

    const requestCount = windowMetrics.length;
    const responseTimes = windowMetrics.map(m => m.responseTime);
    const averageResponseTime =
      responseTimes.length > 0 ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length : 0;

    const errorCount = windowMetrics.filter(m => m.statusCode >= 400).length;
    const errorRate = requestCount > 0 ? (errorCount / requestCount) * 100 : 0;

    const throughput = requestCount / minutes; // Requests per minute

    return {
      requestCount,
      averageResponseTime,
      errorRate,
      throughput,
      responseTimes,
    };
  }

  /**
   * Get error analysis
   */
  getErrorAnalysis(): {
    totalErrors: number;
    errorsByStatusCode: Record<number, number>;
    errorsByEndpoint: Record<string, number>;
    recentErrorTrends: Array<{ timestamp: number; errorCount: number }>;
  } {
    const errors = this.apiMetrics.filter(m => m.statusCode >= 400);

    const errorsByStatusCode = errors.reduce(
      (acc, error) => {
        acc[error.statusCode] = (acc[error.statusCode] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>
    );

    const errorsByEndpoint = errors.reduce(
      (acc, error) => {
        acc[error.endpoint] = (acc[error.endpoint] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Calculate error trends over the last hour (5-minute buckets)
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const bucketSize = ENV.MONITORING.BUCKET_SIZE_MS;
    const buckets = new Map<number, number>();

    errors
      .filter(e => e.timestamp > oneHourAgo)
      .forEach(error => {
        const bucket = Math.floor(error.timestamp / bucketSize) * bucketSize;
        buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
      });

    const recentErrorTrends = Array.from(buckets.entries())
      .map(([timestamp, errorCount]) => ({ timestamp, errorCount }))
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      totalErrors: errors.length,
      errorsByStatusCode,
      errorsByEndpoint,
      recentErrorTrends,
    };
  }

  /**
   * Reset all metrics (for testing or maintenance)
   */
  resetMetrics(): void {
    this.apiMetrics.length = 0;
    this.endpointStats.clear();
    this.recentErrors.clear();
    this.logger.log("API metrics reset");
  }

  /**
   * Get current metrics count
   */
  getMetricsCount(): number {
    return this.apiMetrics.length;
  }

  // Private methods

  private updateEndpointStats(metrics: ApiMetrics): void {
    const key = `${metrics.method} ${metrics.endpoint}`;
    let stats = this.endpointStats.get(key);

    if (!stats) {
      stats = {
        endpoint: key,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        maxResponseTime: 0,
        minResponseTime: Infinity,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        averageResponseSize: 0,
        errorRate: 0,
        lastRequest: 0,
        statusCodeDistribution: {},
      };
      this.endpointStats.set(key, stats);
    }

    // Update basic counters
    stats.totalRequests++;
    stats.lastRequest = metrics.timestamp;

    if (metrics.statusCode >= 200 && metrics.statusCode < 400) {
      stats.successfulRequests++;
    } else {
      stats.failedRequests++;
    }

    // Update status code distribution
    stats.statusCodeDistribution[metrics.statusCode] = (stats.statusCodeDistribution[metrics.statusCode] || 0) + 1;

    // Update response time statistics
    const allResponseTimes = this.apiMetrics
      .filter((m: ApiMetrics) => `${m.method} ${m.endpoint}` === key)
      .map((m: ApiMetrics) => m.responseTime)
      .sort((a: number, b: number) => a - b);

    if (allResponseTimes.length > 0) {
      stats.averageResponseTime =
        allResponseTimes.reduce((sum: number, time: number) => sum + time, 0) / allResponseTimes.length;
      stats.maxResponseTime = Math.max(...allResponseTimes);
      stats.minResponseTime = Math.min(...allResponseTimes);

      // Calculate percentiles
      const p95Index = Math.floor(allResponseTimes.length * 0.95);
      const p99Index = Math.floor(allResponseTimes.length * 0.99);
      stats.p95ResponseTime = allResponseTimes[p95Index] || 0;
      stats.p99ResponseTime = allResponseTimes[p99Index] || 0;
    }

    // Update response size statistics
    const allResponseSizes = this.apiMetrics
      .filter((m: ApiMetrics) => `${m.method} ${m.endpoint}` === key && m.responseSize > 0)
      .map((m: ApiMetrics) => m.responseSize);

    if (allResponseSizes.length > 0) {
      stats.averageResponseSize =
        allResponseSizes.reduce((sum: number, size: number) => sum + size, 0) / allResponseSizes.length;
    }

    // Update error rate
    stats.errorRate = stats.totalRequests > 0 ? (stats.failedRequests / stats.totalRequests) * 100 : 0;
  }

  private trackError(metrics: ApiMetrics): void {
    const errorKey = `${metrics.endpoint}:${metrics.statusCode}`;
    const existing = this.recentErrors.get(errorKey);

    // Use monitoring mixin counter
    this.incrementCounter(`api_errors_${metrics.endpoint}_${metrics.statusCode}`);
    this.incrementCounter("total_api_errors");

    if (existing) {
      existing.count++;
      existing.lastSeen = metrics.timestamp;
    } else {
      this.recentErrors.set(errorKey, {
        count: 1,
        lastSeen: metrics.timestamp,
        error: metrics.error || `HTTP ${metrics.statusCode}`,
      });
    }

    // Maintain error history size
    if (this.recentErrors.size > this.maxErrorHistory) {
      // Remove oldest errors
      const entries = Array.from(this.recentErrors.entries());
      entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);

      const toRemove = entries.slice(0, entries.length - this.maxErrorHistory);
      toRemove.forEach(([key]) => this.recentErrors.delete(key));
    }
  }

  private checkAndEmitAlerts(metrics: ApiMetrics): void {
    // Alert on very slow responses
    if (metrics.responseTime > ENV.MONITORING.SLOW_RESPONSE_THRESHOLD_MS) {
      this.emit("slowResponse", {
        endpoint: metrics.endpoint || "unknown",
        responseTime: metrics.responseTime,
        threshold: ENV.MONITORING.SLOW_RESPONSE_THRESHOLD_MS,
        timestamp: metrics.timestamp,
        requestId: `req-${Date.now()}`,
        method: metrics.method || "GET",
        statusCode: metrics.statusCode || 200,
      });
    }

    // Alert on server errors
    if (metrics.statusCode >= 500) {
      this.emit("serverError", {
        endpoint: metrics.endpoint || "unknown",
        statusCode: metrics.statusCode || 500,
        error: metrics.error || "Server Error",
        timestamp: metrics.timestamp,
        requestId: `req-${Date.now()}`,
        method: metrics.method || "GET",
      });
    }

    // Alert on high error rate for endpoint
    const stats = this.endpointStats.get(`${metrics.method} ${metrics.endpoint}`);
    if (stats && stats.totalRequests > 10 && stats.errorRate > ENV.MONITORING.HIGH_ERROR_RATE_THRESHOLD) {
      this.emit("highErrorRate", {
        endpoint: stats.endpoint,
        errorRate: stats.errorRate,
        threshold: ENV.MONITORING.HIGH_ERROR_RATE_THRESHOLD,
        timeWindow: ENV.MONITORING.ERROR_RATE_TIME_WINDOW_MS,
        timestamp: metrics.timestamp,
        errorCount: Math.floor((stats.totalRequests * stats.errorRate) / 100),
        totalRequests: stats.totalRequests,
      });
    }
  }

  private startPeriodicCleanup(): void {
    // Clean up old metrics every 5 minutes
    this.createInterval(() => {
      this.cleanupOldMetrics();
    }, ENV.MONITORING.BUCKET_SIZE_MS);
  }

  private cleanupOldMetrics(): void {
    const now = Date.now();
    const maxAge = ENV.MONITORING.DATA_RETENTION_MS;
    const cutoff = now - maxAge;

    // Remove old metrics
    const originalLength = this.apiMetrics.length;
    const filteredMetrics = this.apiMetrics.filter(m => m.timestamp > cutoff);
    this.apiMetrics.length = 0;
    this.apiMetrics.push(...filteredMetrics);

    // Remove old errors
    for (const [key, error] of this.recentErrors.entries()) {
      if (error.lastSeen < cutoff) {
        this.recentErrors.delete(key);
      }
    }

    if (originalLength !== this.apiMetrics.length) {
      this.logger.debug(`Cleaned up ${originalLength - this.apiMetrics.length} old metrics`);
    }
  }

  /**
   * Emit API monitoring events
   */
  override emit(event: "apiRequest", metrics: ApiMetrics): boolean;
  override emit(event: "slowResponse", data: SlowResponseData): boolean;
  override emit(event: "serverError", data: ServerErrorData): boolean;
  override emit(event: "highErrorRate", data: HighErrorRateData): boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Listen for API monitoring events
   */
  override on(event: "apiRequest", callback: (metrics: ApiMetrics) => void): this;
  override on(event: "slowResponse", callback: (data: SlowResponseData) => void): this;
  override on(event: "serverError", callback: (data: ServerErrorData) => void): this;
  override on(event: "highErrorRate", callback: (data: HighErrorRateData) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
