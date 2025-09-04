import { Test, TestingModule } from "@nestjs/testing";
import { DynamicModule, ForwardReference, Provider, Type } from "@nestjs/common";
import { ConfigService } from "@/config/config.service";
import { ConsensusAggregator } from "@/aggregators/consensus-aggregator";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";

/**
 * Test module builder utility to reduce boilerplate in test files
 */
export class TestModuleBuilder {
  private providers: Provider[] = [];
  private controllers: Type<unknown>[] = [];
  private imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>> = [];

  /**
   * Add a service provider with optional mock
   */
  addProvider<T>(
    token: string | symbol | Provider | Type<unknown>,
    mockImplementation?: Partial<T>
  ): TestModuleBuilder {
    if (mockImplementation) {
      this.providers.push({
        provide: token as string | symbol | Type<unknown>,
        useValue: mockImplementation,
      });
    } else {
      this.providers.push(token as Provider);
    }
    return this;
  }

  /**
   * Add a controller
   */
  addController(controller: Type<unknown>): TestModuleBuilder {
    this.controllers.push(controller);
    return this;
  }

  /**
   * Add a module import
   */
  addImport(
    module: Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>
  ): TestModuleBuilder {
    this.imports.push(module);
    return this;
  }

  /**
   * Add common mocked services used across many tests
   */
  addCommonMocks(): TestModuleBuilder {
    return this.addProvider(ConfigService, {
      get: jest.fn(),
      getConfig: jest.fn(),
      getFeedConfigurations: jest.fn().mockReturnValue([]),
      getEnvironmentConfig: jest.fn().mockReturnValue({}),
    })
      .addProvider(EnhancedLoggerService, {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      })
      .addProvider(ConsensusAggregator, {
        aggregate: jest.fn(),
        validateUpdate: jest.fn(),
        getQualityMetrics: jest.fn(),
      })
      .addProvider(RealTimeCacheService, {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        clear: jest.fn(),
        getStats: jest.fn(),
      });
  }

  /**
   * Build the testing module
   */
  async build(): Promise<TestingModule> {
    return Test.createTestingModule({
      controllers: this.controllers,
      providers: this.providers,
      imports: this.imports,
    }).compile();
  }
}

/**
 * Factory function for creating test modules
 */
export function createTestModule(): TestModuleBuilder {
  return new TestModuleBuilder();
}
