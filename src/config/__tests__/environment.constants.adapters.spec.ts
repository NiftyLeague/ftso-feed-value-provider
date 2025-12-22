import { ExchangeId } from "@/common/types/adapters";

describe("environment.constants adapter parsing", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should parse DISABLED_CUSTOM_ADAPTERS and compute ACTIVE_CUSTOM_ADAPTERS", async () => {
    process.env.NODE_ENV = "development";
    process.env.DISABLED_CUSTOM_ADAPTERS = "binance,NOT_REAL,KrAkEn";
    process.env.DISABLED_CCXT_EXCHANGES = "binance,Bitget,,  mexc  ";

    const { ENV, ENV_HELPERS } = await import("../environment.constants");

    expect(ENV_HELPERS.isDevelopment()).toBe(true);
    expect(ENV_HELPERS.isProduction()).toBe(false);

    expect(ENV.ADAPTERS.DISABLED_CUSTOM_ADAPTERS).toEqual(
      expect.arrayContaining([ExchangeId.Binance, ExchangeId.Kraken])
    );
    expect(ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS).not.toContain(ExchangeId.Binance);
    expect(ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS).not.toContain(ExchangeId.Kraken);

    expect(ENV.ADAPTERS.DISABLED_CCXT_EXCHANGES).toEqual(expect.arrayContaining(["binance", "bitget", "mexc"]));
  });

  it("should support ENV_HELPERS.isTest", async () => {
    process.env.NODE_ENV = "test";

    const { ENV_HELPERS } = await import("../environment.constants");

    expect(ENV_HELPERS.isTest()).toBe(true);
    expect(ENV_HELPERS.isDevelopment()).toBe(false);
  });
});
