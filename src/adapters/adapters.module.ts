import { Module } from "@nestjs/common";
import { ExchangeAdapterRegistry } from "./base/exchange-adapter.registry";
import { ConfigService } from "@/config/config.service";
import { ConfigModule } from "@/config/config.module";

// Import all crypto adapters
import { BinanceAdapter } from "./crypto/binance.adapter";
import { CoinbaseAdapter } from "./crypto/coinbase.adapter";
import { KrakenAdapter } from "./crypto/kraken.adapter";
import { OkxAdapter } from "./crypto/okx.adapter";
import { CryptocomAdapter } from "./crypto/cryptocom.adapter";
import { CcxtMultiExchangeAdapter } from "./crypto/ccxt.adapter";

@Module({
  imports: [ConfigModule],
  providers: [
    // Crypto adapters
    BinanceAdapter,
    CoinbaseAdapter,
    KrakenAdapter,
    OkxAdapter,
    CryptocomAdapter,
    {
      provide: CcxtMultiExchangeAdapter,
      useFactory: (configService: ConfigService) => {
        return new CcxtMultiExchangeAdapter(undefined, {
          hasCustomAdapter: (exchange: string) => configService.hasCustomAdapter(exchange),
          getCcxtExchangesFromFeeds: () => configService.getCcxtExchangesFromFeeds(),
          getFeedConfigurations: () => configService.getFeedConfigurations(),
        });
      },
      inject: [ConfigService],
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
