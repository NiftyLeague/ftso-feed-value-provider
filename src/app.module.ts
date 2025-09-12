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
import { AdaptersModule } from "@/adapters/adapters.module";
import { ErrorHandlingModule } from "@/error-handling/error-handling.module";

// Core services
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";
import { ResponseTimeInterceptor } from "@/common/interceptors/response-time.interceptor";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";
import { ConfigService } from "@/config/config.service";

@Module({
  imports: [
    // Core modules
    ConfigModule,
    CacheModule,
    AggregatorsModule,
    AdaptersModule,
    IntegrationModule,
    ErrorHandlingModule, // Global error handling with standardized patterns
  ],
  controllers: [FeedController, HealthController, MetricsController],
  providers: [
    // API middleware and guards
    StandardizedErrorHandlerService,
    {
      provide: RateLimiterService,
      useFactory: (_configService: ConfigService) => {
        return new RateLimiterService({
          windowMs: 60000, // 1 minute
          maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "1000", 10),
          skipSuccessfulRequests: false,
          skipFailedRequests: false,
        });
      },
      inject: [ConfigService],
    },
    {
      provide: RateLimitGuard,
      useFactory: (rateLimiterService: RateLimiterService) => {
        return new RateLimitGuard(rateLimiterService);
      },
      inject: [RateLimiterService],
    },
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
