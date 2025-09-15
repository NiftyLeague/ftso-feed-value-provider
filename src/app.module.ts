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
import { DebugService } from "@/common/debug/debug.service";
import { ConfigService } from "@/config/config.service";
import { EnvironmentUtils } from "@/common/utils/environment.utils";
import {
  createServiceFactory,
  createCustomConfigFactory,
  createAsyncProvider,
  createConditionalServiceFactory,
} from "@/common/factories/service.factory";

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
    createCustomConfigFactory(
      RateLimiterService,
      () => ({
        windowMs: 60000, // 1 minute
        maxRequests: EnvironmentUtils.parseInt("RATE_LIMIT_MAX_REQUESTS", 1000, { min: 1, max: 10000 }),
        skipSuccessfulRequests: false,
        skipFailedRequests: false,
      }),
      [ConfigService.name]
    ),
    createServiceFactory(RateLimitGuard, [RateLimiterService.name]),
    ResponseTimeInterceptor,
    ApiMonitorService,

    // Debug service - only available in development
    createConditionalServiceFactory(
      DebugService,
      (config: unknown) => (config as { nodeEnv: string }).nodeEnv === "development",
      [ConfigService.name]
    ),

    // Main FTSO provider service factory
    createAsyncProvider(
      "FTSO_PROVIDER_SERVICE",
      async (
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
      [RealTimeCacheService.name, RealTimeAggregationService.name, IntegrationService.name]
    ),

    // Provide the service for direct injection (for health checks)
    {
      provide: FtsoProviderService,
      useFactory: (ftsoService: FtsoProviderService) => ftsoService,
      inject: ["FTSO_PROVIDER_SERVICE"],
    },
  ],
})
export class AppModule {}
