import { ConfigUtils } from "../config.utils";

// Mock console.warn to avoid test output noise
const mockConsoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

// Mock process.env
const originalEnv = process.env;

describe("ConfigUtils - Comprehensive Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Reset the mock to ensure it's working
    mockConsoleWarn.mockClear();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("parseIntWithDefault", () => {
    it("should return default value for undefined input", () => {
      const result = ConfigUtils.parseIntWithDefault(undefined, 42);
      expect(result).toBe(42);
    });

    it("should return default value for empty string", () => {
      const result = ConfigUtils.parseIntWithDefault("", 42);
      expect(result).toBe(42);
    });

    it("should parse valid integer", () => {
      const result = ConfigUtils.parseIntWithDefault("123", 42);
      expect(result).toBe(123);
    });

    it("should return default for invalid string", () => {
      const result = ConfigUtils.parseIntWithDefault("invalid", 42);
      expect(result).toBe(42);
    });

    it("should parse decimal number as integer (truncated)", () => {
      const result = ConfigUtils.parseIntWithDefault("123.45", 42);
      expect(result).toBe(123); // parseInt truncates decimal part
    });

    it("should validate minimum value", () => {
      const result = ConfigUtils.parseIntWithDefault("5", 42, { min: 10 });
      expect(result).toBe(42);
    });

    it("should validate maximum value", () => {
      const result = ConfigUtils.parseIntWithDefault("100", 42, { max: 50 });
      expect(result).toBe(42);
    });

    it("should use custom field name in warnings", () => {
      const result = ConfigUtils.parseIntWithDefault("invalid", 42, { fieldName: "testField" });
      expect(result).toBe(42);
    });

    it("should accept value within range", () => {
      const result = ConfigUtils.parseIntWithDefault("25", 42, { min: 10, max: 50 });
      expect(result).toBe(25);
    });
  });

  describe("parseFloatWithDefault", () => {
    it("should return default value for undefined input", () => {
      const result = ConfigUtils.parseFloatWithDefault(undefined, 42.5);
      expect(result).toBe(42.5);
    });

    it("should parse valid float", () => {
      const result = ConfigUtils.parseFloatWithDefault("123.45", 42.5);
      expect(result).toBe(123.45);
    });

    it("should parse integer as float", () => {
      const result = ConfigUtils.parseFloatWithDefault("123", 42.5);
      expect(result).toBe(123);
    });

    it("should return default for invalid string", () => {
      const result = ConfigUtils.parseFloatWithDefault("invalid", 42.5);
      expect(result).toBe(42.5);
    });

    it("should validate minimum value", () => {
      const result = ConfigUtils.parseFloatWithDefault("5.5", 42.5, { min: 10 });
      expect(result).toBe(42.5);
    });

    it("should validate maximum value", () => {
      const result = ConfigUtils.parseFloatWithDefault("100.5", 42.5, { max: 50 });
      expect(result).toBe(42.5);
    });

    it("should use custom field name in warnings", () => {
      const result = ConfigUtils.parseFloatWithDefault("invalid", 42.5, { fieldName: "testField" });
      expect(result).toBe(42.5);
    });
  });

  describe("parseJsonWithDefault", () => {
    it("should return default value for undefined input", () => {
      const result = ConfigUtils.parseJsonWithDefault(undefined, { default: "value" });
      expect(result).toEqual({ default: "value" });
    });

    it("should parse valid JSON", () => {
      const result = ConfigUtils.parseJsonWithDefault('{"key": "value"}', {});
      expect(result).toEqual({ key: "value" });
    });

    it("should parse JSON array", () => {
      const result = ConfigUtils.parseJsonWithDefault("[1, 2, 3]", []);
      expect(result).toEqual([1, 2, 3]);
    });

    it("should return default for invalid JSON", () => {
      const result = ConfigUtils.parseJsonWithDefault('{"key": "value"', {});
      expect(result).toEqual({});
    });

    it("should use custom field name in warnings", () => {
      const result = ConfigUtils.parseJsonWithDefault("invalid", {}, { fieldName: "testField" });
      expect(result).toEqual({});
    });
  });

  describe("parseBooleanWithDefault", () => {
    it("should return default value for undefined input", () => {
      const result = ConfigUtils.parseBooleanWithDefault(undefined, true);
      expect(result).toBe(true);
    });

    it("should parse 'true' as true", () => {
      const result = ConfigUtils.parseBooleanWithDefault("true", false);
      expect(result).toBe(true);
    });

    it("should parse 'TRUE' as true", () => {
      const result = ConfigUtils.parseBooleanWithDefault("TRUE", false);
      expect(result).toBe(true);
    });

    it("should parse '1' as true", () => {
      const result = ConfigUtils.parseBooleanWithDefault("1", false);
      expect(result).toBe(true);
    });

    it("should parse 'yes' as true", () => {
      const result = ConfigUtils.parseBooleanWithDefault("yes", false);
      expect(result).toBe(true);
    });

    it("should parse 'false' as false", () => {
      const result = ConfigUtils.parseBooleanWithDefault("false", true);
      expect(result).toBe(false);
    });

    it("should parse 'FALSE' as false", () => {
      const result = ConfigUtils.parseBooleanWithDefault("FALSE", true);
      expect(result).toBe(false);
    });

    it("should parse '0' as false", () => {
      const result = ConfigUtils.parseBooleanWithDefault("0", true);
      expect(result).toBe(false);
    });

    it("should parse 'no' as false", () => {
      const result = ConfigUtils.parseBooleanWithDefault("no", true);
      expect(result).toBe(false);
    });

    it("should return default for invalid value", () => {
      const result = ConfigUtils.parseBooleanWithDefault("maybe", true);
      expect(result).toBe(true);
    });

    it("should use custom field name in warnings", () => {
      const result = ConfigUtils.parseBooleanWithDefault("invalid", true, { fieldName: "testField" });
      expect(result).toBe(true);
    });
  });

  describe("parseListWithDefault", () => {
    it("should return default value for undefined input", () => {
      const result = ConfigUtils.parseListWithDefault(undefined, ["default"]);
      expect(result).toEqual(["default"]);
    });

    it("should parse comma-separated list", () => {
      const result = ConfigUtils.parseListWithDefault("a,b,c", []);
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should trim whitespace", () => {
      const result = ConfigUtils.parseListWithDefault(" a , b , c ", []);
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should filter empty values by default", () => {
      const result = ConfigUtils.parseListWithDefault("a,,b,", []);
      expect(result).toEqual(["a", "b"]);
    });

    it("should not filter empty values when filterEmpty is false", () => {
      const result = ConfigUtils.parseListWithDefault("a,,b,", [], { filterEmpty: false });
      expect(result).toEqual(["a", "", "b", ""]);
    });

    it("should use custom separator", () => {
      const result = ConfigUtils.parseListWithDefault("a;b;c", [], { separator: ";" });
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("should use custom field name", () => {
      const result = ConfigUtils.parseListWithDefault("a,b,c", [], { fieldName: "testField" });
      expect(result).toEqual(["a", "b", "c"]);
    });
  });

  describe("parsePort", () => {
    it("should parse valid port number", () => {
      const result = ConfigUtils.parsePort("8080", 3000);
      expect(result).toBe(8080);
    });

    it("should return default for invalid port", () => {
      const result = ConfigUtils.parsePort("invalid", 3000);
      expect(result).toBe(3000);
    });

    it("should return default for port below minimum", () => {
      const result = ConfigUtils.parsePort("0", 3000);
      expect(result).toBe(3000);
    });

    it("should return default for port above maximum", () => {
      const result = ConfigUtils.parsePort("70000", 3000);
      expect(result).toBe(3000);
    });

    it("should use custom field name", () => {
      const result = ConfigUtils.parsePort("invalid", 3000, "customPort");
      expect(result).toBe(3000);
    });
  });

  describe("parseTimeoutMs", () => {
    it("should parse valid timeout", () => {
      const result = ConfigUtils.parseTimeoutMs("5000", 1000);
      expect(result).toBe(5000);
    });

    it("should return default for invalid timeout", () => {
      const result = ConfigUtils.parseTimeoutMs("invalid", 1000);
      expect(result).toBe(1000);
    });

    it("should return default for negative timeout", () => {
      const result = ConfigUtils.parseTimeoutMs("-1000", 1000);
      expect(result).toBe(1000);
    });

    it("should return default for timeout above maximum", () => {
      const result = ConfigUtils.parseTimeoutMs("400000", 1000);
      expect(result).toBe(1000);
    });
  });

  describe("parsePercentage", () => {
    it("should parse valid percentage", () => {
      const result = ConfigUtils.parsePercentage("75.5", 50);
      expect(result).toBe(75.5);
    });

    it("should return default for invalid percentage", () => {
      const result = ConfigUtils.parsePercentage("invalid", 50);
      expect(result).toBe(50);
    });

    it("should return default for percentage below 0", () => {
      const result = ConfigUtils.parsePercentage("-10", 50);
      expect(result).toBe(50);
    });

    it("should return default for percentage above 100", () => {
      const result = ConfigUtils.parsePercentage("150", 50);
      expect(result).toBe(50);
    });
  });

  describe("parseFileSize", () => {
    it("should parse bytes", () => {
      const result = ConfigUtils.parseFileSize("1024", 0);
      expect(result).toBe(1024);
    });

    it("should parse KB", () => {
      const result = ConfigUtils.parseFileSize("1KB", 0);
      expect(result).toBe(1024);
    });

    it("should parse MB", () => {
      const result = ConfigUtils.parseFileSize("1MB", 0);
      expect(result).toBe(1024 * 1024);
    });

    it("should parse GB", () => {
      const result = ConfigUtils.parseFileSize("1GB", 0);
      expect(result).toBe(1024 * 1024 * 1024);
    });

    it("should parse TB", () => {
      const result = ConfigUtils.parseFileSize("1TB", 0);
      expect(result).toBe(1024 * 1024 * 1024 * 1024);
    });

    it("should parse decimal values", () => {
      const result = ConfigUtils.parseFileSize("1.5MB", 0);
      expect(result).toBe(Math.floor(1.5 * 1024 * 1024));
    });

    it("should handle case insensitive units", () => {
      const result = ConfigUtils.parseFileSize("1mb", 0);
      expect(result).toBe(1024 * 1024);
    });

    it("should return default for invalid format", () => {
      const result = ConfigUtils.parseFileSize("invalid", 1024);
      expect(result).toBe(1024);
    });

    it("should use custom field name", () => {
      const result = ConfigUtils.parseFileSize("invalid", 1024, "maxSize");
      expect(result).toBe(1024);
    });
  });

  describe("parseDurationMs", () => {
    it("should parse milliseconds", () => {
      const result = ConfigUtils.parseDurationMs("1000ms", 0);
      expect(result).toBe(1000);
    });

    it("should parse seconds", () => {
      const result = ConfigUtils.parseDurationMs("5s", 0);
      expect(result).toBe(5000);
    });

    it("should parse minutes", () => {
      const result = ConfigUtils.parseDurationMs("2m", 0);
      expect(result).toBe(2 * 60 * 1000);
    });

    it("should parse hours", () => {
      const result = ConfigUtils.parseDurationMs("1h", 0);
      expect(result).toBe(60 * 60 * 1000);
    });

    it("should parse days", () => {
      const result = ConfigUtils.parseDurationMs("1d", 0);
      expect(result).toBe(24 * 60 * 60 * 1000);
    });

    it("should parse decimal values", () => {
      const result = ConfigUtils.parseDurationMs("1.5s", 0);
      expect(result).toBe(1500);
    });

    it("should default to milliseconds when no unit", () => {
      const result = ConfigUtils.parseDurationMs("1000", 0);
      expect(result).toBe(1000);
    });

    it("should handle case insensitive units", () => {
      const result = ConfigUtils.parseDurationMs("1S", 0);
      expect(result).toBe(1000);
    });

    it("should return default for invalid format", () => {
      const result = ConfigUtils.parseDurationMs("invalid", 1000);
      expect(result).toBe(1000);
    });
  });

  describe("requireEnvVar", () => {
    it("should return environment variable value", () => {
      process.env.TEST_VAR = "test-value";
      const result = ConfigUtils.requireEnvVar("TEST_VAR");
      expect(result).toBe("test-value");
    });

    it("should throw error for missing variable", () => {
      delete process.env.TEST_VAR;
      expect(() => ConfigUtils.requireEnvVar("TEST_VAR")).toThrow("Required environment variable TEST_VAR is not set");
    });
  });

  describe("getEnvVar", () => {
    it("should return environment variable value", () => {
      process.env.TEST_VAR = "test-value";
      const result = ConfigUtils.getEnvVar("TEST_VAR");
      expect(result).toBe("test-value");
    });

    it("should return default value for missing variable", () => {
      delete process.env.TEST_VAR;
      const result = ConfigUtils.getEnvVar("TEST_VAR", "default-value");
      expect(result).toBe("default-value");
    });

    it("should return empty string for missing variable without default", () => {
      delete process.env.TEST_VAR;
      const result = ConfigUtils.getEnvVar("TEST_VAR");
      expect(result).toBe("");
    });

    it("should throw error for required missing variable", () => {
      delete process.env.TEST_VAR;
      expect(() => ConfigUtils.getEnvVar("TEST_VAR", undefined, { required: true })).toThrow(
        "Required environment variable TEST_VAR is not set"
      );
    });

    it("should validate allowed values", () => {
      process.env.TEST_VAR = "invalid";
      expect(() => ConfigUtils.getEnvVar("TEST_VAR", undefined, { allowedValues: ["valid1", "valid2"] })).toThrow(
        "Environment variable TEST_VAR must be one of: valid1, valid2"
      );
    });

    it("should accept allowed value", () => {
      process.env.TEST_VAR = "valid1";
      const result = ConfigUtils.getEnvVar("TEST_VAR", undefined, { allowedValues: ["valid1", "valid2"] });
      expect(result).toBe("valid1");
    });

    it("should validate pattern", () => {
      process.env.TEST_VAR = "invalid-format";
      expect(() => ConfigUtils.getEnvVar("TEST_VAR", undefined, { pattern: /^\d+$/ })).toThrow(
        "Environment variable TEST_VAR does not match required pattern"
      );
    });

    it("should accept matching pattern", () => {
      process.env.TEST_VAR = "12345";
      const result = ConfigUtils.getEnvVar("TEST_VAR", undefined, { pattern: /^\d+$/ });
      expect(result).toBe("12345");
    });
  });

  describe("loadExchangeApiKeys", () => {
    it("should load API keys for exchanges", () => {
      process.env.BINANCE_API_KEY = "binance-key";
      process.env.BINANCE_SECRET = "binance-secret";
      process.env.BINANCE_PASSPHRASE = "binance-passphrase";
      process.env.BINANCE_SANDBOX = "true";

      const result = ConfigUtils.loadExchangeApiKeys(["binance"]);

      expect(result).toEqual({
        binance: {
          apiKey: "binance-key",
          secret: "binance-secret",
          passphrase: "binance-passphrase",
          sandbox: true,
        },
      });
    });

    it("should handle exchanges with no API keys", () => {
      const result = ConfigUtils.loadExchangeApiKeys(["nonexistent"]);
      expect(result).toEqual({});
    });

    it("should handle partial API keys", () => {
      process.env.BINANCE_API_KEY = "binance-key";
      process.env.BINANCE_SANDBOX = "false";

      const result = ConfigUtils.loadExchangeApiKeys(["binance"]);

      expect(result).toEqual({
        binance: {
          apiKey: "binance-key",
          secret: undefined,
          passphrase: undefined,
          sandbox: false,
        },
      });
    });

    it("should handle multiple exchanges", () => {
      process.env.BINANCE_API_KEY = "binance-key";
      process.env.COINBASE_API_KEY = "coinbase-key";
      process.env.COINBASE_SECRET = "coinbase-secret";

      const result = ConfigUtils.loadExchangeApiKeys(["binance", "coinbase"]);

      expect(result).toEqual({
        binance: {
          apiKey: "binance-key",
          secret: undefined,
          passphrase: undefined,
          sandbox: false,
        },
        coinbase: {
          apiKey: "coinbase-key",
          secret: "coinbase-secret",
          passphrase: undefined,
          sandbox: false,
        },
      });
    });
  });

  describe("createValidationResult", () => {
    it("should create valid result with no errors", () => {
      const result = ConfigUtils.createValidationResult();
      expect(result).toEqual({
        isValid: true,
        errors: [],
        warnings: [],
        missingRequired: [],
        invalidValues: [],
      });
    });

    it("should create invalid result with errors", () => {
      const result = ConfigUtils.createValidationResult(["error1", "error2"]);
      expect(result).toEqual({
        isValid: false,
        errors: ["error1", "error2"],
        warnings: [],
        missingRequired: [],
        invalidValues: [],
      });
    });

    it("should create invalid result with missing required", () => {
      const result = ConfigUtils.createValidationResult([], [], ["missing1"]);
      expect(result).toEqual({
        isValid: false,
        errors: [],
        warnings: [],
        missingRequired: ["missing1"],
        invalidValues: [],
      });
    });

    it("should create result with all types of issues", () => {
      const result = ConfigUtils.createValidationResult(["error1"], ["warning1"], ["missing1"], ["invalid1"]);
      expect(result).toEqual({
        isValid: false,
        errors: ["error1"],
        warnings: ["warning1"],
        missingRequired: ["missing1"],
        invalidValues: ["invalid1"],
      });
    });
  });

  describe("mergeValidationResults", () => {
    it("should merge multiple valid results", () => {
      const result1 = ConfigUtils.createValidationResult();
      const result2 = ConfigUtils.createValidationResult();

      const merged = ConfigUtils.mergeValidationResults(result1, result2);

      expect(merged).toEqual({
        isValid: true,
        errors: [],
        warnings: [],
        missingRequired: [],
        invalidValues: [],
      });
    });

    it("should merge results with different issues", () => {
      const result1 = ConfigUtils.createValidationResult(["error1"], ["warning1"]);
      const result2 = ConfigUtils.createValidationResult([], ["warning2"], ["missing1"]);

      const merged = ConfigUtils.mergeValidationResults(result1, result2);

      expect(merged).toEqual({
        isValid: false,
        errors: ["error1"],
        warnings: ["warning1", "warning2"],
        missingRequired: ["missing1"],
        invalidValues: [],
      });
    });

    it("should merge multiple invalid results", () => {
      const result1 = ConfigUtils.createValidationResult(["error1"], [], ["missing1"]);
      const result2 = ConfigUtils.createValidationResult(["error2"], [], ["missing2"]);

      const merged = ConfigUtils.mergeValidationResults(result1, result2);

      expect(merged).toEqual({
        isValid: false,
        errors: ["error1", "error2"],
        warnings: [],
        missingRequired: ["missing1", "missing2"],
        invalidValues: [],
      });
    });

    it("should handle empty array", () => {
      const merged = ConfigUtils.mergeValidationResults();

      expect(merged).toEqual({
        isValid: true,
        errors: [],
        warnings: [],
        missingRequired: [],
        invalidValues: [],
      });
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle very large numbers", () => {
      const result = ConfigUtils.parseIntWithDefault("999999999999999", 42);
      expect(result).toBe(999999999999999);
    });

    it("should handle very small numbers", () => {
      const result = ConfigUtils.parseFloatWithDefault("0.000001", 42);
      expect(result).toBe(0.000001);
    });

    it("should handle empty JSON object", () => {
      const result = ConfigUtils.parseJsonWithDefault("{}", { default: "value" });
      expect(result).toEqual({});
    });

    it("should handle empty JSON array", () => {
      const result = ConfigUtils.parseJsonWithDefault("[]", [1, 2, 3]);
      expect(result).toEqual([]);
    });

    it("should handle whitespace-only strings", () => {
      const result = ConfigUtils.parseListWithDefault("   ", []);
      expect(result).toEqual([]);
    });

    it("should handle single character values", () => {
      const result = ConfigUtils.parseListWithDefault("a", []);
      expect(result).toEqual(["a"]);
    });

    it("should handle special characters in file size", () => {
      const result = ConfigUtils.parseFileSize("1.5MB", 0);
      expect(result).toBe(Math.floor(1.5 * 1024 * 1024));
    });

    it("should handle very large file sizes", () => {
      const result = ConfigUtils.parseFileSize("10TB", 0);
      expect(result).toBe(10 * 1024 * 1024 * 1024 * 1024);
    });

    it("should handle very long durations", () => {
      const result = ConfigUtils.parseDurationMs("7d", 0);
      expect(result).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
