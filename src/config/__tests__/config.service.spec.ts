import { ExchangeId } from "@/common/types/adapters";
import { FeedCategory, type FeedConfiguration } from "@/common/types/core";

const mockFeeds: FeedConfiguration[] = [
  {
    feed: { category: FeedCategory.Crypto, name: "BTC/USD" },
    sources: [
      { exchange: ExchangeId.Binance, symbol: "BTC/USDT" },
      { exchange: ExchangeId.Coinbase, symbol: "BTC-USD" },
    ],
  },
  {
    feed: { category: FeedCategory.Crypto, name: "ETH/USD" },
    sources: [{ exchange: ExchangeId.Kraken, symbol: "ETH/USD" }],
  },
];

const getAllFeedConfigurations = jest.fn((..._args: unknown[]) => mockFeeds);
const getFeedConfiguration = jest.fn((feedId: { category: number; name: string }, ..._args: unknown[]) =>
  mockFeeds.find(f => f.feed.category === feedId.category && f.feed.name === feedId.name)
);
const hasCustomAdapter = jest.fn((exchange: string, ..._args: unknown[]) => exchange === "binance");
const reloadFeedConfigurations = jest.fn((..._args: unknown[]) => undefined);

describe("ConfigService", () => {
  const getConfigService = async (envOverrides?: {
    port?: number;
    emailEnabled?: boolean;
    smtpHost?: string;
    webhookEnabled?: boolean;
    webhookUrl?: string;
  }) => {
    // Ensure this suite always sees the mocked @/common/utils, even if another
    // test imported ConfigService earlier in the worker.
    jest.resetModules();

    if (envOverrides) {
      jest.doMock("../environment.constants", () => {
        const actual = jest.requireActual("../environment.constants") as typeof import("../environment.constants");
        const ENV = {
          ...actual.ENV,
          APPLICATION: {
            ...actual.ENV.APPLICATION,
            PORT: envOverrides.port ?? actual.ENV.APPLICATION.PORT,
          },
          ALERTING: {
            ...actual.ENV.ALERTING,
            EMAIL: {
              ...actual.ENV.ALERTING.EMAIL,
              ENABLED: envOverrides.emailEnabled ?? actual.ENV.ALERTING.EMAIL.ENABLED,
              SMTP_HOST: envOverrides.smtpHost ?? actual.ENV.ALERTING.EMAIL.SMTP_HOST,
            },
            WEBHOOK: {
              ...actual.ENV.ALERTING.WEBHOOK,
              ENABLED: envOverrides.webhookEnabled ?? actual.ENV.ALERTING.WEBHOOK.ENABLED,
              URL: envOverrides.webhookUrl ?? actual.ENV.ALERTING.WEBHOOK.URL,
            },
          },
        };

        return {
          ...actual,
          ENV,
        };
      });
    }

    jest.doMock("@/common/utils", () => ({
      getAllFeedConfigurations: () => getAllFeedConfigurations(),
      getFeedConfiguration: (feedId: unknown) => getFeedConfiguration(feedId as any),
      hasCustomAdapter: (exchange: unknown) => hasCustomAdapter(exchange as any),
      reloadFeedConfigurations: () => reloadFeedConfigurations(),
    }));

    return import("@/config/config.service");
  };

  beforeEach(() => {
    // Jest is configured with resetMocks=true; restore default implementations
    // for our jest.fn utilities each test.
    getAllFeedConfigurations.mockImplementation(() => mockFeeds);
    getFeedConfiguration.mockImplementation((feedId: { category: number; name: string }) =>
      mockFeeds.find(f => f.feed.category === feedId.category && f.feed.name === feedId.name)
    );
    hasCustomAdapter.mockImplementation((exchange: string) => exchange === "binance");
    reloadFeedConfigurations.mockImplementation(() => undefined);
  });

  it("returns feed configurations", async () => {
    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    expect(service.getFeedConfigurations()).toEqual(mockFeeds);
    expect(getAllFeedConfigurations).toHaveBeenCalled();
  });

  it("returns a single feed configuration", async () => {
    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    const cfg = service.getFeedConfiguration({ category: FeedCategory.Crypto, name: "BTC/USD" });
    expect(cfg?.feed.name).toBe("BTC/USD");
    expect(getFeedConfiguration).toHaveBeenCalled();
  });

  it("computes feeds count", async () => {
    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    expect(service.getFeedsCount()).toBe(2);
  });

  it("returns fallback feeds count when loading fails", async () => {
    getAllFeedConfigurations.mockImplementation(() => {
      throw new Error("boom");
    });

    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    expect(service.getFeedsCountWithFallback(123)).toBe(123);
  });

  it("returns all feed symbols", async () => {
    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    expect(service.getAllFeedSymbols()).toEqual(["BTC/USD", "ETH/USD"]);
  });

  it("throws a descriptive error when symbols cannot be loaded", async () => {
    getAllFeedConfigurations.mockImplementation(() => {
      throw new Error("boom");
    });

    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    expect(() => service.getAllFeedSymbols()).toThrow(/Failed to get feed symbols/i);
  });

  it("delegates hasCustomAdapter", async () => {
    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    expect(service.hasCustomAdapter("binance")).toBe(true);
    expect(service.hasCustomAdapter("kraken")).toBe(false);
  });

  it("maps adapter classes and CCXT ids", async () => {
    const { ConfigService } = await getConfigService();
    const service = new ConfigService();

    expect(service.getAdapterClass("binance")).toBe("BinanceAdapter");
    expect(service.getAdapterClass("unknown")).toBeUndefined();

    // Custom adapters return undefined CCXT ID
    expect(service.getCcxtId(ExchangeId.Binance)).toBeUndefined();

    // Non-custom adapters pass through
    expect(service.getCcxtId("bitfinex")).toBe("bitfinex");
  });

  it("reloads feed configuration", async () => {
    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    service.reloadFeedConfigurations();
    expect(reloadFeedConfigurations).toHaveBeenCalledTimes(1);
  });

  it("returns service name", async () => {
    const { ConfigService } = await getConfigService();
    const service = new ConfigService();
    expect(service.getServiceName()).toBe("ConfigService");
  });

  it("validateConfiguration reports invalid port", async () => {
    const { ConfigService } = await getConfigService({ port: 0 });
    const service = new ConfigService();

    const validation = service.validateConfiguration();
    expect(validation.isValid).toBe(false);
    expect(validation.errors).toEqual(expect.arrayContaining([expect.stringMatching(/Invalid port/i)]));
  });

  it("validateConfiguration reports missing SMTP host when email alerting enabled", async () => {
    const { ConfigService } = await getConfigService({ emailEnabled: true, smtpHost: "" });
    const service = new ConfigService();

    const validation = service.validateConfiguration();
    expect(validation.isValid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/Email alerting enabled but SMTP host not configured/i)])
    );
  });

  it("validateConfiguration reports missing webhook URL when webhook alerting enabled", async () => {
    const { ConfigService } = await getConfigService({ webhookEnabled: true, webhookUrl: "" });
    const service = new ConfigService();

    const validation = service.validateConfiguration();
    expect(validation.isValid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/Webhook alerting enabled but URL not configured/i)])
    );
  });
});
