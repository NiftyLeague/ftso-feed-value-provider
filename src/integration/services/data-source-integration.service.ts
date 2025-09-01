import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/common/base/base-event.service";

// Core components
import { ProductionDataManagerService } from "@/data-manager/production-data-manager";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";
import { ExchangeAdapter } from "@/adapters/base/exchange-adapter.interface";

// Exchange adapters
import { BinanceAdapter } from "@/adapters/crypto/binance.adapter";
import { CoinbaseAdapter } from "@/adapters/crypto/coinbase.adapter";
import { KrakenAdapter } from "@/adapters/crypto/kraken.adapter";
import { OkxAdapter } from "@/adapters/crypto/okx.adapter";
import { CryptocomAdapter } from "@/adapters/crypto/cryptocom.adapter";

// Error handling
import { HybridErrorHandlerService } from "@/error-handling/hybrid-error-handler.service";
import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";

// Data source factory
import { DataSourceFactory } from "./data-source.factory";

// Types and interfaces
import { EnhancedFeedId } from "@/common/types/feed.types";
import { DataSource, PriceUpdate } from "@/common/interfaces/core/data-source.interface";

@Injectable()
export class DataSourceIntegrationService extends BaseEventService {
  private isInitialized = false;

  constructor(
    private readonly dataManager: ProductionDataManagerService,
    private readonly adapterRegistry: ExchangeAdapterRegistry,
    private readonly errorHandler: HybridErrorHandlerService,
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly connectionRecovery: ConnectionRecoveryService,
    private readonly dataSourceFactory: DataSourceFactory
  ) {
    super("DataSourceIntegration", true); // Enable enhanced logging
  }

  async initialize(): Promise<void> {
    const startTime = performance.now();

    try {
      this.logger.log("Starting data source integration initialization");

      // Step 1: Register exchange adapters
      await this.registerExchangeAdapters();

      // Step 2: Initialize error handling
      await this.initializeErrorHandling();

      // Step 3: Start data sources
      await this.startDataSources();

      // Step 4: Wire data flow connections
      await this.wireDataFlow();

      this.isInitialized = true;

      const duration = performance.now() - startTime;
      this.logger.log(`Data source initialization completed in ${duration.toFixed(2)}ms`);
    } catch (error) {
      this.logError(error as Error, "data_source_initialization", { severity: "critical" });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log("Shutting down Data Source Integration...");

    try {
      // Disconnect data sources
      await this.disconnectDataSources();

      // Cleanup data manager
      this.dataManager.cleanup();

      this.logger.log("Data Source Integration shutdown completed");
    } catch (error) {
      this.logError(error as Error, "shutdown");
    }
  }

  async subscribeToFeed(feedId: EnhancedFeedId): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Data source integration not initialized");
    }

    try {
      await this.dataManager.subscribeToFeed(feedId);

      // Configure feed sources for connection recovery
      const primarySources = this.getPrimarySourcesForFeed(feedId);
      const backupSources = this.getBackupSourcesForFeed(feedId);

      if (primarySources.length > 0) {
        this.connectionRecovery.configureFeedSources(feedId, primarySources, backupSources);
      }

      this.logger.debug(`Subscribed to feed: ${feedId.name}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to feed ${feedId.name}:`, error);

      // Handle error through error handler
      this.errorHandler.handleError(error, {
        component: "feedSubscription",
        sourceId: feedId.name,
      });

      throw error;
    }
  }

  getDataSourceHealth(): any {
    return this.dataManager.getConnectionHealth();
  }

  getAdapterStats(): any {
    return this.adapterRegistry.getStats();
  }

  // Private methods
  private async registerExchangeAdapters(): Promise<void> {
    const operationId = `register_adapters_${Date.now()}`;
    this.enhancedLogger.startPerformanceTimer(operationId, "register_exchange_adapters", "DataSourceIntegration");

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
            component: "DataSourceIntegration",
            operation: "adapter_registration",
            sourceId: name,
            metadata: { adapterType: adapter.constructor.name },
          });
        } catch (error) {
          if (error.message.includes("already registered")) {
            skippedCount++;
            this.enhancedLogger.debug(`Adapter ${name} already registered, skipping`, {
              component: "DataSourceIntegration",
              operation: "adapter_registration",
              sourceId: name,
            });
          } else {
            this.enhancedLogger.error(error, {
              component: "DataSourceIntegration",
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
        "DataSourceIntegration",
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
        component: "DataSourceIntegration",
        operation: "register_exchange_adapters",
        severity: "critical",
      });
      throw error;
    }
  }

  private async initializeErrorHandling(): Promise<void> {
    this.logger.log("Initializing error handling for data sources...");

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

      // Connect data manager health events
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

      this.logger.log("Error handling initialized for data sources");
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

  private async wireDataFlow(): Promise<void> {
    this.logger.log("Wiring data flow connections...");

    try {
      // Connect data manager to emit price updates
      this.dataManager.on("priceUpdate", (update: PriceUpdate) => {
        this.handlePriceUpdate(update);
      });

      this.logger.log("Data flow connections established");
    } catch (error) {
      this.logger.error("Failed to wire data flow:", error);
      throw error;
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

  // Event handlers
  private handlePriceUpdate(update: PriceUpdate): void {
    try {
      // Update adapter health
      this.adapterRegistry.updateHealthStatus(update.source, "healthy");

      // Emit for price aggregation coordination
      this.emit("priceUpdate", update);

      this.logger.debug(`Processed price update from ${update.source}: ${update.symbol} = ${update.price}`);
    } catch (error) {
      this.logger.error(`Error handling price update from ${update.source}:`, error);
      this.adapterRegistry.updateHealthStatus(update.source, "unhealthy");
      this.handleSourceError(update.source, error);
    }
  }

  private handleSourceError(sourceId: string, error: Error): void {
    try {
      // Handle through error handler
      this.errorHandler.handleError(error, {
        sourceId,
        component: "dataSource",
      });

      // Update adapter health
      this.adapterRegistry.updateHealthStatus(sourceId, "unhealthy");

      // Emit for system health monitoring
      this.emit("sourceError", sourceId, error);
    } catch (handlingError) {
      this.logger.error(`Error handling source error for ${sourceId}:`, handlingError);
    }
  }

  private handleSourceDisconnection(sourceId: string): void {
    try {
      // Trigger connection recovery (fire and forget)
      void this.connectionRecovery.handleDisconnection(sourceId);

      // Emit for system health monitoring
      this.emit("sourceDisconnected", sourceId);
    } catch (error) {
      this.logger.error(`Error handling disconnection for source ${sourceId}:`, error);
    }
  }

  private handleSourceUnhealthy(sourceId: string): void {
    try {
      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "unhealthy");

      // Open circuit breaker
      this.circuitBreaker.openCircuit(sourceId, "Source unhealthy");

      // Emit for system health monitoring
      this.emit("sourceUnhealthy", sourceId);
    } catch (error) {
      this.logger.error(`Error handling unhealthy source ${sourceId}:`, error);
    }
  }

  private handleSourceHealthy(sourceId: string): void {
    try {
      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "healthy");

      // Emit for system health monitoring
      this.emit("sourceHealthy", sourceId);
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

      // Emit for system health monitoring
      this.emit("sourceRecovered", sourceId);
    } catch (error) {
      this.logger.error(`Error handling recovered source ${sourceId}:`, error);
    }
  }

  private handleSourceFailover(sourceId: string, reason: string): void {
    try {
      // Emit for system health monitoring
      this.emit("sourceFailover", sourceId, reason);
    } catch (error) {
      this.logger.error(`Error handling failover for source ${sourceId}:`, error);
    }
  }

  private handleRestFallbackActivated(sourceId: string): void {
    try {
      // Emit for system health monitoring
      this.emit("restFallbackActivated", sourceId);
    } catch (error) {
      this.logger.error(`Error handling REST fallback for source ${sourceId}:`, error);
    }
  }

  private handleConnectionRecoveryEvent(eventType: string, sourceId: string, result?: any): void {
    try {
      this.logger.log(`Connection recovery event: ${eventType} for ${sourceId}`);
      this.emit("connectionRecoveryEvent", eventType, sourceId, result);
    } catch (error) {
      this.logger.error(`Error handling connection recovery event ${eventType} for ${sourceId}:`, error);
    }
  }

  private handleConnectionRestored(sourceId: string): void {
    try {
      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "healthy");

      // Close circuit breaker
      this.circuitBreaker.closeCircuit(sourceId, "Connection restored");

      // Emit for system health monitoring
      this.emit("connectionRestored", sourceId);
    } catch (error) {
      this.logger.error(`Error handling connection restored for ${sourceId}:`, error);
    }
  }

  private handleCircuitBreakerEvent(eventType: string, sourceId: string): void {
    try {
      this.logger.log(`Circuit breaker event: ${eventType} for ${sourceId}`);
      this.emit("circuitBreakerEvent", eventType, sourceId);
    } catch (error) {
      this.logger.error(`Error handling circuit breaker event ${eventType} for ${sourceId}:`, error);
    }
  }

  // Helper methods
  private createDataSourceFromAdapter(adapter: ExchangeAdapter): DataSource {
    const priority = this.getAdapterPriority(adapter.exchangeName);
    return this.dataSourceFactory.createFromAdapter(adapter, priority);
  }

  private getAdapterPriority(exchangeName: string): number {
    // Tier 1 exchanges get higher priority
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    return tier1Exchanges.includes(exchangeName) ? 1 : 2;
  }

  private getPrimarySourcesForFeed(_feedId: EnhancedFeedId): string[] {
    // Get primary sources for the feed from configuration
    // This would typically come from feed configuration
    return ["binance", "coinbase", "kraken"];
  }

  private getBackupSourcesForFeed(_feedId: EnhancedFeedId): string[] {
    // Get backup sources for the feed from configuration
    return ["okx", "cryptocom"];
  }
}
