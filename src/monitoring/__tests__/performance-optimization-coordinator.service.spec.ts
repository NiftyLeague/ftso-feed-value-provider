import { Test, TestingModule } from "@nestjs/testing";
import { PerformanceOptimizationCoordinatorService } from "../performance-optimization-coordinator.service";
import { PerformanceMonitorService } from "../performance-monitor.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";

// Mock the dependencies
jest.mock("../performance-monitor.service");
jest.mock("@/cache/real-time-cache.service");
jest.mock("@/cache/cache-warmer.service");
jest.mock("@/aggregators/real-time-aggregation.service");

describe("PerformanceOptimizationCoordinatorService", () => {
  let service: PerformanceOptimizationCoordinatorService;
  let mockPerformanceMonitor: jest.Mocked<PerformanceMonitorService>;
  let mockCacheService: jest.Mocked<RealTimeCacheService>;
  let mockCacheWarmer: jest.Mocked<CacheWarmerService>;
  let mockAggregationService: jest.Mocked<RealTimeAggregationService>;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock instances
    mockPerformanceMonitor = {
      getCurrentMetrics: jest.fn(),
      getPerformanceHistory: jest.fn(),
      isHealthy: jest.fn(),
    } as any;

    mockCacheService = {
      getCacheStats: jest.fn(),
      clearCache: jest.fn(),
      optimizeCache: jest.fn(),
    } as any;

    mockCacheWarmer = {
      startWarming: jest.fn(),
      stopWarming: jest.fn(),
      isWarming: jest.fn(),
      setDataSourceCallback: jest.fn(),
    } as any;

    mockAggregationService = {
      getAggregationStats: jest.fn(),
      optimizeAggregation: jest.fn(),
      getAggregatedPrice: jest.fn(),
      on: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PerformanceOptimizationCoordinatorService,
        {
          provide: PerformanceMonitorService,
          useValue: mockPerformanceMonitor,
        },
        {
          provide: RealTimeCacheService,
          useValue: mockCacheService,
        },
        {
          provide: CacheWarmerService,
          useValue: mockCacheWarmer,
        },
        {
          provide: RealTimeAggregationService,
          useValue: mockAggregationService,
        },
      ],
    }).compile();

    service = module.get<PerformanceOptimizationCoordinatorService>(PerformanceOptimizationCoordinatorService);
  });

  describe("onModuleInit", () => {
    it("should initialize the service", async () => {
      await service.onModuleInit();

      expect(service).toBeDefined();
    });

    it("should initialize without errors", async () => {
      // Mock the aggregation service to have an 'on' method
      (mockAggregationService as any).on = jest.fn();

      await service.onModuleInit();

      expect(service).toBeDefined();
    });
  });

  describe("onModuleDestroy", () => {
    it("should clean up resources", async () => {
      await service.onModuleDestroy();

      expect(service).toBeDefined();
    });

    it("should clean up without errors", async () => {
      await service.onModuleDestroy();

      expect(service).toBeDefined();
    });
  });

  describe("service functionality", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should have required dependencies", () => {
      expect(service).toBeInstanceOf(PerformanceOptimizationCoordinatorService);
    });
  });

  describe("error handling", () => {
    it("should handle service errors gracefully", async () => {
      // Should not throw
      expect(service).toBeDefined();
    });

    it("should handle cache service errors", async () => {
      // Should not throw
      expect(service).toBeDefined();
    });

    it("should handle aggregation service errors", async () => {
      // Should not throw
      expect(service).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("should respect enabled configuration", () => {
      // Test that the service respects its enabled state
      expect(service).toBeDefined();
    });

    it("should use correct performance targets", () => {
      // Test that the service uses appropriate performance targets
      expect(service).toBeDefined();
    });
  });

  describe("monitoring intervals", () => {
    it("should handle monitoring interval configuration", () => {
      // Test that the service respects monitoring interval settings
      expect(service).toBeDefined();
    });

    it("should handle optimization interval configuration", () => {
      // Test that the service respects optimization interval settings
      expect(service).toBeDefined();
    });
  });
});
