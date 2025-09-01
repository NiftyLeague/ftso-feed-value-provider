import { Module } from "@nestjs/common";
import { FtsoProviderService } from "@/app.service";

// App controllers
import { FeedController } from "@/controllers/feed.controller";
import { HealthController } from "@/controllers/health.controller";
import { MetricsController } from "@/controllers/metrics.controller";

// Production integration
import { IntegrationModule } from "@/integration/integration.module";
import { IntegrationService } from "@/integration/integration.service";

// Core modules
import { ConfigModule } from "@/config/config.module";
import { CacheModule } from "@/cache/cache.module";
import { AggregatorsModule } from "@/aggregators/aggregators.module";

// Core services
import { ApiErrorHandlerService } from "@/error-handling/api-error-handler.service";
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { ResponseTimeInterceptor } from "@/common/interceptors/response-time.interceptor";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";

@Module({
  imports: [
    // Core modules
    ConfigModule,
    CacheModule,
    AggregatorsModule,
    // Always use production integration
    IntegrationModule,
  ],
  controllers: [FeedController, HealthController, MetricsController],
  providers: [
    // API middleware and guards
    ApiErrorHandlerService,
    {
      provide: RateLimiterService,
      useFactory: () => {
        return new RateLimiterService({
          windowMs: 60000, // 1 minute
          maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "1000", 10),
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
        cacheService: RealTimeCacheService,
        aggregationService: RealTimeAggregationService,
        integrationService: IntegrationService
      ) => {
        try {
          // Always use production integration service
          const service = new FtsoProviderService(cacheService, aggregationService);

          // Wire the integration service to the provider service
          service.setIntegrationService(integrationService);

          console.log("✅ FTSO Provider Service initialized in production mode");
          return service;
        } catch (error) {
          console.error("❌ Failed to initialize FTSO Provider Service:", error);
          throw error;
        }
      },
      inject: [RealTimeCacheService, RealTimeAggregationService, IntegrationService],
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
