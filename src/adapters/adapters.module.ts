import { Module } from "@nestjs/common";
import { ExchangeAdapterRegistry } from "./base/exchange-adapter.registry";
import { hasCustomAdapter, getAllFeedConfigurations } from "@/common/utils";
import { ENV } from "@/config/environment.constants";
import { ExchangeId } from "@/common/types/adapters";

// Import all crypto adapters
import { BinanceAdapter } from "./crypto/binance.adapter";
import { CoinbaseAdapter } from "./crypto/coinbase.adapter";
import { KrakenAdapter } from "./crypto/kraken.adapter";
import { OkxAdapter } from "./crypto/okx.adapter";
import { CryptocomAdapter } from "./crypto/cryptocom.adapter";
import { CcxtMultiExchangeAdapter } from "./crypto/ccxt.adapter";

@Module({
  imports: [],
  providers: [
    // Crypto adapters
    BinanceAdapter,
    CoinbaseAdapter,
    KrakenAdapter,
    OkxAdapter,
    CryptocomAdapter,
    {
      provide: CcxtMultiExchangeAdapter,
      useFactory: () => {
        return new CcxtMultiExchangeAdapter(undefined, {
          hasCustomAdapter: (exchange: string) => hasCustomAdapter(exchange),
          getCcxtExchangesFromFeeds: () => {
            const allFeeds = getAllFeedConfigurations();
            const exchanges = new Set<string>();
            allFeeds.forEach(feed => {
              feed.sources.forEach(source => {
                exchanges.add(source.exchange);
              });
            });
            const allExchanges = Array.from(exchanges);
            const customAdapterExchanges = ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS;
            return allExchanges.filter(exchange => !customAdapterExchanges.includes(exchange as ExchangeId));
          },
          getFeedConfigurations: () => getAllFeedConfigurations(),
        });
      },
      scope: 1, // Make it a singleton
    },

    // Adapter initialization - this factory ensures all adapters are registered
    {
      provide: ExchangeAdapterRegistry,
      useFactory: (
        binance: BinanceAdapter,
        coinbase: CoinbaseAdapter,
        kraken: KrakenAdapter,
        okx: OkxAdapter,
        cryptocom: CryptocomAdapter,
        ccxt: CcxtMultiExchangeAdapter
      ) => {
        const registry = new ExchangeAdapterRegistry();

        // Register all adapters
        if (ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS.includes(ExchangeId.Binance)) {
          registry.register(ExchangeId.Binance, binance);
        }
        if (ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS.includes(ExchangeId.Coinbase)) {
          registry.register(ExchangeId.Coinbase, coinbase);
        }
        if (ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS.includes(ExchangeId.Kraken)) {
          registry.register(ExchangeId.Kraken, kraken);
        }
        if (ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS.includes(ExchangeId.Okx)) {
          registry.register(ExchangeId.Okx, okx);
        }
        if (ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS.includes(ExchangeId.Cryptocom)) {
          registry.register(ExchangeId.Cryptocom, cryptocom);
        }
        registry.register(ExchangeId.CcxtMultiExchange, ccxt);

        return registry;
      },
      inject: [BinanceAdapter, CoinbaseAdapter, KrakenAdapter, OkxAdapter, CryptocomAdapter, CcxtMultiExchangeAdapter],
    },
  ],
  exports: [
    ExchangeAdapterRegistry,
    BinanceAdapter,
    CoinbaseAdapter,
    KrakenAdapter,
    OkxAdapter,
    CryptocomAdapter,
    CcxtMultiExchangeAdapter,
  ],
})
export class AdaptersModule {}
