import { Logger } from "@nestjs/common";

import { DebugService } from "../debug.service";

describe("DebugService", () => {
  it("should log initialization, debug, performance, and memory usage", () => {
    const logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const debugSpy = jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

    const memoryUsageSpy = jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 10 * 1024 * 1024,
      heapTotal: 20 * 1024 * 1024,
      heapUsed: 5 * 1024 * 1024,
      external: 1 * 1024 * 1024,
      arrayBuffers: 1 * 1024 * 1024,
    });

    const service = new DebugService();

    expect(logSpy).toHaveBeenCalled();
    expect(String(logSpy.mock.calls[0]?.[0] ?? "")).toContain("Debug service initialized");

    service.logDebug("hello", { a: 1 });
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG] hello"), { a: 1 });

    service.logPerformance("op", 12);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("[PERF] op took 12ms"));

    service.logMemoryUsage();
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("[MEMORY] RSS: 10MB, Heap: 5MB"));

    memoryUsageSpy.mockRestore();
    debugSpy.mockRestore();
    logSpy.mockRestore();
  });
});
