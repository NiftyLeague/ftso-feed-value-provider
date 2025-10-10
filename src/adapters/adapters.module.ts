import { Module } from "@nestjs/common";
import { ExchangeAdapterRegistry } from "./base/exchange-adapter.registry";
import { hasCustomAdapter, getAllFeedConfigurations } from "@/common/utils";

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
            const customAdapterExchanges = ["binance", "coinbase", "cryptocom", "kraken", "okx"];
            return allExchanges.filter(exchange => !customAdapterExchanges.includes(exchange));
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
        registry.register("binance", binance);
        registry.register("coinbase", coinbase);
        registry.register("kraken", kraken);
        registry.register("okx", okx);
        registry.register("cryptocom", cryptocom);
        registry.register("ccxt-multi-exchange", ccxt);

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
