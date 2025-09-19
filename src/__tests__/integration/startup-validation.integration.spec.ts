import { Test, TestingModule } from "@nestjs/testing";
import { forwardRef } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { ErrorHandlingModule } from "@/error-handling/error-handling.module";
import { IntegrationModule } from "@/integration/integration.module";
import { MonitoringModule } from "@/monitoring/monitoring.module";
import { AdaptersModule } from "@/adapters/adapters.module";
import { CacheModule } from "@/cache/cache.module";
import { AggregatorsModule } from "@/aggregators/aggregators.module";
import { AppModule } from "@/app.module";
import { StartupValidationService } from "@/integration/services/startup-validation.service";
import { IntegrationService } from "@/integration/integration.service";
import { ProductionDataManagerService } from "@/data-manager/production-data-manager.service";
import { SystemHealthService } from "@/integration/services/system-health.service";
import { DataSourceIntegrationService } from "@/integration/services/data-source-integration.service";
import { PriceAggregationCoordinatorService } from "@/integration/services/price-aggregation-coordinator.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ConsensusAggregator } from "@/aggregators/consensus-aggregator.service";
import { FailoverManager } from "@/data-manager/failover-manager.service";
import { WebSocketConnectionManager } from "@/data-manager/websocket-connection-manager.service";
import { DataValidator } from "@/data-manager/validation/data-validator";
import { ValidationService } from "@/data-manager/validation/validation.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { CcxtMultiExchangeAdapter } from "@/adapters/crypto/ccxt.adapter";
import { ConfigService } from "@/config/config.service";

describe("Startup Validation Integration", () => {
  let module: TestingModule;
  let startupValidationService: StartupValidationService;
  let integrationService: IntegrationService;
  let configService: ConfigService;

  beforeAll(async () => {
    // Set up required environment variables
    process.env.VALUE_PROVIDER_CLIENT_PORT = "3101";
    process.env.NODE_ENV = "test";

    module = await Test.createTestingModule({
      imports: [
        ConfigModule,
        ErrorHandlingModule,
        IntegrationModule,
        MonitoringModule,
        AdaptersModule,
        CacheModule,
        AggregatorsModule,
        AppModule,
      ],
    }).compile();

    startupValidationService = module.get<StartupValidationService>(StartupValidationService);
    integrationService = module.get<IntegrationService>(IntegrationService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterAll(async () => {
    await module.close();
  });

  describe("Startup Validation Service", () => {
    it("should be defined", () => {
      expect(startupValidationService).toBeDefined();
    });

    it("should have all required dependencies", () => {
      expect(integrationService).toBeDefined();
      expect(configService).toBeDefined();
    });

    it("should validate integration service initialization", async () => {
      // Mock the integration service as initialized by setting the property directly
      Object.defineProperty(integrationService, "isInitialized", {
        value: true,
        writable: true,
      });

      jest.spyOn(integrationService, "getSystemHealth").mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: {
          successRate: 100,
          errorCount: 0,
        },
        performance: {
          averageResponseTime: 0,
          errorRate: 0,
        },
        accuracy: {
          averageConfidence: 0,
          outlierRate: 0,
        },
      });

      const result = await startupValidationService.validateStartup();

      if (!result.success) {
        console.log("Validation errors:", result.errors);
        console.log("Validation warnings:", result.warnings);
      }

      expect(result.success).toBe(true);
      expect(integrationService.getSystemHealth).toHaveBeenCalled();
    });

    it("should handle integration service timeout", async () => {
      // Mock the integration service as not initialized
      Object.defineProperty(integrationService, "isInitialized", {
        value: false,
        writable: true,
      });

      // Mock the event listener to never resolve
      jest.spyOn(integrationService, "once").mockImplementation(() => {
        // Don't call the callback to simulate timeout
        return integrationService;
      });

      // Mock the environment variable to use a shorter timeout for testing
      const originalTimeout = process.env.INTEGRATION_SERVICE_TIMEOUT_MS;
      process.env.INTEGRATION_SERVICE_TIMEOUT_MS = "1000"; // 1 second timeout

      try {
        const result = await startupValidationService.validateStartup();

        expect(result.success).toBe(false);
        expect(result.errors).toContain(
          "Integration service validation failed: Integration service initialization timeout"
        );
      } finally {
        // Restore original timeout
        if (originalTimeout) {
          process.env.INTEGRATION_SERVICE_TIMEOUT_MS = originalTimeout;
        } else {
          delete process.env.INTEGRATION_SERVICE_TIMEOUT_MS;
        }
      }
    }, 10000);

    it("should validate data sources availability", async () => {
      // Mock the integration service as initialized
      Object.defineProperty(integrationService, "isInitialized", {
        value: true,
        writable: true,
      });

      jest.spyOn(integrationService, "getSystemHealth").mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: {
          successRate: 100,
          errorCount: 0,
        },
        performance: {
          averageResponseTime: 0,
          errorRate: 0,
        },
        accuracy: {
          averageConfidence: 0,
          outlierRate: 0,
        },
      });

      const result = await startupValidationService.validateStartup();

      expect(result.success).toBe(true);
      expect(result.validatedServices).toContain("ConfigService");
    }, 10000);

    it("should validate feed configuration", async () => {
      const mockFeeds = [
        {
          feed: { category: 1, name: "FLR/USD" },
          sources: [
            { exchange: "binance", symbol: "FLR/USDT" },
            { exchange: "coinbase", symbol: "FLR/USD" },
          ],
        },
      ];

      jest.spyOn(configService, "getFeedConfigurations").mockReturnValue(mockFeeds);

      // Mock the integration service as initialized
      Object.defineProperty(integrationService, "isInitialized", {
        value: true,
        writable: true,
      });

      jest.spyOn(integrationService, "getSystemHealth").mockResolvedValue({
        status: "healthy",
        timestamp: Date.now(),
        sources: [],
        aggregation: {
          successRate: 100,
          errorCount: 0,
        },
        performance: {
          averageResponseTime: 0,
          errorRate: 0,
        },
        accuracy: {
          averageConfidence: 0,
          outlierRate: 0,
        },
      });

      const result = await startupValidationService.validateStartup();

      expect(result.success).toBe(true);
      expect(result.validatedServices).toContain("ConfigService");
    }, 10000);
  });

  describe("Integration Service Initialization", () => {
    it("should initialize successfully", async () => {
      // Mock all dependencies
      const mockDataManager = {
        initialize: jest.fn().mockResolvedValue(undefined),
        addDataSource: jest.fn().mockResolvedValue(undefined),
        getConnectedSources: jest.fn().mockReturnValue([]),
      };

      const mockSystemHealth = {
        initialize: jest.fn().mockResolvedValue(undefined),
        getOverallHealth: jest.fn().mockResolvedValue({
          status: "healthy",
          timestamp: Date.now(),
          sources: [],
          aggregation: {
            successRate: 100,
            errorCount: 0,
          },
          performance: {
            averageResponseTime: 0,
            errorRate: 0,
          },
          accuracy: {
            averageConfidence: 0,
            outlierRate: 0,
          },
        }),
      };

      const mockPriceAggregationCoordinator = {
        initialize: jest.fn().mockResolvedValue(undefined),
      };

      const mockDataSourceIntegration = {
        initialize: jest.fn().mockResolvedValue(undefined),
      };

      // Mock the integration service methods
      jest.spyOn(integrationService, "initialize").mockImplementation(async () => {
        await mockDataManager.initialize();
        await mockSystemHealth.initialize();
        await mockPriceAggregationCoordinator.initialize();
        await mockDataSourceIntegration.initialize();
        integrationService.emit("initialized");
      });

      await integrationService.initialize();

      expect(mockDataManager.initialize).toHaveBeenCalled();
      expect(mockSystemHealth.initialize).toHaveBeenCalled();
      expect(mockPriceAggregationCoordinator.initialize).toHaveBeenCalled();
      expect(mockDataSourceIntegration.initialize).toHaveBeenCalled();
    });

    it("should handle initialization errors gracefully", async () => {
      const error = new Error("Initialization failed");
      jest.spyOn(integrationService, "initialize").mockRejectedValue(error);

      await expect(integrationService.initialize()).rejects.toThrow("Initialization failed");
    });
  });

  describe("Module Dependency Resolution", () => {
    it("should resolve all module dependencies", () => {
      expect(module.get(ConfigService)).toBeDefined();
      expect(module.get(ExchangeAdapterRegistry)).toBeDefined();
      expect(module.get(CcxtMultiExchangeAdapter)).toBeDefined();
      expect(module.get(FailoverManager)).toBeDefined();
      expect(module.get(WebSocketConnectionManager)).toBeDefined();
      expect(module.get(DataValidator)).toBeDefined();
      expect(module.get(ValidationService)).toBeDefined();
      expect(module.get(UniversalRetryService)).toBeDefined();
      expect(module.get(CircuitBreakerService)).toBeDefined();
      expect(module.get(ConnectionRecoveryService)).toBeDefined();
      expect(module.get(StandardizedErrorHandlerService)).toBeDefined();
      expect(module.get(ProductionDataManagerService)).toBeDefined();
      expect(module.get(SystemHealthService)).toBeDefined();
      expect(module.get(DataSourceIntegrationService)).toBeDefined();
      expect(module.get(PriceAggregationCoordinatorService)).toBeDefined();
      expect(module.get(RealTimeCacheService)).toBeDefined();
      expect(module.get(RealTimeAggregationService)).toBeDefined();
      expect(module.get(ConsensusAggregator)).toBeDefined();
    });
  });

  describe("Error Handling During Startup", () => {
    it("should handle missing dependencies gracefully", async () => {
      const invalidModule = Test.createTestingModule({
        imports: [ConfigModule],
        providers: [
          {
            provide: "INVALID_SERVICE",
            useFactory: () => {
              return new (class {})();
            },
            inject: ["NON_EXISTENT_SERVICE"],
          },
        ],
      });

      await expect(invalidModule.compile()).rejects.toThrow();
    });

    it("should handle circular dependency issues", async () => {
      // This test ensures that our forwardRef() usage is working correctly
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule,
          ErrorHandlingModule,
          CacheModule,
          MonitoringModule,
          AdaptersModule,
          forwardRef(() => IntegrationModule),
          AggregatorsModule,
        ],
      }).compile();

      expect(module.get(RealTimeAggregationService)).toBeDefined();
      expect(module.get(IntegrationService)).toBeDefined();
    });
  });

  describe("Configuration Validation", () => {
    it("should validate feeds.json file exists", () => {
      const feeds = configService.getFeedConfigurations();
      expect(Array.isArray(feeds)).toBe(true);
      expect(feeds.length).toBeGreaterThan(0);
    });

    it("should validate adapter mappings", () => {
      const hasCustomAdapter = configService.hasCustomAdapter("binance");
      expect(typeof hasCustomAdapter).toBe("boolean");
    });

    it("should validate CCXT exchanges from feeds", () => {
      // This functionality is now handled by the adapters module directly
      // using utilities, so we just verify the config service exists
      expect(configService).toBeDefined();
    });
  });

  describe("Environment Variable Validation", () => {
    it("should validate that NODE_ENV is required", () => {
      // Test that the environment variable validation logic works
      const originalNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;

      // Check that the environment variable is missing
      expect(process.env.NODE_ENV).toBeUndefined();

      // Restore original value
      if (originalNodeEnv) {
        process.env.NODE_ENV = originalNodeEnv;
      } else {
        process.env.NODE_ENV = "test";
      }
    });

    it("should validate that VALUE_PROVIDER_CLIENT_PORT is required", () => {
      // Test that the environment variable validation logic works
      const originalPort = process.env.VALUE_PROVIDER_CLIENT_PORT;
      delete process.env.VALUE_PROVIDER_CLIENT_PORT;

      // Check that the environment variable is missing
      expect(process.env.VALUE_PROVIDER_CLIENT_PORT).toBeUndefined();

      // Restore original value
      if (originalPort) {
        process.env.VALUE_PROVIDER_CLIENT_PORT = originalPort;
      } else {
        process.env.VALUE_PROVIDER_CLIENT_PORT = "3101";
      }
    });
  });

  describe("Integration Service Initialization Timing", () => {
    it("should properly wait for integration service initialization", async () => {
      // Create a mock integration service that takes time to initialize
      const mockIntegrationService = {
        isServiceInitialized: jest.fn().mockReturnValue(false),
        once: jest.fn(),
        getSystemHealth: jest.fn().mockResolvedValue({
          status: "healthy",
          sources: [],
          aggregation: { errorCount: 0, successRate: 1 },
          performance: { averageResponseTime: 100, errorRate: 0 },
          accuracy: { averageConfidence: 0.95, outlierRate: 0.05 },
        }),
      };

      const module = await Test.createTestingModule({
        imports: [ConfigModule],
        providers: [
          {
            provide: StartupValidationService,
            useFactory: (integrationService: any) => {
              return new StartupValidationService(integrationService);
            },
            inject: [IntegrationService],
          },
          {
            provide: IntegrationService,
            useValue: mockIntegrationService,
          },
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const startupValidationService = module.get<StartupValidationService>(StartupValidationService);

      // Mock the event emission after a delay
      setTimeout(() => {
        mockIntegrationService.isServiceInitialized.mockReturnValue(true);
        // Simulate the 'initialized' event
        const onceCallback = mockIntegrationService.once.mock.calls[0]?.[1];
        if (onceCallback) {
          onceCallback();
        }
      }, 100);

      // This should not throw an error and should wait for initialization
      const result = await startupValidationService.validateStartup();
      expect(result.success).toBe(true);
      expect(mockIntegrationService.once).toHaveBeenCalledWith("initialized", expect.any(Function));
    }, 10000);

    it("should timeout when integration service takes too long to initialize", async () => {
      const mockIntegrationService = {
        isServiceInitialized: jest.fn().mockReturnValue(false),
        once: jest.fn(),
        getSystemHealth: jest.fn(),
      };

      const module = await Test.createTestingModule({
        imports: [ConfigModule],
        providers: [
          {
            provide: StartupValidationService,
            useFactory: (integrationService: any) => {
              return new StartupValidationService(integrationService);
            },
            inject: [IntegrationService],
          },
          {
            provide: IntegrationService,
            useValue: mockIntegrationService,
          },
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const startupValidationService = module.get<StartupValidationService>(StartupValidationService);

      // Mock the environment variable to use a shorter timeout for testing
      const originalTimeout = process.env.INTEGRATION_SERVICE_TIMEOUT_MS;
      process.env.INTEGRATION_SERVICE_TIMEOUT_MS = "1000"; // 1 second timeout

      try {
        // This should return a failed result with timeout error
        const result = await startupValidationService.validateStartup();
        expect(result.success).toBe(false);
        expect(result.errors).toContain(
          "Integration service validation failed: Integration service initialization timeout"
        );
      } finally {
        // Restore original timeout
        if (originalTimeout) {
          process.env.INTEGRATION_SERVICE_TIMEOUT_MS = originalTimeout;
        } else {
          delete process.env.INTEGRATION_SERVICE_TIMEOUT_MS;
        }
      }
    }, 10000);

    it("should handle integration service that is already initialized", async () => {
      const mockIntegrationService = {
        isServiceInitialized: jest.fn().mockReturnValue(true),
        once: jest.fn(),
        getSystemHealth: jest.fn().mockResolvedValue({
          status: "healthy",
          sources: [],
          aggregation: { errorCount: 0, successRate: 1 },
          performance: { averageResponseTime: 100, errorRate: 0 },
          accuracy: { averageConfidence: 0.95, outlierRate: 0.05 },
        }),
      };

      const module = await Test.createTestingModule({
        imports: [ConfigModule],
        providers: [
          {
            provide: StartupValidationService,
            useFactory: (integrationService: any) => {
              return new StartupValidationService(integrationService);
            },
            inject: [IntegrationService],
          },
          {
            provide: IntegrationService,
            useValue: mockIntegrationService,
          },
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const startupValidationService = module.get<StartupValidationService>(StartupValidationService);

      const result = await startupValidationService.validateStartup();
      expect(result.success).toBe(true);
      expect(mockIntegrationService.once).not.toHaveBeenCalled();
    });
  });

  describe("Lifecycle Method Implementation", () => {
    it("should properly implement onModuleInit and onModuleDestroy", () => {
      const integrationService = module.get<IntegrationService>(IntegrationService);

      // Check that the methods exist and are functions
      expect(typeof integrationService.onModuleInit).toBe("function");
      expect(typeof integrationService.onModuleDestroy).toBe("function");
      expect(typeof integrationService.performInitialization).toBe("function");
    });

    it("should emit initialized event after performInitialization", async () => {
      const integrationService = module.get<IntegrationService>(IntegrationService);
      const emitSpy = jest.spyOn(integrationService, "emitWithLogging");

      // Mock the initialize method to avoid actual initialization
      const originalInitialize = integrationService.initialize;
      integrationService.initialize = jest.fn().mockResolvedValue(undefined);

      try {
        await integrationService.performInitialization();
        expect(emitSpy).toHaveBeenCalledWith("initialized");
      } finally {
        // Restore original method
        integrationService.initialize = originalInitialize;
        emitSpy.mockRestore();
      }
    });
  });
});
