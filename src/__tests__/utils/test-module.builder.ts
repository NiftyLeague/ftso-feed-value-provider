import { Test, TestingModule } from "@nestjs/testing";
import { DynamicModule, ForwardReference, Provider, Type } from "@nestjs/common";
import { ConfigService } from "@/config/config.service";
import { ConsensusAggregator } from "@/aggregators/consensus-aggregator.service";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CachePerformanceMonitorService } from "@/cache/cache-performance-monitor.service";
import { EnhancedLoggerService } from "@/common/logging/enhanced-logger.service";
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";
import { UniversalRetryService } from "@/error-handling/universal-retry.service";
import { ApiMonitorService } from "@/monitoring/api-monitor.service";
import { AlertingService } from "@/monitoring/alerting.service";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { RateLimiterService } from "@/common/rate-limiting/rate-limiter.service";
import { RateLimitGuard } from "@/common/rate-limiting/rate-limit.guard";

// Mock HTTP Exception interface for testing
interface MockHttpException extends Error {
  getStatus(): number;
  getResponse(): {
    success: boolean;
    error: {
      code: string;
      message: string;
      severity: string;
      timestamp: number;
    };
    timestamp: number;
    requestId: string;
    retryable: boolean;
    retryAfter?: number;
  };
}

/**
 * Test module builder utility to reduce boilerplate in test files
 */
export class TestModuleBuilder {
  private providers: Provider[] = [];
  private controllers: Type<unknown>[] = [];
  private imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>> = [];

  /**
   * Add a service provider with optional mock
   */
  addProvider<T>(
    token: string | symbol | Provider | Type<unknown>,
    mockImplementation?: Partial<T>
  ): TestModuleBuilder {
    if (mockImplementation) {
      this.providers.push({
        provide: token as string | symbol | Type<unknown>,
        useValue: mockImplementation,
      });
    } else {
      this.providers.push(token as Provider);
    }
    return this;
  }

  /**
   * Add a controller
   */
  addController(controller: Type<unknown>): TestModuleBuilder {
    this.controllers.push(controller);
    return this;
  }

  /**
   * Add a module import
   */
  addImport(
    module: Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference<unknown>
  ): TestModuleBuilder {
    this.imports.push(module);
    return this;
  }

  /**
   * Add common mocked services used across many tests
   */
  addCommonMocks(): TestModuleBuilder {
    const mockFtsoProviderService = {
      // Mock the integration service property to avoid "not available" error
      integrationService: {
        getCurrentPrice: jest.fn().mockResolvedValue({
          price: 50000.0,
          timestamp: Date.now(),
          sources: ["mock"],
          confidence: 0.95,
        }),
        getCurrentPrices: jest.fn().mockImplementation(feedIds => {
          return Promise.resolve(
            feedIds.map((feedId: { name: string }) => ({
              price: feedId.name === "BTC/USD" ? 50000.0 : 1.0,
              timestamp: Date.now(),
              sources: ["mock"],
              confidence: 0.95,
            }))
          );
        }),
      },

      // IFtsoProviderService methods
      getValue: async (feed: { name: string }) => {
        const result = {
          feed,
          value: feed?.name === "BTC/USD" ? 50000.0 : 3000.0,
        };
        console.log(`Mock getValue returning:`, result);
        return result;
      },
      getValues: async (feeds: Array<{ name: string }>) => {
        if (!Array.isArray(feeds)) {
          throw new Error("Invalid feeds array");
        }
        const result = feeds.map(feed => ({
          feed,
          value: feed.name === "BTC/USD" ? 50000.0 : feed.name === "ETH/USD" ? 3000.0 : 1.0,
        }));
        return result;
      },
      getVolumes: jest.fn().mockImplementation((feeds: Array<{ name: string }>, _windowSec: number) => {
        if (!Array.isArray(feeds)) {
          throw new Error("Invalid feeds array");
        }
        return Promise.resolve(
          feeds.map(feed => ({
            feed,
            volumes: [
              { exchange: "binance", volume: 1000000.0 },
              { exchange: "coinbase", volume: 500000.0 },
            ],
          }))
        );
      }),
      healthCheck: jest.fn().mockReturnValue(
        Promise.resolve({
          status: "healthy",
          timestamp: Date.now(),
          components: {
            integration: { status: "healthy" },
            cache: { status: "healthy" },
            aggregation: { status: "healthy" },
          },
        })
      ),
      getPerformanceMetrics: jest.fn().mockResolvedValue({
        uptime: 3600,
        responseTime: { average: 50, p95: 100, max: 200 },
        requestsPerSecond: 10,
        errorRate: 0,
        cacheStats: { hits: 100, misses: 10, hitRate: 0.9 },
        aggregationStats: { totalFeeds: 5, activeFeeds: 5 },
        activeFeedCount: 5,
      }),
      setIntegrationService: jest.fn().mockImplementation(function (this: { integrationService?: unknown }) {
        // Mock the integration service to avoid the "not available" error
        this.integrationService = {
          getCurrentPrice: jest.fn().mockResolvedValue({
            price: 50000.0,
            timestamp: Date.now(),
            sources: ["mock"],
            confidence: 0.95,
          }),
          getCurrentPrices: jest.fn().mockImplementation(feedIds => {
            return Promise.resolve(
              feedIds.map((feedId: { name: string }) => ({
                price: feedId.name === "BTC/USD" ? 50000.0 : 1.0,
                timestamp: Date.now(),
                sources: ["mock"],
                confidence: 0.95,
              }))
            );
          }),
          getSystemHealth: jest.fn().mockResolvedValue({
            status: "healthy",
            connections: 1,
            adapters: 1,
            cache: { hitRate: 0.9, entries: 100 },
          }),
        };
      }),
      // IBaseService methods
      getHealthStatus: jest.fn().mockReturnValue(
        Promise.resolve({
          status: "healthy",
          timestamp: Date.now(),
          ready: true,
          alive: true,
          uptime: 3600,
          components: {
            integration: { status: "healthy" },
            cache: { status: "healthy" },
            aggregation: { status: "healthy" },
          },
        })
      ),
      getServicePerformanceMetrics: jest.fn().mockResolvedValue({
        uptime: 3600,
        responseTime: { average: 50, p95: 100, max: 200 },
        requestsPerSecond: 10,
        errorRate: 0,
        timestamp: Date.now(),
        throughput: 100,
        connections: 10,
        memoryUsage: {
          heapUsed: 50000000,
          heapTotal: 100000000,
          external: 10000000,
          arrayBuffers: 1000000,
        },
      }),
      getServiceName: jest.fn().mockReturnValue("MockFtsoProviderService"),
    };

    return this.addProvider(ConfigService, {
      get: jest.fn(),
      getConfig: jest.fn(),
      getFeedConfigurations: jest.fn().mockReturnValue([]),
      getEnvironmentConfig: jest.fn().mockReturnValue({}),
    })
      .addProvider(EnhancedLoggerService, {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      })
      .addProvider(ConsensusAggregator, {
        aggregate: jest.fn(),
        validateUpdate: jest.fn(),
        getQualityMetrics: jest.fn(),
      })
      .addProvider(RealTimeCacheService, {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        clear: jest.fn(),
        getStats: jest.fn().mockReturnValue({
          hits: 0,
          misses: 0,
          hitRate: 0,
          size: 0,
          evictions: 0,
          averageGetTime: 0,
          averageSetTime: 0,
          averageResponseTime: 0,
          memoryUsage: 0,
          totalRequests: 0,
          missRate: 0,
          totalEntries: 0,
        }),
        getPrice: jest.fn().mockReturnValue(null), // Return null to force aggregation service path
        setPrice: jest.fn(),
        getForVotingRound: jest.fn().mockReturnValue(null), // Return null to force fresh data path
        setForVotingRound: jest.fn(),
        destroy: jest.fn(),
      })
      .addProvider(
        RealTimeAggregationService,
        (() => {
          const mockFn = async (_feed: { name: string }) => {
            // Return null to trigger fallback to provider service
            return null;
          };
          return {
            getAggregatedPrice: mockFn,
            addPriceUpdate: jest.fn(),
            subscribe: jest.fn(),
            getQualityMetrics: jest.fn(),
            getCacheStats: jest.fn(),
            getActiveFeedCount: jest.fn(),
            processPriceUpdate: jest.fn(),
            clearCache: jest.fn(),
          };
        })()
      )
      .addProvider(ApiMonitorService, {
        logRequest: jest.fn(),
        logResponse: jest.fn(),
        logError: jest.fn(),
        getMetrics: jest.fn(),
        recordApiRequest: jest.fn(),
        getMetricsCount: jest.fn().mockReturnValue(1000),
        getApiHealthMetrics: jest.fn().mockReturnValue({
          timestamp: Date.now(),
          totalRequests: 1000,
          requestsPerMinute: 50,
          averageResponseTime: 75,
          errorRate: 0.02,
          slowRequestRate: 0.1,
          criticalRequestRate: 0.01,
          topEndpoints: [],
          recentErrors: [],
        }),
        getAllEndpointStats: jest.fn().mockReturnValue([
          {
            endpoint: "/health",
            totalRequests: 500,
            successfulRequests: 495,
            failedRequests: 5,
            averageResponseTime: 25,
            maxResponseTime: 100,
            minResponseTime: 5,
            p95ResponseTime: 50,
            p99ResponseTime: 75,
            averageResponseSize: 512,
            errorRate: 0.01,
            lastRequest: Date.now(),
            statusCodeDistribution: { 200: 495, 400: 3, 500: 2 },
          },
          {
            endpoint: "/metrics",
            totalRequests: 300,
            successfulRequests: 290,
            failedRequests: 10,
            averageResponseTime: 45,
            maxResponseTime: 200,
            minResponseTime: 10,
            p95ResponseTime: 100,
            p99ResponseTime: 150,
            averageResponseSize: 1024,
            errorRate: 0.03,
            lastRequest: Date.now(),
            statusCodeDistribution: { 200: 290, 400: 5, 500: 5 },
          },
        ]),
        getPerformanceMetrics: jest.fn().mockReturnValue({
          requestCount: 1000,
          averageResponseTime: 75,
          errorRate: 0.02,
          throughput: 16.67,
          responseTimes: [50, 75, 100, 125],
          endpoints: [], // Add endpoints array to prevent undefined access
        }),
        getErrorAnalysis: jest.fn().mockReturnValue({
          totalErrors: 20,
          errorsByStatusCode: { 400: 10, 500: 10 },
          errorsByEndpoint: { "/health": 15, "/metrics": 5 },
          recentErrorTrends: [
            { timestamp: Date.now() - 60000, errorCount: 5 },
            { timestamp: Date.now() - 30000, errorCount: 3 },
          ],
        }),
      })
      .addProvider(StandardizedErrorHandlerService, {
        executeWithStandardizedHandling: jest.fn().mockImplementation(operation => operation()),
        handleValidationError: jest.fn(),
        handleAuthenticationError: jest.fn(),
        handleRateLimitError: jest.fn(),
        handleExternalServiceError: jest.fn(),
        getErrorStatistics: jest.fn().mockReturnValue({}),
      })
      .addProvider(UniversalRetryService, {
        executeWithRetry: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        executeHttpWithRetry: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        executeDatabaseWithRetry: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        executeCacheWithRetry: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        executeExternalApiWithRetry: jest.fn().mockImplementation(async (operation, _config) => {
          console.log("Common mock executeExternalApiWithRetry called");
          try {
            const result = await operation();
            console.log("Operation result:", result);
            return result;
          } catch (error) {
            console.log("Operation error:", error);
            throw error;
          }
        }),
        configureRetrySettings: jest.fn(),
        getRetryStatistics: jest.fn().mockReturnValue({}),
      })
      .addProvider(RateLimiterService, {
        checkRateLimit: jest.fn().mockReturnValue({
          totalHits: 1,
          totalHitsInWindow: 1,
          remainingPoints: 999,
          msBeforeNext: 0,
          isBlocked: false,
          key: "test",
          windowMs: 60000,
          maxRequests: 1000,
          remaining: 999,
        }),
        recordRequest: jest.fn().mockReturnValue({
          totalHits: 1,
          totalHitsInWindow: 1,
          remainingPoints: 999,
          msBeforeNext: 0,
          isBlocked: false,
          key: "test",
          windowMs: 60000,
          maxRequests: 1000,
          remaining: 999,
        }),
        getConfig: jest.fn().mockReturnValue({
          windowMs: 60000,
          maxRequests: 1000,
          skipSuccessfulRequests: false,
          skipFailedRequests: false,
        }),
        getRateLimitInfo: jest.fn().mockReturnValue({
          totalHits: 1,
          totalHitsInWindow: 1,
          remainingPoints: 999,
          msBeforeNext: 0,
          isBlocked: false,
          key: "test",
          windowMs: 60000,
          maxRequests: 1000,
          remaining: 999,
        }),
        updateConfig: jest.fn(),
        reset: jest.fn(),
        resetClient: jest.fn(),
        getStats: jest.fn().mockReturnValue({
          totalRequests: 1,
          allowedRequests: 1,
          blockedRequests: 0,
          hitRate: 1,
          averageResponseTime: 10,
        }),
      })
      .addProvider(CachePerformanceMonitorService, {
        recordResponseTime: jest.fn(),
        getPerformanceMetrics: jest.fn().mockReturnValue({
          timestamp: Date.now(),
          hitRate: 0.9,
          missRate: 0.1,
          totalRequests: 100,
          requestRate: 10,
          requestsPerSecond: 10,
          averageGetTime: 5,
          averageResponseTime: 5,
          memoryUsage: 1024,
          entryCount: 50,
          evictionRate: 0.01,
        }),
        getMemoryUsageHistory: jest.fn().mockReturnValue([]),
        getResponseTimePercentiles: jest.fn().mockReturnValue({
          p50: 5,
          p90: 10,
          p95: 15,
          p99: 20,
        }),
        checkPerformanceThresholds: jest.fn().mockReturnValue({
          hitRateOk: true,
          responseTimeOk: true,
          memoryUsageOk: true,
          overallHealthy: true,
        }),
        generatePerformanceReport: jest.fn().mockReturnValue("Cache Performance Report"),
        triggerCollection: jest.fn(),
        destroy: jest.fn(),
      })
      .addProvider(AlertingService, {
        evaluateMetric: jest.fn(),
        sendAlert: jest.fn().mockResolvedValue(undefined),
        testAlertDelivery: jest.fn().mockResolvedValue(undefined),
        getAllAlerts: jest.fn().mockReturnValue([]),
        getActiveAlerts: jest.fn().mockReturnValue([]),
        getAlertsBySeverity: jest.fn().mockReturnValue([]),
        getAlertStats: jest.fn().mockReturnValue({
          total: 0,
          active: 0,
          bySeverity: {},
        }),
      })

      .addProvider({
        provide: "FTSO_PROVIDER_SERVICE",
        useValue: mockFtsoProviderService,
      })
      .addProvider("StandardizedErrorHandlerService", {
        executeWithStandardizedHandling: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        createStandardizedError: jest.fn().mockImplementation((error, _metadata, requestId) => {
          const httpException = new Error(error.message) as MockHttpException;
          httpException.getStatus = () => 500;
          httpException.getResponse = () => ({
            success: false,
            error: {
              code: "INTERNAL_ERROR",
              message: error.message,
              severity: "high",
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
            requestId: requestId || "test-request-id",
            retryable: true,
          });
          return httpException;
        }),
        handleValidationError: jest.fn().mockImplementation((message, _details, requestId) => {
          const httpException = new Error(message) as MockHttpException;
          httpException.getStatus = () => 400;
          httpException.getResponse = () => ({
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message,
              severity: "medium",
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
            requestId: requestId || "test-request-id",
            retryable: false,
          });
          return httpException;
        }),
        handleAuthenticationError: jest.fn().mockImplementation((message, requestId) => {
          const httpException = new Error(message) as MockHttpException;
          httpException.getStatus = () => 401;
          httpException.getResponse = () => ({
            success: false,
            error: {
              code: "AUTHENTICATION_ERROR",
              message,
              severity: "high",
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
            requestId: requestId || "test-request-id",
            retryable: false,
          });
          return httpException;
        }),
        handleRateLimitError: jest.fn().mockImplementation((requestId, retryAfter) => {
          const httpException = new Error("Rate limit exceeded") as MockHttpException;
          httpException.getStatus = () => 429;
          httpException.getResponse = () => ({
            success: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Rate limit exceeded",
              severity: "medium",
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
            requestId: requestId || "test-request-id",
            retryable: true,
            retryAfter: retryAfter || 60000,
          });
          return httpException;
        }),
        handleExternalServiceError: jest.fn().mockImplementation((serviceName, _originalError, requestId) => {
          const httpException = new Error(`External service error: ${serviceName}`) as MockHttpException;
          httpException.getStatus = () => 502;
          httpException.getResponse = () => ({
            success: false,
            error: {
              code: "EXTERNAL_SERVICE_ERROR",
              message: `External service error: ${serviceName}`,
              severity: "high",
              timestamp: Date.now(),
            },
            timestamp: Date.now(),
            requestId: requestId || "test-request-id",
            retryable: true,
          });
          return httpException;
        }),
        getErrorStatistics: jest.fn().mockReturnValue({}),
        resetErrorStatistics: jest.fn(),
        configureRetrySettings: jest.fn(),
      })
      .addProvider("UniversalRetryService", {
        executeWithRetry: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        executeHttpWithRetry: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        executeDatabaseWithRetry: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        executeCacheWithRetry: jest.fn().mockImplementation(async operation => {
          return await operation();
        }),
        executeExternalApiWithRetry: jest.fn().mockImplementation(async (operation, config) => {
          console.log("String token mock executeExternalApiWithRetry called with:", {
            operation: typeof operation,
            config,
          });
          try {
            const result = await operation();
            console.log("String token mock executeExternalApiWithRetry operation result:", result);
            return result;
          } catch (error) {
            console.log("String token mock executeExternalApiWithRetry operation error:", error);
            throw error;
          }
        }),
        configureRetrySettings: jest.fn(),
        getRetryStatistics: jest.fn().mockReturnValue({}),
        resetRetryStatistics: jest.fn(),
        getRetryConfiguration: jest.fn().mockReturnValue({
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 30000,
          backoffMultiplier: 2,
          jitter: true,
          retryableErrors: ["timeout", "connection", "network"],
        }),
        isRetryableError: jest.fn().mockReturnValue(true),
      });
  }

  /**
   * Build the testing module
   */
  async build(): Promise<TestingModule> {
    return (
      Test.createTestingModule({
        controllers: this.controllers,
        providers: this.providers,
        imports: this.imports,
      })
        // Bypass rate limiting in tests globally for modules built with this builder
        .overrideGuard(RateLimitGuard)
        .useValue({ canActivate: () => true })
        .compile()
    );
  }
}

/**
 * Factory function for creating test modules
 */
export function createTestModule(): TestModuleBuilder {
  return new TestModuleBuilder();
}
