describe("ConfigController", () => {
  const makeFeed = (category: number, name: string, exchanges: string[]) => ({
    feed: { category, name },
    sources: exchanges.map(exchange => ({ exchange })),
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it("returns configuration status including adapter counts", async () => {
    jest.doMock("@/config/environment.constants", () => ({
      ENV: {
        APPLICATION: { NODE_ENV: "test", PORT: 1234 },
        MONITORING: { ENABLED: true, METRICS_PORT: 9090 },
        LOGGING: { LOG_LEVEL: "debug", ENABLE_FILE_LOGGING: true, ENABLE_PERFORMANCE_LOGGING: true },
        CACHE: { TTL_MS: 1000, MAX_ENTRIES: 10 },
        ADAPTERS: { ACTIVE_CUSTOM_ADAPTERS: ["binance", "customex"] },
      },
    }));

    jest.doMock("@/config/exchanges.json", () => ({
      categories: {
        "1": { exchanges: ["binance", "kraken", "coinbase"] },
      },
    }));

    await jest.isolateModulesAsync(async () => {
      const { ConfigController } = await import("../config.controller");

      const configService = {
        getFeedConfigurations: jest
          .fn()
          .mockReturnValue([makeFeed(1, "BTC/USD", ["binance", "kraken"]), makeFeed(1, "ETH/USD", ["coinbase"])]),
        validateConfiguration: jest.fn(),
      };

      const controller = new ConfigController(configService as any);
      const status = controller.getConfigurationStatus();

      expect(configService.getFeedConfigurations).toHaveBeenCalled();
      expect(status.feeds.count).toBe(2);
      // ccxtExchanges filters out ACTIVE_CUSTOM_ADAPTERS
      expect(status.adapters.ccxtAdapterCount).toBe(2); // kraken + coinbase
      expect(status.adapters.customAdapterCount).toBe(2);
      expect(status.adapters.totalExchanges).toBe(4);
    });
  });

  it("validates configuration and summarizes feed validation", async () => {
    jest.doMock("@/config/environment.constants", () => ({
      ENV: {
        APPLICATION: { NODE_ENV: "test", PORT: 1234 },
        MONITORING: { ENABLED: true, METRICS_PORT: 9090 },
        LOGGING: { LOG_LEVEL: "debug", ENABLE_FILE_LOGGING: false, ENABLE_PERFORMANCE_LOGGING: false },
        CACHE: { TTL_MS: 1000, MAX_ENTRIES: 10 },
        ADAPTERS: { ACTIVE_CUSTOM_ADAPTERS: [] },
      },
    }));

    jest.doMock("@/config/exchanges.json", () => ({ categories: {} }));

    await jest.isolateModulesAsync(async () => {
      const { ConfigController } = await import("../config.controller");

      const configService = {
        getFeedConfigurations: jest
          .fn()
          .mockReturnValue([makeFeed(1, "BTC/USD", ["binance", "kraken"]), makeFeed(2, "FLR/USD", ["custom"])]),
        validateConfiguration: jest.fn().mockReturnValue({
          isValid: false,
          errors: ["missing X", "missing Y"],
          warnings: ["warn1"],
        }),
      };

      const controller = new ConfigController(configService as any);
      const result = controller.validateConfiguration();

      expect(result.overall.isValid).toBe(false);
      expect(result.overall.criticalErrors).toBe(2);
      expect(result.overall.warnings).toBe(1);
      expect(result.feeds.totalFeeds).toBe(2);
      expect(result.feeds.totalSources).toBe(3);
      expect(result.feeds.validationResults).toHaveLength(2);
      expect(result.feeds.validationResults[0]?.feedName).toBe("BTC/USD");
    });
  });

  it("returns feed summary with categories and exchange usage and hybrid summary", async () => {
    jest.doMock("@/config/environment.constants", () => ({
      ENV: {
        APPLICATION: { NODE_ENV: "test", PORT: 1234 },
        MONITORING: { ENABLED: true, METRICS_PORT: 9090 },
        LOGGING: { LOG_LEVEL: "debug", ENABLE_FILE_LOGGING: false, ENABLE_PERFORMANCE_LOGGING: false },
        CACHE: { TTL_MS: 1000, MAX_ENTRIES: 10 },
        ADAPTERS: { ACTIVE_CUSTOM_ADAPTERS: ["customex"] },
      },
    }));

    jest.doMock("@/config/exchanges.json", () => ({
      categories: {
        "1": { exchanges: ["customex", "kraken"] },
      },
    }));

    await jest.isolateModulesAsync(async () => {
      const { ConfigController } = await import("../config.controller");

      const configService = {
        getFeedConfigurations: jest
          .fn()
          .mockReturnValue([
            makeFeed(1, "BTC/USD", ["kraken"]),
            makeFeed(1, "ETH/USD", ["kraken", "coinbase"]),
            makeFeed(2, "FLR/USD", ["customex"]),
          ]),
        validateConfiguration: jest.fn(),
      };

      const controller = new ConfigController(configService as any);
      const summary = controller.getFeedConfigurationSummary();

      expect(summary.totalFeeds).toBe(3);
      expect(summary.totalSources).toBe(4);
      expect(summary.feedsByCategory[1]).toBe(2);
      expect(summary.feedsByCategory[2]).toBe(1);
      expect(summary.exchangeUsage.kraken).toBe(2);
      expect(summary.exchangeUsage.coinbase).toBe(1);
      expect(summary.exchangeUsage.customex).toBe(1);
      expect(summary.hybridSummary.customAdapterExchanges).toEqual(["customex"]);
      expect(summary.hybridSummary.ccxtExchanges).toEqual(["kraken"]);
    });
  });

  it("returns adapter configuration with hybrid provider config", async () => {
    jest.doMock("@/config/environment.constants", () => ({
      ENV: {
        APPLICATION: { NODE_ENV: "test", PORT: 1234 },
        MONITORING: { ENABLED: true, METRICS_PORT: 9090 },
        LOGGING: { LOG_LEVEL: "debug", ENABLE_FILE_LOGGING: false, ENABLE_PERFORMANCE_LOGGING: false },
        CACHE: { TTL_MS: 1000, MAX_ENTRIES: 10 },
        ADAPTERS: { ACTIVE_CUSTOM_ADAPTERS: ["customex"] },
      },
    }));

    jest.doMock("@/config/exchanges.json", () => ({
      categories: {
        "1": { exchanges: ["customex", "kraken"] },
      },
    }));

    await jest.isolateModulesAsync(async () => {
      const { ConfigController } = await import("../config.controller");

      const configService = {
        getFeedConfigurations: jest.fn().mockReturnValue([]),
        validateConfiguration: jest.fn(),
      };

      const controller = new ConfigController(configService as any);
      const adapters = controller.getAdapterConfiguration();

      expect(adapters.customAdapterExchanges).toEqual(["customex"]);
      expect(adapters.ccxtExchanges).toEqual(["kraken"]);
      expect(adapters.hybridProviderConfig.customAdapterExchanges).toEqual(["customex"]);
      expect(adapters.hybridProviderConfig.ccxtExchanges).toEqual(["kraken"]);
    });
  });

  it("handles missing crypto exchanges config (returns no ccxt exchanges)", async () => {
    jest.doMock("@/config/environment.constants", () => ({
      ENV: {
        APPLICATION: { NODE_ENV: "test", PORT: 1234 },
        MONITORING: { ENABLED: true, METRICS_PORT: 9090 },
        LOGGING: { LOG_LEVEL: "debug", ENABLE_FILE_LOGGING: false, ENABLE_PERFORMANCE_LOGGING: false },
        CACHE: { TTL_MS: 1000, MAX_ENTRIES: 10 },
        ADAPTERS: { ACTIVE_CUSTOM_ADAPTERS: ["customex"] },
      },
    }));

    jest.doMock("@/config/exchanges.json", () => ({ categories: {} }));

    await jest.isolateModulesAsync(async () => {
      const { ConfigController } = await import("../config.controller");

      const configService = {
        getFeedConfigurations: jest.fn().mockReturnValue([]),
        validateConfiguration: jest.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] }),
      };

      const controller = new ConfigController(configService as any);
      const status = controller.getConfigurationStatus();

      expect(status.adapters.ccxtAdapterCount).toBe(0);
      expect(status.adapters.customAdapterCount).toBe(1);
      expect(status.adapters.totalExchanges).toBe(1);
    });
  });
});
