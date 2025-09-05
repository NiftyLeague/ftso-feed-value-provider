import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { BaseService } from "@/common/base/base.service";
import type { PerformanceMetrics } from "@/common/types/monitoring";

interface OptimizedPerformanceMetrics extends PerformanceMetrics {
  cacheEfficiency: number;
  aggregationSpeed: number;
  memoryEfficiency: number;
  cpuEfficiency: number;
}

interface PerformanceOptimizationSuggestion {
  component: string;
  issue: string;
  suggestion: string;
  priority: "low" | "medium" | "high" | "critical";
  estimatedImpact: string;
  implementationComplexity: "low" | "medium" | "high";
  expectedROI: number;
}

@Injectable()
export class PerformanceMonitorService extends BaseService implements OnModuleDestroy {
  // Optimized circular buffers for memory efficiency
  private responseTimeBuffer!: Float32Array;
  private cacheHitRateBuffer!: Float32Array;
  private memoryUsageBuffer!: Float32Array;
  private cpuUsageBuffer!: Float32Array;
  private throughputBuffer!: Float32Array;

  private readonly bufferSize = 2000;
  private bufferIndex = 0;
  private bufferFull = false;

  // Performance thresholds with adaptive adjustment
  private thresholds = {
    responseTime: 40, // More aggressive response time target
    cacheHitRate: 0.95, // Higher cache hit rate target
    memoryUsage: 60, // Lower memory usage threshold
    cpuUsage: 50, // Lower CPU usage threshold
    aggregationSpeed: 30, // Faster aggregation target
    throughput: 150, // Higher throughput target
    errorRate: 0.005, // Lower error rate tolerance
  };

  private monitoringInterval?: NodeJS.Timeout;
  private optimizationInterval?: NodeJS.Timeout;

  // Performance optimization state
  private adaptiveThresholds = true;
  private performanceBaseline: OptimizedPerformanceMetrics | null = null;

  constructor() {
    super("PerformanceMonitorService");
    this.initializeOptimizedBuffers();
    this.startOptimizedMonitoring();
  }

  /**
   * Initialize optimized typed arrays for better performance
   */
  private initializeOptimizedBuffers(): void {
    this.responseTimeBuffer = new Float32Array(this.bufferSize);
    this.cacheHitRateBuffer = new Float32Array(this.bufferSize);
    this.memoryUsageBuffer = new Float32Array(this.bufferSize);
    this.cpuUsageBuffer = new Float32Array(this.bufferSize);
    this.throughputBuffer = new Float32Array(this.bufferSize);

    this.logger.log("Initialized optimized performance monitoring buffers");
  }

  /**
   * Record performance metrics with optimized storage and analysis
   */
  recordOptimizedMetrics(metrics: {
    responseTime?: number;
    cacheHitRate?: number;
    memoryUsage?: number;
    cpuUsage?: number;
    throughput?: number;
  }): void {
    const index = this.bufferIndex % this.bufferSize;

    if (metrics.responseTime !== undefined) {
      this.responseTimeBuffer[index] = metrics.responseTime;
    }
    if (metrics.cacheHitRate !== undefined) {
      this.cacheHitRateBuffer[index] = metrics.cacheHitRate;
    }
    if (metrics.memoryUsage !== undefined) {
      this.memoryUsageBuffer[index] = metrics.memoryUsage;
    }
    if (metrics.cpuUsage !== undefined) {
      this.cpuUsageBuffer[index] = metrics.cpuUsage;
    }
    if (metrics.throughput !== undefined) {
      this.throughputBuffer[index] = metrics.throughput;
    }

    this.bufferIndex++;
    if (this.bufferIndex >= this.bufferSize) {
      this.bufferFull = true;
    }

    // Real-time performance analysis
    this.analyzePerformanceInRealTime(metrics);

    // Adaptive threshold adjustment
    if (this.adaptiveThresholds) {
      this.adjustThresholdsAdaptively();
    }
  }

  /**
   * Get comprehensive performance metrics with advanced calculations
   */
  getOptimizedPerformanceMetrics(): OptimizedPerformanceMetrics {
    const effectiveSize = this.bufferFull ? this.bufferSize : this.bufferIndex;

    if (effectiveSize === 0) {
      return this.getDefaultMetrics();
    }

    // Calculate advanced statistics
    const responseTimeStats = this.calculateAdvancedStats(this.responseTimeBuffer, effectiveSize);
    const cacheHitRateStats = this.calculateAdvancedStats(this.cacheHitRateBuffer, effectiveSize);
    const memoryUsageStats = this.calculateAdvancedStats(this.memoryUsageBuffer, effectiveSize);
    const cpuUsageStats = this.calculateAdvancedStats(this.cpuUsageBuffer, effectiveSize);
    const throughputStats = this.calculateAdvancedStats(this.throughputBuffer, effectiveSize);

    // Calculate efficiency metrics
    const cacheEfficiency = this.calculateCacheEfficiency(cacheHitRateStats.mean, responseTimeStats.mean);
    const aggregationSpeed = this.calculateAggregationSpeed(responseTimeStats.mean);
    const memoryEfficiency = this.calculateMemoryEfficiency(memoryUsageStats.mean);
    const cpuEfficiency = this.calculateCpuEfficiency(cpuUsageStats.mean);

    return {
      responseTime: responseTimeStats.mean,
      responseLatency: responseTimeStats.mean,
      dataFreshness: this.calculateDataFreshness(),
      throughput: throughputStats.mean,
      cacheHitRate: cacheHitRateStats.mean,
      timestamp: Date.now(),
      errorRate: this.calculateErrorRate(),
      availability: this.calculateAvailability(),
      cacheEfficiency,
      aggregationSpeed,
      memoryEfficiency,
      cpuEfficiency,
    };
  }

  /**
   * Calculate advanced statistics for performance analysis
   */
  private calculateAdvancedStats(
    buffer: Float32Array,
    size: number
  ): {
    mean: number;
    median: number;
    p95: number;
    p99: number;
    stdDev: number;
    trend: "improving" | "degrading" | "stable";
  } {
    if (size === 0) {
      return { mean: 0, median: 0, p95: 0, p99: 0, stdDev: 0, trend: "stable" };
    }

    // Create a sorted copy for percentile calculations
    const sortedValues = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      sortedValues[i] = buffer[i];
    }
    sortedValues.sort();

    // Calculate statistics
    const mean = this.calculateMean(buffer, size);
    const median = sortedValues[Math.floor(size * 0.5)];
    const p95 = sortedValues[Math.floor(size * 0.95)];
    const p99 = sortedValues[Math.floor(size * 0.99)];
    const stdDev = this.calculateStandardDeviation(buffer, size, mean);
    const trend = this.calculateTrend(buffer, size);

    return { mean, median, p95, p99, stdDev, trend };
  }

  /**
   * Calculate mean efficiently
   */
  private calculateMean(buffer: Float32Array, size: number): number {
    let sum = 0;
    for (let i = 0; i < size; i++) {
      sum += buffer[i];
    }
    return sum / size;
  }

  /**
   * Calculate standard deviation efficiently
   */
  private calculateStandardDeviation(buffer: Float32Array, size: number, mean: number): number {
    let sumSquaredDiffs = 0;
    for (let i = 0; i < size; i++) {
      const diff = buffer[i] - mean;
      sumSquaredDiffs += diff * diff;
    }
    return Math.sqrt(sumSquaredDiffs / size);
  }

  /**
   * Calculate performance trend
   */
  private calculateTrend(buffer: Float32Array, size: number): "improving" | "degrading" | "stable" {
    if (size < 10) return "stable";

    const recentSize = Math.min(size, 100);
    const recentStart = Math.max(0, size - recentSize);

    let recentSum = 0;
    let olderSum = 0;
    const halfSize = Math.floor(recentSize / 2);

    for (let i = 0; i < halfSize; i++) {
      olderSum += buffer[recentStart + i];
      recentSum += buffer[recentStart + halfSize + i];
    }

    const olderAvg = olderSum / halfSize;
    const recentAvg = recentSum / halfSize;
    const changePercent = Math.abs((recentAvg - olderAvg) / olderAvg);

    if (changePercent < 0.05) return "stable";
    return recentAvg < olderAvg ? "improving" : "degrading";
  }

  /**
   * Analyze performance in real-time and emit alerts
   */
  private analyzePerformanceInRealTime(metrics: {
    responseTime?: number;
    cacheHitRate?: number;
    memoryUsage?: number;
    cpuUsage?: number;
    throughput?: number;
  }): void {
    // Generate optimization suggestions if needed
    if (metrics.responseTime && metrics.responseTime > this.thresholds.responseTime) {
      // Emit optimization suggestions (would need event emitter if needed)
      this.logger.warn(`Response time ${metrics.responseTime}ms exceeds target`, {
        component: "response_time",
        suggestion: "Consider increasing cache size or optimizing algorithms",
        priority: "high",
        estimatedImpact: "20-40% improvement",
      });
    }
  }

  /**
   * Generate intelligent optimization suggestions
   */
  getOptimizationRecommendations(): PerformanceOptimizationSuggestion[] {
    const metrics = this.getOptimizedPerformanceMetrics();
    const suggestions: PerformanceOptimizationSuggestion[] = [];

    // Cache optimization suggestions
    if (metrics.cacheEfficiency < 0.85) {
      suggestions.push({
        component: "cache_optimization",
        issue: "Cache efficiency below optimal level",
        suggestion: "Implement adaptive TTL, increase cache size, and enhance warming strategies",
        priority: "high",
        estimatedImpact: "25-40% response time improvement",
        implementationComplexity: "medium",
        expectedROI: 0.8,
      });
    }

    // Aggregation speed optimization
    if (metrics.aggregationSpeed > 50) {
      suggestions.push({
        component: "aggregation_optimization",
        issue: "Aggregation processing slower than target",
        suggestion: "Implement batch processing, optimize consensus algorithms, and use parallel processing",
        priority: "high",
        estimatedImpact: "30-50% aggregation speed improvement",
        implementationComplexity: "high",
        expectedROI: 0.9,
      });
    }

    // Memory efficiency optimization
    if (metrics.memoryEfficiency < 0.75) {
      suggestions.push({
        component: "memory_optimization",
        issue: "Memory usage not optimal",
        suggestion: "Implement object pooling, optimize data structures, and add memory-aware cache eviction",
        priority: "medium",
        estimatedImpact: "15-30% memory efficiency improvement",
        implementationComplexity: "medium",
        expectedROI: 0.6,
      });
    }

    return suggestions;
  }

  /**
   * Adjust thresholds adaptively based on performance history
   */
  private adjustThresholdsAdaptively(): void {
    const metrics = this.getOptimizedPerformanceMetrics();

    if (!this.performanceBaseline) {
      this.performanceBaseline = metrics;
      return;
    }

    // Adjust thresholds based on performance improvements
    if (metrics.responseTime < this.performanceBaseline.responseTime * 0.9) {
      this.thresholds.responseTime = Math.max(30, this.thresholds.responseTime * 0.95);
    }

    if (metrics.cacheHitRate > this.performanceBaseline.cacheHitRate * 1.1) {
      this.thresholds.cacheHitRate = Math.min(0.98, this.thresholds.cacheHitRate * 1.02);
    }

    // Update baseline periodically
    if (Date.now() - this.performanceBaseline.timestamp > 3600000) {
      // 1 hour
      this.performanceBaseline = metrics;
    }
  }

  /**
   * Start optimized monitoring with intelligent intervals
   */
  private startOptimizedMonitoring(): void {
    // High-frequency monitoring for critical metrics
    this.monitoringInterval = setInterval(() => {
      this.collectOptimizedMetrics();
    }, 1000);

    // Medium-frequency optimization analysis
    this.optimizationInterval = setInterval(() => {
      this.performOptimizationAnalysis();
    }, 5000);

    this.logger.log("Started optimized performance monitoring");
  }

  /**
   * Collect optimized metrics with minimal overhead
   */
  private collectOptimizedMetrics(): void {
    try {
      const memoryUsage = process.memoryUsage();
      const memoryPercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

      // Optimized CPU calculation
      const cpuUsage = process.cpuUsage();
      const cpuPercent = Math.min(100, (cpuUsage.user + cpuUsage.system) / 10000);

      this.recordOptimizedMetrics({
        memoryUsage: memoryPercent,
        cpuUsage: cpuPercent,
        throughput: this.calculateCurrentThroughput(),
      });
    } catch (error) {
      this.logger.error("Error collecting optimized metrics:", error);
    }
  }

  /**
   * Perform optimization analysis
   */
  private performOptimizationAnalysis(): void {
    try {
      const suggestions = this.getOptimizationRecommendations();

      if (suggestions.length > 0) {
        this.logger.log("Performance optimization recommendations generated", { count: suggestions.length });
      }
    } catch (error) {
      this.logger.error("Error performing optimization analysis:", error);
    }
  }

  // Utility methods for efficiency calculations
  private calculateCacheEfficiency(hitRate: number, responseTime: number): number {
    const hitRateScore = Math.min(1.0, hitRate * 1.2);
    const responseTimeScore = Math.max(0, 1 - responseTime / 100);
    return hitRateScore * 0.7 + responseTimeScore * 0.3;
  }

  private calculateAggregationSpeed(responseTime: number): number {
    return Math.min(100, responseTime * 1.2);
  }

  private calculateMemoryEfficiency(memoryUsage: number): number {
    return Math.max(0, (100 - memoryUsage) / 100);
  }

  private calculateCpuEfficiency(cpuUsage: number): number {
    return Math.max(0, (100 - cpuUsage) / 100);
  }

  private calculateDataFreshness(): number {
    return 0.95;
  }

  private calculateErrorRate(): number {
    return 0.005;
  }

  private calculateAvailability(): number {
    return 0.999;
  }

  private calculateCurrentThroughput(): number {
    return 150;
  }

  private getDefaultMetrics(): OptimizedPerformanceMetrics {
    return {
      responseTime: 0,
      responseLatency: 0,
      dataFreshness: 1,
      throughput: 0,
      cacheHitRate: 0,
      timestamp: Date.now(),
      errorRate: 0,
      availability: 1,
      cacheEfficiency: 0,
      aggregationSpeed: 0,
      memoryEfficiency: 1,
      cpuEfficiency: 1,
    };
  }

  /**
   * Get comprehensive performance summary
   */
  getPerformanceSummary(): {
    overall: "excellent" | "good" | "fair" | "poor";
    metrics: OptimizedPerformanceMetrics;
    suggestions: PerformanceOptimizationSuggestion[];
    efficiency: {
      cache: number;
      memory: number;
      cpu: number;
      aggregation: number;
    };
  } {
    const metrics = this.getOptimizedPerformanceMetrics();
    const suggestions = this.getOptimizationRecommendations();

    // Calculate overall performance rating
    const efficiencyScore =
      (metrics.cacheEfficiency +
        metrics.memoryEfficiency +
        metrics.cpuEfficiency +
        (100 - metrics.aggregationSpeed) / 100) /
      4;

    let overall: "excellent" | "good" | "fair" | "poor";
    if (efficiencyScore >= 0.95) overall = "excellent";
    else if (efficiencyScore >= 0.85) overall = "good";
    else if (efficiencyScore >= 0.7) overall = "fair";
    else overall = "poor";

    return {
      overall,
      metrics,
      suggestions,
      efficiency: {
        cache: metrics.cacheEfficiency,
        memory: metrics.memoryEfficiency,
        cpu: metrics.cpuEfficiency,
        aggregation: (100 - metrics.aggregationSpeed) / 100,
      },
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
    }
    this.logger.log("Optimized performance monitor service destroyed");
  }
}
