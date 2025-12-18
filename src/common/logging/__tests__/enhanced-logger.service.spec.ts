import { Logger } from "@nestjs/common";
import { TestHelpers } from "@/__tests__/utils/test.helpers";

const fsMock = {
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  appendFileSync: jest.fn(),
} as unknown as jest.Mocked<Pick<typeof import("fs"), "existsSync" | "mkdirSync" | "appendFileSync">>;

jest.mock("fs", () => fsMock);

jest.mock("@/config/environment.constants", () => ({
  ENV: {
    LOGGING: {
      ENABLE_FILE_LOGGING: true,
      ENABLE_PERFORMANCE_LOGGING: true,
      ENABLE_DEBUG_LOGGING: true,
      LOG_DIRECTORY: "logs",
      LOG_LEVEL: "debug",
    },
    DATA_FRESHNESS: {
      STALE_WARNING_MS: 1000,
    },
  },
}));

describe("EnhancedLoggerService", () => {
  const loadEnhancedLoggerService = async () => {
    const mod = await import("../enhanced-logger.service");
    return mod.EnhancedLoggerService;
  };

  beforeEach(() => {
    jest.clearAllMocks();

    fsMock.existsSync.mockReturnValue(false as any);
    fsMock.mkdirSync.mockImplementation(() => undefined as any);
    fsMock.appendFileSync.mockImplementation(() => undefined as any);

    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("initializes log directory", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const logger = new EnhancedLoggerService("Test");
    expect(logger).toBeDefined();
    expect(fsMock.existsSync).toHaveBeenCalled();
    expect(fsMock.mkdirSync).toHaveBeenCalled();
  });

  it("writes log entries to file when enabled", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const logger = new EnhancedLoggerService("Test");
    logger.log("hello", { component: "x", operation: "y" });

    expect(fsMock.appendFileSync).toHaveBeenCalled();
  });

  it("routes Error objects through ErrorLogger", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const logger = new EnhancedLoggerService("Test");
    const errorSpy = jest.spyOn((logger as any).errorLogger, "logError");

    logger.error(new Error("boom"), { component: "x", operation: "y" });

    expect(errorSpy).toHaveBeenCalled();
  });

  it("starts and ends performance timers", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const logger = new EnhancedLoggerService("Test");

    const startSpy = jest.spyOn((logger as any).performanceLogger, "startTimer");
    const endSpy = jest.spyOn((logger as any).performanceLogger, "endTimer");

    logger.startPerformanceTimer("op-1", "operation", "component", { a: 1 });
    logger.endPerformanceTimer("op-1", true, { b: 2 });

    expect(startSpy).toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalled();
  });

  it("writes debug/verbose/fatal entries to file", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const logger = new EnhancedLoggerService("Test");

    logger.debug("dbg", { component: "x", operation: "y" });
    logger.verbose("v", { component: "x", operation: "y" });
    logger.fatal("boom", { component: "x", operation: "y" });

    expect(fsMock.appendFileSync).toHaveBeenCalled();
    expect(Logger.prototype.debug).toHaveBeenCalled();
    // With LOG_LEVEL='debug', verbose should be filtered out
    expect(Logger.prototype.verbose).not.toHaveBeenCalled();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });

  it("dir logs to console and file", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const dirSpy = jest.spyOn(console, "dir").mockImplementation(() => undefined);

    const logger = new EnhancedLoggerService("Test");
    logger.dir("dir", { component: "x", operation: "y" });

    expect(dirSpy).toHaveBeenCalled();
    expect(fsMock.appendFileSync).toHaveBeenCalled();
  });

  it("logCriticalOperation writes audit log and routes success/failure", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const logger = new EnhancedLoggerService("Test");

    const logSpy = jest.spyOn(logger, "log");
    const errorSpy = jest.spyOn(logger, "error");

    logger.logCriticalOperation("op", "Component", { a: 1 }, true, "started");
    logger.logCriticalOperation("op", "Component", { a: 1 }, false);

    expect(logSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    expect(fsMock.appendFileSync).toHaveBeenCalledWith(expect.stringContaining("audit.log"), expect.any(String));
  });

  it("logPriceUpdate warns once then rate-limits to debug", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const logger = new EnhancedLoggerService("Test");
    const warnSpy = jest.spyOn(logger, "warn");
    const debugSpy = jest.spyOn(logger, "debug");

    const now = 1_000_000;

    TestHelpers.withMockedNow(now, () => {
      // stale: first time -> warn
      logger.logPriceUpdate("BTC/USD", "binance", 50000, now - 10_000, 0.9);
      // stale again immediately -> debug (rate limited)
      logger.logPriceUpdate("BTC/USD", "binance", 50001, now - 10_000, 0.9);
      // fresh -> debug
      logger.logPriceUpdate("BTC/USD", "binance", 50002, now - 10, 0.9);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("routes connection and error recovery events", async () => {
    const EnhancedLoggerService = await loadEnhancedLoggerService();
    const logger = new EnhancedLoggerService("Test");

    const logSpy = jest.spyOn(logger, "log");
    const warnSpy = jest.spyOn(logger, "warn");
    const errorSpy = jest.spyOn(logger, "error");

    logger.logConnection("source", "connected");
    logger.logConnection("source", "disconnected");
    logger.logConnection("source", "reconnecting");
    logger.logConnection("source", "failed");

    logger.logErrorRecovery("source", "type", "action", true);
    logger.logErrorRecovery("source", "type", "action", false);

    expect(logSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });
});
