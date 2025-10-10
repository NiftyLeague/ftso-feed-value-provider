import { Test, TestingModule } from "@nestjs/testing";
import { forwardRef } from "@nestjs/common";
import { ConfigModule } from "@/config/config.module";
import { ErrorHandlingModule } from "@/error-handling/error-handling.module";
import { IntegrationModule } from "@/integration/integration.module";
import { AdaptersModule } from "@/adapters/adapters.module";
import { AggregatorsModule } from "@/aggregators/aggregators.module";
import { AppModule } from "@/app.module";
import { ConfigService } from "@/config/config.service";

import { FailoverManager } from "@/data-manager/failover-manager.service";
import { DataValidator } from "@/data-manager/validation/data-validator";
import { ValidationService } from "@/data-manager/validation/validation.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { CcxtMultiExchangeAdapter } from "@/adapters/crypto/ccxt.adapter";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ConsensusAggregator } from "@/aggregators/consensus-aggregator.service";
import { ProductionDataManagerService } from "@/data-manager/production-data-manager.service";
import { SystemHealthService } from "@/integration/services/system-health.service";
import { DataSourceIntegrationService } from "@/integration/services/data-source-integration.service";
import { PriceAggregationCoordinatorService } from "@/integration/services/price-aggregation-coordinator.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheModule } from "@/cache/cache.module";
import { MonitoringModule } from "@/monitoring/monitoring.module";

describe("Module Dependency Injection Integration", () => {
  describe("ConfigModule Dependencies", () => {
    let module: TestingModule;

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [ConfigModule],
      }).compile();
    });

    afterAll(async () => {
      await module.close();
    });

    it("should resolve ConfigService with all dependencies", () => {
      const configService = module.get<ConfigService>(ConfigService);
      expect(configService).toBeDefined();
    });

    // ConfigValidationService and FileWatcherService were removed during simplification

    it("should handle missing dependencies gracefully", async () => {
      const invalidModule = Test.createTestingModule({
        providers: [
          {
            provide: ConfigService,
            useFactory: () => {
              return new ConfigService();
            },
            inject: ["MISSING_SERVICE"],
          },
        ],
      });

      await expect(invalidModule.compile()).rejects.toThrow();
    });
  });

  describe("ErrorHandlingModule Dependencies", () => {
    let module: TestingModule;

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [ErrorHandlingModule],
      }).compile();
    });

    afterAll(async () => {
      await module.close();
    });

    it("should resolve all error handling services", () => {
      expect(module.get<UniversalRetryService>(UniversalRetryService)).toBeDefined();
      expect(module.get<CircuitBreakerService>(CircuitBreakerService)).toBeDefined();
      expect(module.get<ConnectionRecoveryService>(ConnectionRecoveryService)).toBeDefined();
      expect(module.get<StandardizedErrorHandlerService>(StandardizedErrorHandlerService)).toBeDefined();
    });

    it("should resolve FailoverManager from ErrorHandlingModule", () => {
      const failoverManager = module.get<FailoverManager>(FailoverManager);
      expect(failoverManager).toBeDefined();
    });

    it("should handle circular dependency resolution", () => {
      // This test ensures that FailoverManager can be resolved from ErrorHandlingModule
      // without causing circular dependency issues
      const failoverManager = module.get<FailoverManager>(FailoverManager);
      expect(failoverManager).toBeInstanceOf(FailoverManager);
    });
  });

  describe("AdaptersModule Dependencies", () => {
    let module: TestingModule;

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [ConfigModule, AdaptersModule],
      }).compile();
    });

    afterAll(async () => {
      await module.close();
    });

    it("should resolve ExchangeAdapterRegistry", () => {
      const registry = module.get<ExchangeAdapterRegistry>(ExchangeAdapterRegistry);
      expect(registry).toBeDefined();
    });

    it("should resolve CcxtMultiExchangeAdapter with ConfigService", async () => {
      const ccxtAdapter = await module.resolve<CcxtMultiExchangeAdapter>(CcxtMultiExchangeAdapter);
      expect(ccxtAdapter).toBeDefined();
    });

    it("should handle ConfigService dependency injection", async () => {
      const configService = module.get<ConfigService>(ConfigService);
      const ccxtAdapter = await module.resolve<CcxtMultiExchangeAdapter>(CcxtMultiExchangeAdapter);

      expect(configService).toBeDefined();
      expect(ccxtAdapter).toBeDefined();
    });
  });

  describe("IntegrationModule Dependencies", () => {
    let module: TestingModule;

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [ConfigModule, ErrorHandlingModule, CacheModule, MonitoringModule, AdaptersModule, IntegrationModule],
      }).compile();
    });

    afterAll(async () => {
      await module.close();
    });

    it("should resolve all integration services", async () => {
      expect(module.get<ProductionDataManagerService>(ProductionDataManagerService)).toBeDefined();
      expect(await module.resolve<SystemHealthService>(SystemHealthService)).toBeDefined();
      expect(await module.resolve<DataSourceIntegrationService>(DataSourceIntegrationService)).toBeDefined();
      expect(
        await module.resolve<PriceAggregationCoordinatorService>(PriceAggregationCoordinatorService)
      ).toBeDefined();
    });

    it("should resolve DataValidator and ValidationService with proper dependencies", () => {
      const dataValidator = module.get<DataValidator>(DataValidator);
      const validationService = module.get<ValidationService>(ValidationService);

      expect(dataValidator).toBeDefined();
      expect(validationService).toBeDefined();
    });
  });

  describe("AggregatorsModule Dependencies", () => {
    let module: TestingModule;

    beforeAll(async () => {
      module = await Test.createTestingModule({
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
    });

    afterAll(async () => {
      await module.close();
    });

    it("should resolve aggregation services", () => {
      expect(module.get<RealTimeAggregationService>(RealTimeAggregationService)).toBeDefined();
      expect(module.get<ConsensusAggregator>(ConsensusAggregator)).toBeDefined();
    });

    it("should handle circular dependency with IntegrationModule", () => {
      // This test ensures that the forwardRef() usage works correctly
      const aggregationService = module.get<RealTimeAggregationService>(RealTimeAggregationService);
      expect(aggregationService).toBeDefined();
    });
  });

  describe("AppModule Dependencies", () => {
    let module: TestingModule;

    beforeAll(async () => {
      module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
    });

    afterAll(async () => {
      await module.close();
    });

    it("should resolve all app-level services", () => {
      expect(module.get<ConfigService>(ConfigService)).toBeDefined();
      expect(module.get<RealTimeCacheService>(RealTimeCacheService)).toBeDefined();
      expect(module.get<RealTimeAggregationService>(RealTimeAggregationService)).toBeDefined();
    });

    it("should resolve FTSO_PROVIDER_SERVICE", () => {
      const ftsoProvider = module.get("FTSO_PROVIDER_SERVICE");
      expect(ftsoProvider).toBeDefined();
    });

    it("should handle service factory dependencies", () => {
      // Test that service factories can resolve their dependencies
      const configService = module.get<ConfigService>(ConfigService);
      expect(configService).toBeDefined();
    });
  });

  describe("Circular Dependency Resolution", () => {
    it("should handle AggregatorsModule -> IntegrationModule circular dependency", async () => {
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

      expect(module.get<RealTimeAggregationService>(RealTimeAggregationService)).toBeDefined();
      expect(module.get<ProductionDataManagerService>(ProductionDataManagerService)).toBeDefined();

      await module.close();
    });

    it("should handle IntegrationModule -> AggregatorsModule circular dependency", async () => {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule,
          ErrorHandlingModule,
          CacheModule,
          MonitoringModule,
          AdaptersModule,
          AggregatorsModule,
          forwardRef(() => IntegrationModule),
        ],
      }).compile();

      expect(module.get<ProductionDataManagerService>(ProductionDataManagerService)).toBeDefined();
      expect(module.get<RealTimeAggregationService>(RealTimeAggregationService)).toBeDefined();

      await module.close();
    });
  });

  describe("Service Factory Dependencies", () => {
    it("should handle useFactory with class references", async () => {
      const module = await Test.createTestingModule({
        providers: [
          {
            provide: "TEST_SERVICE",
            useFactory: (configService: ConfigService) => {
              return { configService };
            },
            inject: [ConfigService],
          },
        ],
        imports: [ConfigModule],
      }).compile();

      const testService = module.get("TEST_SERVICE");
      expect(testService).toBeDefined();
      expect(testService.configService).toBeDefined();

      await module.close();
    });

    it("should handle useFactory with multiple dependencies", async () => {
      const module = await Test.createTestingModule({
        providers: [
          {
            provide: "MULTI_DEPENDENCY_SERVICE",
            useFactory: (configService: ConfigService, universalRetryService: UniversalRetryService) => {
              return { configService, universalRetryService };
            },
            inject: [ConfigService, UniversalRetryService],
          },
        ],
        imports: [ConfigModule, ErrorHandlingModule],
      }).compile();

      const multiService = module.get("MULTI_DEPENDENCY_SERVICE");
      expect(multiService).toBeDefined();
      expect(multiService.configService).toBeDefined();
      expect(multiService.universalRetryService).toBeDefined();

      await module.close();
    });

    it("should handle useFactory with no dependencies", async () => {
      const module = await Test.createTestingModule({
        providers: [
          {
            provide: "NO_DEPENDENCY_SERVICE",
            useFactory: () => {
              return { initialized: true };
            },
            inject: [],
          },
        ],
      }).compile();

      const noDepService = module.get("NO_DEPENDENCY_SERVICE");
      expect(noDepService).toBeDefined();
      expect(noDepService.initialized).toBe(true);

      await module.close();
    });
  });

  describe("Error Scenarios", () => {
    it("should handle missing provider errors", async () => {
      const module = Test.createTestingModule({
        providers: [
          {
            provide: "MISSING_DEPENDENCY_SERVICE",
            useFactory: (missingService: any) => {
              return { missingService };
            },
            inject: ["MISSING_SERVICE"],
          },
        ],
      });

      await expect(module.compile()).rejects.toThrow();
    });

    it("should handle invalid dependency injection", async () => {
      const module = Test.createTestingModule({
        providers: [
          {
            provide: "INVALID_INJECTION_SERVICE",
            useFactory: (configService: ConfigService) => {
              return { configService };
            },
            inject: ["INVALID_STRING_REFERENCE"], // Should be ConfigService class
          },
        ],
      });

      await expect(module.compile()).rejects.toThrow();
    });

    it("should handle circular dependency without forwardRef", async () => {
      // This test ensures that circular dependencies fail without forwardRef
      const module = Test.createTestingModule({
        providers: [
          {
            provide: "SERVICE_A",
            useFactory: (serviceB: any) => ({ serviceB }),
            inject: ["SERVICE_B"],
          },
          {
            provide: "SERVICE_B",
            useFactory: (serviceA: any) => ({ serviceA }),
            inject: ["SERVICE_A"],
          },
        ],
      });

      await expect(module.compile()).rejects.toThrow();
    });
  });
});
