describe("FilteredLogger", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("filters log methods based on ENV.LOGGING.LOG_LEVEL", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/config/environment.constants", () => ({
        ENV: {
          LOGGING: {
            LOG_LEVEL: "error",
          },
        },
      }));

      const { Logger } = await import("@nestjs/common");
      const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
      const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const debugSpy = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
      const verboseSpy = jest.spyOn(Logger.prototype, "verbose").mockImplementation(() => undefined);

      const { FilteredLogger } = await import("../filtered-logger");

      const logger = new FilteredLogger("Test");

      logger.log("x");
      logger.warn("x");
      logger.debug("x");
      logger.verbose("x");
      logger.error("x");
      logger.fatal("boom");

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalled();
      expect(verboseSpy).not.toHaveBeenCalled();

      expect(errorSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith("x");
      expect(errorSpy).toHaveBeenCalledWith("[FATAL] boom");
    });
  });
});
