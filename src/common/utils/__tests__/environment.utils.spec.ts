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
    delete process.env.TEST_LIST;
    delete process.env.TEST_JSON;
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
    });

    it("should enforce min/max bounds", () => {
      process.env.TEST_INT = "1";
      expect(EnvironmentUtils.parseInt("TEST_INT", 42, { min: 2 })).toBe(42);

      process.env.TEST_INT = "100";
      expect(EnvironmentUtils.parseInt("TEST_INT", 42, { max: 50 })).toBe(42);
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

    it("should return default value for invalid float", () => {
      process.env.TEST_FLOAT = "nope";
      expect(EnvironmentUtils.parseFloat("TEST_FLOAT", 3.14)).toBe(3.14);
    });

    it("should enforce min/max bounds", () => {
      process.env.TEST_FLOAT = "0.1";
      expect(EnvironmentUtils.parseFloat("TEST_FLOAT", 3.14, { min: 1 })).toBe(3.14);

      process.env.TEST_FLOAT = "10";
      expect(EnvironmentUtils.parseFloat("TEST_FLOAT", 3.14, { max: 5 })).toBe(3.14);
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

    it("should parse yes/1 and no/0", () => {
      process.env.TEST_BOOL = "1";
      expect(EnvironmentUtils.parseBoolean("TEST_BOOL", false)).toBe(true);

      process.env.TEST_BOOL = "yes";
      expect(EnvironmentUtils.parseBoolean("TEST_BOOL", false)).toBe(true);

      process.env.TEST_BOOL = "0";
      expect(EnvironmentUtils.parseBoolean("TEST_BOOL", true)).toBe(false);

      process.env.TEST_BOOL = "no";
      expect(EnvironmentUtils.parseBoolean("TEST_BOOL", true)).toBe(false);
    });

    it("should return default for invalid boolean", () => {
      process.env.TEST_BOOL = "maybe";
      expect(EnvironmentUtils.parseBoolean("TEST_BOOL", true)).toBe(true);
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

    it("should enforce min/max length and pattern", () => {
      process.env.TEST_STRING = "a";
      expect(EnvironmentUtils.parseString("TEST_STRING", "default", { minLength: 2 })).toBe("default");

      process.env.TEST_STRING = "abcdef";
      expect(EnvironmentUtils.parseString("TEST_STRING", "default", { maxLength: 3 })).toBe("default");

      process.env.TEST_STRING = "no-digits";
      expect(EnvironmentUtils.parseString("TEST_STRING", "default", { pattern: /\d+/ })).toBe("default");
    });
  });

  describe("parseList", () => {
    it("should return default list when env var is not set", () => {
      expect(EnvironmentUtils.parseList("TEST_LIST", ["a"])).toEqual(["a"]);
    });

    it("should parse comma-separated list, trimming and dropping empties", () => {
      process.env.TEST_LIST = " a, b , ,c ,, ";
      expect(EnvironmentUtils.parseList("TEST_LIST")).toEqual(["a", "b", "c"]);
    });
  });

  describe("parseJSON", () => {
    it("should return default when env var is not set", () => {
      expect(EnvironmentUtils.parseJSON("TEST_JSON", { a: 1 })).toEqual({ a: 1 });
    });

    it("should parse valid JSON and fall back on invalid JSON", () => {
      process.env.TEST_JSON = '{"a":2}';
      expect(EnvironmentUtils.parseJSON("TEST_JSON", { a: 1 })).toEqual({ a: 2 });

      process.env.TEST_JSON = "{nope";
      expect(EnvironmentUtils.parseJSON("TEST_JSON", { a: 1 })).toEqual({ a: 1 });
    });
  });
});
