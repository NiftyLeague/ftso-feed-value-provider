import { EventEmitter } from "events";

import type { FeedConfiguration } from "@/common/types/core";
import { FeedCategory } from "@/common/types/core";
import { ExchangeId } from "@/common/types/adapters";

import { TestHelpers } from "@/__tests__/utils/test.helpers";

const getAllFeedConfigurations = jest.fn((..._args: unknown[]): FeedConfiguration[] => [
  {
    feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
    sources: [{ exchange: ExchangeId.Binance, symbol: "BTC/USDT" }],
  },
]);

let osFreemem = () => 1;
let osTotalmem = () => 100;

class MockIntegrationService extends EventEmitter {
  private initialized = true;

  setInitialized(value: boolean) {
    this.initialized = value;
  }

  isServiceInitialized(): boolean {
    return this.initialized;
  }

  async getSystemHealth(): Promise<any> {
    return { status: "healthy", sources: [] };
  }
}

describe("StartupValidationService", () => {
  let integration: MockIntegrationService;
  let startAsyncValidationSpy: jest.SpyInstance;
  let ConfigServiceCtor: typeof import("@/config/config.service").ConfigService;
  let StartupValidationServiceCtor: typeof import("@/integration/services/startup-validation.service").StartupValidationService;

  const envOverrides = {
    TIMEOUTS: {
      INTEGRATION_MS: 10,
    },
    SYSTEM: {
      MEMORY_CRITICAL_THRESHOLD: 0.01,
      MEMORY_WARNING_THRESHOLD: 0.005,
      FREE_MEMORY_CRITICAL_THRESHOLD: 0.01,
      MIN_NODE_VERSION: 18,
      RECOMMENDED_NODE_VERSION: 22,
    },
  };

  const loadModules = async () => {
    // Ensure this suite always sees the mocked @/common/utils, even if another
    // test imported ConfigService earlier in the worker.
    jest.resetModules();

    jest.doMock("@/common/utils", () => ({
      getAllFeedConfigurations: () => getAllFeedConfigurations(),
      getFeedConfiguration: jest.fn(),
      hasCustomAdapter: jest.fn(),
      reloadFeedConfigurations: jest.fn(),
    }));

    jest.doMock("@/config/environment.constants", () => {
      const actual = jest.requireActual(
        "@/config/environment.constants"
      ) as typeof import("@/config/environment.constants");
      return {
        ...actual,
        ENV: {
          ...actual.ENV,
          TIMEOUTS: {
            ...actual.ENV.TIMEOUTS,
            ...envOverrides.TIMEOUTS,
          },
          SYSTEM: {
            ...actual.ENV.SYSTEM,
            ...envOverrides.SYSTEM,
          },
        },
      };
    });

    // Mock built-ins used by validateSystemResources for deterministic branching
    jest.doMock("v8", () => ({
      getHeapStatistics: () => ({
        heap_size_limit: 100,
      }),
    }));
    jest.doMock("os", () => ({
      freemem: () => osFreemem(),
      totalmem: () => osTotalmem(),
    }));

    ({ ConfigService: ConfigServiceCtor } = await import("@/config/config.service"));
    ({ StartupValidationService: StartupValidationServiceCtor } =
      await import("@/integration/services/startup-validation.service"));
  };

  beforeEach(async () => {
    integration = new MockIntegrationService();

    // Jest is configured with resetMocks=true; restore default implementations
    // for our jest.fn utilities each test.
    getAllFeedConfigurations.mockImplementation((): FeedConfiguration[] => [
      {
        feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
        sources: [{ exchange: ExchangeId.Binance, symbol: "BTC/USDT" }],
      },
    ]);

    await loadModules();

    jest.spyOn(ConfigServiceCtor.prototype, "validateConfiguration").mockReturnValue({
      isValid: true,
      errors: [],
      warnings: [],
      missingRequired: [],
      invalidValues: [],
    } as any);

    // Prevent the constructor's async validation timer from running during unit tests
    startAsyncValidationSpy = jest
      .spyOn(StartupValidationServiceCtor.prototype as any, "startAsyncValidation")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    startAsyncValidationSpy.mockRestore();
    jest.restoreAllMocks();
    jest.useRealTimers();

    // Reset dynamic os mock defaults
    osFreemem = () => 1;
    osTotalmem = () => 100;
  });

  it("runs a successful startup validation", async () => {
    const service = new StartupValidationServiceCtor(integration as any);

    const result = await service.validateStartup();

    expect(result.success).toBe(true);
    expect(result.errors).toEqual([]);

    expect(result.validatedServices).toEqual(
      expect.arrayContaining([
        "FeedConfiguration",
        "ConfigService",
        "IntegrationService",
        "Environment Variables",
        "System Resources",
      ])
    );
    expect(typeof result.validationTime).toBe("number");
    expect(result.validationTime).toBeGreaterThanOrEqual(0);
  });

  it("adds a warning when no feeds are configured", async () => {
    getAllFeedConfigurations.mockImplementation(() => []);

    const service = new StartupValidationServiceCtor(integration as any);
    const result = await service.validateStartup();

    expect(result.warnings.join(" ")).toMatch(/No feed configurations found/i);
    expect(result.validatedServices).toContain("FeedConfiguration");
  });

  it("fails validation when ConfigService validation reports errors", async () => {
    (ConfigServiceCtor.prototype.validateConfiguration as unknown as jest.Mock).mockReturnValueOnce({
      isValid: false,
      errors: ["Invalid port"],
      warnings: [],
      missingRequired: [],
      invalidValues: [],
    } as any);

    const service = new StartupValidationServiceCtor(integration as any);
    const result = await service.validateStartup();

    expect(result.success).toBe(false);
    expect(result.errors.join(" ")).toMatch(/ConfigService: Configuration validation failed/i);
  });

  it("fails validation when environment config is not available", async () => {
    jest.spyOn(ConfigServiceCtor.prototype, "getEnvironmentConfig").mockReturnValueOnce(null as any);

    const service = new StartupValidationServiceCtor(integration as any);
    const result = await service.validateStartup();

    expect(result.success).toBe(false);
    expect(result.errors).toContain("ConfigService: Environment configuration not available");
  });

  it("fails validation when feed configurations are not accessible", async () => {
    // validateStartup() instantiates ConfigService multiple times, and the constructor
    // logs feed count (calling getFeedConfigurations) as a side-effect.
    // Ensure the calls used for feed-count logging and validateConfiguration succeed,
    // then break the final call used by validateConfigService.
    jest
      .spyOn(ConfigServiceCtor.prototype, "getFeedConfigurations")
      .mockImplementationOnce(() => getAllFeedConfigurations())
      .mockImplementationOnce(() => getAllFeedConfigurations())
      .mockImplementationOnce(() => getAllFeedConfigurations())
      .mockImplementationOnce(() => ({}) as any);

    const service = new StartupValidationServiceCtor(integration as any);
    const result = await service.validateStartup();

    expect(result.success).toBe(false);
    expect(result.errors).toContain("ConfigService: Feed configurations not accessible");
  });

  it("adds warnings when ConfigService validation reports warnings", async () => {
    (ConfigServiceCtor.prototype.validateConfiguration as unknown as jest.Mock).mockReturnValueOnce({
      isValid: true,
      errors: [],
      warnings: ["Low disk space"],
      missingRequired: [],
      invalidValues: [],
    } as any);

    const service = new StartupValidationServiceCtor(integration as any);
    const result = await service.validateStartup();

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("ConfigService: Low disk space");
    expect(result.validatedServices).toContain("ConfigService");
  });

  it("records a critical memory warning when heap usage exceeds critical threshold", async () => {
    jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 0,
      heapTotal: 50,
      heapUsed: 99,
      external: 0,
      arrayBuffers: 0,
    } as any);

    const service = new StartupValidationServiceCtor(integration as any);
    const result = await service.validateStartup();

    expect(result.validatedServices).toContain("System Resources");
    expect(result.warnings.join(" ")).toMatch(/Critical memory usage at startup/i);
  });

  it("covers the warning-level and normal memory branches without adding warnings", async () => {
    // Warning branch: between warning and critical
    const memorySpy = jest.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 0,
      heapTotal: 50,
      heapUsed: 0.6,
      external: 0,
      arrayBuffers: 0,
    } as any);

    const warnBranchService = new StartupValidationServiceCtor(integration as any);
    const warnBranch = await warnBranchService.validateStartup();
    expect(warnBranch.validatedServices).toContain("System Resources");
    // In this branch the service logs debug instead of warning
    expect(warnBranch.warnings.join(" ")).not.toMatch(/Critical memory usage at startup/i);

    // Normal branch: below warning threshold
    memorySpy.mockReturnValueOnce({
      rss: 0,
      heapTotal: 50,
      heapUsed: 0.1,
      external: 0,
      arrayBuffers: 0,
    } as any);

    const normalBranchService = new StartupValidationServiceCtor(integration as any);
    const normalBranch = await normalBranchService.validateStartup();
    expect(normalBranch.validatedServices).toContain("System Resources");
  });

  it("covers low-free-memory branch and Node version warning/debug branches", async () => {
    // Force the low free memory debug branch by returning 0 free memory
    osFreemem = () => 0;
    osTotalmem = () => 100;

    // Low but supported Node version triggers debug branch (MIN=18, RECOMMENDED=22)
    const originalVersion = process.version;
    Object.defineProperty(process, "version", { value: "v18.0.0", configurable: true });

    try {
      const service = new StartupValidationServiceCtor(integration as any);
      const result = await service.validateStartup();
      expect(result.validatedServices).toContain("System Resources");
    } finally {
      Object.defineProperty(process, "version", { value: originalVersion, configurable: true });
    }
  });

  it("adds a warning when Node version is below minimum", async () => {
    const originalVersion = process.version;
    Object.defineProperty(process, "version", { value: "v16.0.0", configurable: true });

    try {
      const service = new StartupValidationServiceCtor(integration as any);
      const result = await service.validateStartup();
      expect(result.warnings.join(" ")).toMatch(/not supported/i);
    } finally {
      Object.defineProperty(process, "version", { value: originalVersion, configurable: true });
    }
  });

  it("warns when integration health check fails", async () => {
    jest.spyOn(integration, "getSystemHealth").mockRejectedValueOnce(new Error("health check boom"));
    integration.setInitialized(true);

    const service = new StartupValidationServiceCtor(integration as any);
    const result = await service.validateStartup();

    expect(result.validatedServices).toContain("IntegrationService");
    expect(result.warnings.join(" ")).toMatch(/health check failed/i);
  });

  it("adds a warning when integration initialization times out", async () => {
    await TestHelpers.withFakeTimersAsync(async () => {
      integration.setInitialized(false);

      const service = new StartupValidationServiceCtor(integration as any);

      // Avoid waitForCondition interfering with timeout path
      (service as any).waitForCondition = jest.fn().mockResolvedValue(false);

      const promise = service.validateStartup();
      // Advance enough time to ensure the internal initialization timeout fires
      await jest.advanceTimersByTimeAsync(60_000);
      const result = await promise;

      expect(result.validatedServices).toContain("IntegrationService");
      expect(result.warnings.join(" ")).toMatch(/initialization timeout/i);
    });
  });

  it("does not warn when integration becomes initialized via event", async () => {
    integration.setInitialized(false);

    const service = new StartupValidationServiceCtor(integration as any);
    const promise = service.validateStartup();

    await new Promise(resolve => setTimeout(resolve, 1));
    integration.setInitialized(true);
    integration.emit("initialized");

    const result = await promise;

    expect(result.validatedServices).toContain("IntegrationService");
    expect(result.warnings.join(" ")).not.toMatch(/initialization timeout/i);
  });

  it("adds a warning when all data sources are unhealthy", async () => {
    integration.setInitialized(true);
    jest.spyOn(integration, "getSystemHealth").mockResolvedValueOnce({
      status: "healthy",
      sources: [{ status: "unhealthy" }, { status: "unhealthy" }],
    });

    const service = new StartupValidationServiceCtor(integration as any);
    const result = await service.validateStartup();

    expect(result.validatedServices).toContain("IntegrationService");
    expect(result.warnings.join(" ")).toMatch(/All data sources are unhealthy/i);
  });

  it("validateSystemResources warns on critical memory usage and unsupported node version", async () => {
    const originalMemoryUsage = process.memoryUsage;
    const originalVersion = process.version;

    // Force critical memory usage against heap limit
    (process as any).memoryUsage = () => ({
      rss: 0,
      heapTotal: 1,
      heapUsed: 99,
      external: 0,
      arrayBuffers: 0,
    });

    Object.defineProperty(process, "version", {
      value: "v16.0.0",
      configurable: true,
    });

    const service = new StartupValidationServiceCtor(integration as any);
    const result: any = {
      success: true,
      errors: [],
      warnings: [],
      validatedServices: [],
      timestamp: Date.now(),
      validationTime: 0,
    };

    await (service as any).validateSystemResources(result);

    expect(result.validatedServices).toContain("System Resources");
    expect(result.warnings.join(" ")).toMatch(/Critical memory usage at startup/i);
    expect(result.warnings.join(" ")).toMatch(/Node\.js version .* is not supported/i);

    (process as any).memoryUsage = originalMemoryUsage;
    Object.defineProperty(process, "version", {
      value: originalVersion,
      configurable: true,
    });
  });

  it("validateSystemResources uses debug paths for warning-level memory and supported node", async () => {
    const originalMemoryUsage = process.memoryUsage;
    const originalVersion = process.version;

    // Force memory usage between warning and critical thresholds
    (process as any).memoryUsage = () => ({
      rss: 0,
      heapTotal: 1,
      heapUsed: 0.6,
      external: 0,
      arrayBuffers: 0,
    });

    Object.defineProperty(process, "version", {
      value: "v20.0.0",
      configurable: true,
    });

    const service = new StartupValidationServiceCtor(integration as any);
    const result: any = {
      success: true,
      errors: [],
      warnings: [],
      validatedServices: [],
      timestamp: Date.now(),
      validationTime: 0,
    };

    await (service as any).validateSystemResources(result);

    expect(result.validatedServices).toContain("System Resources");
    expect(result.warnings).toEqual([]);

    (process as any).memoryUsage = originalMemoryUsage;
    Object.defineProperty(process, "version", {
      value: originalVersion,
      configurable: true,
    });
  });
});
