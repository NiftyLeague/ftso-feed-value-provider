import { Test, TestingModule } from "@nestjs/testing";

import { PerformanceOptimizationCoordinatorService } from "../performance-optimization-coordinator.service";
import { PerformanceMonitorService } from "../performance-monitor.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";

describe("PerformanceOptimizationCoordinatorService", () => {
  let service: PerformanceOptimizationCoordinatorService;
  let performanceMonitor: any;
  let cacheService: any;
  let cacheWarmer: any;
  let aggregationService: any;

  beforeEach(async () => {
    performanceMonitor = {
      getPerformanceMetrics: jest.fn().mockReturnValue({
        responseTime: 50,
        memoryEfficiency: 0.9,
        cpuEfficiency: 0.9,
        throughput: 100,
      }),
      recordOptimizedMetrics: jest.fn(),
      getOptimizationRecommendations: jest.fn().mockReturnValue([]),
    };

    cacheService = {
      getStats: jest.fn().mockReturnValue({ hitRate: 0.9 }),
      getEfficiencyScore: jest.fn().mockReturnValue(0.8),
      optimizePerformance: jest.fn(),
    };

    cacheWarmer = {
      setDataSourceCallback: jest.fn(),
    };

    aggregationService = {
      on: jest.fn(),
      getAggregatedPrice: jest.fn().mockResolvedValue({ symbol: "BTC/USD", price: 100, confidence: 0.9 }),
      optimizePerformance: jest.fn(),
      getEfficiencyScore: jest.fn().mockReturnValue(0.9),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceOptimizationCoordinatorService,
        { provide: PerformanceMonitorService, useValue: performanceMonitor },
        { provide: RealTimeCacheService, useValue: cacheService },
        { provide: CacheWarmerService, useValue: cacheWarmer },
        { provide: RealTimeAggregationService, useValue: aggregationService },
      ],
    }).compile();

    service = module.get(PerformanceOptimizationCoordinatorService);

    // Replace logger with deterministic spies
    (service as any).logger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    (service as any).enhancedLogger = {
      debug: jest.fn(),
    };
  });

  it("initializes when enabled and starts monitoring", async () => {
    const initSpy = jest
      .spyOn(service as any, "initializeOptimizationCoordinator")
      .mockImplementation(async () => undefined);
    const startSpy = jest.spyOn(service as any, "startPerformanceOptimization").mockImplementation(() => undefined);

    await service.initialize();

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect((service as any).logger.log).toHaveBeenCalled();
  });

  it("does not initialize when disabled", async () => {
    (service as any).config.enabled = false;
    const initSpy = jest.spyOn(service as any, "initializeOptimizationCoordinator");
    const startSpy = jest.spyOn(service as any, "startPerformanceOptimization");

    await service.initialize();

    expect(initSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("collects baseline metrics", async () => {
    await (service as any).collectBaselineMetrics();
    expect((service as any).performanceHistory.length).toBe(1);
    expect(performanceMonitor.getPerformanceMetrics).toHaveBeenCalled();
    expect(cacheService.getStats).toHaveBeenCalled();
  });

  it("configures cache warming callback and returns aggregated price", async () => {
    (service as any).setupIntelligentCacheWarming();

    expect(cacheWarmer.setDataSourceCallback).toHaveBeenCalledTimes(1);
    const cb = cacheWarmer.setDataSourceCallback.mock.calls[0][0];

    const result = await cb({ category: 1, name: "BTC/USD" });
    expect(aggregationService.getAggregatedPrice).toHaveBeenCalled();
    expect(result).toEqual({ symbol: "BTC/USD", price: 100, confidence: 0.9 });
  });

  it("cache warming callback returns null when aggregation fails", async () => {
    aggregationService.getAggregatedPrice.mockRejectedValueOnce(new Error("boom"));

    (service as any).setupIntelligentCacheWarming();
    const cb = cacheWarmer.setDataSourceCallback.mock.calls[0][0];
    const result = await cb({ category: 1, name: "BTC/USD" });

    expect(result).toBeNull();
    expect((service as any).logger.error).toHaveBeenCalled();
  });

  it("creates and executes immediate optimization actions when thresholds exceeded", async () => {
    // Force very strict targets and enable auto-optimization
    (service as any).config.performanceTargets = {
      responseTime: 10,
      cacheHitRate: 0.95,
      memoryUsage: 50,
      cpuUsage: 50,
    };
    (service as any).config.autoOptimization = true;

    const executeSpy = jest
      .spyOn(service as any, "executeOptimizationActions")
      .mockImplementation(async (...args: unknown[]) => {
        const actions = (args[0] as any[]) ?? [];
        actions.forEach(a => (a.implemented = true));
      });

    await (service as any).checkImmediateOptimizationNeeds(
      { responseTime: 200, memoryEfficiency: 0.9, cpuEfficiency: 0.9 },
      { hitRate: 0.5 }
    );

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect((service as any).optimizationActions.length).toBeGreaterThan(0);
  });

  it("optimizes cache performance and logs improvement", async () => {
    cacheService.getEfficiencyScore.mockReturnValueOnce(0.5).mockReturnValueOnce(0.7);
    await (service as any).optimizeCachePerformance();
    expect(cacheService.optimizePerformance).toHaveBeenCalledTimes(1);
    expect((service as any).logger.log).toHaveBeenCalled();
  });

  it("optimizes cache performance and logs debug for minor change", async () => {
    cacheService.getEfficiencyScore.mockReturnValueOnce(0.5).mockReturnValueOnce(0.505);
    await (service as any).optimizeCachePerformance();
    expect(cacheService.optimizePerformance).toHaveBeenCalledTimes(1);
    expect((service as any).logger.debug).toHaveBeenCalled();
  });

  it("dispatches optimization actions and warns for unknown actions", async () => {
    jest.spyOn(service as any, "optimizeResponseTime").mockImplementation(async () => undefined);
    jest.spyOn(service as any, "optimizeCachePerformance").mockImplementation(async () => undefined);
    jest.spyOn(service as any, "optimizeMemoryUsage").mockImplementation(async () => undefined);
    jest.spyOn(service as any, "optimizeAggregationPerformance").mockImplementation(async () => undefined);

    await (service as any).executeOptimizationAction({ action: "optimize_response_time" });
    await (service as any).executeOptimizationAction({ action: "optimize_cache_performance" });
    await (service as any).executeOptimizationAction({ action: "optimize_memory_usage" });
    await (service as any).executeOptimizationAction({ action: "optimize_aggregation_optimization" });
    await (service as any).executeOptimizationAction({ action: "unknown_action" });

    expect((service as any).logger.warn).toHaveBeenCalledWith(expect.stringContaining("Unknown optimization action"));
  });

  it("runs optimization analysis and executes only high/critical actions when enabled", async () => {
    performanceMonitor.getOptimizationRecommendations.mockReturnValueOnce([
      { component: "cache", suggestion: "do cache", priority: "high", estimatedImpact: "x" },
      { component: "aggregation", suggestion: "do agg", priority: "low", estimatedImpact: "y" },
      { component: "memory", suggestion: "do mem", priority: "critical", estimatedImpact: "z" },
    ]);
    (service as any).config.autoOptimization = true;

    const execSpy = jest
      .spyOn(service as any, "executeOptimizationActions")
      .mockImplementation(async (...args: unknown[]) => {
        const actions = (args[0] as any[]) ?? [];
        actions.forEach(a => (a.implemented = true));
      });
    const cleanupSpy = jest.spyOn(service as any, "cleanupOptimizationActions");

    await (service as any).performOptimizationAnalysis();

    expect((service as any).enhancedLogger.debug).toHaveBeenCalled();
    expect(execSpy).toHaveBeenCalledTimes(1);
    const calledWith = execSpy.mock.calls[0][0] as any[];
    expect(calledWith.every(a => a.priority === "high" || a.priority === "critical")).toBe(true);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);
    expect((service as any).optimizationActions.length).toBeGreaterThan(0);
  });

  it("cleans up old optimization actions", () => {
    const now = Date.now();
    (service as any).optimizationActions = [
      {
        action: "a",
        component: "c",
        description: "d",
        priority: "low",
        estimatedImpact: "i",
        implemented: false,
        timestamp: now - 999999999,
      },
    ];

    (service as any).cleanupOptimizationActions();
    expect((service as any).optimizationActions.length).toBe(0);
    expect((service as any).logger.debug).toHaveBeenCalled();
  });

  it("returns stable summary when there is insufficient history", () => {
    (service as any).performanceHistory = [];
    (service as any).optimizationActions = [];

    const summary = service.getOptimizationSummary();
    expect(summary.performanceTrends.responseTime.trend).toBe("stable");
    expect(summary.recommendations).toContain("Performance is stable - continue monitoring");
  });

  it("records monitoring metrics and trims history", async () => {
    (service as any).performanceHistory = Array.from({ length: 2100 }).map((_, i) => ({
      timestamp: Date.now() - i,
      responseTime: 1,
      cacheHitRate: 1,
      memoryUsage: 1,
      cpuUsage: 1,
    }));

    jest.spyOn(service as any, "checkImmediateOptimizationNeeds").mockImplementation(async () => undefined);

    await (service as any).performPerformanceMonitoring();

    expect(performanceMonitor.recordOptimizedMetrics).toHaveBeenCalled();
    expect((service as any).performanceHistory.length).toBe(2000);
  });

  it("logs monitoring errors", async () => {
    performanceMonitor.getPerformanceMetrics.mockImplementationOnce(() => {
      throw new Error("boom");
    });

    await (service as any).performPerformanceMonitoring();
    expect((service as any).logger.error).toHaveBeenCalled();
  });

  it("returns optimization summary with recommendations", () => {
    const now = Date.now();
    (service as any).performanceHistory = [
      { timestamp: now - 1000, responseTime: 100, cacheHitRate: 0.9, memoryUsage: 10, cpuUsage: 10 },
      { timestamp: now, responseTime: 200, cacheHitRate: 0.85, memoryUsage: 20, cpuUsage: 10 },
    ];
    (service as any).optimizationActions = [
      {
        action: "optimize_cache_performance",
        component: "cache",
        description: "x",
        priority: "high",
        estimatedImpact: "y",
        implemented: false,
        timestamp: now - 100,
      },
    ];

    const summary = service.getOptimizationSummary();
    expect(summary.performanceTrends.responseTime.trend).toBe("degrading");
    expect(summary.recommendations.length).toBeGreaterThan(0);
  });
});
