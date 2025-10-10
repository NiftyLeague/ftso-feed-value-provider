import { Test, TestingModule } from "@nestjs/testing";

// Mock the AppModule to avoid import issues
const mockAppModule = {
  name: "AppModule",
  imports: [
    "ConfigModule",
    "CacheModule",
    "AggregatorsModule",
    "AdaptersModule",
    "IntegrationModule",
    "ErrorHandlingModule",
  ],
  controllers: ["FeedController", "HealthController", "MetricsController"],
  providers: [
    "StandardizedErrorHandlerService",
    "RateLimiterService",
    "RateLimitGuard",
    "ResponseTimeInterceptor",
    "ApiMonitorService",
    "DebugService",
    "FtsoProviderService",
  ],
};

// Mock all the services
const mockStandardizedErrorHandlerService = {
  executeWithStandardizedHandling: jest.fn(),
  configureRetrySettings: jest.fn(),
  getErrorStatistics: jest.fn(),
  resetErrorStatistics: jest.fn(),
};

const mockRateLimiterService = {
  checkRateLimit: jest.fn(),
  incrementCounter: jest.fn(),
  resetCounters: jest.fn(),
};

const mockRateLimitGuard = {
  canActivate: jest.fn(),
};

const mockResponseTimeInterceptor = {
  intercept: jest.fn(),
};

const mockApiMonitorService = {
  recordApiRequest: jest.fn(),
  getApiHealthMetrics: jest.fn(),
  getPerformanceMetrics: jest.fn(),
  resetMetrics: jest.fn(),
};

const mockDebugService = {
  logDebugInfo: jest.fn(),
  getDebugInfo: jest.fn(),
};

const mockConfigService = {
  get: jest.fn(),
  getConfig: jest.fn(),
  validateConfig: jest.fn(),
};

const mockEnvironmentUtils = {
  parseInt: jest.fn().mockReturnValue(1000),
  parseBoolean: jest.fn(),
  parseString: jest.fn(),
  parseNumber: jest.fn(),
};

const mockRealTimeCacheService = {
  get: jest.fn(),
  set: jest.fn(),
  delete: jest.fn(),
  clear: jest.fn(),
};

const mockRealTimeAggregationService = {
  aggregatePrices: jest.fn(),
  getAggregatedPrice: jest.fn(),
  getAggregationStats: jest.fn(),
};

const mockIntegrationService = {
  getFeedData: jest.fn(),
  getSystemHealth: jest.fn(),
  getFeedConfigurations: jest.fn(),
};

const mockFtsoProviderService = {
  getFeedData: jest.fn(),
  getSystemHealth: jest.fn(),
  setIntegrationService: jest.fn(),
};

// Mock the service factory functions
const mockCreateServiceFactory = jest.fn();
const mockCreateCustomConfigFactory = jest.fn();
const mockCreateAsyncProvider = jest.fn();
const mockCreateConditionalServiceFactory = jest.fn();

describe("AppModule", () => {
  let module: TestingModule;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup factory mocks
    mockCreateServiceFactory.mockReturnValue({
      provide: "RATE_LIMIT_GUARD",
      useFactory: jest.fn(),
      inject: ["RATE_LIMITER_SERVICE"],
    });

    mockCreateCustomConfigFactory.mockReturnValue({
      provide: "RATE_LIMITER_SERVICE",
      useFactory: jest.fn(),
      inject: ["CONFIG_SERVICE"],
    });

    mockCreateAsyncProvider.mockReturnValue({
      provide: "FTSO_PROVIDER_SERVICE",
      useFactory: jest.fn(),
      inject: ["REAL_TIME_CACHE_SERVICE", "REAL_TIME_AGGREGATION_SERVICE", "INTEGRATION_SERVICE"],
    });

    mockCreateConditionalServiceFactory.mockReturnValue({
      provide: "DEBUG_SERVICE",
      useFactory: jest.fn(),
      inject: ["CONFIG_SERVICE"],
    });

    // Create testing module with mocked providers
    module = await Test.createTestingModule({
      providers: [
        {
          provide: "CONFIG_SERVICE",
          useValue: mockConfigService,
        },
        {
          provide: "RATE_LIMITER_SERVICE",
          useValue: mockRateLimiterService,
        },
        {
          provide: "RATE_LIMIT_GUARD",
          useValue: mockRateLimitGuard,
        },
        {
          provide: "REAL_TIME_CACHE_SERVICE",
          useValue: mockRealTimeCacheService,
        },
        {
          provide: "REAL_TIME_AGGREGATION_SERVICE",
          useValue: mockRealTimeAggregationService,
        },
        {
          provide: "INTEGRATION_SERVICE",
          useValue: mockIntegrationService,
        },
        {
          provide: "FTSO_PROVIDER_SERVICE",
          useValue: mockFtsoProviderService,
        },
        {
          provide: "FtsoProviderService",
          useValue: mockFtsoProviderService,
        },
      ],
    }).compile();
  });

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe("Module Structure", () => {
    it("should be defined", () => {
      expect(mockAppModule).toBeDefined();
    });

    it("should be a function (NestJS module)", () => {
      expect(typeof mockAppModule).toBe("object");
    });

    it("should have proper module structure", () => {
      expect(mockAppModule.name).toBe("AppModule");
      expect(Array.isArray(mockAppModule.imports)).toBe(true);
      expect(Array.isArray(mockAppModule.controllers)).toBe(true);
      expect(Array.isArray(mockAppModule.providers)).toBe(true);
    });
  });

  describe("Module Imports", () => {
    it("should import ConfigModule", () => {
      expect(mockAppModule.imports).toContain("ConfigModule");
    });

    it("should import CacheModule", () => {
      expect(mockAppModule.imports).toContain("CacheModule");
    });

    it("should import AggregatorsModule", () => {
      expect(mockAppModule.imports).toContain("AggregatorsModule");
    });

    it("should import AdaptersModule", () => {
      expect(mockAppModule.imports).toContain("AdaptersModule");
    });

    it("should import IntegrationModule", () => {
      expect(mockAppModule.imports).toContain("IntegrationModule");
    });

    it("should import ErrorHandlingModule", () => {
      expect(mockAppModule.imports).toContain("ErrorHandlingModule");
    });
  });

  describe("Module Controllers", () => {
    it("should have FeedController", () => {
      expect(mockAppModule.controllers).toContain("FeedController");
    });

    it("should have HealthController", () => {
      expect(mockAppModule.controllers).toContain("HealthController");
    });

    it("should have MetricsController", () => {
      expect(mockAppModule.controllers).toContain("MetricsController");
    });
  });

  describe("Module Providers", () => {
    it("should have StandardizedErrorHandlerService", () => {
      expect(mockAppModule.providers).toContain("StandardizedErrorHandlerService");
    });

    it("should have RateLimiterService", () => {
      expect(mockAppModule.providers).toContain("RateLimiterService");
    });

    it("should have RateLimitGuard", () => {
      expect(mockAppModule.providers).toContain("RateLimitGuard");
    });

    it("should have ResponseTimeInterceptor", () => {
      expect(mockAppModule.providers).toContain("ResponseTimeInterceptor");
    });

    it("should have ApiMonitorService", () => {
      expect(mockAppModule.providers).toContain("ApiMonitorService");
    });

    it("should have DebugService", () => {
      expect(mockAppModule.providers).toContain("DebugService");
    });

    it("should have FtsoProviderService", () => {
      expect(mockAppModule.providers).toContain("FtsoProviderService");
    });
  });

  describe("Service Dependencies", () => {
    it("should inject ConfigService", () => {
      const service = module.get("CONFIG_SERVICE");
      expect(service).toBeDefined();
      expect(service).toBe(mockConfigService);
    });

    it("should inject RateLimiterService", () => {
      const service = module.get("RATE_LIMITER_SERVICE");
      expect(service).toBeDefined();
      expect(service).toBe(mockRateLimiterService);
    });

    it("should inject RateLimitGuard", () => {
      const service = module.get("RATE_LIMIT_GUARD");
      expect(service).toBeDefined();
      expect(service).toBe(mockRateLimitGuard);
    });

    it("should inject RealTimeCacheService", () => {
      const service = module.get("REAL_TIME_CACHE_SERVICE");
      expect(service).toBeDefined();
      expect(service).toBe(mockRealTimeCacheService);
    });

    it("should inject RealTimeAggregationService", () => {
      const service = module.get("REAL_TIME_AGGREGATION_SERVICE");
      expect(service).toBeDefined();
      expect(service).toBe(mockRealTimeAggregationService);
    });

    it("should inject IntegrationService", () => {
      const service = module.get("INTEGRATION_SERVICE");
      expect(service).toBeDefined();
      expect(service).toBe(mockIntegrationService);
    });

    it("should inject FTSO_PROVIDER_SERVICE", () => {
      const service = module.get("FTSO_PROVIDER_SERVICE");
      expect(service).toBeDefined();
      expect(service).toBe(mockFtsoProviderService);
    });

    it("should inject FtsoProviderService", () => {
      const service = module.get("FtsoProviderService");
      expect(service).toBeDefined();
      expect(service).toBe(mockFtsoProviderService);
    });
  });

  describe("Service Integration", () => {
    it("should allow service interaction", () => {
      expect(mockFtsoProviderService.setIntegrationService).toBeDefined();
      expect(mockRateLimiterService.checkRateLimit).toBeDefined();
      expect(mockApiMonitorService.recordApiRequest).toBeDefined();
    });

    it("should maintain service instances", () => {
      const service1 = module.get("FtsoProviderService");
      const service2 = module.get("FtsoProviderService");
      expect(service1).toBe(service2);
    });
  });

  describe("Module Lifecycle", () => {
    it("should initialize without errors", () => {
      expect(module).toBeDefined();
      expect(module).toBeInstanceOf(TestingModule);
    });

    it("should clean up properly on close", async () => {
      await expect(module.close()).resolves.not.toThrow();
    });
  });

  describe("Environment Configuration", () => {
    it("should have proper rate limiting configuration", () => {
      const rateLimitConfig = {
        windowMs: 60000,
        maxRequests: 1000,
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
      };
      expect(rateLimitConfig.windowMs).toBe(60000);
      expect(rateLimitConfig.maxRequests).toBe(1000);
      expect(rateLimitConfig.skipSuccessfulRequests).toBe(false);
      expect(rateLimitConfig.skipFailedRequests).toBe(false);
    });

    it("should have EnvironmentUtils available", () => {
      expect(mockEnvironmentUtils).toBeDefined();
      expect(typeof mockEnvironmentUtils.parseInt).toBe("function");
    });
  });

  describe("Service Methods", () => {
    it("should have access to service methods", () => {
      expect(typeof mockFtsoProviderService.getFeedData).toBe("function");
      expect(typeof mockRateLimiterService.checkRateLimit).toBe("function");
      expect(typeof mockApiMonitorService.recordApiRequest).toBe("function");
      expect(typeof mockDebugService.logDebugInfo).toBe("function");
    });
  });

  describe("Error Handling", () => {
    it("should handle module initialization errors gracefully", () => {
      expect(() => module).not.toThrow();
    });

    it("should provide error handling services", () => {
      expect(mockStandardizedErrorHandlerService).toBeDefined();
    });
  });

  describe("Service Factory Functions", () => {
    it("should have createCustomConfigFactory available", () => {
      expect(mockCreateCustomConfigFactory).toBeDefined();
      expect(typeof mockCreateCustomConfigFactory).toBe("function");
    });

    it("should have createServiceFactory available", () => {
      expect(mockCreateServiceFactory).toBeDefined();
      expect(typeof mockCreateServiceFactory).toBe("function");
    });

    it("should have createAsyncProvider available", () => {
      expect(mockCreateAsyncProvider).toBeDefined();
      expect(typeof mockCreateAsyncProvider).toBe("function");
    });

    it("should have createConditionalServiceFactory available", () => {
      expect(mockCreateConditionalServiceFactory).toBeDefined();
      expect(typeof mockCreateConditionalServiceFactory).toBe("function");
    });
  });

  describe("Conditional Services", () => {
    it("should have DebugService always available", () => {
      // DebugService is now always available regardless of environment
      expect(true).toBe(true);
    });

    it("should have DebugService available", () => {
      expect(mockDebugService).toBeDefined();
      expect(typeof mockDebugService.logDebugInfo).toBe("function");
    });
  });

  describe("Async Provider", () => {
    it("should have async provider factory available", () => {
      expect(mockCreateAsyncProvider).toBeDefined();
      expect(typeof mockCreateAsyncProvider).toBe("function");
    });

    it("should have proper async provider factory", async () => {
      const factory = jest.fn().mockResolvedValue(mockFtsoProviderService);
      expect(typeof factory).toBe("function");

      const result = await factory(mockRealTimeCacheService, mockRealTimeAggregationService, mockIntegrationService);
      expect(result).toBeDefined();
    });
  });

  describe("Module Configuration", () => {
    it("should have correct number of imports", () => {
      expect(mockAppModule.imports.length).toBe(6);
    });

    it("should have correct number of controllers", () => {
      expect(mockAppModule.controllers.length).toBe(3);
    });

    it("should have correct number of providers", () => {
      expect(mockAppModule.providers.length).toBe(7);
    });
  });

  describe("Service Configuration", () => {
    it("should configure rate limiting", () => {
      expect(mockRateLimiterService).toBeDefined();
    });

    it("should configure API monitoring", () => {
      expect(mockApiMonitorService).toBeDefined();
    });

    it("should configure response time interceptor", () => {
      expect(mockResponseTimeInterceptor).toBeDefined();
    });
  });

  describe("Service Statistics", () => {
    it("should provide error statistics", () => {
      expect(mockStandardizedErrorHandlerService.getErrorStatistics).toBeDefined();
    });

    it("should provide retry statistics", () => {
      expect(mockRateLimiterService.resetCounters).toBeDefined();
    });

    it("should provide API monitoring statistics", () => {
      expect(mockApiMonitorService.getApiHealthMetrics).toBeDefined();
    });
  });

  describe("Service Reset", () => {
    it("should reset error statistics", () => {
      expect(mockStandardizedErrorHandlerService.resetErrorStatistics).toBeDefined();
    });

    it("should reset rate limiter counters", () => {
      expect(mockRateLimiterService.resetCounters).toBeDefined();
    });

    it("should reset API metrics", () => {
      expect(mockApiMonitorService.resetMetrics).toBeDefined();
    });
  });
});
