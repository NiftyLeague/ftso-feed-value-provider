import { Module } from "@nestjs/common";
import { FtsoProviderService } from "@/app.service";
import { FtsoProviderController } from "@/app.controller";
import { CcxtFeed } from "@/data-feeds/ccxt-provider-service";
import { RandomFeed } from "@/data-feeds/random-feed";
import { BaseDataFeed } from "@/data-feeds/base-feed";
import { FixedFeed } from "@/data-feeds/fixed-feed";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ConsensusAggregator } from "@/aggregators/consensus-aggregator";
import { ApiErrorHandlerService } from "@/error-handling/api-error-handler.service";
import { RateLimiterService } from "@/middleware/rate-limiter.service";
import { RateLimitGuard } from "@/guards/rate-limit.guard";
import { ResponseTimeInterceptor } from "@/interceptors/response-time.interceptor";

@Module({
  imports: [],
  controllers: [FtsoProviderController],
  providers: [
    // Core services
    RealTimeCacheService,
    ConsensusAggregator,
    RealTimeAggregationService,
    ApiErrorHandlerService,
    RateLimiterService,
    RateLimitGuard,
    ResponseTimeInterceptor,
    {
      provide: "FTSO_PROVIDER_SERVICE",
      useFactory: async (cacheService: RealTimeCacheService, aggregationService: RealTimeAggregationService) => {
        let dataFeed: BaseDataFeed;

        if (process.env.VALUE_PROVIDER_IMPL == "fixed") {
          dataFeed = new FixedFeed();
        } else if (process.env.VALUE_PROVIDER_IMPL == "random") {
          dataFeed = new RandomFeed();
        } else {
          const ccxtFeed = new CcxtFeed();
          await ccxtFeed.start();
          dataFeed = ccxtFeed;
        }

        const service = new FtsoProviderService(dataFeed, cacheService, aggregationService);
        return service;
      },
      inject: [RealTimeCacheService, RealTimeAggregationService],
    },
  ],
})
export class AppModule {}
