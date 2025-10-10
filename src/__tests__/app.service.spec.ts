// Simple test for FtsoProviderService
import { FtsoProviderService } from "../app.service";

// Mock services
const mockCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  has: jest.fn(),
  delete: jest.fn(),
  clear: jest.fn(),
  getStats: jest.fn().mockReturnValue({
    hits: 100,
    misses: 50,
    hitRate: 0.67,
    size: 1000,
    maxSize: 5000,
  }),
  getCacheStats: jest.fn().mockReturnValue({
    hits: 100,
    misses: 50,
    hitRate: 0.67,
    size: 1000,
    maxSize: 5000,
  }),
};

const mockAggregationService = {
  getAggregationStats: jest.fn().mockReturnValue({
    totalFeeds: 10,
    activeFeeds: 8,
    averageAccuracy: 0.95,
    lastUpdate: Date.now(),
  }),
  getCacheStats: jest.fn().mockReturnValue({
    totalEntries: 1000,
    hitRate: 0.85,
    averageResponseTime: 50,
  }),
  getActiveFeedCount: jest.fn().mockReturnValue(5),
};

describe("FtsoProviderService", () => {
  let service: FtsoProviderService;

  beforeEach(() => {
    service = new FtsoProviderService(mockCacheService as any, mockAggregationService as any);
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should be instance of FtsoProviderService", () => {
      expect(service).toBeInstanceOf(FtsoProviderService);
    });
  });

  describe("Basic Functionality", () => {
    it("should handle service creation", () => {
      expect(service).toBeDefined();
      expect(typeof service).toBe("object");
    });

    it("should have required methods", () => {
      expect(typeof service.getValue).toBe("function");
      expect(typeof service.getValues).toBe("function");
      expect(typeof service.getVolumes).toBe("function");
      expect(typeof service.getPerformanceMetrics).toBe("function");
      expect(typeof service.healthCheck).toBe("function");
      expect(typeof service.getServicePerformanceMetrics).toBe("function");
    });
  });

  describe("Integration Service Management", () => {
    it("should set integration service successfully", () => {
      const mockIntegrationService = {
        getAggregatedPrices: jest.fn(),
        getAggregatedVolumes: jest.fn(),
        getHealthStatus: jest.fn(),
        getPerformanceMetrics: jest.fn(),
        isHealthy: jest.fn().mockReturnValue(true),
        getStatus: jest.fn().mockReturnValue("healthy"),
        getMetrics: jest.fn().mockReturnValue({ responseTime: 100 }),
        // Add the required operations that the service checks for
        getCurrentPrice: jest.fn(),
        getCurrentPrices: jest.fn(),
        getSystemHealth: jest.fn(),
      };

      expect(() => {
        service.setIntegrationService(mockIntegrationService as any);
      }).not.toThrow();
    });

    it("should throw error for invalid integration service", () => {
      const invalidService = {} as any;

      expect(() => {
        service.setIntegrationService(invalidService);
      }).toThrow("Invalid integration service: missing required operations");
    });
  });

  describe("Error Handling", () => {
    it("should handle missing integration service", async () => {
      const feedId = { category: 1, name: "BTC/USD" };

      await expect(service.getValue(feedId)).rejects.toThrow("Production integration service not available");
    });

    it("should handle missing integration service for getValues", async () => {
      const feedIds = [{ category: 1, name: "BTC/USD" }];

      await expect(service.getValues(feedIds)).rejects.toThrow("Production integration service not available");
    });

    it("should handle getVolumes without integration service", async () => {
      const feedIds = [{ category: 1, name: "BTC/USD" }];

      const result = await service.getVolumes(feedIds, 300000);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].feed).toEqual(feedIds[0]);
      expect(result[0].volumes).toEqual([]);
    });
  });

  describe("Performance and Health Methods", () => {
    it("should call getPerformanceMetrics", async () => {
      // Mock the cache service to return proper stats
      mockCacheService.getStats.mockReturnValue({
        hitRate: 0.85,
        missRate: 0.15,
        totalEntries: 1000,
      });

      // Mock the aggregation service methods
      mockAggregationService.getCacheStats.mockReturnValue({
        hitRate: 0.85,
        missRate: 0.15,
        totalEntries: 1000,
      });

      const result = await service.getPerformanceMetrics();
      expect(result).toBeDefined();
      expect(result.uptime).toBeDefined();
      expect(result.cacheStats).toBeDefined();
      expect(result.aggregationStats).toBeDefined();
    });

    it("should call healthCheck", async () => {
      const result = await service.healthCheck();
      expect(result).toBeDefined();
    });

    it("should call getServicePerformanceMetrics", async () => {
      const result = await service.getServicePerformanceMetrics();
      expect(result).toBeDefined();
    });
  });
});
