import { Injectable, Logger, Inject } from "@nestjs/common";
import { PerformanceMetrics, HealthMetrics, MonitoringConfig } from "./interfaces/monitoring.interfaces";
import * as os from "os";

@Injectable()
export class PerformanceMonitorService {
  private readonly logger = new Logger(PerformanceMonitorService.name);
  private performanceHistory: PerformanceMetrics[] = [];
  private healthHistory: HealthMetrics[] = [];
  private connectionStatus: Map<string, boolean> = new Map();
  private responseTimeHistory: Map<string, number[]> = new Map();
  private dataFreshnessHistory: Map<string, number[]> = new Map();
  private errorCounts: Map<string, number> = new Map();
  private startTime: number = Date.now();

  constructor(@Inject("MonitoringConfig") private readonly config: MonitoringConfig) {
    // Start periodic monitoring
    this.startPeriodicMonitoring();
  }

  /**
   * Track API response latency
   * Requirement 4.1: Response latency monitoring (target <100ms)
   */
  trackResponseLatency(endpoint: string, latency: number): void {
    const history = this.responseTimeHistory.get(endpoint) || [];
    history.push(latency);

    // Keep only last 100 measurements per endpoint
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    this.responseTimeHistory.set(endpoint, history);

    // Log slow responses
    if (latency > this.config.performanceThresholds.maxResponseLatency) {
      this.logger.warn(
        `Slow response detected for ${endpoint}: ${latency}ms > ${this.config.performanceThresholds.maxResponseLatency}ms`
      );
    }
  }

  /**
   * Track data freshness
   * Requirement 4.4: Data freshness tracking (target <2s)
   */
  trackDataFreshness(feedId: string, dataAge: number): void {
    const history = this.dataFreshnessHistory.get(feedId) || [];
    history.push(dataAge);

    // Keep only last 100 measurements per feed
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    this.dataFreshnessHistory.set(feedId, history);

    // Log stale data
    if (dataAge > this.config.performanceThresholds.maxDataAge) {
      this.logger.warn(
        `Stale data detected for ${feedId}: ${dataAge}ms > ${this.config.performanceThresholds.maxDataAge}ms`
      );
    }
  }

  /**
   * Update connection status for exchanges
   * Requirement 4.4: Connection status monitoring for all exchanges
   */
  updateConnectionStatus(exchange: string, isConnected: boolean): void {
    const wasConnected = this.connectionStatus.get(exchange);
    this.connectionStatus.set(exchange, isConnected);

    // Log connection changes
    if (wasConnected !== undefined && wasConnected !== isConnected) {
      if (isConnected) {
        this.logger.log(`Exchange ${exchange} reconnected`);
      } else {
        this.logger.warn(`Exchange ${exchange} disconnected`);
      }
    }
  }

  /**
   * Track error occurrences
   * Requirement 4.5: System resource usage monitoring
   */
  trackError(source: string, error: Error): void {
    const key = `${source}:${error.constructor.name}`;
    const currentCount = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, currentCount + 1);

    this.logger.error(`Error in ${source}: ${error.message}`, error.stack);
  }

  /**
   * Get current performance metrics
   */
  getCurrentPerformanceMetrics(): PerformanceMetrics {
    const now = Date.now();

    // Calculate average response latency across all endpoints
    const allLatencies = Array.from(this.responseTimeHistory.values()).flat();
    const avgLatency =
      allLatencies.length > 0 ? allLatencies.reduce((sum, lat) => sum + lat, 0) / allLatencies.length : 0;

    // Calculate average data freshness across all feeds
    const allFreshness = Array.from(this.dataFreshnessHistory.values()).flat();
    const avgFreshness =
      allFreshness.length > 0 ? allFreshness.reduce((sum, fresh) => sum + fresh, 0) / allFreshness.length : 0;

    // Calculate throughput (simplified - would need request counting in real implementation)
    const throughput = this.calculateThroughput();

    // Calculate cache hit rate (would need cache service integration)
    const cacheHitRate = this.calculateCacheHitRate();

    return {
      responseLatency: avgLatency,
      dataFreshness: avgFreshness,
      throughput,
      cacheHitRate,
      timestamp: now,
    };
  }

  /**
   * Get current health metrics
   */
  getCurrentHealthMetrics(): HealthMetrics {
    const now = Date.now();

    // Calculate error rate (errors per minute)
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    const uptimeMinutes = (now - this.startTime) / 60000;
    const errorRate = uptimeMinutes > 0 ? totalErrors / uptimeMinutes : 0;

    // Get system resource usage
    const cpuUsage = this.getCpuUsage();
    const memoryUsage = this.getMemoryUsage();
    const uptime = now - this.startTime;

    return {
      connectionStatus: new Map(this.connectionStatus),
      errorRate,
      cpuUsage,
      memoryUsage,
      uptime,
      timestamp: now,
    };
  }

  /**
   * Get performance statistics for a specific endpoint
   */
  getEndpointStats(endpoint: string): {
    averageLatency: number;
    maxLatency: number;
    minLatency: number;
    p95Latency: number;
    requestCount: number;
  } {
    const history = this.responseTimeHistory.get(endpoint) || [];

    if (history.length === 0) {
      return {
        averageLatency: 0,
        maxLatency: 0,
        minLatency: 0,
        p95Latency: 0,
        requestCount: 0,
      };
    }

    const sorted = [...history].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);

    return {
      averageLatency: history.reduce((sum, lat) => sum + lat, 0) / history.length,
      maxLatency: Math.max(...history),
      minLatency: Math.min(...history),
      p95Latency: sorted[p95Index] || 0,
      requestCount: history.length,
    };
  }

  /**
   * Get data freshness statistics for a specific feed
   */
  getFeedFreshnessStats(feedId: string): {
    averageFreshness: number;
    maxFreshness: number;
    minFreshness: number;
    staleDataPercentage: number;
  } {
    const history = this.dataFreshnessHistory.get(feedId) || [];

    if (history.length === 0) {
      return {
        averageFreshness: 0,
        maxFreshness: 0,
        minFreshness: 0,
        staleDataPercentage: 0,
      };
    }

    const staleCount = history.filter(age => age > this.config.performanceThresholds.maxDataAge).length;
    const staleDataPercentage = (staleCount / history.length) * 100;

    return {
      averageFreshness: history.reduce((sum, fresh) => sum + fresh, 0) / history.length,
      maxFreshness: Math.max(...history),
      minFreshness: Math.min(...history),
      staleDataPercentage,
    };
  }

  /**
   * Get connection status summary
   */
  getConnectionSummary(): {
    totalExchanges: number;
    connectedExchanges: number;
    disconnectedExchanges: number;
    connectionRate: number;
  } {
    const totalExchanges = this.connectionStatus.size;
    const connectedExchanges = Array.from(this.connectionStatus.values()).filter(Boolean).length;
    const disconnectedExchanges = totalExchanges - connectedExchanges;
    const connectionRate = totalExchanges > 0 ? (connectedExchanges / totalExchanges) * 100 : 0;

    return {
      totalExchanges,
      connectedExchanges,
      disconnectedExchanges,
      connectionRate,
    };
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    totalErrors: number;
    errorRate: number;
    errorsBySource: Map<string, number>;
    topErrors: Array<{ source: string; count: number }>;
  } {
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    const uptimeMinutes = (Date.now() - this.startTime) / 60000;
    const errorRate = uptimeMinutes > 0 ? totalErrors / uptimeMinutes : 0;

    const topErrors = Array.from(this.errorCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalErrors,
      errorRate,
      errorsBySource: new Map(this.errorCounts),
      topErrors,
    };
  }

  /**
   * Check if performance thresholds are met
   */
  checkPerformanceThresholds(): {
    latencyOk: boolean;
    freshnessOk: boolean;
    throughputOk: boolean;
    cacheHitRateOk: boolean;
    overallOk: boolean;
  } {
    const metrics = this.getCurrentPerformanceMetrics();

    const latencyOk = metrics.responseLatency <= this.config.performanceThresholds.maxResponseLatency;
    const freshnessOk = metrics.dataFreshness <= this.config.performanceThresholds.maxDataAge;
    const throughputOk = metrics.throughput >= this.config.performanceThresholds.minThroughput;
    const cacheHitRateOk = metrics.cacheHitRate >= this.config.performanceThresholds.minCacheHitRate;

    return {
      latencyOk,
      freshnessOk,
      throughputOk,
      cacheHitRateOk,
      overallOk: latencyOk && freshnessOk && throughputOk && cacheHitRateOk,
    };
  }

  /**
   * Check if health thresholds are met
   */
  checkHealthThresholds(): {
    errorRateOk: boolean;
    cpuUsageOk: boolean;
    memoryUsageOk: boolean;
    connectionRateOk: boolean;
    overallOk: boolean;
  } {
    const metrics = this.getCurrentHealthMetrics();
    const connectionSummary = this.getConnectionSummary();

    const errorRateOk = metrics.errorRate <= this.config.healthThresholds.maxErrorRate;
    const cpuUsageOk = metrics.cpuUsage <= this.config.healthThresholds.maxCpuUsage;
    const memoryUsageOk = metrics.memoryUsage <= this.config.healthThresholds.maxMemoryUsage;
    const connectionRateOk = connectionSummary.connectionRate >= this.config.healthThresholds.minConnectionRate;

    return {
      errorRateOk,
      cpuUsageOk,
      memoryUsageOk,
      connectionRateOk,
      overallOk: errorRateOk && cpuUsageOk && memoryUsageOk && connectionRateOk,
    };
  }

  /**
   * Reset monitoring data
   */
  resetMonitoringData(): void {
    this.performanceHistory = [];
    this.healthHistory = [];
    this.responseTimeHistory.clear();
    this.dataFreshnessHistory.clear();
    this.errorCounts.clear();
    this.startTime = Date.now();
  }

  /**
   * Start periodic monitoring
   */
  private startPeriodicMonitoring(): void {
    setInterval(() => {
      const performanceMetrics = this.getCurrentPerformanceMetrics();
      const healthMetrics = this.getCurrentHealthMetrics();

      this.performanceHistory.push(performanceMetrics);
      this.healthHistory.push(healthMetrics);

      // Keep only last 1000 entries
      if (this.performanceHistory.length > 1000) {
        this.performanceHistory.splice(0, this.performanceHistory.length - 1000);
      }
      if (this.healthHistory.length > 1000) {
        this.healthHistory.splice(0, this.healthHistory.length - 1000);
      }
    }, this.config.monitoringInterval);
  }

  /**
   * Calculate throughput (simplified implementation)
   */
  private calculateThroughput(): number {
    // In a real implementation, this would track actual request counts
    // For now, return a calculated value based on response time history
    const totalRequests = Array.from(this.responseTimeHistory.values()).reduce(
      (sum, history) => sum + history.length,
      0
    );

    const uptimeSeconds = (Date.now() - this.startTime) / 1000;
    return uptimeSeconds > 0 ? totalRequests / uptimeSeconds : 0;
  }

  /**
   * Calculate cache hit rate (simplified implementation)
   */
  private calculateCacheHitRate(): number {
    // In a real implementation, this would integrate with the cache service
    // For now, return a mock value
    return 85; // 85% hit rate
  }

  /**
   * Get CPU usage percentage
   */
  private getCpuUsage(): number {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    return 100 - (totalIdle / totalTick) * 100;
  }

  /**
   * Get memory usage percentage
   */
  private getMemoryUsage(): number {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return (usedMemory / totalMemory) * 100;
  }
}
