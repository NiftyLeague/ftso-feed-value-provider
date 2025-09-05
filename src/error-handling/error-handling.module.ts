import { Module, Global } from "@nestjs/common";
import { StandardizedErrorHandlerService } from "./standardized-error-handler.service";
import { UniversalRetryService } from "./universal-retry.service";
import { CircuitBreakerService } from "./circuit-breaker.service";
import { ConnectionRecoveryService } from "./connection-recovery.service";

/**
 * Global error handling module that provides standardized error handling,
 * retry mechanisms, and circuit breaker patterns across the entire application
 */
@Global()
@Module({
  providers: [
    // Core error handling services
    StandardizedErrorHandlerService,
    UniversalRetryService,
    CircuitBreakerService,
    ConnectionRecoveryService,
  ],
  exports: [
    // Core services
    StandardizedErrorHandlerService,
    UniversalRetryService,
    CircuitBreakerService,
    ConnectionRecoveryService,
  ],
})
export class ErrorHandlingModule {
  constructor(
    private readonly standardizedErrorHandler: StandardizedErrorHandlerService,
    private readonly universalRetryService: UniversalRetryService,
    private readonly circuitBreaker: CircuitBreakerService
  ) {
    this.initializeErrorHandling();
  }

  private initializeErrorHandling(): void {
    // Configure default retry settings for common services
    this.configureDefaultRetrySettings();

    // Register default circuit breakers
    this.registerDefaultCircuitBreakers();

    // Set up error monitoring
    this.setupErrorMonitoring();
  }

  private configureDefaultRetrySettings(): void {
    // Configure retry settings for different service types
    const retryConfigs = [
      {
        serviceId: "FeedController",
        config: {
          maxRetries: 3,
          initialDelayMs: 1000,
          maxDelayMs: 15000,
          retryableErrors: [
            "timeout",
            "connection",
            "network",
            "rate limit",
            "service unavailable",
            "data source unavailable",
          ],
        },
      },
      {
        serviceId: "HealthController",
        config: {
          maxRetries: 2,
          initialDelayMs: 500,
          maxDelayMs: 5000,
        },
      },
      {
        serviceId: "MetricsController",
        config: {
          maxRetries: 1,
          initialDelayMs: 1000,
          maxDelayMs: 3000,
        },
      },
      {
        serviceId: "ExchangeAdapter",
        config: {
          maxRetries: 5,
          initialDelayMs: 2000,
          maxDelayMs: 30000,
          retryableErrors: ["timeout", "connection", "network", "rate limit", "exchange unavailable", "api error"],
        },
      },
      {
        serviceId: "AggregationService",
        config: {
          maxRetries: 2,
          initialDelayMs: 500,
          maxDelayMs: 5000,
        },
      },
      {
        serviceId: "CacheService",
        config: {
          maxRetries: 1,
          initialDelayMs: 100,
          maxDelayMs: 1000,
        },
      },
    ];

    retryConfigs.forEach(({ serviceId, config }) => {
      this.universalRetryService.configureRetrySettings(serviceId, config);
    });
  }

  private registerDefaultCircuitBreakers(): void {
    // Register circuit breakers for critical services
    const circuitBreakerConfigs = [
      {
        serviceId: "FeedController",
        config: {
          failureThreshold: 5,
          recoveryTimeout: 60000,
          successThreshold: 3,
          timeout: 10000,
          monitoringWindow: 300000,
        },
      },
      {
        serviceId: "ExchangeAdapter:Binance",
        config: {
          failureThreshold: 3,
          recoveryTimeout: 120000,
          successThreshold: 2,
          timeout: 15000,
          monitoringWindow: 300000,
        },
      },
      {
        serviceId: "ExchangeAdapter:Coinbase",
        config: {
          failureThreshold: 3,
          recoveryTimeout: 120000,
          successThreshold: 2,
          timeout: 15000,
          monitoringWindow: 300000,
        },
      },
      {
        serviceId: "ExchangeAdapter:Kraken",
        config: {
          failureThreshold: 3,
          recoveryTimeout: 120000,
          successThreshold: 2,
          timeout: 15000,
          monitoringWindow: 300000,
        },
      },
      {
        serviceId: "ExchangeAdapter:OKX",
        config: {
          failureThreshold: 3,
          recoveryTimeout: 120000,
          successThreshold: 2,
          timeout: 15000,
          monitoringWindow: 300000,
        },
      },
      {
        serviceId: "ExchangeAdapter:CryptoCom",
        config: {
          failureThreshold: 3,
          recoveryTimeout: 120000,
          successThreshold: 2,
          timeout: 15000,
          monitoringWindow: 300000,
        },
      },
      {
        serviceId: "AggregationService",
        config: {
          failureThreshold: 5,
          recoveryTimeout: 30000,
          successThreshold: 3,
          timeout: 5000,
          monitoringWindow: 300000,
        },
      },
      {
        serviceId: "CacheService",
        config: {
          failureThreshold: 10,
          recoveryTimeout: 15000,
          successThreshold: 5,
          timeout: 3000,
          monitoringWindow: 300000,
        },
      },
    ];

    circuitBreakerConfigs.forEach(({ serviceId, config }) => {
      this.circuitBreaker.registerCircuit(serviceId, config);
    });
  }

  private setupErrorMonitoring(): void {
    // Set up event listeners for error monitoring
    this.standardizedErrorHandler.on("standardizedError", errorEvent => {
      // Log critical errors for monitoring
      if (errorEvent.metadata?.severity === "critical") {
        console.error("CRITICAL ERROR DETECTED:", {
          component: errorEvent.metadata.component,
          operation: errorEvent.metadata.operation,
          error: errorEvent.error.message,
          timestamp: errorEvent.timestamp,
          requestId: errorEvent.response.requestId,
        });
      }
    });

    this.universalRetryService.on("retryFailure", retryEvent => {
      // Log retry failures for monitoring
      if (retryEvent.attemptCount >= 3) {
        console.warn("RETRY EXHAUSTED:", {
          serviceId: retryEvent.serviceId,
          operation: retryEvent.operationName,
          attempts: retryEvent.attemptCount,
          error: retryEvent.error,
          timestamp: retryEvent.timestamp,
        });
      }
    });

    this.circuitBreaker.on("circuitOpened", serviceId => {
      // Log circuit breaker openings for monitoring
      console.error("CIRCUIT BREAKER OPENED:", {
        serviceId,
        timestamp: Date.now(),
        stats: this.circuitBreaker.getStats(serviceId),
      });
    });

    this.circuitBreaker.on("circuitClosed", serviceId => {
      // Log circuit breaker recoveries for monitoring
      console.info("CIRCUIT BREAKER RECOVERED:", {
        serviceId,
        timestamp: Date.now(),
        stats: this.circuitBreaker.getStats(serviceId),
      });
    });
  }
}
