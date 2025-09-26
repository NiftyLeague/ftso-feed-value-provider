import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";

// Core components
import { ProductionDataManagerService } from "@/data-manager/production-data-manager.service";
import { ExchangeAdapterRegistry } from "@/adapters/base/exchange-adapter.registry";

// Error handling
import { StandardizedErrorHandlerService } from "@/error-handling/standardized-error-handler.service";

import { CircuitBreakerService } from "@/error-handling/circuit-breaker.service";
import { ConnectionRecoveryService } from "@/error-handling/connection-recovery.service";

// WebSocket orchestration
import { WebSocketOrchestratorService } from "./websocket-orchestrator.service";

// Types and interfaces
import type { CoreFeedId, DataSource, PriceUpdate } from "@/common/types/core";
import type { IExchangeAdapter } from "@/common/types/adapters";

// Data source factory
import { DataSourceFactory } from "./data-source.factory";

@Injectable()
export class DataSourceIntegrationService extends EventDrivenService {
  public override isInitialized = false;

  // Rate limiting for health warnings to prevent spam
  private healthWarningLastLogged = new Map<string, number>();
  private readonly HEALTH_WARNING_COOLDOWN_MS = 30000; // 30 seconds

  constructor(
    private readonly dataManager: ProductionDataManagerService,
    private readonly adapterRegistry: ExchangeAdapterRegistry,
    private readonly errorHandler: StandardizedErrorHandlerService,

    private readonly circuitBreaker: CircuitBreakerService,
    private readonly connectionRecovery: ConnectionRecoveryService,
    private readonly dataSourceFactory: DataSourceFactory,
    private readonly wsOrchestrator: WebSocketOrchestratorService
  ) {
    super({ useEnhancedLogging: true });
  }

  override async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.log("Data source integration already initialized, skipping");
      return;
    }

    await this.executeWithErrorHandling(
      async () => {
        this.startTimer("initialize");
        this.logger.log("Starting data source integration initialization");

        // Step 1: Register exchange adapters
        await this.registerExchangeAdapters();
        this.triggerGarbageCollection("after_adapter_registration");

        // Step 2: Initialize WebSocket orchestrator (handles connections centrally)
        await this.wsOrchestrator.initialize();
        this.triggerGarbageCollection("after_orchestrator_init");

        // Step 3: Initialize error handling
        await this.initializeErrorHandling();
        this.triggerGarbageCollection("after_error_handling_init");

        // Step 4: Start data sources (without connecting - orchestrator handles this)
        await this.startDataSources();
        this.triggerGarbageCollection("after_data_sources_start");

        // Step 5: Wire data flow connections
        await this.wireDataFlow();
        this.triggerGarbageCollection("after_data_flow_wiring");

        this.isInitialized = true;

        const duration = this.endTimer("initialize");
        this.logger.log(`Data source initialization completed in ${duration.toFixed(2)}ms`);
      },
      "data_source_initialization",
      {
        retries: 1,
        retryDelay: 3000,
        onError: (error, attempt) => {
          this.logger.warn(`Data source initialization attempt ${attempt + 1} failed: ${error.message}`);
        },
      }
    );
  }

  private triggerGarbageCollection(phase: string): void {
    if (global.gc) {
      const memBefore = process.memoryUsage();
      global.gc();
      const memAfter = process.memoryUsage();
      const freed = memBefore.heapUsed - memAfter.heapUsed;
      this.logger.debug(`GC triggered after ${phase}: freed ${(freed / 1024 / 1024).toFixed(2)}MB`);
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log("Shutting down Data Source Integration...");

    await this.executeWithErrorHandling(
      async () => {
        // Disconnect data sources
        await this.disconnectDataSources();

        // Cleanup data manager
        await this.dataManager.cleanup();

        this.logger.log("Data Source Integration shutdown completed");
      },
      "shutdown",
      {
        shouldThrow: false, // Don't throw during shutdown
        retries: 1,
        retryDelay: 1000,
      }
    );
  }

  async subscribeToFeed(feedId: CoreFeedId): Promise<void> {
    if (!this.isInitialized) {
      throw new Error("Data source integration not initialized");
    }

    try {
      // Use WebSocket orchestrator for centralized subscription management
      await this.wsOrchestrator.subscribeToFeed(feedId);

      // Configure feed sources for connection recovery
      const primarySources = this.getPrimarySourcesForFeed(feedId);
      const backupSources = this.getBackupSourcesForFeed(feedId);

      if (primarySources.length > 0) {
        this.connectionRecovery.configureFeedSources(feedId, primarySources, backupSources);
      }

      this.logger.debug(`Subscribed to feed: ${feedId.name}`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to feed ${feedId.name}:`, error);

      // Handle error through standardized error handler
      const errObj = error instanceof Error ? error : new Error(String(error));
      await this.errorHandler
        .executeWithStandardizedHandling(
          async () => {
            throw errObj;
          },
          {
            serviceId: "DataSourceIntegrationService",
            operationName: "feedSubscription",
            component: "feedSubscription",
            requestId: `feed_${feedId.name}_${Date.now()}`,
          }
        )
        .catch(() => {}); // Catch to prevent double throw

      throw error;
    }
  }

  getDataSourceHealth(): Promise<{
    totalSources: number;
    connectedSources: number;
    averageLatency: number;
    failedSources: string[];
    healthScore: number;
  }> {
    return this.dataManager.getConnectionHealth();
  }

  getAdapterStats(): ReturnType<ExchangeAdapterRegistry["getStats"]> {
    return this.adapterRegistry.getStats();
  }

  // Private methods
  private async registerExchangeAdapters(): Promise<void> {
    const operationId = `register_adapters_${Date.now()}`;
    this.startTimer(operationId);

    try {
      // Verify that adapters are already registered by AdaptersModule
      const expectedAdapters = ["binance", "coinbase", "cryptocom", "kraken", "okx", "ccxt-multi-exchange"];

      let availableCount = 0;
      let missingAdapters: string[] = [];

      for (const adapterName of expectedAdapters) {
        if (this.adapterRegistry.has(adapterName)) {
          availableCount++;
          this.logDebug(`Exchange adapter available: ${adapterName}`, "adapter_verification", {
            sourceId: adapterName,
          });
        } else {
          missingAdapters.push(adapterName);
        }
      }

      if (missingAdapters.length > 0) {
        this.logWarning(`Missing adapters: ${missingAdapters.join(", ")}`, "adapter_verification", {
          missingCount: missingAdapters.length,
          totalExpected: expectedAdapters.length,
        });
      }

      this.logCriticalOperation(
        "verify_exchange_adapters",
        {
          totalExpected: expectedAdapters.length,
          availableCount,
          missingCount: missingAdapters.length,
        },
        missingAdapters.length === 0
      );
    } catch (error) {
      const errObj = error instanceof Error ? error : new Error(String(error));
      this.logFatal(`Exchange adapters verification failed: ${errObj.message}`, "verify_exchange_adapters", {
        severity: "critical",
        error: errObj.message,
        stack: errObj.stack,
      });
      throw error;
    } finally {
      // Always end the timer, regardless of success or failure
      this.endTimer(operationId);
    }
  }

  private async initializeErrorHandling(): Promise<void> {
    this.logger.log("Initializing error handling for data sources...");

    try {
      // Connect error handler to data manager events
      this.dataManager.on("sourceError", (sourceId: string, error: Error) => {
        this.logger.error(`Data source error from ${sourceId}:`, error);
        void this.handleSourceError(sourceId, error);
      });

      // Connect connection recovery to data manager disconnection events
      this.dataManager.on("sourceDisconnected", (sourceId: string) => {
        this.logger.warn(`Data source ${sourceId} disconnected`);
        this.handleSourceDisconnection(sourceId);
      });

      // Connect data manager unhealthy source events
      this.dataManager.on("sourceUnhealthy", (sourceId: string) => {
        // Rate limit health warnings to prevent spam
        const now = Date.now();
        const lastLogged = this.healthWarningLastLogged.get(sourceId) || 0;

        if (now - lastLogged > this.HEALTH_WARNING_COOLDOWN_MS) {
          this.logger.warn(`Data source ${sourceId} is unhealthy`);
          this.healthWarningLastLogged.set(sourceId, now);
        }

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
      this.connectionRecovery.on(
        "failoverCompleted",
        (sourceId: string, result: { success: boolean; timestamp: number; attempts: number }) => {
          this.handleConnectionRecoveryEvent("failoverCompleted", sourceId, result);
        }
      );

      this.connectionRecovery.on(
        "failoverFailed",
        (sourceId: string, result: { success: boolean; error: string; attempts: number }) => {
          this.handleConnectionRecoveryEvent("failoverFailed", sourceId, result);
        }
      );

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
    this.logger.log("Registering data sources (connections handled by orchestrator)...");

    try {
      const adapters = this.adapterRegistry.getFiltered({ isActive: true });
      let registeredCount = 0;

      for (const adapter of adapters) {
        try {
          // Create data source from adapter (but don't connect - orchestrator handles this)
          const dataSource = this.createDataSourceFromAdapter(adapter);

          // Register with connection recovery service for error handling
          await this.connectionRecovery.registerDataSource(dataSource);

          // Register circuit breaker for the data source with more lenient settings
          this.circuitBreaker.registerCircuit(dataSource.id, {
            failureThreshold: 20, // Even more lenient for individual data sources
            recoveryTimeout: 30000, // Longer recovery time
            successThreshold: 1, // Lower success threshold
            timeout: 15000, // Longer timeout
          });

          // Add to data manager (without connecting)
          await this.dataManager.addDataSource(dataSource);

          registeredCount++;
          this.logger.log(`Registered data source: ${adapter.exchangeName} (${registeredCount}/${adapters.length})`);

          // Trigger garbage collection after each registration to manage memory
          if (global.gc) {
            const memBefore = process.memoryUsage();
            global.gc();
            const memAfter = process.memoryUsage();
            const freed = memBefore.heapUsed - memAfter.heapUsed;
            this.logger.debug(
              `GC after ${adapter.exchangeName} registration: freed ${(freed / 1024 / 1024).toFixed(2)}MB`
            );
          }

          // Small delay between registrations to prevent overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 50));
        } catch (error) {
          this.logger.error(`Failed to register data source ${adapter.exchangeName}:`, error);

          // Handle error through standardized error handler
          const errObj = error instanceof Error ? error : new Error(String(error));
          await this.errorHandler
            .executeWithStandardizedHandling(
              async () => {
                throw errObj;
              },
              {
                serviceId: "DataSourceIntegrationService",
                operationName: "dataSourceStartup",
                component: "dataSourceStartup",
                requestId: `startup_${adapter.exchangeName}_${Date.now()}`,
              }
            )
            .catch(() => {}); // Catch to prevent double throw

          // Continue with other adapters
        }
      }

      this.logger.log(
        `Data sources registered (${registeredCount}/${adapters.length}) - connections managed by orchestrator`
      );
    } catch (error) {
      this.logger.error("Failed to register data sources:", error);
      throw error;
    }
  }

  private async wireDataFlow(): Promise<void> {
    this.logger.log("Wiring data flow connections...");

    try {
      // Connect data manager to emit price updates
      this.dataManager.on("priceUpdate", async (update: PriceUpdate) => {
        await this.handlePriceUpdate(update);
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
  private async handlePriceUpdate(update: PriceUpdate): Promise<void> {
    try {
      // Update adapter health
      this.adapterRegistry.updateHealthStatus(update.source, "healthy");

      // Emit for price aggregation coordination
      this.emit("priceUpdate", update);

      this.logger.debug(`Processed price update from ${update.source}: ${update.symbol} = ${update.price}`);
    } catch (error) {
      this.logger.error(`Error handling price update from ${update.source}:`, error);
      this.adapterRegistry.updateHealthStatus(update.source, "unhealthy");
      const errObj = error instanceof Error ? error : new Error(String(error));
      await this.handleSourceError(update.source, errObj);
    }
  }

  private async handleSourceError(sourceId: string, error: Error): Promise<void> {
    try {
      // Handle through standardized error handler
      await this.errorHandler
        .executeWithStandardizedHandling(
          async () => {
            throw error;
          },
          {
            serviceId: "DataSourceIntegrationService",
            operationName: "dataSourceError",
            component: "dataSource",
            requestId: `error_${sourceId}_${Date.now()}`,
          }
        )
        .catch(() => {}); // Catch to prevent double throw

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
      // Use WebSocket orchestrator for intelligent reconnection
      void this.wsOrchestrator.reconnectExchange(sourceId);

      // Also trigger connection recovery as backup
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

      // Use consistent circuit breaker behavior across all environments
      this.circuitBreaker.openCircuit(sourceId, "Source unhealthy");

      // Emit for system health monitoring
      this.emit("sourceUnhealthy", sourceId);

      this.logger.debug(`Handled unhealthy source ${sourceId} - circuit breaker opened`);
    } catch (error) {
      this.logger.error(`Error handling unhealthy source ${sourceId}:`, error);
    }
  }

  private sourceFailureCounts = new Map<string, number>();

  private resetSourceFailureCount(sourceId: string): void {
    this.sourceFailureCounts.delete(sourceId);
  }

  private handleSourceHealthy(sourceId: string): void {
    try {
      // Update adapter health status
      this.adapterRegistry.updateHealthStatus(sourceId, "healthy");

      // Reset failure count when source becomes healthy
      this.resetSourceFailureCount(sourceId);

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

      // Reset failure count when source recovers
      this.resetSourceFailureCount(sourceId);

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

  private handleConnectionRecoveryEvent(eventType: string, sourceId: string, result?: unknown): void {
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
  private createDataSourceFromAdapter(adapter: IExchangeAdapter): DataSource {
    const priority = this.getAdapterPriority(adapter.exchangeName);
    return this.dataSourceFactory.createFromAdapter(adapter, priority);
  }

  private getAdapterPriority(exchangeName: string): number {
    // Tier 1 exchanges get higher priority
    const tier1Exchanges = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    return tier1Exchanges.includes(exchangeName) ? 1 : 2;
  }

  private getPrimarySourcesForFeed(_feedId: CoreFeedId): string[] {
    // Get primary sources for the feed from configuration
    // This would typically come from feed configuration
    return ["binance", "coinbase", "kraken"];
  }

  private getBackupSourcesForFeed(_feedId: CoreFeedId): string[] {
    // Get backup sources for the feed from configuration
    return ["okx", "cryptocom"];
  }
}
