import { MODULE_METADATA } from "@nestjs/common/constants";

import { ExchangeId } from "@/common/types/adapters";

describe("AdaptersModule provider factories", () => {
  const loadIsolated = async (activeCustomAdapters: ExchangeId[], feeds: any[]) => {
    jest.resetModules();

    jest.doMock("@/config/environment.constants", () => ({
      ENV: {
        ADAPTERS: {
          ACTIVE_CUSTOM_ADAPTERS: activeCustomAdapters,
        },
      },
    }));

    jest.doMock("@/common/utils", () => ({
      hasCustomAdapter: (exchange: string) => exchange === "custom",
      getAllFeedConfigurations: () => feeds,
    }));

    class MockCcxtMultiExchangeAdapter {
      // Expose captured callbacks so the test can execute the module-defined logic
      options: any;

      constructor(_unused?: unknown, options?: unknown) {
        this.options = options;
      }
    }

    jest.doMock("../crypto/ccxt.adapter", () => ({
      CcxtMultiExchangeAdapter: MockCcxtMultiExchangeAdapter,
    }));

    const mod = await import("../adapters.module");
    const ccxtMod = await import("../crypto/ccxt.adapter");
    const registryMod = await import("../base/exchange-adapter.registry");

    return {
      AdaptersModule: mod.AdaptersModule,
      CcxtMultiExchangeAdapter: ccxtMod.CcxtMultiExchangeAdapter,
      ExchangeAdapterRegistry: registryMod.ExchangeAdapterRegistry,
    };
  };

  it("should compute CCXT exchange list excluding active custom adapters", async () => {
    const feeds = [
      {
        sources: [
          { exchange: ExchangeId.Binance },
          { exchange: ExchangeId.Kraken },
          { exchange: ExchangeId.CcxtMultiExchange },
        ],
      },
    ];

    const { AdaptersModule, CcxtMultiExchangeAdapter } = await loadIsolated(
      [ExchangeId.Binance, ExchangeId.Kraken],
      feeds
    );

    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AdaptersModule) as any[];
    const ccxtProvider = providers.find(p => p && p.provide === CcxtMultiExchangeAdapter);

    expect(ccxtProvider).toBeDefined();
    const instance = ccxtProvider.useFactory();

    const exchanges = instance.options.getCcxtExchangesFromFeeds();
    expect(exchanges).toEqual([ExchangeId.CcxtMultiExchange]);

    expect(instance.options.hasCustomAdapter("custom")).toBe(true);
    expect(instance.options.hasCustomAdapter("binance")).toBe(false);
  });

  it("should register only enabled custom adapters plus CCXT", async () => {
    const { AdaptersModule, CcxtMultiExchangeAdapter, ExchangeAdapterRegistry } = await loadIsolated(
      [ExchangeId.Binance, ExchangeId.Coinbase],
      []
    );

    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AdaptersModule) as any[];
    const ccxtProvider = providers.find(p => p && p.provide === CcxtMultiExchangeAdapter);
    const registryProvider = providers.find(p => p && p.provide === ExchangeAdapterRegistry);

    expect(ccxtProvider).toBeDefined();
    expect(registryProvider).toBeDefined();

    const ccxtInstance = ccxtProvider.useFactory();

    const makeAdapter = (name: string) =>
      ({
        exchangeName: name,
        category: 1,
        capabilities: {
          supportsWebSocket: false,
          supportsREST: true,
          supportsVolume: false,
          supportedCategories: [1],
        },
        validateSymbol: () => true,
      }) as any;

    const registry = registryProvider.useFactory(
      makeAdapter("binance"),
      makeAdapter("coinbase"),
      makeAdapter("kraken"),
      makeAdapter("okx"),
      makeAdapter("cryptocom"),
      ccxtInstance
    ) as InstanceType<typeof ExchangeAdapterRegistry>;

    expect(registry.has(ExchangeId.Binance)).toBe(true);
    expect(registry.has(ExchangeId.Coinbase)).toBe(true);
    expect(registry.has(ExchangeId.Kraken)).toBe(false);
    expect(registry.has(ExchangeId.Okx)).toBe(false);
    expect(registry.has(ExchangeId.Cryptocom)).toBe(false);
    expect(registry.has(ExchangeId.CcxtMultiExchange)).toBe(true);
  });
});
