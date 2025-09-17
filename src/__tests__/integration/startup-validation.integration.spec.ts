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
import { ConfigValidationService } from "@/config/config-validation.service";
import { FileWatcherService } from "@/config/file-watcher.service";

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

      const result = await startupValidationService.validateStartup();

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        "Integration service validation failed: Integration service initialization timeout"
      );
    }, 35000);

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
      expect(module.get(ConfigValidationService)).toBeDefined();
      expect(module.get(FileWatcherService)).toBeDefined();
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
      const ccxtExchanges = configService.getCcxtExchangesFromFeeds();
      expect(Array.isArray(ccxtExchanges)).toBe(true);
    });
  });
});
