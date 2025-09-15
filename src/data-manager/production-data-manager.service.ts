import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { ErrorCode } from "@/common/types/error-handling";
import { ConfigService } from "@/config/config.service";

import type { AggregatedPrice, BaseServiceConfig } from "@/common/types/services";
import type { CoreFeedId, DataSource, PriceUpdate } from "@/common/types/core";
import type { HealthCheckResult } from "@/common/types/monitoring";
import type {
  ProductionDataManager,
  ConnectionHealth,
  ConnectionMetrics,
  SourceSubscription,
  DataFreshnessPolicy,
} from "@/common/types/data-manager";
import {
  hasReconnectionCapability,
  hasRestFallbackCapability,
  hasHealthCheckCapability,
} from "@/common/types/data-manager";

interface IReconnectConfig extends BaseServiceConfig {
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  maxAttempts: number;
}

@Injectable()
export class ProductionDataManagerService extends EventDrivenService implements ProductionDataManager {
  // Data sources management
  private dataSources = new Map<string, DataSource>();
  private connectionMetrics = new Map<string, ConnectionMetrics>();
  private subscriptions = new Map<string, SourceSubscription[]>();

  // Real-time data management properties
  readonly maxDataAge = 2000; // milliseconds (Requirement 6.1)
  readonly maxCacheTTL = 1000; // milliseconds (Requirement 6.2)

  // Data freshness policy
  private readonly dataFreshnessPolicy: DataFreshnessPolicy = {
    rejectStaleData: true,
    staleThresholdMs: 2000,
    realTimePriority: true,
    cacheBypassOnFreshData: true,
  };

  // Active reconnection timers
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private healthMonitorInterval?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    super({
      initialDelay: 1000,
      maxDelay: 30000,
      backoffMultiplier: 2,
      maxAttempts: 10,
      useEnhancedLogging: true,
    });
    this.setupHealthMonitoring();
  }

  /**
   * Get the typed configuration for this service
   */
  private get reconnectConfig(): IReconnectConfig {
    return this.config as IReconnectConfig;
  }

  // Failover and recovery methods
  async triggerSourceFailover(sourceId: string, reason: string): Promise<boolean> {
    const operationId = `failover_${sourceId}_${Date.now()}`;
    this.startTimer(operationId);

    try {
      this.enhancedLogger?.logErrorRecovery(sourceId, "connection_failure", "source_failover", false, {
        reason,
        phase: "starting",
      });

      const source = this.dataSources.get(sourceId);
      if (!source) {
        this.enhancedLogger?.error(`Cannot failover unknown source: ${sourceId}`, {
          component: "ProductionDataManager",
          operation: "source_failover",
          sourceId,
          severity: "high",
        });
        this.endTimer(operationId);
        return false;
      }

      // Mark source as unhealthy
      const metrics = this.connectionMetrics.get(sourceId);
      if (metrics) {
        metrics.isHealthy = false;
      }

      // Attempt reconnection for WebSocket sources
      if (source.type === "websocket" && "attemptReconnection" in source) {
        this.enhancedLogger?.logConnection(sourceId, "reconnecting", {
          sourceType: source.type,
          reason,
        });

        try {
          if (!hasReconnectionCapability(source)) {
            throw new Error("Source does not support reconnection");
          }
          const reconnected = await source.attemptReconnection();
          if (reconnected) {
            this.enhancedLogger?.logConnection(sourceId, "connected", {
              recoveryMethod: "websocket_reconnection",
            });

            if (metrics) {
              metrics.isHealthy = true;
              metrics.reconnectAttempts = 0;
            }

            this.enhancedLogger?.logErrorRecovery(sourceId, "connection_failure", "websocket_reconnection", true);
            this.endTimer(operationId);
            this.emit("sourceRecovered", sourceId);
            return true;
          }
        } catch (reconnectError) {
          const errMsg = reconnectError instanceof Error ? reconnectError.message : String(reconnectError);
          this.enhancedLogger?.error(errMsg, {
            component: "ProductionDataManager",
            operation: "websocket_reconnection",
            sourceId,
            severity: "medium",
          });
        }
      }

      // Try REST fallback for subscribed symbols
      const subscriptions = this.subscriptions.get(sourceId) || [];
      let restFallbackSuccess = false;
      let processedSymbols = 0;

      for (const subscription of subscriptions) {
        for (const symbol of subscription.symbols) {
          try {
            if (hasRestFallbackCapability(source)) {
              const restUpdate = await source.fetchPriceViaREST(symbol);
              if (restUpdate) {
                this.processUpdateImmediately(restUpdate);
                restFallbackSuccess = true;
                processedSymbols++;

                this.enhancedLogger?.logPriceUpdate(
                  symbol,
                  sourceId,
                  restUpdate.price,
                  restUpdate.timestamp,
                  restUpdate.confidence
                );
              }
            }
          } catch (restError) {
            const errMsg = restError instanceof Error ? restError.message : String(restError);
            this.enhancedLogger?.error(errMsg, {
              component: "ProductionDataManager",
              operation: "rest_fallback",
              sourceId,
              symbol,
              severity: "medium",
            });
          }
        }
      }

      if (restFallbackSuccess) {
        this.enhancedLogger?.logErrorRecovery(sourceId, "connection_failure", "rest_fallback", true, {
          processedSymbols,
          totalSubscriptions: subscriptions.length,
        });

        this.endTimer(operationId);

        this.emit("restFallbackActivated", sourceId);
        return true;
      }

      // Failover unsuccessful
      this.enhancedLogger?.logErrorRecovery(sourceId, "connection_failure", "source_failover", false, {
        reason: "no_recovery_method_successful",
      });

      this.endTimer(operationId);

      // Emit failover event for external handling
      this.emit("sourceFailover", sourceId, reason);
      return false;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.enhancedLogger?.error(errMsg, {
        component: "ProductionDataManager",
        operation: "source_failover",
        sourceId,
        severity: "high",
      });

      this.endTimer(operationId);
      return false;
    }
  }

  async recoverSource(sourceId: string): Promise<boolean> {
    try {
      this.logger.log(`Attempting to recover source: ${sourceId}`);

      const source = this.dataSources.get(sourceId);
      if (!source) {
        return false;
      }

      // Cancel any pending reconnection attempts
      const timer = this.reconnectTimers.get(sourceId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(sourceId);
      }

      // Attempt recovery
      if (hasReconnectionCapability(source)) {
        const recovered = await source.attemptReconnection();
        if (recovered) {
          const metrics = this.connectionMetrics.get(sourceId);
          if (metrics) {
            metrics.isHealthy = true;
            metrics.reconnectAttempts = 0;
            metrics.lastUpdate = Date.now();
          }

          this.logger.log(`Source recovery successful: ${sourceId}`);
          this.emit("sourceRecovered", sourceId);
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error(`Error recovering source ${sourceId}:`, error);
      return false;
    }
  }

  getSourceHealthMetrics(sourceId: string): HealthCheckResult | undefined {
    const source = this.dataSources.get(sourceId);
    const metrics = this.connectionMetrics.get(sourceId);

    if (!source || !metrics) {
      return undefined;
    }

    const now = Date.now();
    const details = {
      component: sourceId,
      status: metrics.isHealthy && source.isConnected() ? ("healthy" as const) : ("unhealthy" as const),
      timestamp: now,
      metrics: {
        uptime: metrics.uptime,
        memoryUsage: 0,
        cpuUsage: 0,
        connectionCount: 1,
      },
    };

    return {
      isHealthy: metrics.isHealthy && source.isConnected(),
      details,
      timestamp: now,
    };
  }

  // Cleanup
  public override async cleanup(): Promise<void> {
    // Clear all reconnection timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Clear health monitoring interval
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = undefined;
    }
  }

  // Test helper method to manually emit price updates
  emitPriceUpdate(update: PriceUpdate): void {
    this.logger.debug(`Manually emitting priceUpdate event for ${update.symbol} from ${update.source}`);
    this.emit("priceUpdate", update);
  }

  // Test helper method to manually emit source errors
  emitSourceError(sourceId: string, error: Error): void {
    this.logger.debug(`Manually emitting sourceError event for ${sourceId}`);
    this.emit("sourceError", sourceId, error);
  }

  // Test helper method to manually emit source disconnection
  emitSourceDisconnected(sourceId: string): void {
    this.logger.debug(`Manually emitting sourceDisconnected event for ${sourceId}`);
    this.emit("sourceDisconnected", sourceId);
  }

  // Connection management methods
  async addDataSource(source: DataSource): Promise<void> {
    try {
      this.logger.log(`Adding data source: ${source.id}`);

      // Initialize connection metrics
      this.connectionMetrics.set(source.id, {
        sourceId: source.id,
        isHealthy: false,
        lastUpdate: Date.now(),
        errorCount: 0,
        successCount: 0,
        reconnectAttempts: 0,
        averageLatency: 0,
        latency: 0,
        uptime: 0,
      });

      // Set up event handlers
      this.setupSourceEventHandlers(source);

      // Store the source
      this.dataSources.set(source.id, source);

      // Attempt initial connection if it's a WebSocket source
      if (source.type === "websocket") {
        await this.connectWithRetry(source);
      }

      this.logger.log(`Data source ${source.id} added successfully`);
      this.emit("sourceAdded", source.id);
    } catch (error) {
      this.logger.error(`Failed to add data source ${source.id}:`, error);
      throw error;
    }
  }

  async removeDataSource(sourceId: string): Promise<void> {
    try {
      this.logger.log(`Removing data source: ${sourceId}`);

      const source = this.dataSources.get(sourceId);
      if (!source) {
        this.logger.warn(`Data source ${sourceId} not found`);
        return;
      }

      // Cancel any active reconnection attempts
      const timer = this.reconnectTimers.get(sourceId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(sourceId);
      }

      // Unsubscribe from all feeds for this source
      const subscriptions = this.subscriptions.get(sourceId) || [];
      for (const subscription of subscriptions) {
        await source.unsubscribe(subscription.symbols);
      }

      // Clean up
      this.dataSources.delete(sourceId);
      this.connectionMetrics.delete(sourceId);
      this.subscriptions.delete(sourceId);

      this.logger.log(`Data source ${sourceId} removed successfully`);
      this.emit("sourceRemoved", sourceId);
    } catch (error) {
      this.logger.error(`Failed to remove data source ${sourceId}:`, error);
      throw error;
    }
  }

  getConnectedSources(): DataSource[] {
    return Array.from(this.dataSources.values()).filter(source => source.isConnected());
  }

  // Feed-specific exchange selection methods
  /**
   * Get the specific exchanges configured for a feed from feeds.json
   */
  private getConfiguredExchangesForFeed(feedId: CoreFeedId): string[] {
    const feedConfig = this.configService.getFeedConfiguration(feedId);
    if (!feedConfig) {
      this.logger.warn(`No configuration found for feed: ${feedId.name}`);
      return [];
    }

    return feedConfig.sources.map(source => source.exchange);
  }

  /**
   * Get data sources for a specific feed based on feeds.json configuration
   */
  private getSourcesForFeed(feedId: CoreFeedId): DataSource[] {
    const configuredExchanges = this.getConfiguredExchangesForFeed(feedId);
    const sources: DataSource[] = [];

    for (const exchange of configuredExchanges) {
      const source = this.getDataSourceForExchange(exchange);
      if (source && source.isConnected()) {
        sources.push(source);
      } else {
        this.logger.warn(`Exchange ${exchange} not available for feed ${feedId.name}`);
      }
    }

    if (sources.length === 0) {
      this.logger.error(
        `No available sources for feed ${feedId.name}. Configured exchanges: ${configuredExchanges.join(", ")}`
      );
    }

    return sources;
  }

  /**
   * Get data source for a specific exchange
   */
  private getDataSourceForExchange(exchange: string): DataSource | null {
    // First try to find by exact exchange name
    let source = this.dataSources.get(exchange);
    if (source) {
      return source;
    }

    // Check if this is a custom adapter exchange
    if (this.configService.hasCustomAdapter(exchange)) {
      // Try to find by adapter name pattern
      for (const [sourceId, dataSource] of this.dataSources.entries()) {
        if (
          sourceId.toLowerCase().includes(exchange.toLowerCase()) ||
          exchange.toLowerCase().includes(sourceId.toLowerCase())
        ) {
          return dataSource;
        }
      }
    } else {
      // This is a CCXT exchange - find the CCXT adapter
      const ccxtSource = this.dataSources.get("ccxt-multi-exchange");
      if (ccxtSource) {
        return ccxtSource;
      }
    }

    return null;
  }

  /**
   * Validate that all configured exchanges for a feed are available
   */
  private validateFeedSources(feedId: CoreFeedId): { isValid: boolean; missingExchanges: string[] } {
    const configuredExchanges = this.getConfiguredExchangesForFeed(feedId);
    const missingExchanges: string[] = [];

    for (const exchange of configuredExchanges) {
      const source = this.getDataSourceForExchange(exchange);
      if (!source || !source.isConnected()) {
        missingExchanges.push(exchange);
      }
    }

    return {
      isValid: missingExchanges.length === 0,
      missingExchanges,
    };
  }

  /**
   * Get price updates from feed-specific sources
   */
  async getPriceUpdatesForFeed(feedId: CoreFeedId): Promise<PriceUpdate[]> {
    const configuredExchanges = this.getConfiguredExchangesForFeed(feedId);
    const priceUpdates: PriceUpdate[] = [];

    for (const exchange of configuredExchanges) {
      try {
        const source = this.getDataSourceForExchange(exchange);
        if (!source) {
          this.logger.debug(`Source not found for exchange ${exchange}`);
          continue;
        }

        // Check if this is a CCXT exchange
        if (!this.configService.hasCustomAdapter(exchange)) {
          // This is a CCXT exchange - get price from specific exchange
          const adapterDataSource = source as {
            getAdapter?: () => {
              getPriceFromExchange?: (exchange: string, feedId: CoreFeedId) => Promise<PriceUpdate | null>;
            };
          }; // Cast to AdapterDataSource
          if (adapterDataSource.getAdapter && "getPriceFromExchange" in adapterDataSource.getAdapter()) {
            const ccxtAdapter = adapterDataSource.getAdapter();
            if (ccxtAdapter?.getPriceFromExchange) {
              const priceUpdate = await ccxtAdapter.getPriceFromExchange(exchange, feedId);
              if (priceUpdate) {
                priceUpdates.push(priceUpdate);
              }
            }
          }
        } else {
          // This is a custom adapter - use REST fallback
          if (hasRestFallbackCapability(source)) {
            const restUpdate = await source.fetchPriceViaREST(feedId.name);
            if (restUpdate) {
              priceUpdates.push(restUpdate);
            }
          }
        }
      } catch (error) {
        this.logger.debug(`Failed to get price from ${exchange} for ${feedId.name}:`, error);
      }
    }

    return priceUpdates;
  }

  // Real-time data management methods
  async subscribeToFeed(feedId: CoreFeedId): Promise<void> {
    this.logger.log(`Subscribing to feed: ${feedId.name}`);

    const symbol = feedId.name;

    // Validate that all configured exchanges are available
    const validation = this.validateFeedSources(feedId);
    if (!validation.isValid) {
      this.logger.warn(`Missing exchanges for feed ${feedId.name}: ${validation.missingExchanges.join(", ")}`);
    }

    // Get only the sources configured for this specific feed
    const feedSources = this.getSourcesForFeed(feedId);

    if (feedSources.length === 0) {
      throw new Error(
        `No available data sources for feed ${feedId.name}. Check feed configuration and adapter availability.`
      );
    }

    this.logger.log(`Subscribing to ${feedSources.length} configured sources for feed ${feedId.name}`);

    // Subscribe only to feed-specific sources
    for (const source of feedSources) {
      try {
        await source.subscribe([symbol]);

        // Track subscription
        const sourceSubscriptions = this.subscriptions.get(source.id) || [];
        sourceSubscriptions.push({
          sourceId: source.id,
          feedId,
          symbols: [symbol],
          timestamp: Date.now(),
          lastUpdate: Date.now(),
          active: true,
        });
        this.subscriptions.set(source.id, sourceSubscriptions);

        this.logger.debug(`Successfully subscribed ${source.id} to ${symbol}`);
      } catch (error) {
        this.logger.error(`Failed to subscribe to ${symbol} on ${source.id}:`, error);
      }
    }
  }

  async unsubscribeFromFeed(feedId: CoreFeedId): Promise<void> {
    this.logger.log(`Unsubscribing from feed: ${feedId.name}`);

    const symbol = feedId.name;

    for (const [sourceId, subscriptions] of this.subscriptions.entries()) {
      const source = this.dataSources.get(sourceId);
      if (!source) continue;

      // Find and remove subscription
      const subscriptionIndex = subscriptions.findIndex(
        sub => sub.feedId.name === feedId.name && sub.feedId.category === feedId.category
      );

      if (subscriptionIndex >= 0) {
        try {
          await source.unsubscribe([symbol]);
          subscriptions.splice(subscriptionIndex, 1);
        } catch (error) {
          this.logger.error(`Failed to unsubscribe from ${symbol} on ${sourceId}:`, error);
        }
      }
    }
  }

  // Health monitoring methods
  async getConnectionHealth(): Promise<ConnectionHealth> {
    const totalSources = this.dataSources.size;
    const connectedSources = this.getConnectedSources().length;
    const failedSources: string[] = [];
    let totalLatency = 0;
    let healthySources = 0;

    for (const [sourceId, metrics] of this.connectionMetrics.entries()) {
      if (metrics.isHealthy) {
        totalLatency += metrics.latency;
        healthySources++;
      } else {
        failedSources.push(sourceId);
      }
    }

    // Calculate health score as percentage of healthy sources
    const healthScore = totalSources > 0 ? (healthySources / totalSources) * 100 : 0;

    return {
      totalSources,
      connectedSources,
      averageLatency: healthySources > 0 ? totalLatency / healthySources : 0,
      failedSources,
      healthScore,
    };
  }

  async getDataFreshness(feedId: CoreFeedId): Promise<number> {
    let mostRecentUpdate = 0;

    for (const [, subscriptions] of this.subscriptions.entries()) {
      const subscription = subscriptions.find(
        sub => sub.feedId.name === feedId.name && sub.feedId.category === feedId.category
      );

      if (subscription && subscription.lastUpdate > mostRecentUpdate) {
        mostRecentUpdate = subscription.lastUpdate;
      }
    }

    return mostRecentUpdate > 0 ? Date.now() - mostRecentUpdate : Infinity;
  }

  // Real-time data management implementation
  prioritizeRealTimeData(): boolean {
    return this.dataFreshnessPolicy.realTimePriority;
  }

  processUpdateImmediately(update: PriceUpdate): void {
    // Validate data freshness
    const age = Date.now() - update.timestamp;
    if (age > this.maxDataAge) {
      this.enhancedLogger?.warn(`Rejecting stale data from ${update.source}: age ${age}ms`, {
        component: "ProductionDataManager",
        operation: "process_update",
        sourceId: update.source,
        symbol: update.symbol,
        metadata: {
          age,
          maxDataAge: this.maxDataAge,
          price: update.price,
          confidence: update.confidence,
        },
      });
      return;
    }

    // Update subscription timestamp
    this.updateSubscriptionTimestamp(update);

    // Log the price update with enhanced context
    this.enhancedLogger?.logPriceUpdate(
      update.symbol,
      update.source,
      update.price,
      update.timestamp,
      update.confidence
    );

    // Emit for immediate processing
    this.enhancedLogger?.debug(`Emitting priceUpdate event for ${update.symbol} from ${update.source}`, {
      component: "ProductionDataManager",
      operation: "emit_price_update",
      sourceId: update.source,
      symbol: update.symbol,
      metadata: {
        price: update.price,
        confidence: update.confidence,
        age,
      },
    });

    this.emit("priceUpdate", update);
  }

  maintainVotingRoundHistory(rounds: number): void {
    // This will be implemented when historical data storage is added
    this.logger.debug(`Maintaining history for ${rounds} voting rounds`);
  }

  // Price retrieval methods - integrated with aggregation service
  async getCurrentPrice(feedId: CoreFeedId): Promise<AggregatedPrice> {
    try {
      // Check if we have recent data for this feed
      const freshness = await this.getDataFreshness(feedId);

      if (freshness === Infinity) {
        throw new Error(`No data available for feed ${feedId.name}`);
      }

      if (freshness > this.maxDataAge) {
        throw new Error(`Data too stale for feed ${feedId.name}: ${freshness}ms old`);
      }

      // For now, we emit a request for current price and let the aggregation service handle it
      // In a fully integrated system, this would directly call the aggregation service
      this.emit("priceRequest", feedId);

      // This is a placeholder implementation - in the real system, this would:
      // 1. Query the aggregation service directly
      // 2. Return cached aggregated price if fresh enough
      // 3. Trigger fresh aggregation if needed
      throw new Error(`getCurrentPrice requires aggregation service integration for ${feedId.name}`);
    } catch (error) {
      this.logger.error(`Error getting current price for ${feedId.name}:`, error);
      throw error;
    }
  }

  async getCurrentPrices(feedIds: CoreFeedId[]): Promise<AggregatedPrice[]> {
    try {
      const results = await Promise.allSettled(feedIds.map(feedId => this.getCurrentPrice(feedId)));

      return results
        .filter((result): result is PromiseFulfilledResult<AggregatedPrice> => result.status === "fulfilled")
        .map(result => result.value);
    } catch (error) {
      this.logger.error(`Error getting current prices for ${feedIds.length} feeds:`, error);
      throw error;
    }
  }

  // Private helper methods
  private setupSourceEventHandlers(source: DataSource): void {
    // Handle price updates
    source.onPriceUpdate((update: PriceUpdate) => {
      try {
        // Update connection metrics first
        this.updateConnectionMetrics(source.id, update.timestamp);

        // Validate update quality
        if (this.validatePriceUpdateQuality(update)) {
          this.processUpdateImmediately(update);
        } else {
          this.logger.warn(
            `Low quality price update from ${source.id} for ${update.symbol}: confidence ${update.confidence}`
          );
          // Still process but with lower priority
          this.processUpdateImmediately(update);
        }
      } catch (error) {
        this.logger.error(`Error processing price update from ${source.id}:`, error);
        this.emit("sourceError", source.id, error);
      }
    });

    // Handle connection changes
    source.onConnectionChange((connected: boolean) => {
      this.handleConnectionChange(source.id, connected);
    });

    // Handle source errors (if the DataSource supports error events)
    if (typeof source.onError === "function") {
      source.onError((error: Error) => {
        this.logger.error(`Error from data source ${source.id}:`, error);

        // Classify error and emit with additional context
        const errorContext = {
          sourceId: source.id,
          sourceType: source.type,
          timestamp: Date.now(),
          errorType: (error as Error & { errorType?: string }).errorType || ErrorCode.UNKNOWN_ERROR,
        };

        this.emit("sourceError", source.id, error, errorContext);

        // Update connection metrics to reflect error
        const metrics = this.connectionMetrics.get(source.id);
        if (metrics) {
          metrics.isHealthy = false;
        }
      });
    }
  }

  private validatePriceUpdateQuality(update: PriceUpdate): boolean {
    // Quality thresholds
    const MIN_CONFIDENCE = 0.3;
    const MAX_AGE_MS = 10000; // 10 seconds

    // Check confidence level
    if (update.confidence < MIN_CONFIDENCE) {
      return false;
    }

    // Check data age
    const age = Date.now() - update.timestamp;
    if (age > MAX_AGE_MS) {
      return false;
    }

    return true;
  }

  private async connectWithRetry(source: DataSource): Promise<void> {
    const sourceId = source.id;
    const metrics = this.connectionMetrics.get(sourceId);

    if (!metrics) {
      throw new Error(`No metrics found for source ${sourceId}`);
    }

    await this.executeWithErrorHandling(
      async () => {
        // Attempt connection (this would be implemented in the actual DataSource)
        // For now, we'll simulate the connection attempt
        this.logger.log(`Attempting to connect to ${sourceId}`);

        // Update metrics on successful connection
        metrics.isHealthy = true;
        metrics.reconnectAttempts = 0;
        metrics.lastUpdate = Date.now();
      },
      `connect_data_source_${sourceId}`,
      {
        retries: this.reconnectConfig.maxAttempts - 1,
        retryDelay: this.reconnectConfig.initialDelay,
        shouldThrow: false,
        onError: (error, attempt) => {
          this.logger.error(`Connection failed for ${sourceId} (attempt ${attempt}):`, error);

          // Emit error event for error handling services
          this.emit("sourceError", sourceId, error);

          // Update metrics to reflect failure
          metrics.isHealthy = false;
          metrics.reconnectAttempts = attempt;
        },
      }
    );
  }

  // Removed scheduleReconnection method - now handled by error handling mixin

  private handleConnectionChange(sourceId: string, connected: boolean): void {
    const metrics = this.connectionMetrics.get(sourceId);
    if (!metrics) return;

    metrics.isHealthy = connected;

    if (connected) {
      this.logger.log(`Data source ${sourceId} connected`);
      metrics.reconnectAttempts = 0;

      // Cancel any pending reconnection
      const timer = this.reconnectTimers.get(sourceId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectTimers.delete(sourceId);
      }

      this.emit("sourceConnected", sourceId);
    } else {
      this.logger.warn(`Data source ${sourceId} disconnected`);

      // Schedule reconnection for WebSocket sources
      const source = this.dataSources.get(sourceId);
      if (source && source.type === "websocket") {
        // Use the standardized retry mechanism
        void this.connectWithRetry(source);
      }

      this.emit("sourceDisconnected", sourceId);
    }
  }

  private updateConnectionMetrics(sourceId: string, timestamp: number): void {
    const metrics = this.connectionMetrics.get(sourceId);
    if (!metrics) return;

    const now = Date.now();
    metrics.latency = now - timestamp;
    metrics.lastUpdate = now;
    metrics.isHealthy = true;

    // Record latency metric using monitoring mixin
    this.recordMetric(`${sourceId}_latency_ms`, metrics.latency);
  }

  private updateSubscriptionTimestamp(update: PriceUpdate): void {
    const subscriptions = this.subscriptions.get(update.source);
    if (!subscriptions) return;

    for (const subscription of subscriptions) {
      if (subscription.symbols.includes(update.symbol)) {
        subscription.lastUpdate = update.timestamp;
      }
    }
  }

  private setupHealthMonitoring(): void {
    // Run health checks every 30 seconds
    this.healthMonitorInterval = setInterval(() => {
      void this.performHealthCheck();
    }, 30000);
  }

  private async performHealthCheck(): Promise<void> {
    const now = Date.now();

    for (const [sourceId, metrics] of this.connectionMetrics.entries()) {
      const source = this.dataSources.get(sourceId);
      if (!source) continue;

      const timeSinceLastUpdate = now - metrics.lastUpdate;

      // Perform comprehensive health check
      let isHealthy = metrics.isHealthy;

      // Check for stale data
      if (timeSinceLastUpdate > 60000) {
        isHealthy = false;
      }

      // Check connection status
      if (!source.isConnected()) {
        isHealthy = false;
      }

      // Check latency
      if (source.getLatency() > 5000) {
        // 5 second latency threshold
        isHealthy = false;
      }

      // Perform adapter-specific health check if available
      try {
        if (hasHealthCheckCapability(source)) {
          const adapterHealthy = await source.performHealthCheck();
          if (!adapterHealthy) {
            isHealthy = false;
          }
        }
      } catch (error) {
        this.logger.error(`Health check failed for ${sourceId}:`, error);
        isHealthy = false;
      }

      // Update health status if changed
      if (metrics.isHealthy !== isHealthy) {
        metrics.isHealthy = isHealthy;

        if (!isHealthy) {
          this.logger.warn(`Data source ${sourceId} marked as unhealthy - last update: ${timeSinceLastUpdate}ms ago`);
          this.emit("sourceUnhealthy", sourceId);
        } else {
          this.logger.log(`Data source ${sourceId} marked as healthy`);
          this.emit("sourceHealthy", sourceId);
        }
      }
    }

    // Calculate overall service health based on connection health
    const totalConnections = this.connectionMetrics.size;
    const healthyConnections = Array.from(this.connectionMetrics.values()).filter(m => m.isHealthy).length;

    if (totalConnections === 0) {
      this.setHealthStatus("degraded");
    } else {
      const healthyRatio = healthyConnections / totalConnections;
      if (healthyRatio >= 0.8) {
        this.setHealthStatus("healthy");
      } else if (healthyRatio >= 0.5) {
        this.setHealthStatus("degraded");
      } else {
        this.setHealthStatus("unhealthy");
      }
    }
  }
}
