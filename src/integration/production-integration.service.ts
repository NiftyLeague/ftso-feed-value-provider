import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { EventEmitter } from "events";
import { EnhancedLoggerService, LogContext } from "@/utils/enhanced-logger.service";

// Core components
import { ProductionDataManagerService } from "@/data-manager/production-data-manager";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { RealTimeAggregationService } from "@/aggregators/real-time-aggregation.service";
import { ConsensusAggregator } from "@/aggregators/consensus-aggregator";
import { RealTimeCacheService } from "@/cache/real-time-cache.service";
import { CacheWarmerService } from "@/cache/cache-warmer.service";
import { CachePerformanceMonitorService } from "@/cache/cache-performance-monitor.service";

// Exchange adapters
import { BinanceAdapter } from "@/adapters/crypto/binance.adapter";
import { CoinbaseAdapter } from "@/adapters/crypto/coinbase.adapter";
import { KrakenAdapter } from "@/adapters/crypto/kraken.adapter";
import { OkxAdapter } from "@/adapters/crypto/okx.adapter";
import { CryptocomAdapter } from "@/adapters/crypto/cryptocom.adapter";

// Monitoring
import { AccuracyMonitorService } from "@/monitoring/accuracy-monitor.service";
import { PerformanceMonitorService } from "@/monitoring/performance-monitor.service";
import { AlertingService } from "@/monitoring/alerting.service";

// Error handling
import { HybridErrorHandlerService } from "@/error-handling/hybrid-error-handler.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";

// Configuration
import { ConfigService } from "@/config/config.service";

// Data source factory
import { DataSourceFactory } from "./data-source.factory";

// Types and interfaces
import { EnhancedFeedId } from "@/types";
import { DataSource, PriceUpdate } from "@/interfaces";
import { AggregatedPrice } from "@/aggregators/base/aggregation.interfaces";
import { FeedCategory } from "@/types/feed-category.enum";

@Injectable()
export class ProductionIntegrationService extends EventEmitter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProductionIntegrationService.name);
  private readonly enhancedLogger = new EnhancedLoggerService("ProductionIntegration");
  private isInitialized = false;
  private shutdownInProgress = false;

  // Component references
  private dataManager: ProductionDataManagerService;
  private adapterRegistry: ExchangeAdapterRegistry;
  private aggregationService: RealTimeAggregationService;
  private consensusAggregator: ConsensusAggregator;
  private cacheService: RealTimeCacheService;
  private cacheWarmerService: CacheWarmerService;
  private cachePerformanceMonitor: CachePerformanceMonitorService;

  // Monitoring components
  private accuracyMonitor: AccuracyMonitorService;
  private performanceMonitor: PerformanceMonitorService;
  private alertingService: AlertingService;

  // Error handling components
  private errorHandler: HybridErrorHandlerService;
  private circuitBreaker: CircuitBreakerService;
  private connectionRecovery: ConnectionRecoveryService;

  // Configuration
  private configService: ConfigService;

  // Data source factory
  private dataSourceFactory: DataSourceFactory;

  constructor(
    dataManager: ProductionDataManagerService,
    adapterRegistry: ExchangeAdapterRegistry,
    aggregationService: RealTimeAggregationService,
    consensusAggregator: ConsensusAggregator,
    cacheService: RealTimeCacheService,
    cacheWarmerService: CacheWarmerService,
    cachePerformanceMonitor: CachePerformanceMonitorService,
    accuracyMonitor: AccuracyMonitorService,
    performanceMonitor: PerformanceMonitorService,
    alertingService: AlertingService,
    errorHandler: HybridErrorHandlerService,
    circuitBreaker: CircuitBreakerService,
    connectionRecovery: ConnectionRecoveryService,
    configService: ConfigService,
    dataSourceFactory: DataSourceFactory
  ) {
    super();

    this.dataManager = dataManager;
    this.adapterRegistry = adapterRegistry;
    this.aggregationService = aggregationService;
    this.consensusAggregator = consensusAggregator;
    this.cacheService = cacheService;
    this.cacheWarmerService = cacheWarmerService;
    this.cachePerformanceMonitor = cachePerformanceMonitor;
    this.accuracyMonitor = accuracyMonitor;
    this.performanceMonitor = performanceMonitor;
    this.alertingService = alertingService;
    this.errorHandler = errorHandler;
    this.circuitBreaker = circuitBreaker;
    this.connectionRecovery = connectionRecovery;
    this.configService = configService;
    this.dataSourceFactory = dataSourceFactory;
  }

  async onModuleInit(): Promise<void> {
    const operationId = `init_${Date.now()}`;
    this.enhancedLogger.startPerformanceTimer(operationId, "module_initialization", "ProductionIntegration");

    try {
      this.enhancedLogger.logCriticalOperation("module_initialization", "ProductionIntegration", {
        phase: "starting",
        timestamp: Date.now(),
      });

      // Step 1: Register exchange adapters
      await this.registerExchangeAdapters();

      // Step 2: Wire data flow connections
      await this.wireDataFlow();

      // Step 3: Connect monitoring systems
      await this.connectMonitoring();

      // Step 4: Initialize error handling
      await this.initializeErrorHandling();

      // Step 5: Start data sources
      await this.startDataSources();

      // Step 6: Subscribe to configured feeds
      await this.subscribeToFeeds();

      this.isInitialized = true;

      this.enhancedLogger.logCriticalOperation(
        "module_initialization",
        "ProductionIntegration",
        {
          phase: "completed",
          timestamp: Date.now(),
          initialized: true,
        },
        true
      );

      this.enhancedLogger.endPerformanceTimer(operationId, true, { initialized: true });
      this.emit("initialized");
    } catch (error) {
      this.enhancedLogger.logCriticalOperation(
        "module_initialization",
        "ProductionIntegration",
        {
          phase: "failed",
          timestamp: Date.now(),
          error: error.message,
        },
        false
      );

      this.enhancedLogger.endPerformanceTimer(operationId, false, { error: error.message });
      this.enhancedLogger.error(error, {
        component: "ProductionIntegration",
        operation: "module_initialization",
        severity: "critical",
      });
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;
    this.logger.log("Shutting down Production FTSO Provider Integration...");

    try {
      // Stop monitoring
      await this.stopMonitoring();

      // Disconnect data sources
      await this.disconnectDataSources();

      // Cleanup data manager
      this.dataManager.cleanup();

      this.logger.log("Production FTSO Provider Integration shutdown completed");
    } catch (error) {
      this.logger.error("Error during shutdown:", error);
    }
  }

  // Public API methods
  async getCurrentPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice> {
    if (!this.isInitialized) {
      throw new Error("Integration service not initialized");
    }

    const startTime = performance.now();

    try {
      // Track feed access for cache warming
      this.cacheWarmerService.trackFeedAccess(feedId);

      // Check cache first
      const cachedPrice = this.cacheService.getPrice(feedId);
      if (cachedPrice && this.isFreshData(cachedPrice.timestamp)) {
        // Record cache hit performance
        const responseTime = performance.now() - startTime;
        this.cachePerformanceMonitor.recordResponseTime(responseTime);

        return {
          symbol: feedId.name,
          price: cachedPrice.value,
          timestamp: cachedPrice.timestamp,
          sources: cachedPrice.sources,
          confidence: cachedPrice.confidence,
          consensusScore: 0, // Will be calculated by consensus aggregator
        };
      }

      // Get fresh aggregated price
      const aggregatedPrice = await this.aggregationService.getAggregatedPrice(feedId);

      if (aggregatedPrice) {
        // Cache the result with automatic invalidation
        this.cacheService.setPrice(feedId, {
          value: aggregatedPrice.price,
          timestamp: aggregatedPrice.timestamp,
          sources: aggregatedPrice.sources,
          confidence: aggregatedPrice.confidence,
        });

        // Invalidate any stale cache entries
        this.cacheService.invalidateOnPriceUpdate(feedId);

        // Record cache miss performance
        const responseTime = performance.now() - startTime;
        this.cachePerformanceMonitor.recordResponseTime(responseTime);

        return aggregatedPrice;
      }

      throw new Error(`No price data available for feed ${feedId.name}`);
    } catch (error) {
      this.logger.error(`Error getting current price for ${feedId.name}:`, error);

      // Record error response time
      const responseTime = performance.now() - startTime;
      this.cachePerformanceMonitor.recordResponseTime(responseTime);

      throw error;
    }
  }

  async getCurrentPrices(feedIds: EnhancedFeedId[]): Promise<AggregatedPrice[]> {
    const results = await Promise.allSettled(feedIds.map(feedId => this.getCurrentPrice(feedId)));

    return results
      .filter((result): result is PromiseFulfilledResult<AggregatedPrice> => result.status === "fulfilled")
      .map(result => result.value);
  }

  async getSystemHealth(): Promise<any> {
    const connectionHealth = await this.dataManager.getConnectionHealth();
    const cacheStats = this.cacheService.getStats();
    const cachePerformanceMetrics = this.cachePerformanceMonitor.getPerformanceMetrics();
    const cacheHealthCheck = this.cachePerformanceMonitor.checkPerformanceThresholds();
    const warmupStats = this.cacheWarmerService.getWarmupStats();

    return {
      status: this.determineOverallHealth(connectionHealth),
      timestamp: Date.now(),
      connections: connectionHealth,
      adapters: this.adapterRegistry.getStats(),
      cache: {
        stats: cacheStats,
        performance: cachePerformanceMetrics,
        health: cacheHealthCheck,
        warmup: warmupStats,
      },
    };
  }

  // Private initialization methods
  private async registerExchangeAdapters(): Promise<void> {
    const operationId = `register_adapters_${Date.now()}`;
    this.enhancedLogger.startPerformanceTimer(operationId, "register_exchange_adapters", "ProductionIntegration");

    try {
      const adaptersToRegister = [
        { name: "binance", adapter: new BinanceAdapter() },
        { name: "coinbase", adapter: new CoinbaseAdapter() },
        { name: "cryptocom", adapter: new CryptocomAdapter() },
        { name: "kraken", adapter: new KrakenAdapter() },
        { name: "okx", adapter: new OkxAdapter() },
      ];

      let registeredCount = 0;
      let skippedCount = 0;

      for (const { name, adapter } of adaptersToRegister) {
        try {
          this.adapterRegistry.register(name, adapter);
          registeredCount++;

          this.enhancedLogger.log(`Exchange adapter registered: ${name}`, {
            component: "ProductionIntegration",
            operation: "adapter_registration",
            sourceId: name,
            metadata: { adapterType: adapter.constructor.name },
          });
        } catch (error) {
          if (error.message.includes("already registered")) {
            skippedCount++;
            this.enhancedLogger.debug(`Adapter ${name} already registered, skipping`, {
              component: "ProductionIntegration",
              operation: "adapter_registration",
              sourceId: name,
            });
          } else {
            this.enhancedLogger.error(error, {
              component: "ProductionIntegration",
              operation: "adapter_registration",
              sourceId: name,
              severity: "high",
            });
            throw error;
          }
        }
      }

      this.enhancedLogger.logCriticalOperation(
        "register_exchange_adapters",
        "ProductionIntegration",
        {
          totalAdapters: adaptersToRegister.length,
          registeredCount,
          skippedCount,
        },
        true
      );

      this.enhancedLogger.endPerformanceTimer(operationId, true, { registeredCount, skippedCount });
    } catch (error) {
      this.enhancedLogger.endPerformanceTimer(operationId, false, { error: error.message });
      this.enhancedLogger.error(error, {
        component: "ProductionIntegration",
        operation: "register_exchange_adapters",
        severity: "critical",
      });
      throw error;
    }
  }

  private async wireDataFlow(): Promise<void> {
    this.logger.log("Wiring data flow connections...");

    try {
      // Connect data manager to aggregation service
      this.dataManager.on("priceUpdate", (update: PriceUpdate) => {
        this.handlePriceUpdate(update);
      });

      // Connect aggregation service events to cache and monitoring
      this.aggregationService.on("aggregatedPrice", (aggregatedPrice: AggregatedPrice) => {
        this.handleAggregatedPrice(aggregatedPrice);
      });

      // Connect data manager price requests (for getCurrentPrice integration)
      this.dataManager.on("priceRequest", async (feedId: EnhancedFeedId) => {
        try {
          const aggregatedPrice = await this.aggregationService.getAggregatedPrice(feedId);
          if (aggregatedPrice) {
            this.emit("priceResponse", feedId, aggregatedPrice);
          }
        } catch (error) {
          this.logger.error(`Error handling price request for ${feedId.name}:`, error);
          this.emit("priceError", feedId, error);
        }
      });

      // Wire cache warmer service to actual data sources
      this.cacheWarmerService.setDataSourceCallback(async (feedId: EnhancedFeedId) => {
        try {
          return await this.aggregationService.getAggregatedPrice(feedId);
        } catch (error) {
          this.logger.error(`Error fetching data for cache warming of ${feedId.name}:`, error);
          return null;
        }
      });

      this.logger.log("Data flow connections established with cache integration");
    } catch (error) {
      this.logger.error("Failed to wire data flow:", error);
      throw error;
    }
  }

  private async connectMonitoring(): Promise<void> {
    this.logger.log("Connecting monitoring systems...");

    try {
      // Connect data manager health events
      this.dataManager.on("sourceUnhealthy", (sourceId: string) => {
        this.logger.warn(`Data source ${sourceId} is unhealthy`);
        this.handleSourceUnhealthy(sourceId);
      });

      // Connect data manager healthy events
      this.dataManager.on("sourceHealthy", (sourceId: string) => {
        this.logger.log(`Data source ${sourceId} is healthy`);
        this.handleSourceHealthy(sourceId);
      });

      // Connect source recovery events
      this.dataManager.on("sourceRecovered", (sourceId: string) => {
        this.logger.log(`Data source ${sourceId} recovered`);
        this.handleSourceRecovered(sourceId);
      });

      // Connect failover events
      this.dataManager.on("sourceFailover", (sourceId: string, reason: string) => {
        this.logger.warn(`Data source ${sourceId} failover triggered: ${reason}`);
        this.handleSourceFailover(sourceId, reason);
      });

      // Connect REST fallback events
      this.dataManager.on("restFallbackActivated", (sourceId: string) => {
        this.logger.log(`REST fallback activated for ${sourceId}`);
        this.handleRestFallbackActivated(sourceId);
      });

      // Connect aggregated price events to accuracy monitoring
      this.aggregationService.on("aggregatedPrice", (aggregatedPrice: AggregatedPrice) => {
        this.recordAccuracyMetrics(aggregatedPrice);
      });

      // Connect performance monitoring to all price updates
      this.dataManager.on("priceUpdate", (update: PriceUpdate) => {
        this.recordPerformanceMetrics(update);
      });

      // Connect monitoring alerts to alerting service
      this.setupMonitoringAlerts();

      this.logger.log("Monitoring systems connected");
    } catch (error) {
      this.logger.error("Failed to connect monitoring:", error);
      throw error;
    }
  }

  private handleSourceHealthy(sourceId: string): void {
    try {
      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "healthy");

      // Send recovery alert
      const alert = {
        type: "source_recovered",
        sourceId,
        timestamp: Date.now(),
        severity: "info",
        message: `Data source ${sourceId} is now healthy`,
      };

      this.sendAlert(alert);
    } catch (error) {
      this.logger.error(`Error handling healthy source ${sourceId}:`, error);
    }
  }

  private handleSourceRecovered(sourceId: string): void {
    try {
      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "healthy");

      // Close circuit breaker
      this.circuitBreaker.closeCircuit(sourceId, "Source recovered");

      // Send recovery alert
      const alert = {
        type: "source_recovered",
        sourceId,
        timestamp: Date.now(),
        severity: "info",
        message: `Data source ${sourceId} has recovered`,
      };

      this.sendAlert(alert);
    } catch (error) {
      this.logger.error(`Error handling recovered source ${sourceId}:`, error);
    }
  }

  private handleSourceFailover(sourceId: string, reason: string): void {
    try {
      // Send failover alert
      const alert = {
        type: "source_failover",
        sourceId,
        reason,
        timestamp: Date.now(),
        severity: "warning",
        message: `Data source ${sourceId} failover triggered: ${reason}`,
      };

      this.sendAlert(alert);
    } catch (error) {
      this.logger.error(`Error handling failover for source ${sourceId}:`, error);
    }
  }

  private handleRestFallbackActivated(sourceId: string): void {
    try {
      // Send REST fallback alert
      const alert = {
        type: "rest_fallback_activated",
        sourceId,
        timestamp: Date.now(),
        severity: "info",
        message: `REST fallback activated for ${sourceId}`,
      };

      this.sendAlert(alert);
    } catch (error) {
      this.logger.error(`Error handling REST fallback for source ${sourceId}:`, error);
    }
  }

  private async initializeErrorHandling(): Promise<void> {
    this.logger.log("Initializing error handling...");

    try {
      // Connect error handler to data manager events
      this.dataManager.on("sourceError", (sourceId: string, error: Error) => {
        this.logger.error(`Data source error from ${sourceId}:`, error);
        this.handleSourceError(sourceId, error);
      });

      // Connect connection recovery to data manager disconnection events
      this.dataManager.on("sourceDisconnected", (sourceId: string) => {
        this.logger.warn(`Data source ${sourceId} disconnected`);
        this.handleSourceDisconnection(sourceId);
      });

      // Connect data manager unhealthy source events
      this.dataManager.on("sourceUnhealthy", (sourceId: string) => {
        this.logger.warn(`Data source ${sourceId} is unhealthy`);
        this.handleSourceUnhealthy(sourceId);
      });

      // Connect aggregation service errors
      this.aggregationService.on("error", (error: Error) => {
        this.logger.error("Aggregation service error:", error);
        this.handleAggregationError(error);
      });

      // Connect error handler events to monitoring and alerting
      this.errorHandler.on("errorHandled", (sourceId: string, error: any) => {
        this.handleErrorHandlerEvent("errorHandled", sourceId, error);
      });

      this.errorHandler.on("tier1ErrorHandled", (sourceId: string, error: any, response: any) => {
        this.handleErrorHandlerEvent("tier1ErrorHandled", sourceId, error, response);
      });

      this.errorHandler.on("tier2ErrorHandled", (sourceId: string, error: any, response: any) => {
        this.handleErrorHandlerEvent("tier2ErrorHandled", sourceId, error, response);
      });

      this.errorHandler.on("failoverExecuted", (sourceId: string, fallbackSources: string[]) => {
        this.handleFailoverEvent(sourceId, fallbackSources);
      });

      this.errorHandler.on("ccxtBackupActivated", (feedId: any, sourceId: string) => {
        this.handleCcxtBackupActivated(feedId, sourceId);
      });

      this.errorHandler.on("gracefulDegradationImplemented", (feedId: any, sourceId: string) => {
        this.handleGracefulDegradation(feedId, sourceId);
      });

      // Connect connection recovery events
      this.connectionRecovery.on("failoverCompleted", (sourceId: string, result: any) => {
        this.handleConnectionRecoveryEvent("failoverCompleted", sourceId, result);
      });

      this.connectionRecovery.on("failoverFailed", (sourceId: string, result: any) => {
        this.handleConnectionRecoveryEvent("failoverFailed", sourceId, result);
      });

      this.connectionRecovery.on("connectionRestored", (sourceId: string) => {
        this.handleConnectionRestored(sourceId);
      });

      this.connectionRecovery.on("sourceUnhealthy", (sourceId: string) => {
        this.handleSourceUnhealthy(sourceId);
      });

      // Connect circuit breaker events
      this.circuitBreaker.on("circuitOpened", (sourceId: string) => {
        this.handleCircuitBreakerEvent("circuitOpened", sourceId);
      });

      this.circuitBreaker.on("circuitClosed", (sourceId: string) => {
        this.handleCircuitBreakerEvent("circuitClosed", sourceId);
      });

      this.circuitBreaker.on("circuitHalfOpen", (sourceId: string) => {
        this.handleCircuitBreakerEvent("circuitHalfOpen", sourceId);
      });

      this.logger.log("Error handling initialized with full service integration");
    } catch (error) {
      this.logger.error("Failed to initialize error handling:", error);
      throw error;
    }
  }

  private async startDataSources(): Promise<void> {
    this.logger.log("Starting data sources...");

    try {
      const adapters = this.adapterRegistry.getFiltered({ isActive: true });

      for (const adapter of adapters) {
        try {
          // Create data source from adapter
          const dataSource = this.createDataSourceFromAdapter(adapter);

          // Register with connection recovery service for error handling
          await this.connectionRecovery.registerDataSource(dataSource);

          // Register circuit breaker for the data source
          this.circuitBreaker.registerCircuit(dataSource.id, {
            failureThreshold: 5,
            recoveryTimeout: 30000,
            successThreshold: 3,
            timeout: 10000,
          });

          // Add to data manager
          await this.dataManager.addDataSource(dataSource);

          this.logger.log(`Started data source: ${adapter.exchangeName}`);
        } catch (error) {
          this.logger.error(`Failed to start data source ${adapter.exchangeName}:`, error);

          // Handle error through error handler
          this.errorHandler.handleError(error, {
            sourceId: adapter.exchangeName,
            component: "dataSourceStartup",
          });

          // Continue with other adapters
        }
      }

      this.logger.log("Data sources started");
    } catch (error) {
      this.logger.error("Failed to start data sources:", error);
      throw error;
    }
  }

  private async subscribeToFeeds(): Promise<void> {
    this.logger.log("Subscribing to configured feeds...");

    try {
      const feedConfigs = this.configService.getFeedConfigurations();

      for (const config of feedConfigs) {
        try {
          await this.dataManager.subscribeToFeed(config.feed);

          // Configure feed sources for connection recovery
          const primarySources = this.getPrimarySourcesForFeed(config.feed);
          const backupSources = this.getBackupSourcesForFeed(config.feed);

          if (primarySources.length > 0) {
            this.connectionRecovery.configureFeedSources(config.feed, primarySources, backupSources);
          }

          this.logger.debug(`Subscribed to feed: ${config.feed.name}`);
        } catch (error) {
          this.logger.error(`Failed to subscribe to feed ${config.feed.name}:`, error);

          // Handle error through error handler
          this.errorHandler.handleError(error, {
            component: "feedSubscription",
            sourceId: config.feed.name,
          });

          // Continue with other feeds
        }
      }

      this.logger.log(`Subscribed to ${feedConfigs.length} feeds`);
    } catch (error) {
      this.logger.error("Failed to subscribe to feeds:", error);
      throw error;
    }
  }

  // Event handlers
  private handlePriceUpdate(update: PriceUpdate): void {
    const startTime = performance.now();

    try {
      // Record performance metrics
      this.recordPerformanceMetrics(update);

      // Track feed access for cache warming
      const feedId: EnhancedFeedId = {
        category: this.determineFeedCategory(update.symbol),
        name: update.symbol,
      };
      this.cacheWarmerService.trackFeedAccess(feedId);

      // Process through aggregation service
      this.aggregationService.processPriceUpdate(update).catch(error => {
        this.logger.error(`Error processing price update in aggregation service:`, error);
      });

      // Update adapter health
      this.adapterRegistry.updateHealthStatus(update.source, "healthy");

      // Record cache performance metrics
      const responseTime = performance.now() - startTime;
      this.cachePerformanceMonitor.recordResponseTime(responseTime);

      this.logger.debug(`Processed price update from ${update.source}: ${update.symbol} = ${update.price}`);
    } catch (error) {
      this.logger.error(`Error handling price update from ${update.source}:`, error);
      this.adapterRegistry.updateHealthStatus(update.source, "unhealthy");
      this.handleSourceError(update.source, error);
    }
  }

  private handleAggregatedPrice(aggregatedPrice: AggregatedPrice): void {
    try {
      // Cache the aggregated price
      const feedId: EnhancedFeedId = {
        category: this.determineFeedCategory(aggregatedPrice.symbol),
        name: aggregatedPrice.symbol,
      };

      // Set price in cache with automatic invalidation
      this.cacheService.setPrice(feedId, {
        value: aggregatedPrice.price,
        timestamp: aggregatedPrice.timestamp,
        sources: aggregatedPrice.sources,
        confidence: aggregatedPrice.confidence,
      });

      // Invalidate any stale cache entries for this feed
      this.cacheService.invalidateOnPriceUpdate(feedId);

      // Record accuracy metrics
      this.accuracyMonitor.recordPrice(aggregatedPrice);

      // Emit for external consumers
      this.emit("priceReady", aggregatedPrice);

      this.logger.debug(`Cached aggregated price for ${aggregatedPrice.symbol}: ${aggregatedPrice.price}`);
    } catch (error) {
      this.logger.error(`Error handling aggregated price for ${aggregatedPrice.symbol}:`, error);
    }
  }

  // Cleanup methods
  private async stopMonitoring(): Promise<void> {
    try {
      // Stop all monitoring services
      await Promise.allSettled([
        this.performanceMonitor.stop(),
        this.accuracyMonitor.stop(),
        this.alertingService.stop(),
      ]);

      this.logger.log("All monitoring services stopped successfully");
    } catch (error) {
      this.logger.error("Error stopping monitoring:", error);
    }
  }

  private async disconnectDataSources(): Promise<void> {
    try {
      const connectedSources = this.dataManager.getConnectedSources();

      for (const source of connectedSources) {
        // Unregister from error handling services
        await this.connectionRecovery.unregisterDataSource(source.id);
        this.circuitBreaker.unregisterCircuit(source.id);

        // Remove from data manager
        await this.dataManager.removeDataSource(source.id);
      }
    } catch (error) {
      this.logger.error("Error disconnecting data sources:", error);
    }
  }

  // Helper methods
  private createDataSourceFromAdapter(adapter: any): DataSource {
    const priority = this.getAdapterPriority(adapter.exchangeName);
    return this.dataSourceFactory.createFromAdapter(adapter, priority);
  }

  private getAdapterPriority(exchangeName: string): number {
    // Tier 1 exchanges get higher priority
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    return tier1Exchanges.includes(exchangeName) ? 1 : 2;
  }

  private determineFeedCategory(symbol: string): FeedCategory {
    // Simple heuristic - in production this would use proper configuration
    if (symbol.includes("USD") || symbol.includes("BTC") || symbol.includes("ETH")) {
      return FeedCategory.Crypto;
    }
    return FeedCategory.Crypto; // Default to crypto for now
  }

  private isFreshData(timestamp: number): boolean {
    const age = Date.now() - timestamp;
    return age <= 2000; // 2-second freshness requirement
  }

  private determineOverallHealth(connectionHealth: any): string {
    if (connectionHealth.healthScore < 50) {
      return "unhealthy";
    }

    if (connectionHealth.healthScore < 80) {
      return "degraded";
    }

    return "healthy";
  }

  // Additional event handlers for complete integration
  private handleSourceError(sourceId: string, error: Error, context?: any): void {
    try {
      // Enhanced error handling with context
      const errorContext = {
        sourceId,
        component: "dataSource",
        errorType: (error as any).errorType || "UNKNOWN_ERROR",
        exchangeName: (error as any).exchangeName || sourceId,
        adapterType: (error as any).adapterType || "unknown",
        timestamp: (error as any).timestamp || Date.now(),
        ...context,
      };

      // Use error handler service to classify and handle the error
      this.errorHandler.handleError(error, errorContext);

      // Record failure for circuit breaker
      this.errorHandler.recordFailure(sourceId);

      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "unhealthy");

      // Trigger failover through data manager if it's a critical error
      if (this.isCriticalError(error)) {
        this.dataManager.triggerSourceFailover(sourceId, `Critical error: ${error.message}`).catch(failoverError => {
          this.logger.error(`Failover failed for ${sourceId}:`, failoverError);
        });
      }

      this.logger.error(`Handled error from source ${sourceId}:`, error);
    } catch (handlingError) {
      this.logger.error(`Error in error handling for source ${sourceId}:`, handlingError);
    }
  }

  private isCriticalError(error: Error): boolean {
    const errorType = (error as any).errorType;
    const criticalTypes = ["CONNECTION_ERROR", "TIMEOUT_ERROR"];
    return criticalTypes.includes(errorType);
  }

  private handleSourceDisconnection(sourceId: string): void {
    try {
      // Trigger connection recovery
      this.connectionRecovery.handleDisconnection(sourceId);

      // Record failure for error handler
      this.errorHandler.recordFailure(sourceId);

      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "unhealthy");

      this.logger.warn(`Handled disconnection for source ${sourceId}`);
    } catch (error) {
      this.logger.error(`Error handling disconnection for source ${sourceId}:`, error);
    }
  }

  private handleSourceUnhealthy(sourceId: string): void {
    try {
      // Send alert for unhealthy source
      const alert = {
        type: "source_unhealthy",
        sourceId,
        timestamp: Date.now(),
        severity: "warning",
        message: `Data source ${sourceId} is unhealthy`,
      };

      this.sendAlert(alert);

      this.logger.warn(`Handled unhealthy source: ${sourceId}`);
    } catch (error) {
      this.logger.error(`Error handling unhealthy source ${sourceId}:`, error);
    }
  }

  private handleAggregationError(error: Error): void {
    try {
      // Handle aggregation service errors
      this.errorHandler.handleError(error, { component: "aggregation" });

      const alert = {
        type: "aggregation_error",
        timestamp: Date.now(),
        severity: "error",
        message: `Aggregation service error: ${error.message}`,
        error: error.stack,
      };

      this.sendAlert(alert);

      this.logger.error("Handled aggregation error:", error);
    } catch (handlingError) {
      this.logger.error("Error in aggregation error handling:", handlingError);
    }
  }

  private recordPerformanceMetrics(update: PriceUpdate): void {
    try {
      // Record performance metrics for the price update
      this.performanceMonitor.recordPriceUpdate(update);

      // Calculate and evaluate response latency
      const latency = Date.now() - (update.timestamp || Date.now());
      this.alertingService.evaluateMetric("response_latency", latency, {
        source: update.source,
        symbol: update.symbol,
        timestamp: update.timestamp,
      });

      // Calculate and evaluate data freshness
      const dataAge = Date.now() - (update.timestamp || Date.now());
      this.alertingService.evaluateMetric("data_freshness", dataAge, {
        source: update.source,
        symbol: update.symbol,
        timestamp: update.timestamp,
      });

      // Get current performance metrics and evaluate them
      const performanceMetrics = this.performanceMonitor.getCurrentPerformanceMetrics();

      // Evaluate overall response latency
      this.alertingService.evaluateMetric("response_latency", performanceMetrics.responseLatency, {
        timestamp: performanceMetrics.timestamp,
      });

      // Evaluate data freshness
      this.alertingService.evaluateMetric("data_freshness", performanceMetrics.dataFreshness, {
        timestamp: performanceMetrics.timestamp,
      });

      // Get connection summary and evaluate connection rate
      const connectionSummary = this.performanceMonitor.getConnectionSummary();
      this.alertingService.evaluateMetric("connection_rate", connectionSummary.connectionRate, {
        connectedExchanges: connectionSummary.connectedExchanges,
        totalExchanges: connectionSummary.totalExchanges,
        timestamp: Date.now(),
      });

      // Get error stats and evaluate error rate
      const errorStats = this.performanceMonitor.getErrorStats();
      this.alertingService.evaluateMetric("error_rate", errorStats.errorRate, {
        totalErrors: errorStats.totalErrors,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error("Error recording performance metrics:", error);
    }
  }

  private recordAccuracyMetrics(aggregatedPrice: AggregatedPrice): void {
    try {
      // Record accuracy metrics for the aggregated price
      this.accuracyMonitor.recordPrice(aggregatedPrice);

      // Get the latest accuracy metrics for this feed
      const feedId: EnhancedFeedId = {
        category: this.determineFeedCategory(aggregatedPrice.symbol),
        name: aggregatedPrice.symbol,
      };

      const accuracyMetrics = this.accuracyMonitor.getAccuracyMetrics(feedId.name);
      if (accuracyMetrics) {
        // Evaluate consensus deviation against alert rules
        this.alertingService.evaluateMetric("consensus_deviation", accuracyMetrics.consensusDeviation, {
          feedId: aggregatedPrice.symbol,
          price: aggregatedPrice.price,
          timestamp: aggregatedPrice.timestamp,
        });

        // Evaluate accuracy rate against alert rules
        this.alertingService.evaluateMetric("accuracy_rate", accuracyMetrics.accuracyRate, {
          feedId: aggregatedPrice.symbol,
          timestamp: aggregatedPrice.timestamp,
        });

        // Evaluate quality score against alert rules
        this.alertingService.evaluateMetric("quality_score", accuracyMetrics.qualityScore, {
          feedId: aggregatedPrice.symbol,
          timestamp: aggregatedPrice.timestamp,
        });
      }

      // Check for low consensus score
      if (aggregatedPrice.consensusScore < 0.7) {
        const alert = {
          type: "low_consensus",
          symbol: aggregatedPrice.symbol,
          consensusScore: aggregatedPrice.consensusScore,
          timestamp: aggregatedPrice.timestamp,
          severity: "warning",
          message: `Low consensus score for ${aggregatedPrice.symbol}: ${aggregatedPrice.consensusScore}`,
        };

        this.sendAlert(alert);
      }
    } catch (error) {
      this.logger.error("Error recording accuracy metrics:", error);
    }
  }

  private setupMonitoringAlerts(): void {
    try {
      // Set up accuracy monitoring alerts
      this.accuracyMonitor.on("accuracyAlert", (alert: any) => {
        this.sendAlert(alert);
      });

      // Set up performance monitoring alerts
      this.performanceMonitor.on("performanceAlert", (alert: any) => {
        this.sendAlert(alert);
      });

      this.logger.log("Monitoring alerts configured");
    } catch (error) {
      this.logger.error("Error setting up monitoring alerts:", error);
    }
  }

  private sendAlert(alert: any): void {
    try {
      // Send alert directly through alerting service
      this.alertingService.sendAlert(alert).catch(error => {
        this.logger.error("Error delivering alert:", error);
      });

      this.logger.warn(`Alert sent: ${alert.type} - ${alert.message}`);
    } catch (error) {
      this.logger.error("Error sending alert:", error);
    }
  }

  private getPrimarySourcesForFeed(feedId: any): string[] {
    // Get primary (Tier 1) sources for the feed
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    const connectedSources = this.dataManager.getConnectedSources();

    return connectedSources.filter(source => tier1Exchanges.includes(source.id)).map(source => source.id);
  }

  private getBackupSourcesForFeed(feedId: any): string[] {
    // Get backup (Tier 2) sources for the feed
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    const connectedSources = this.dataManager.getConnectedSources();

    return connectedSources.filter(source => !tier1Exchanges.includes(source.id)).map(source => source.id);
  }

  // New error handling event handlers

  private handleErrorHandlerEvent(eventType: string, sourceId: string, error: any, response?: any): void {
    try {
      this.logger.log(`Error handler event: ${eventType} for source ${sourceId}`);

      // Update adapter health status based on error handling
      if (eventType === "errorHandled" || eventType.includes("ErrorHandled")) {
        this.adapterRegistry.updateHealthStatus(sourceId, "degraded");
      }

      // Send alert for significant error events
      if (eventType === "tier1ErrorHandled" && error.severity === "critical") {
        const alert = {
          type: "tier1_error_critical",
          sourceId,
          timestamp: Date.now(),
          severity: "critical",
          message: `Critical Tier 1 error handled for ${sourceId}: ${error.classification}`,
          metadata: { error, response },
        };
        this.sendAlert(alert);
      }

      // Record performance impact of error handling
      if (response?.estimatedRecoveryTime) {
        this.performanceMonitor.recordMetric("error_recovery_time", response.estimatedRecoveryTime, {
          sourceId,
          strategy: response.strategy,
        });
      }
    } catch (handlingError) {
      this.logger.error(`Error handling error handler event ${eventType}:`, handlingError);
    }
  }

  private handleFailoverEvent(sourceId: string, fallbackSources: string[]): void {
    try {
      this.logger.log(`Failover executed for ${sourceId} to sources: ${fallbackSources.join(", ")}`);

      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "unhealthy");
      fallbackSources.forEach(fallbackId => {
        this.adapterRegistry.updateHealthStatus(fallbackId, "healthy");
      });

      // Send failover alert
      const alert = {
        type: "failover_executed",
        sourceId,
        timestamp: Date.now(),
        severity: "warning",
        message: `Failover executed for ${sourceId} to ${fallbackSources.length} backup sources`,
        metadata: { fallbackSources },
      };
      this.sendAlert(alert);

      // Record failover metrics
      this.performanceMonitor.recordMetric("failover_count", 1, {
        sourceId,
        fallbackCount: fallbackSources.length,
      });
    } catch (error) {
      this.logger.error(`Error handling failover event for ${sourceId}:`, error);
    }
  }

  private handleCcxtBackupActivated(feedId: any, sourceId: string): void {
    try {
      this.logger.log(`CCXT backup activated for feed ${feedId.name} replacing source ${sourceId}`);

      // Send backup activation alert
      const alert = {
        type: "ccxt_backup_activated",
        feedId: feedId.name,
        sourceId,
        timestamp: Date.now(),
        severity: "info",
        message: `CCXT backup activated for feed ${feedId.name} due to ${sourceId} failure`,
        metadata: { feedId, sourceId },
      };
      this.sendAlert(alert);

      // Record backup activation metrics
      this.performanceMonitor.recordMetric("ccxt_backup_activation", 1, {
        feedId: feedId.name,
        sourceId,
      });
    } catch (error) {
      this.logger.error(`Error handling CCXT backup activation for ${feedId?.name}:`, error);
    }
  }

  private handleGracefulDegradation(feedId: any, sourceId: string): void {
    try {
      this.logger.warn(`Graceful degradation implemented for feed ${feedId.name} due to ${sourceId} failure`);

      // Send degradation alert
      const alert = {
        type: "graceful_degradation",
        feedId: feedId.name,
        sourceId,
        timestamp: Date.now(),
        severity: "warning",
        message: `System operating in degraded mode for feed ${feedId.name} due to ${sourceId} failure`,
        metadata: { feedId, sourceId },
      };
      this.sendAlert(alert);

      // Record degradation metrics
      this.performanceMonitor.recordMetric("graceful_degradation_count", 1, {
        feedId: feedId.name,
        sourceId,
      });
    } catch (error) {
      this.logger.error(`Error handling graceful degradation for ${feedId?.name}:`, error);
    }
  }

  private handleConnectionRecoveryEvent(eventType: string, sourceId: string, result: unknown): void {
    try {
      this.logger.log(`Connection recovery event: ${eventType} for source ${sourceId}`);

      const resultData = result as any; // Type assertion for unknown result

      if (eventType === "failoverCompleted") {
        // Update health status based on failover success
        if (resultData?.success) {
          this.adapterRegistry.updateHealthStatus(sourceId, "degraded");

          // Activate backup sources
          resultData.activatedSources?.forEach((backupId: string) => {
            this.adapterRegistry.updateHealthStatus(backupId, "healthy");
          });

          // Send success alert
          const alert = {
            type: "connection_failover_success",
            sourceId,
            timestamp: Date.now(),
            severity: "info",
            message: `Connection failover completed successfully for ${sourceId} in ${resultData.failoverTime || 0}ms`,
            metadata: result,
          };
          this.sendAlert(alert);
        } else {
          // Failover failed
          this.adapterRegistry.updateHealthStatus(sourceId, "unhealthy");

          const alert = {
            type: "connection_failover_failed",
            sourceId,
            timestamp: Date.now(),
            severity: "error",
            message: `Connection failover failed for ${sourceId} after ${resultData?.failoverTime || 0}ms`,
            metadata: result,
          };
          this.sendAlert(alert);
        }

        // Record failover performance
        this.performanceMonitor.recordMetric("connection_failover_time", resultData?.failoverTime || 0, {
          sourceId,
          success: resultData?.success || false,
          degradationLevel: resultData?.degradationLevel || "unknown",
        });
      }
    } catch (error) {
      this.logger.error(`Error handling connection recovery event ${eventType}:`, error);
    }
  }

  private handleConnectionRestored(sourceId: string): void {
    try {
      this.logger.log(`Connection restored for source ${sourceId}`);

      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "healthy");

      // Send restoration alert
      const alert = {
        type: "connection_restored",
        sourceId,
        timestamp: Date.now(),
        severity: "info",
        message: `Connection restored for source ${sourceId}`,
        metadata: { sourceId },
      };
      this.sendAlert(alert);

      // Record restoration metrics
      this.performanceMonitor.recordMetric("connection_restoration", 1, { sourceId });
    } catch (error) {
      this.logger.error(`Error handling connection restoration for ${sourceId}:`, error);
    }
  }

  private handleCircuitBreakerEvent(eventType: string, sourceId: string): void {
    try {
      this.logger.log(`Circuit breaker event: ${eventType} for source ${sourceId}`);

      // Update adapter health based on circuit breaker state
      switch (eventType) {
        case "circuitOpened":
          this.adapterRegistry.updateHealthStatus(sourceId, "unhealthy");

          const openAlert = {
            type: "circuit_breaker_opened",
            sourceId,
            timestamp: Date.now(),
            severity: "error",
            message: `Circuit breaker opened for source ${sourceId} due to repeated failures`,
            metadata: { sourceId, state: "open" },
          };
          this.sendAlert(openAlert);
          break;

        case "circuitClosed":
          this.adapterRegistry.updateHealthStatus(sourceId, "healthy");

          const closedAlert = {
            type: "circuit_breaker_closed",
            sourceId,
            timestamp: Date.now(),
            severity: "info",
            message: `Circuit breaker closed for source ${sourceId} - service recovered`,
            metadata: { sourceId, state: "closed" },
          };
          this.sendAlert(closedAlert);
          break;

        case "circuitHalfOpen":
          this.adapterRegistry.updateHealthStatus(sourceId, "degraded");

          const halfOpenAlert = {
            type: "circuit_breaker_half_open",
            sourceId,
            timestamp: Date.now(),
            severity: "warning",
            message: `Circuit breaker half-open for source ${sourceId} - testing recovery`,
            metadata: { sourceId, state: "half_open" },
          };
          this.sendAlert(halfOpenAlert);
          break;
      }

      // Record circuit breaker state changes
      this.performanceMonitor.recordMetric("circuit_breaker_state_change", 1, {
        sourceId,
        state: eventType.replace("circuit", "").toLowerCase(),
      });
    } catch (error) {
      this.logger.error(`Error handling circuit breaker event ${eventType}:`, error);
    }
  }
}
