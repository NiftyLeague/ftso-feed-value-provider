import { Module } from "@nestjs/common";
import { FtsoProviderService } from "@/app.service";
import { FtsoProviderController } from "@/app.controller";

// Legacy data feeds (for backward compatibility)
import { CcxtFeed } from "@/data-feeds/ccxt-provider-service";
import { RandomFeed } from "@/data-feeds/random-feed";
import { BaseDataFeed } from "@/data-feeds/base-feed";
import { FixedFeed } from "@/data-feeds/fixed-feed";

// Production integration
import { IntegrationModule } from "@/integration/integration.module";
import { ProductionIntegrationService } from "@/integration/production-integration.service";

// Core modules
import { ConfigModule } from "@/config/config.module";
import { CacheModule } from "@/cache/cache.module";
import { AggregatorsModule } from "@/aggregators/aggregators.module";

// Core services
import { ApiErrorHandlerService } from "@/error-handling/api-error-handler.service";
import { RateLimiterService } from "@/middleware/rate-limiter.service";
import { RateLimitGuard } from "@/guards/rate-limit.guard";
import { ResponseTimeInterceptor } from "@/interceptors/response-time.interceptor";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";

@Module({
  imports: [
    // Core modules
    ConfigModule,
    CacheModule,
    AggregatorsModule,
    // Production integration module
    IntegrationModule,
  ],
  controllers: [FtsoProviderController],
  providers: [
    // API middleware and guards
    ApiErrorHandlerService,
    {
      provide: RateLimiterService,
      useFactory: () => {
        return new RateLimiterService({
          windowMs: 60000, // 1 minute
          maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "1000"),
          skipSuccessfulRequests: false,
          skipFailedRequests: false,
        });
      },
    },
    RateLimitGuard,
    ResponseTimeInterceptor,
    ApiMonitorService,

    // Main FTSO provider service factory
    {
      provide: "FTSO_PROVIDER_SERVICE",
      useFactory: async (
        integrationService: ProductionIntegrationService,
        cacheService: RealTimeCacheService,
        aggregationService: RealTimeAggregationService
      ) => {
        try {
          // Check if we should use production integration or legacy mode
          const useProduction = process.env.USE_PRODUCTION_INTEGRATION !== "false";

          if (useProduction) {
            // Use production integration service with injected services
            const service = new FtsoProviderService(
              null, // No legacy data feed needed
              cacheService,
              aggregationService
            );

            // Wire the integration service to the provider service
            service.setIntegrationService(integrationService);

            console.log("✅ FTSO Provider Service initialized in production mode");
            return service;
          } else {
            // Legacy mode for backward compatibility
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
            console.log("✅ FTSO Provider Service initialized in legacy mode");
            return service;
          }
        } catch (error) {
          console.error("❌ Failed to initialize FTSO Provider Service:", error);
          throw error;
        }
      },
      inject: [ProductionIntegrationService, RealTimeCacheService, RealTimeAggregationService],
    },

    // Provide the service for direct injection (for health checks)
    {
      provide: FtsoProviderService,
      useFactory: (ftsoService: FtsoProviderService) => ftsoService,
      inject: ["FTSO_PROVIDER_SERVICE"],
    },
  ],
})
export class AppModule {}
