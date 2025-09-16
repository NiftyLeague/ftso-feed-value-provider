// Test for config-validation.service.ts
import { ConfigValidationService } from "../config-validation.service";
import { EnvironmentUtils } from "../../common/utils/environment.utils";
import { ConfigUtils } from "../../common/utils/config.utils";

// Mock EnvironmentUtils
jest.mock("../../common/utils/environment.utils", () => ({
  EnvironmentUtils: {
    parseString: jest.fn(),
    parseInt: jest.fn(),
    parseFloat: jest.fn(),
    parseBoolean: jest.fn(),
    parseList: jest.fn(),
    parseJSON: jest.fn(),
  },
}));

// Mock ConfigUtils
jest.mock("../../common/utils/config.utils", () => ({
  ConfigUtils: {
    loadExchangeApiKeys: jest.fn(),
    createValidationResult: jest.fn(),
  },
}));

describe("ConfigValidationService", () => {
  let service: ConfigValidationService;

  beforeEach(() => {
    service = new ConfigValidationService();

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    (EnvironmentUtils.parseString as jest.Mock).mockImplementation((key: string, defaultValue: string) => {
      const mockValues: Record<string, string> = {
        LOG_LEVEL: "log",
        VALUE_PROVIDER_CLIENT_BASE_PATH: "",
        NODE_ENV: "development",
        ALERT_SMTP_HOST: "localhost",
        ALERT_SMTP_USERNAME: "",
        ALERT_SMTP_PASSWORD: "",
        ALERT_EMAIL_FROM: "alerts@ftso-provider.com",
        ALERT_WEBHOOK_URL: "",
        LOG_DIRECTORY: "./logs",
        MAX_LOG_FILE_SIZE: "10MB",
        DEBUG_LOG_LEVEL: "debug",
        LOG_FORMAT: "json",
        LOG_LEVEL_PRODUCTION_INTEGRATION: "log",
        LOG_LEVEL_DATA_MANAGER: "log",
        LOG_LEVEL_AGGREGATION: "log",
        LOG_LEVEL_ERROR_HANDLER: "log",
        LOG_LEVEL_PERFORMANCE_MONITOR: "log",
        LOG_LEVEL_ALERTING: "log",
        LOG_LEVEL_BOOTSTRAP: "log",
      };
      return mockValues[key] || defaultValue;
    });

    (EnvironmentUtils.parseInt as jest.Mock).mockImplementation((key: string, defaultValue: number) => {
      const mockValues: Record<string, number> = {
        VALUE_PROVIDER_CLIENT_PORT: 3101,
        MEDIAN_DECAY: 0.00005,
        TRADES_HISTORY_SIZE: 1000,
        ALERT_SMTP_PORT: 587,
        ALERT_WEBHOOK_TIMEOUT: 5000,
        ALERT_MAX_PER_HOUR: 20,
        ALERT_RETENTION_DAYS: 30,
        CACHE_TTL_MS: 1000,
        CACHE_MAX_ENTRIES: 10000,
        CACHE_WARMUP_INTERVAL_MS: 30000,
        MONITORING_METRICS_PORT: 9090,
        MONITORING_HEALTH_CHECK_INTERVAL_MS: 5000,
        ERROR_HANDLING_MAX_RETRIES: 3,
        ERROR_HANDLING_RETRY_DELAY_MS: 1000,
        ERROR_HANDLING_CIRCUIT_BREAKER_THRESHOLD: 5,
        ERROR_HANDLING_CIRCUIT_BREAKER_TIMEOUT_MS: 60000,
        MAX_LOG_FILES: 5,
        PERFORMANCE_LOG_THRESHOLD: 100,
        ERROR_LOG_RETENTION_DAYS: 30,
        MAX_ERROR_HISTORY_SIZE: 1000,
      };
      return mockValues[key] || defaultValue;
    });

    (EnvironmentUtils.parseFloat as jest.Mock).mockImplementation((key: string, defaultValue: number) => {
      const mockValues: Record<string, number> = {
        MEDIAN_DECAY: 0.00005,
      };
      return mockValues[key] || defaultValue;
    });

    (EnvironmentUtils.parseBoolean as jest.Mock).mockImplementation((key: string, defaultValue: boolean) => {
      const mockValues: Record<string, boolean> = {
        ALERT_EMAIL_ENABLED: false,
        ALERT_WEBHOOK_ENABLED: false,
        MONITORING_ENABLED: true,
        ENABLE_FILE_LOGGING: false,
        ENABLE_PERFORMANCE_LOGGING: true,
        ENABLE_DEBUG_LOGGING: false,
        ENABLE_AUDIT_LOGGING: true,
        AUDIT_LOG_CRITICAL_OPERATIONS: true,
        INCLUDE_TIMESTAMP: true,
        INCLUDE_CONTEXT: true,
        INCLUDE_STACK_TRACE: true,
      };
      return mockValues[key] || defaultValue;
    });

    (EnvironmentUtils.parseList as jest.Mock).mockImplementation((key: string, defaultValue: string[]) => {
      const mockValues: Record<string, string[]> = {
        ALERT_EMAIL_TO: [],
      };
      return mockValues[key] || defaultValue;
    });

    (EnvironmentUtils.parseJSON as jest.Mock).mockImplementation((key: string, defaultValue: object) => {
      const mockValues: Record<string, object> = {
        ALERT_WEBHOOK_HEADERS: {},
      };
      return mockValues[key] || defaultValue;
    });

    (ConfigUtils.loadExchangeApiKeys as jest.Mock).mockReturnValue({});
    (ConfigUtils.createValidationResult as jest.Mock).mockReturnValue({
      isValid: true,
      errors: [],
      warnings: [],
      missingRequired: [],
      invalidValues: [],
    });
  });

  describe("Service Initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should be instance of ConfigValidationService", () => {
      expect(service).toBeInstanceOf(ConfigValidationService);
    });
  });

  describe("loadAndValidateEnvironmentConfig", () => {
    it("should load and validate environment configuration successfully", () => {
      const config = service.loadAndValidateEnvironmentConfig();

      expect(config).toBeDefined();
      expect(config.logLevel).toBe("log");
      expect(config.port).toBe(3101);
      expect(config.nodeEnv).toBe("development");
      expect(config.useProductionIntegration).toBe(true);
    });

    it("should call EnvironmentUtils methods for all configuration values", () => {
      service.loadAndValidateEnvironmentConfig();

      expect(EnvironmentUtils.parseString).toHaveBeenCalledWith("LOG_LEVEL", "log");
      expect(EnvironmentUtils.parseInt).toHaveBeenCalledWith("VALUE_PROVIDER_CLIENT_PORT", 3101, {
        min: 1,
        max: 65535,
        fieldName: "VALUE_PROVIDER_CLIENT_PORT",
      });
      expect(EnvironmentUtils.parseString).toHaveBeenCalledWith("NODE_ENV", "development");
    });

    it("should validate configuration and throw error on critical validation failures", () => {
      (ConfigUtils.createValidationResult as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ["Critical error"],
        warnings: [],
        missingRequired: [],
        invalidValues: [],
      });

      expect(() => service.loadAndValidateEnvironmentConfig()).toThrow(
        "Critical configuration errors detected. Please fix the configuration and restart."
      );
    });

    it("should log warnings for non-critical validation issues", () => {
      const loggerWarnSpy = jest.spyOn(service.logger, "warn").mockImplementation();

      (ConfigUtils.createValidationResult as jest.Mock).mockReturnValue({
        isValid: true,
        errors: [],
        warnings: ["Warning message"],
        missingRequired: [],
        invalidValues: [],
      });

      service.loadAndValidateEnvironmentConfig();

      expect(loggerWarnSpy).toHaveBeenCalledWith("Environment configuration warnings:");
      expect(loggerWarnSpy).toHaveBeenCalledWith("  - Warning message");

      loggerWarnSpy.mockRestore();
    });
  });

  describe("validateEnvironmentConfig", () => {
    it("should validate log level correctly", () => {
      const config = {
        logLevel: "invalid",
        nodeEnv: "development",
        port: 3101,
        alerting: { email: { enabled: false, to: [] }, webhook: { enabled: false } },
        cache: { ttlMs: 1000, maxEntries: 10000 },
        monitoring: { metricsPort: 9091 },
      } as any;

      const result = service.validateEnvironmentConfig(config);

      expect(result.invalidValues).toContain(
        'LOG_LEVEL: "invalid" is not valid. Must be one of: error, warn, log, debug, verbose'
      );
    });

    it("should validate node environment and add warning for non-standard values", () => {
      const config = {
        logLevel: "log",
        nodeEnv: "staging",
        port: 3101,
        alerting: { email: { enabled: false, to: [] }, webhook: { enabled: false } },
        cache: { ttlMs: 1000, maxEntries: 10000 },
        monitoring: { metricsPort: 9091 },
      } as any;

      const result = service.validateEnvironmentConfig(config);

      expect(result.warnings).toContain(
        'NODE_ENV: "staging" is not a standard value. Expected: development, production, test'
      );
    });

    it("should validate email alerting configuration", () => {
      const config = {
        logLevel: "log",
        nodeEnv: "development",
        port: 3101,
        alerting: {
          email: { enabled: true, smtpHost: "", to: [] },
          webhook: { enabled: false },
        },
        cache: { ttlMs: 1000, maxEntries: 10000 },
        monitoring: { metricsPort: 9091 },
      } as any;

      const result = service.validateEnvironmentConfig(config);

      expect(result.missingRequired).toContain("ALERT_SMTP_HOST is required when email alerting is enabled");
      expect(result.missingRequired).toContain("ALERT_EMAIL_TO is required when email alerting is enabled");
    });

    it("should validate webhook alerting configuration", () => {
      const config = {
        logLevel: "log",
        nodeEnv: "development",
        port: 3101,
        alerting: {
          email: { enabled: false, to: [] },
          webhook: { enabled: true, url: "" },
        },
        cache: { ttlMs: 1000, maxEntries: 10000 },
        monitoring: { metricsPort: 9091 },
      } as any;

      const result = service.validateEnvironmentConfig(config);

      expect(result.missingRequired).toContain("ALERT_WEBHOOK_URL is required when webhook alerting is enabled");
    });

    it("should validate cache configuration and add warnings", () => {
      const config = {
        logLevel: "log",
        nodeEnv: "development",
        port: 3101,
        alerting: { email: { enabled: false, to: [] }, webhook: { enabled: false } },
        cache: { ttlMs: 50, maxEntries: 50 },
        monitoring: { metricsPort: 9091 },
      } as any;

      const result = service.validateEnvironmentConfig(config);

      expect(result.warnings).toContain("CACHE_TTL_MS: 50ms may not be optimal. Recommended range: 100-10000ms");
      expect(result.warnings).toContain("CACHE_MAX_ENTRIES: 50 may be too low for production use");
    });

    it("should validate monitoring port conflict", () => {
      const config = {
        logLevel: "log",
        nodeEnv: "development",
        port: 3101,
        alerting: { email: { enabled: false, to: [] }, webhook: { enabled: false } },
        cache: { ttlMs: 1000, maxEntries: 10000 },
        monitoring: { metricsPort: 3101 },
      } as any;

      const result = service.validateEnvironmentConfig(config);

      expect(result.errors).toContain("MONITORING_METRICS_PORT cannot be the same as VALUE_PROVIDER_CLIENT_PORT");
    });

    it("should set isValid to true when no errors or missing required fields", () => {
      const config = {
        logLevel: "log",
        nodeEnv: "development",
        port: 3101,
        alerting: { email: { enabled: false, to: [] }, webhook: { enabled: false } },
        cache: { ttlMs: 1000, maxEntries: 10000 },
        monitoring: { metricsPort: 9091 },
      } as any;

      const result = service.validateEnvironmentConfig(config);

      expect(result.isValid).toBe(true);
    });
  });

  describe("validateFeedConfigurationStructure", () => {
    it("should validate valid feed configuration array", () => {
      const feedsJson = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "binance", symbol: "BTCUSDT" },
            { exchange: "coinbase", symbol: "BTC-USD" },
          ],
        },
      ];

      const result = service.validateFeedConfigurationStructure(feedsJson);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should reject non-array input", () => {
      const feedsJson = { invalid: "not an array" };

      const result = service.validateFeedConfigurationStructure(feedsJson as any);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("feeds.json must contain an array of feed configurations");
    });

    it("should validate feed object structure", () => {
      const feedsJson = [
        {
          feed: { category: "invalid", name: "" },
          sources: [],
        },
      ];

      const result = service.validateFeedConfigurationStructure(feedsJson);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Feed 1: feed.category must be a number");
      expect(result.errors).toContain("Feed 1: feed.name must be a non-empty string");
    });

    it("should validate sources array structure", () => {
      const feedsJson = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: "not an array",
        },
      ];

      const result = service.validateFeedConfigurationStructure(feedsJson);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Feed 1: 'sources' must be an array");
    });

    it("should validate individual source objects", () => {
      const feedsJson = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [
            { exchange: "", symbol: "BTCUSDT" },
            { exchange: "binance", symbol: "" },
          ],
        },
      ];

      const result = service.validateFeedConfigurationStructure(feedsJson);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Feed 1, Source 1: exchange must be a non-empty string");
      expect(result.errors).toContain("Feed 1, Source 2: symbol must be a non-empty string");
    });

    it("should add warning for feeds with no sources", () => {
      const feedsJson = [
        {
          feed: { category: 1, name: "BTC/USD" },
          sources: [],
        },
      ];

      const result = service.validateFeedConfigurationStructure(feedsJson);

      expect(result.warnings).toContain("Feed 1: No sources defined for feed BTC/USD");
    });
  });

  describe("validateSources", () => {
    it("should validate sources with known adapter mappings", () => {
      const sources = [
        { exchange: "binance", symbol: "BTCUSDT" },
        { exchange: "coinbase", symbol: "BTC-USD" },
      ];
      const adapterMappings = {
        binance: { ccxtId: "binance", adapter: "BinanceAdapter" },
        coinbase: { ccxtId: "coinbasepro", adapter: "CoinbaseAdapter" },
      };

      const result = service.validateSources(sources, adapterMappings);

      expect(result.isValid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should add warning for unknown exchanges", () => {
      const sources = [{ exchange: "unknown-exchange", symbol: "BTCUSDT" }];
      const adapterMappings = {};

      const result = service.validateSources(sources, adapterMappings);

      expect(result.warnings).toContain(
        "Exchange 'unknown-exchange' not in known mappings, will use CCXT with ID 'unknown-exchange'"
      );
    });
  });
});
