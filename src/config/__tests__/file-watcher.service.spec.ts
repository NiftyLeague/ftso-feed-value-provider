import { TestingModule } from "@nestjs/testing";
import { FileWatcherService, FileWatcherOptions, FileChangeCallback } from "../file-watcher.service";
import { createTestModule, MockSetup } from "@/__tests__/utils";
import * as fs from "fs";

// Mock fs module
jest.mock("fs", () => ({
  watchFile: jest.fn(),
  unwatchFile: jest.fn(),
}));

describe("FileWatcherService", () => {
  let service: FileWatcherService;
  let module: TestingModule;
  const mockWatchFile = fs.watchFile as jest.MockedFunction<typeof fs.watchFile>;
  const mockUnwatchFile = fs.unwatchFile as jest.MockedFunction<typeof fs.unwatchFile>;

  beforeAll(() => {
    MockSetup.setupConsole();
  });

  beforeEach(async () => {
    module = await createTestModule().addProvider(FileWatcherService).build();

    service = module.get<FileWatcherService>(FileWatcherService);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  afterAll(() => {
    MockSetup.cleanup();
  });

  describe("initialization", () => {
    it("should be defined", () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(FileWatcherService);
    });

    it("should start with no watched files", () => {
      expect(service.getWatchedFiles()).toEqual([]);
      expect(service.getWatchStatus()).toEqual([]);
    });
  });

  describe("watchFile", () => {
    const testFilePath = "/test/config.json";
    const mockCallback: FileChangeCallback = jest.fn();

    it("should watch a file successfully", () => {
      service.watchFile(testFilePath, mockCallback);

      expect(mockWatchFile).toHaveBeenCalledWith(
        testFilePath,
        { interval: 1000, persistent: true },
        expect.any(Function)
      );
      expect(service.isWatching(testFilePath)).toBe(true);
      expect(service.getWatchedFiles()).toContain(testFilePath);
    });

    it("should use custom options when provided", () => {
      const options: FileWatcherOptions = {
        interval: 2000,
        persistent: false,
      };

      service.watchFile(testFilePath, mockCallback, options);

      expect(mockWatchFile).toHaveBeenCalledWith(testFilePath, options, expect.any(Function));
    });

    it("should replace existing watcher for the same file", () => {
      const firstCallback = jest.fn();
      const secondCallback = jest.fn();

      service.watchFile(testFilePath, firstCallback);
      service.watchFile(testFilePath, secondCallback);

      expect(mockUnwatchFile).toHaveBeenCalledWith(testFilePath);
      expect(mockWatchFile).toHaveBeenCalledTimes(2);
    });

    it("should handle watch errors", () => {
      mockWatchFile.mockImplementationOnce(() => {
        throw new Error("Watch failed");
      });

      expect(() => {
        service.watchFile(testFilePath, mockCallback);
      }).toThrow("Watch failed");
    });

    it("should trigger callback on file changes", () => {
      let watchCallback: Function;
      (mockWatchFile as any).mockImplementationOnce((_path: any, _options: any, callback: any) => {
        watchCallback = callback;
      });

      service.watchFile(testFilePath, mockCallback);

      // Simulate file change
      const currentStats = { mtime: new Date("2023-01-02") };
      const previousStats = { mtime: new Date("2023-01-01") };
      watchCallback!(currentStats, previousStats);

      expect(mockCallback).toHaveBeenCalledWith(testFilePath, currentStats, previousStats);
    });

    it("should not trigger callback if mtime is unchanged", () => {
      let watchCallback: Function;
      (mockWatchFile as any).mockImplementationOnce((_path: any, _options: any, callback: any) => {
        watchCallback = callback;
      });

      service.watchFile(testFilePath, mockCallback);

      // Simulate file access without modification
      const sameTime = new Date("2023-01-01");
      const currentStats = { mtime: sameTime };
      const previousStats = { mtime: sameTime };
      watchCallback!(currentStats, previousStats);

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe("unwatchFile", () => {
    const testFilePath = "/test/config.json";
    const mockCallback: FileChangeCallback = jest.fn();

    beforeEach(() => {
      service.watchFile(testFilePath, mockCallback);
      jest.clearAllMocks();
    });

    it("should unwatch a file successfully", () => {
      service.unwatchFile(testFilePath);

      expect(mockUnwatchFile).toHaveBeenCalledWith(testFilePath);
      expect(service.isWatching(testFilePath)).toBe(false);
      expect(service.getWatchedFiles()).not.toContain(testFilePath);
    });

    it("should handle unwatching non-watched files gracefully", () => {
      const nonWatchedFile = "/test/nonexistent.json";

      expect(() => {
        service.unwatchFile(nonWatchedFile);
      }).not.toThrow();

      expect(mockUnwatchFile).not.toHaveBeenCalled();
    });

    it("should handle unwatch errors gracefully", () => {
      mockUnwatchFile.mockImplementationOnce(() => {
        throw new Error("Unwatch failed");
      });

      expect(() => {
        service.unwatchFile(testFilePath);
      }).not.toThrow();
    });
  });

  describe("file management", () => {
    it("should track multiple watched files", () => {
      const files = ["/test/file1.json", "/test/file2.json", "/test/file3.json"];
      const callback = jest.fn();

      files.forEach(file => {
        service.watchFile(file, callback);
      });

      expect(service.getWatchedFiles()).toEqual(expect.arrayContaining(files));
      expect(service.getWatchedFiles()).toHaveLength(files.length);
    });

    it("should provide watch status for all files", () => {
      const file1 = "/test/file1.json";
      const file2 = "/test/file2.json";
      const callback = jest.fn();

      service.watchFile(file1, callback, { interval: 1000 });
      service.watchFile(file2, callback, { interval: 2000, persistent: false });

      const status = service.getWatchStatus();
      expect(status).toHaveLength(2);
      expect(status).toEqual(
        expect.arrayContaining([
          { filePath: file1, options: { interval: 1000, persistent: true } },
          { filePath: file2, options: { interval: 2000, persistent: false } },
        ])
      );
    });

    it("should unwatch all files", () => {
      const files = ["/test/file1.json", "/test/file2.json"];
      const callback = jest.fn();

      files.forEach(file => {
        service.watchFile(file, callback);
      });

      service.unwatchAllFiles();

      expect(service.getWatchedFiles()).toHaveLength(0);
      expect(mockUnwatchFile).toHaveBeenCalledTimes(files.length);
    });
  });

  describe("lifecycle management", () => {
    it("should cleanup on module destroy", async () => {
      const files = ["/test/file1.json", "/test/file2.json"];
      const callback = jest.fn();

      files.forEach(file => {
        service.watchFile(file, callback);
      });

      await service.onModuleDestroy();

      expect(service.getWatchedFiles()).toHaveLength(0);
      expect(mockUnwatchFile).toHaveBeenCalledTimes(files.length);
    });
  });

  describe("health and metrics", () => {
    it("should return health status", async () => {
      const files = ["/test/file1.json", "/test/file2.json"];
      const callback = jest.fn();

      files.forEach(file => {
        service.watchFile(file, callback);
      });

      const health = service.getHealthStatus();

      expect(health.status).toBe("healthy");
      expect(health.lastCheck).toBeCloseTo(Date.now(), -2);
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });

    it("should return performance metrics", async () => {
      const metrics = await service.getPerformanceMetrics();

      expect(metrics).toHaveProperty("responseTime");
      expect(metrics).toHaveProperty("throughput");
      expect(metrics).toHaveProperty("errorRate");
      expect(metrics).toHaveProperty("uptime");
      expect(typeof metrics.uptime).toBe("number");
    });
  });
});
