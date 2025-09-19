import { Module, OnModuleDestroy } from "@nestjs/common";
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
import { DebugService } from "@/common/debug/debug.service";
import { ENV, ENV_HELPERS } from "@/common/constants";

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
      useFactory: () => {
        return new RateLimiterService({
          windowMs: ENV.RATE_LIMITING.WINDOW_MS,
          maxRequests: ENV.RATE_LIMITING.MAX_REQUESTS,
          skipSuccessfulRequests: false,
          skipFailedRequests: false,
        });
      },
      inject: [],
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

    // Debug service - only available in development
    {
      provide: DebugService,
      useFactory: () => {
        if (ENV_HELPERS.isDevelopment()) {
          return new DebugService();
        }
        return null;
      },
      inject: [],
    },

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

          // Service initialized successfully
          return service;
        } catch (error) {
          // Log error through proper logging service instead of console
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
export class AppModule implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    // This method will be called when the application is shutting down
    // Individual services that implement OnModuleDestroy will be called automatically
    // by NestJS, but we can add any module-level cleanup here if needed
    console.log("AppModule: Shutting down...");
  }
}
