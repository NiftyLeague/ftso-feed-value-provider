import { Module } from "@nestjs/common";
import { FtsoProviderService } from "@/app.service";
import { FtsoProviderController } from "@/app.controller";

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
    // Always use production integration
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
        cacheService: RealTimeCacheService,
        aggregationService: RealTimeAggregationService,
        integrationService: ProductionIntegrationService
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
      inject: [RealTimeCacheService, RealTimeAggregationService, ProductionIntegrationService],
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
