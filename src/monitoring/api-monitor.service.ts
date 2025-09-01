import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/common/base/base-event.service";

export interface ApiMetrics {
  endpoint: string;
  method: string;
  statusCode: number;
  responseTime: number;
  responseSize: number;
  timestamp: number;
  clientId?: string;
  requestId?: string;
  error?: string;
}

export interface EndpointStats {
  endpoint: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  maxResponseTime: number;
  minResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  averageResponseSize: number;
  errorRate: number;
  lastRequest: number;
  statusCodeDistribution: Record<number, number>;
}

export interface ApiHealthMetrics {
  totalRequests: number;
  requestsPerMinute: number;
  averageResponseTime: number;
  errorRate: number;
  slowRequestRate: number; // Requests > 100ms
  criticalRequestRate: number; // Requests > 1000ms
  topEndpoints: Array<{ endpoint: string; requests: number; avgResponseTime: number }>;
  recentErrors: Array<{ endpoint: string; error: string; timestamp: number; count: number }>;
}

@Injectable()
export class ApiMonitorService extends BaseEventService {
  private readonly metrics: ApiMetrics[] = [];
  private readonly endpointStats = new Map<string, EndpointStats>();
  private readonly recentErrors = new Map<string, { count: number; lastSeen: number; error: string }>();
  private readonly maxMetricsHistory = 10000; // Keep last 10k requests
  private readonly maxErrorHistory = 1000; // Keep last 1k errors

  constructor() {
    super("ApiMonitorService");
    this.startPeriodicCleanup();
  }

  /**
   * Record API request metrics
   */
  recordApiRequest(metrics: ApiMetrics): void {
    try {
      // Add to metrics history
      this.metrics.push(metrics);

      // Maintain metrics history size
      if (this.metrics.length > this.maxMetricsHistory) {
        this.metrics.splice(0, this.metrics.length - this.maxMetricsHistory);
      }

      // Update endpoint statistics
      this.updateEndpointStats(metrics);

      // Track errors
      if (metrics.statusCode >= 400) {
        this.trackError(metrics);
      }

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
    const recentMetrics = this.metrics.filter(m => m.timestamp > oneMinuteAgo);

    const totalRequests = this.metrics.length;
    const requestsPerMinute = recentMetrics.length;

    const responseTimes = this.metrics.map(m => m.responseTime);
    const averageResponseTime =
      responseTimes.length > 0 ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length : 0;

    const errorCount = this.metrics.filter(m => m.statusCode >= 400).length;
    const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

    const slowRequestCount = this.metrics.filter(m => m.responseTime > 100).length;
    const slowRequestRate = totalRequests > 0 ? (slowRequestCount / totalRequests) * 100 : 0;

    const criticalRequestCount = this.metrics.filter(m => m.responseTime > 1000).length;
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

    const windowMetrics = this.metrics.filter(m => m.timestamp > windowStart);

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
    const errors = this.metrics.filter(m => m.statusCode >= 400);

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
    const bucketSize = 300000; // 5 minutes
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
    this.metrics.length = 0;
    this.endpointStats.clear();
    this.recentErrors.clear();
    this.logger.log("API metrics reset");
  }

  /**
   * Get current metrics count
   */
  getMetricsCount(): number {
    return this.metrics.length;
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
    const allResponseTimes = this.metrics
      .filter(m => `${m.method} ${m.endpoint}` === key)
      .map(m => m.responseTime)
      .sort((a, b) => a - b);

    if (allResponseTimes.length > 0) {
      stats.averageResponseTime = allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length;
      stats.maxResponseTime = Math.max(...allResponseTimes);
      stats.minResponseTime = Math.min(...allResponseTimes);

      // Calculate percentiles
      const p95Index = Math.floor(allResponseTimes.length * 0.95);
      const p99Index = Math.floor(allResponseTimes.length * 0.99);
      stats.p95ResponseTime = allResponseTimes[p95Index] || 0;
      stats.p99ResponseTime = allResponseTimes[p99Index] || 0;
    }

    // Update response size statistics
    const allResponseSizes = this.metrics
      .filter(m => `${m.method} ${m.endpoint}` === key && m.responseSize > 0)
      .map(m => m.responseSize);

    if (allResponseSizes.length > 0) {
      stats.averageResponseSize = allResponseSizes.reduce((sum, size) => sum + size, 0) / allResponseSizes.length;
    }

    // Update error rate
    stats.errorRate = stats.totalRequests > 0 ? (stats.failedRequests / stats.totalRequests) * 100 : 0;
  }

  private trackError(metrics: ApiMetrics): void {
    const errorKey = `${metrics.endpoint}:${metrics.statusCode}`;
    const existing = this.recentErrors.get(errorKey);

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
    if (metrics.responseTime > 5000) {
      this.emit("slowResponse", {
        endpoint: metrics.endpoint,
        responseTime: metrics.responseTime,
        threshold: 5000,
        timestamp: metrics.timestamp,
      });
    }

    // Alert on server errors
    if (metrics.statusCode >= 500) {
      this.emit("serverError", {
        endpoint: metrics.endpoint,
        statusCode: metrics.statusCode,
        error: metrics.error,
        timestamp: metrics.timestamp,
      });
    }

    // Alert on high error rate for endpoint
    const stats = this.endpointStats.get(`${metrics.method} ${metrics.endpoint}`);
    if (stats && stats.totalRequests > 10 && stats.errorRate > 50) {
      this.emit("highErrorRate", {
        endpoint: stats.endpoint,
        errorRate: stats.errorRate,
        totalRequests: stats.totalRequests,
        timestamp: metrics.timestamp,
      });
    }
  }

  private startPeriodicCleanup(): void {
    // Clean up old metrics every 5 minutes
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 300000);
  }

  private cleanupOldMetrics(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const cutoff = now - maxAge;

    // Remove old metrics
    const originalLength = this.metrics.length;
    const filteredMetrics = this.metrics.filter(m => m.timestamp > cutoff);
    this.metrics.length = 0;
    this.metrics.push(...filteredMetrics);

    // Remove old errors
    for (const [key, error] of this.recentErrors.entries()) {
      if (error.lastSeen < cutoff) {
        this.recentErrors.delete(key);
      }
    }

    if (originalLength !== this.metrics.length) {
      this.logger.debug(`Cleaned up ${originalLength - this.metrics.length} old metrics`);
    }
  }

  /**
   * Emit API monitoring events
   */
  emit(event: "apiRequest", metrics: ApiMetrics): boolean;
  emit(event: "slowResponse", data: any): boolean;
  emit(event: "serverError", data: any): boolean;
  emit(event: "highErrorRate", data: any): boolean;
  emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  /**
   * Listen for API monitoring events
   */
  on(event: "apiRequest", callback: (metrics: ApiMetrics) => void): this;
  on(event: "slowResponse", callback: (data: any) => void): this;
  on(event: "serverError", callback: (data: any) => void): this;
  on(event: "highErrorRate", callback: (data: any) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
}
