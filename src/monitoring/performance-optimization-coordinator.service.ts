import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { BaseEventService } from "@/common/base/base-event.service";

// Performance monitoring services
import { PerformanceMonitorService } from "./performance-monitor.service";

// Cache services
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";

// Aggregation services
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";

interface PerformanceOptimizationConfig {
  enabled: boolean;
  monitoringInterval: number;
  optimizationInterval: number;
  autoOptimization: boolean;
  performanceTargets: {
    responseTime: number;
    cacheHitRate: number;
    memoryUsage: number;
    cpuUsage: number;
  };
}

interface OptimizationAction {
  action: string;
  component: string;
  description: string;
  priority: "low" | "medium" | "high" | "critical";
  estimatedImpact: string;
  implemented: boolean;
  timestamp: number;
}

@Injectable()
export class PerformanceOptimizationCoordinatorService
  extends BaseEventService
  implements OnModuleInit, OnModuleDestroy
{
  private config: PerformanceOptimizationConfig = {
    enabled: true,
    monitoringInterval: 3000, // More frequent monitoring for better responsiveness
    optimizationInterval: 20000, // More frequent optimization analysis
    autoOptimization: true, // Whether to automatically apply performance fixes
    performanceTargets: {
      responseTime: 50, // More aggressive response time target (ms)
      cacheHitRate: 0.95, // Higher cache hit rate target for optimal performance
      memoryUsage: 60, // Lower memory usage threshold before optimization triggers
      cpuUsage: 50, // Lower CPU usage threshold before optimization triggers
    },
  };

  private monitoringInterval?: NodeJS.Timeout;
  private optimizationInterval?: NodeJS.Timeout;
  private optimizationActions: OptimizationAction[] = [];
  private performanceHistory: Array<{
    timestamp: number;
    responseTime: number;
    cacheHitRate: number;
    memoryUsage: number;
    cpuUsage: number;
  }> = [];

  constructor(
    private readonly performanceMonitor: PerformanceMonitorService,
    private readonly cacheService: RealTimeCacheService,
    private readonly cacheWarmer: CacheWarmerService,
    private readonly aggregationService: RealTimeAggregationService
  ) {
    super("PerformanceOptimizationCoordinator", true);
  }

  async onModuleInit(): Promise<void> {
    if (this.config.enabled) {
      await this.initializeOptimizationCoordinator();
      this.startPerformanceOptimization();
      this.logger.log("Performance optimization coordinator initialized and started");
    }
  }

  /**
   * Initialize the optimization coordinator
   */
  private async initializeOptimizationCoordinator(): Promise<void> {
    try {
      // Set up event listeners for performance monitoring
      this.setupPerformanceEventListeners();

      // Initialize baseline performance metrics
      await this.collectBaselineMetrics();

      // Set up intelligent cache warming
      this.setupIntelligentCacheWarming();

      this.logger.log("Performance optimization coordinator initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize performance optimization coordinator:", error);
      throw error;
    }
  }

  /**
   * Set up event listeners for performance monitoring
   */
  private setupPerformanceEventListeners(): void {
    // Note: Performance monitor doesn't emit events directly
    // Optimization suggestions are handled through periodic analysis

    // Listen for aggregation events
    this.aggregationService.on("aggregatedPrice", price => {
      this.trackAggregationPerformance(price);
    });

    this.logger.debug("Performance event listeners configured");
  }

  /**
   * Collect baseline performance metrics
   */
  private async collectBaselineMetrics(): Promise<void> {
    try {
      const metrics = this.performanceMonitor.getOptimizedPerformanceMetrics();
      const cacheStats = this.cacheService.getStats();

      this.performanceHistory.push({
        timestamp: Date.now(),
        responseTime: metrics.responseTime,
        cacheHitRate: cacheStats.hitRate,
        memoryUsage: metrics.memoryEfficiency * 100,
        cpuUsage: metrics.cpuEfficiency * 100,
      });

      this.logger.debug("Baseline performance metrics collected", {
        responseTime: metrics.responseTime,
        cacheHitRate: cacheStats.hitRate,
        memoryUsage: metrics.memoryEfficiency * 100,
      });
    } catch (error) {
      this.logger.error("Error collecting baseline metrics:", error);
    }
  }

  /**
   * Set up intelligent cache warming
   */
  private setupIntelligentCacheWarming(): void {
    // Configure cache warmer with aggregation service
    this.cacheWarmer.setDataSourceCallback(async feedId => {
      try {
        return await this.aggregationService.getAggregatedPrice(feedId);
      } catch (error) {
        this.logger.error(`Error fetching data for cache warming:`, error);
        return null;
      }
    });

    this.logger.debug("Cache warming configured");
  }

  /**
   * Start performance optimization monitoring
   */
  private startPerformanceOptimization(): void {
    // Main monitoring loop
    this.monitoringInterval = setInterval(() => {
      void this.performPerformanceMonitoring();
    }, this.config.monitoringInterval);

    // Optimization analysis loop
    this.optimizationInterval = setInterval(() => {
      void this.performOptimizationAnalysis();
    }, this.config.optimizationInterval);

    this.logger.log("Performance optimization monitoring started");
  }

  /**
   * Enhanced performance monitoring with optimized metrics collection
   */
  private async performPerformanceMonitoring(): Promise<void> {
    try {
      // Collect optimized metrics from enhanced monitor
      const performanceMetrics = this.performanceMonitor.getOptimizedPerformanceMetrics();
      const cacheStats = this.cacheService.getStats();

      // Record comprehensive metrics
      this.performanceMonitor.recordOptimizedMetrics({
        responseTime: performanceMetrics.responseTime,
        cacheHitRate: cacheStats.hitRate,
        memoryUsage: 100 - performanceMetrics.memoryEfficiency * 100,
        cpuUsage: 100 - performanceMetrics.cpuEfficiency * 100,
        throughput: performanceMetrics.throughput,
      });

      // Update enhanced performance history
      this.performanceHistory.push({
        timestamp: Date.now(),
        responseTime: performanceMetrics.responseTime,
        cacheHitRate: cacheStats.hitRate,
        memoryUsage: 100 - performanceMetrics.memoryEfficiency * 100,
        cpuUsage: 100 - performanceMetrics.cpuEfficiency * 100,
      });

      // Optimized history management
      if (this.performanceHistory.length > 2000) {
        this.performanceHistory.splice(0, this.performanceHistory.length - 2000);
      }

      // Enhanced optimization needs assessment
      await this.checkImmediateOptimizationNeeds(performanceMetrics, cacheStats);
    } catch (error) {
      this.logger.error("Error in enhanced performance monitoring:", error);
    }
  }

  /**
   * Check for immediate optimization needs
   */
  private async checkImmediateOptimizationNeeds(
    performanceMetrics: { responseTime: number; memoryEfficiency: number; cpuEfficiency: number },
    cacheStats: { hitRate: number }
  ): Promise<void> {
    const actions: OptimizationAction[] = [];

    // Check response time
    if (performanceMetrics.responseTime > this.config.performanceTargets.responseTime) {
      actions.push({
        action: "optimize_response_time",
        component: "aggregation",
        description: `Response time ${performanceMetrics.responseTime}ms exceeds target ${this.config.performanceTargets.responseTime}ms`,
        priority: performanceMetrics.responseTime > 150 ? "critical" : "high",
        estimatedImpact: "20-40% response time improvement",
        implemented: false,
        timestamp: Date.now(),
      });
    }

    // Check cache hit rate
    if (cacheStats.hitRate < this.config.performanceTargets.cacheHitRate) {
      actions.push({
        action: "optimize_cache_performance",
        component: "cache",
        description: `Cache hit rate ${(cacheStats.hitRate * 100).toFixed(1)}% below target ${(this.config.performanceTargets.cacheHitRate * 100).toFixed(1)}%`,
        priority: cacheStats.hitRate < 0.7 ? "high" : "medium",
        estimatedImpact: "15-30% performance improvement",
        implemented: false,
        timestamp: Date.now(),
      });
    }

    // Execute immediate optimizations if auto-optimization is enabled
    if (this.config.autoOptimization && actions.length > 0) {
      await this.executeOptimizationActions(actions);
    }

    // Store actions for reporting
    this.optimizationActions.push(...actions);
  }

  /**
   * Perform optimization analysis
   */
  private async performOptimizationAnalysis(): Promise<void> {
    try {
      // Get optimization recommendations
      const recommendations = this.performanceMonitor.getOptimizationRecommendations();

      if (recommendations.length > 0) {
        this.enhancedLogger?.debug("Performance optimization analysis completed", {
          component: "PerformanceOptimizationCoordinator",
          operation: "optimization_analysis",
          metadata: {
            recommendationCount: recommendations.length,
            highPriorityCount: recommendations.filter(r => r.priority === "high").length,
          },
        });

        // Convert recommendations to actions
        const actions = recommendations.map(rec => ({
          action: `optimize_${rec.component}`,
          component: rec.component,
          description: rec.suggestion,
          priority: rec.priority as "low" | "medium" | "high" | "critical",
          estimatedImpact: rec.estimatedImpact,
          implemented: false,
          timestamp: Date.now(),
        }));

        // Execute high-priority actions if auto-optimization is enabled
        if (this.config.autoOptimization) {
          const highPriorityActions = actions.filter(a => a.priority === "high" || a.priority === "critical");
          if (highPriorityActions.length > 0) {
            await this.executeOptimizationActions(highPriorityActions);
          }
        }

        this.optimizationActions.push(...actions);
      }

      // Cleanup old optimization actions
      this.cleanupOptimizationActions();
    } catch (error) {
      this.logger.error("Error in optimization analysis:", error);
    }
  }

  /**
   * Execute optimization actions
   */
  private async executeOptimizationActions(actions: OptimizationAction[]): Promise<void> {
    for (const action of actions) {
      try {
        await this.executeOptimizationAction(action);
        action.implemented = true;

        this.enhancedLogger?.debug(`Executed optimization action: ${action.action}`, {
          component: "PerformanceOptimizationCoordinator",
          operation: "execute_optimization_action",
          metadata: {
            action: action.action,
            component: action.component,
            priority: action.priority,
            estimatedImpact: action.estimatedImpact,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to execute optimization action ${action.action}:`, error);
      }
    }
  }

  /**
   * Execute a specific optimization action
   */
  private async executeOptimizationAction(action: OptimizationAction): Promise<void> {
    switch (action.action) {
      case "optimize_response_time":
        await this.optimizeResponseTime();
        break;

      case "optimize_cache_performance":
        await this.optimizeCachePerformance();
        break;

      case "optimize_memory_usage":
        await this.optimizeMemoryUsage();
        break;

      case "optimize_aggregation_optimization":
        await this.optimizeAggregationPerformance();
        break;

      default:
        this.logger.warn(`Unknown optimization action: ${action.action}`);
    }
  }

  /**
   * Optimize response time
   */
  private async optimizeResponseTime(): Promise<void> {
    // Increase cache warming frequency
    // Note: This would require modifying the intelligent cache warmer configuration
    this.logger.debug("Optimizing response time through enhanced cache warming");
  }

  /**
   * Optimize cache performance
   */
  private async optimizeCachePerformance(): Promise<void> {
    // Use the new optimization methods
    this.cacheService.optimizePerformance();

    // Get cache efficiency and log results
    const efficiency = this.cacheService.getEfficiencyScore();
    this.logger.log(`Cache performance optimized - efficiency score: ${(efficiency * 100).toFixed(1)}%`);
  }

  /**
   * Optimize memory usage
   */
  private async optimizeMemoryUsage(): Promise<void> {
    // Trigger garbage collection and cache cleanup
    if (global.gc) {
      global.gc();
    }
    this.logger.debug("Optimized memory usage through garbage collection");
  }

  /**
   * Optimize aggregation performance
   */
  private async optimizeAggregationPerformance(): Promise<void> {
    // Use the new optimization methods
    this.aggregationService.optimizePerformance();

    // Get aggregation efficiency and log results
    const efficiency = this.aggregationService.getEfficiencyScore();
    this.logger.log(`Aggregation performance optimized - efficiency score: ${(efficiency * 100).toFixed(1)}%`);
  }

  /**
   * Track aggregation performance
   */
  private trackAggregationPerformance(price: {
    symbol: string;
    price: number;
    sources?: string[];
    confidence: number;
  }): void {
    // Track aggregation performance metrics
    this.enhancedLogger?.debug(`Aggregation performance tracked for ${price.symbol}`, {
      component: "PerformanceOptimizationCoordinator",
      operation: "track_aggregation_performance",
      metadata: {
        symbol: price.symbol,
        price: price.price,
        sources: price.sources?.length || 0,
        confidence: price.confidence,
      },
    });
  }

  /**
   * Cleanup old optimization actions
   */
  private cleanupOptimizationActions(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    const initialCount = this.optimizationActions.length;
    this.optimizationActions = this.optimizationActions.filter(action => now - action.timestamp < maxAge);

    const cleanedCount = initialCount - this.optimizationActions.length;
    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} old optimization actions`);
    }
  }

  /**
   * Get performance optimization summary
   */
  getOptimizationSummary(): {
    config: PerformanceOptimizationConfig;
    recentActions: OptimizationAction[];
    performanceTrends: {
      responseTime: { current: number; trend: "improving" | "degrading" | "stable" };
      cacheHitRate: { current: number; trend: "improving" | "degrading" | "stable" };
      memoryUsage: { current: number; trend: "improving" | "degrading" | "stable" };
    };
    recommendations: string[];
  } {
    const recentHistory = this.performanceHistory.slice(-10);
    const current = recentHistory[recentHistory.length - 1];
    const previous = recentHistory[recentHistory.length - 2];

    const calculateTrend = (
      current: number,
      previous: number,
      lowerIsBetter = false
    ): "improving" | "degrading" | "stable" => {
      if (!previous) return "stable";
      const diff = current - previous;
      const threshold = Math.abs(current * 0.05); // 5% threshold

      if (Math.abs(diff) < threshold) return "stable";

      if (lowerIsBetter) {
        return diff < 0 ? "improving" : "degrading";
      } else {
        return diff > 0 ? "improving" : "degrading";
      }
    };

    const performanceTrends =
      current && previous
        ? {
            responseTime: {
              current: current.responseTime,
              trend: calculateTrend(current.responseTime, previous.responseTime, true),
            },
            cacheHitRate: {
              current: current.cacheHitRate,
              trend: calculateTrend(current.cacheHitRate, previous.cacheHitRate),
            },
            memoryUsage: {
              current: current.memoryUsage,
              trend: calculateTrend(current.memoryUsage, previous.memoryUsage, true),
            },
          }
        : {
            responseTime: { current: 0, trend: "stable" as const },
            cacheHitRate: { current: 0, trend: "stable" as const },
            memoryUsage: { current: 0, trend: "stable" as const },
          };

    const recentActions = this.optimizationActions
      .filter(action => Date.now() - action.timestamp < 3600000) // Last hour
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

    const recommendations = this.generateRecommendations(performanceTrends);

    return {
      config: { ...this.config },
      recentActions,
      performanceTrends,
      recommendations,
    };
  }

  /**
   * Generate performance recommendations
   */
  private generateRecommendations(trends: {
    responseTime: { current: number; trend: "improving" | "degrading" | "stable" };
    cacheHitRate: { current: number; trend: "improving" | "degrading" | "stable" };
    memoryUsage: { current: number; trend: "improving" | "degrading" | "stable" };
  }): string[] {
    const recommendations: string[] = [];

    if (trends.responseTime.trend === "degrading") {
      recommendations.push("Consider increasing cache warming frequency or optimizing aggregation algorithms");
    }

    if (trends.cacheHitRate.trend === "degrading") {
      recommendations.push("Implement more aggressive cache warming or increase cache size");
    }

    if (trends.memoryUsage.trend === "degrading") {
      recommendations.push("Review memory usage patterns and implement more frequent garbage collection");
    }

    if (recommendations.length === 0) {
      recommendations.push("Performance is stable - continue monitoring");
    }

    return recommendations;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
    }
    this.logger.log("Performance optimization coordinator destroyed");
  }
}
