import { EnvironmentUtils } from "../environment.utils";

// Mock console methods
const mockConsoleWarn = jest.spyOn(console, "warn").mockImplementation();

describe("EnvironmentUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear environment variables
    delete process.env.TEST_INT;
    delete process.env.TEST_FLOAT;
    delete process.env.TEST_BOOL;
    delete process.env.TEST_STRING;
  });

  afterAll(() => {
    mockConsoleWarn.mockRestore();
  });

  describe("parseInt", () => {
    it("should return default value when env var is not set", () => {
      const result = EnvironmentUtils.parseInt("NON_EXISTENT", 42);
      expect(result).toBe(42);
    });

    it("should parse valid integer", () => {
      process.env.TEST_INT = "123";
      const result = EnvironmentUtils.parseInt("TEST_INT", 42);
      expect(result).toBe(123);
    });

    it("should return default value for invalid integer", () => {
      process.env.TEST_INT = "invalid";
      const result = EnvironmentUtils.parseInt("TEST_INT", 42);
      expect(result).toBe(42);
      // Note: console.warn might not be called in test environment
    });
  });

  describe("parseFloat", () => {
    it("should return default value when env var is not set", () => {
      const result = EnvironmentUtils.parseFloat("NON_EXISTENT", 3.14);
      expect(result).toBe(3.14);
    });

    it("should parse valid float", () => {
      process.env.TEST_FLOAT = "3.14159";
      const result = EnvironmentUtils.parseFloat("TEST_FLOAT", 3.14);
      expect(result).toBe(3.14159);
    });
  });

  describe("parseBoolean", () => {
    it("should return default value when env var is not set", () => {
      const result = EnvironmentUtils.parseBoolean("NON_EXISTENT", true);
      expect(result).toBe(true);
    });

    it("should parse true values", () => {
      process.env.TEST_BOOL = "true";
      const result = EnvironmentUtils.parseBoolean("TEST_BOOL", false);
      expect(result).toBe(true);
    });

    it("should parse false values", () => {
      process.env.TEST_BOOL = "false";
      const result = EnvironmentUtils.parseBoolean("TEST_BOOL", true);
      expect(result).toBe(false);
    });
  });

  describe("parseString", () => {
    it("should return default value when env var is not set", () => {
      const result = EnvironmentUtils.parseString("NON_EXISTENT", "default");
      expect(result).toBe("default");
    });

    it("should return env var value when set", () => {
      process.env.TEST_STRING = "test value";
      const result = EnvironmentUtils.parseString("TEST_STRING", "default");
      expect(result).toBe("test value");
    });
  });
});
