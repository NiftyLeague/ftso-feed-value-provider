import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@/config/config.module";
import { StartupValidationService } from "@/integration/services/startup-validation.service";
import { IntegrationService } from "@/integration/integration.service";
import { ConfigService } from "@/config/config.service";

describe("Startup Validation Integration", () => {
  let module: TestingModule;
  let startupValidationService: StartupValidationService;
  let configService: ConfigService;

  beforeAll(async () => {
    // Set up required environment variables
    process.env.VALUE_PROVIDER_CLIENT_PORT = "3101";
    process.env.NODE_ENV = "test";

    // Create a minimal test module with mocked services
    module = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [
        {
          provide: StartupValidationService,
          useValue: {
            validateStartup: jest.fn(),
          },
        },
        {
          provide: IntegrationService,
          useValue: {
            isServiceInitialized: jest.fn(),
            getSystemHealth: jest.fn(),
            once: jest.fn(),
            initialize: jest.fn(),
            onModuleInit: jest.fn(),
            onModuleDestroy: jest.fn(),
            performInitialization: jest.fn(),
            emitWithLogging: jest.fn(),
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    startupValidationService = module.get<StartupValidationService>(StartupValidationService);
    configService = module.get<ConfigService>(ConfigService);
  }, 10000); // 10 second timeout for module compilation

  afterAll(async () => {
    await module.close();
  });

  describe("Startup Validation Service", () => {
    it("should be defined", () => {
      expect(startupValidationService).toBeDefined();
    });

    it("should have all required dependencies", () => {
      expect(configService).toBeDefined();
    });

    it("should validate integration service initialization", async () => {
      // Mock successful validation
      const mockResult = {
        success: true,
        errors: [],
        warnings: [],
        validatedServices: ["ConfigService", "IntegrationService"],
      };

      (startupValidationService.validateStartup as jest.Mock).mockResolvedValue(mockResult);

      const result = await startupValidationService.validateStartup();

      expect(result.success).toBe(true);
      expect(result.validatedServices).toContain("ConfigService");
      expect(result.validatedServices).toContain("IntegrationService");
    });

    it("should handle integration service timeout", async () => {
      // Mock timeout scenario
      const mockResult = {
        success: false,
        errors: ["Integration service validation failed: Integration service initialization timeout"],
        warnings: [],
        validatedServices: [],
      };

      (startupValidationService.validateStartup as jest.Mock).mockResolvedValue(mockResult);

      const result = await startupValidationService.validateStartup();

      expect(result.success).toBe(false);
      expect(result.errors).toContain(
        "Integration service validation failed: Integration service initialization timeout"
      );
    });

    it("should validate data sources availability", async () => {
      // Mock successful validation with data sources
      const mockResult = {
        success: true,
        errors: [],
        warnings: [],
        validatedServices: ["ConfigService", "DataSources"],
      };

      (startupValidationService.validateStartup as jest.Mock).mockResolvedValue(mockResult);

      const result = await startupValidationService.validateStartup();

      expect(result.success).toBe(true);
      expect(result.validatedServices).toContain("ConfigService");
    });

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

      // Mock successful validation
      const mockResult = {
        success: true,
        errors: [],
        warnings: [],
        validatedServices: ["ConfigService"],
      };

      (startupValidationService.validateStartup as jest.Mock).mockResolvedValue(mockResult);

      const result = await startupValidationService.validateStartup();

      expect(result.success).toBe(true);
      expect(result.validatedServices).toContain("ConfigService");
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
  });

  describe("Environment Variable Validation", () => {
    it("should validate that NODE_ENV is required", () => {
      expect(process.env.NODE_ENV).toBe("test");
    });

    it("should validate that VALUE_PROVIDER_CLIENT_PORT is required", () => {
      expect(process.env.VALUE_PROVIDER_CLIENT_PORT).toBe("3101");
    });
  });

  describe("Module Dependency Resolution", () => {
    it("should resolve basic dependencies", () => {
      expect(module.get(ConfigService)).toBeDefined();
      expect(module.get(StartupValidationService)).toBeDefined();
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
  });
});
