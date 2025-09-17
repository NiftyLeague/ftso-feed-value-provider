import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { ErrorCode } from "@/common/types/error-handling";
import { ConfigService } from "@/config/config.service";
import { DATA_AGE_THRESHOLDS } from "@/common/constants/data-age-thresholds";

import type { AggregatedPrice } from "@/common/types/services";
import type { CoreFeedId, DataSource, PriceUpdate } from "@/common/types/core";
import type {
  ProductionDataManager,
  ConnectionHealth,
  ConnectionMetrics,
  SourceSubscription,
  DataFreshnessPolicy,
} from "@/common/types/data-manager";
import { hasRestFallbackCapability, hasHealthCheckCapability } from "@/common/types/data-manager";

interface ServicePerformanceMetrics {
  uptime: number;
  responseTime: {
    average: number;
    p95: number;
    max: number;
  };
  requestsPerSecond: number;
  errorRate: number;
}

@Injectable()
export class ProductionDataManagerService extends EventDrivenService implements ProductionDataManager {
  // Data sources management
  private dataSources = new Map<string, DataSource>();
  private connectionMetrics = new Map<string, ConnectionMetrics>();
  private subscriptions = new Map<string, SourceSubscription[]>();

  // Real-time data management properties
  readonly maxDataAge = DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS;
  readonly maxCacheTTL = DATA_AGE_THRESHOLDS.CACHE_TTL_MS;

  // Data freshness policy
  private readonly dataFreshnessPolicy: DataFreshnessPolicy = {
    rejectStaleData: true,
    staleThresholdMs: DATA_AGE_THRESHOLDS.FRESH_DATA_MS,
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
      if (timeSinceLastUpdate > DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS) {
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

  override async cleanup(): Promise<void> {
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

      // Attempt initial connection for all sources
      await this.connectWithRetry(source);

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

    // Validate that all configured exchanges are available
    const validation = this.validateFeedSources(feedId);
    if (!validation.isValid) {
      this.logger.warn(`Missing exchanges for feed ${feedId.name}: ${validation.missingExchanges.join(", ")}`);
    }

    // Get feed configuration to get exchange-specific symbols
    const feedConfig = this.configService.getFeedConfiguration(feedId);
    if (!feedConfig) {
      throw new Error(`No configuration found for feed: ${feedId.name}`);
    }

    this.logger.log(`Subscribing to ${feedConfig.sources.length} configured sources for feed ${feedId.name}`);

    // Subscribe to each configured source with its specific symbol
    for (const sourceConfig of feedConfig.sources) {
      try {
        const source = this.getDataSourceForExchange(sourceConfig.exchange);
        if (!source || !source.isConnected()) {
          this.logger.warn(`Source ${sourceConfig.exchange} not available for feed ${feedId.name}`);
          continue;
        }

        // Use the exchange-specific symbol from the configuration
        const exchangeSymbol = sourceConfig.symbol;
        await source.subscribe([exchangeSymbol]);

        // Track subscription
        const sourceSubscriptions = this.subscriptions.get(source.id) || [];
        sourceSubscriptions.push({
          sourceId: source.id,
          feedId,
          symbols: [exchangeSymbol],
          timestamp: Date.now(),
          lastUpdate: Date.now(),
          active: true,
        });
        this.subscriptions.set(source.id, sourceSubscriptions);

        this.logger.debug(`Successfully subscribed ${source.id} to ${exchangeSymbol} for feed ${feedId.name}`);
      } catch (error) {
        this.logger.error(
          `Failed to subscribe to ${sourceConfig.symbol} on ${sourceConfig.exchange} for feed ${feedId.name}:`,
          error
        );
      }
    }
  }

  async unsubscribeFromFeed(feedId: CoreFeedId): Promise<void> {
    this.logger.log(`Unsubscribing from feed: ${feedId.name}`);

    // Get feed configuration to get exchange-specific symbols
    const feedConfig = this.configService.getFeedConfiguration(feedId);
    if (!feedConfig) {
      this.logger.warn(`No configuration found for feed: ${feedId.name}`);
      return;
    }

    for (const [sourceId, subscriptions] of this.subscriptions.entries()) {
      const source = this.dataSources.get(sourceId);
      if (!source) continue;

      // Find and remove subscription
      const subscriptionIndex = subscriptions.findIndex(
        sub => sub.feedId.name === feedId.name && sub.feedId.category === feedId.category
      );

      if (subscriptionIndex >= 0) {
        try {
          // Find the exchange-specific symbol for this source
          const sourceConfig = feedConfig.sources.find(s => s.exchange === sourceId);
          const exchangeSymbol = sourceConfig?.symbol || feedId.name;

          await source.unsubscribe([exchangeSymbol]);
          subscriptions.splice(subscriptionIndex, 1);

          this.logger.debug(`Successfully unsubscribed ${sourceId} from ${exchangeSymbol} for feed ${feedId.name}`);
        } catch (error) {
          this.logger.error(`Failed to unsubscribe from ${feedId.name} on ${sourceId}:`, error);
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
    // Validate data age first
    const age = Date.now() - update.timestamp;
    if (age > DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS) {
      this.enhancedLogger?.warn(`Price update from ${update.source} is too stale to use`, {
        component: "ProductionDataManager",
        operation: "process_update",
        sourceId: update.source,
        metadata: {
          age,
          maxAge: DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS,
          symbol: update.symbol,
          price: update.price,
        },
      });
      return;
    }

    // Early warning for approaching staleness
    if (age > DATA_AGE_THRESHOLDS.STALE_WARNING_MS) {
      this.enhancedLogger?.warn(`Price update from ${update.source} is becoming stale`, {
        component: "ProductionDataManager",
        operation: "process_update",
        sourceId: update.source,
        metadata: {
          age,
          warningThreshold: DATA_AGE_THRESHOLDS.STALE_WARNING_MS,
          symbol: update.symbol,
          price: update.price,
        },
      });
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

      if (freshness > DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS) {
        throw new Error(`Data too stale for feed ${feedId.name}: ${freshness}ms old`);
      }

      // Get fresh price updates for this feed
      const priceUpdates = await this.getPriceUpdatesForFeed(feedId);

      if (priceUpdates.length === 0) {
        throw new Error(`No price updates available for feed ${feedId.name}`);
      }

      // Emit request for aggregation (this will be handled by the aggregation service)
      this.emit("priceRequest", feedId);

      // For now, return a simple aggregated result
      // In a fully integrated system, this would call the RealTimeAggregationService
      const validUpdates = priceUpdates.filter(
        update => update.price > 0 && update.timestamp > Date.now() - DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS
      );

      if (validUpdates.length === 0) {
        throw new Error(`No valid price updates for feed ${feedId.name}`);
      }

      // Simple aggregation: weighted average by confidence
      const totalWeight = validUpdates.reduce((sum, update) => sum + (update.confidence || 0.5), 0);
      const weightedPrice = validUpdates.reduce((sum, update) => sum + update.price * (update.confidence || 0.5), 0);

      const aggregatedPrice: AggregatedPrice = {
        symbol: feedId.name,
        price: weightedPrice / totalWeight,
        timestamp: Date.now(),
        sources: validUpdates.map(update => update.source),
        confidence: totalWeight / validUpdates.length,
        consensusScore: validUpdates.length > 1 ? 0.8 : 0.5, // Higher score for multiple sources
      };

      return aggregatedPrice;
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
    // Check confidence level
    const MIN_CONFIDENCE = 0.3;
    if (update.confidence < MIN_CONFIDENCE) {
      return false;
    }

    // Check data age
    const age = Date.now() - update.timestamp;

    // Log warning if approaching staleness
    if (age > DATA_AGE_THRESHOLDS.STALE_WARNING_MS) {
      this.enhancedLogger?.warn(`Price update from ${update.source} is becoming stale`, {
        component: "ProductionDataManager",
        operation: "validate_price_quality",
        sourceId: update.source,
        metadata: {
          age,
          warningThreshold: DATA_AGE_THRESHOLDS.STALE_WARNING_MS,
          symbol: update.symbol,
          price: update.price,
        },
      });
    }

    // Check if data is too stale
    if (age > DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS) {
      this.enhancedLogger?.warn(`Price update from ${update.source} is too stale to use`, {
        component: "ProductionDataManager",
        operation: "validate_price_quality",
        sourceId: update.source,
        metadata: {
          age,
          maxAge: DATA_AGE_THRESHOLDS.MAX_DATA_AGE_MS,
          symbol: update.symbol,
          price: update.price,
        },
      });
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
        // Attempt connection through the data source
        this.logger.log(`Attempting to connect to ${sourceId}`);

        await source.connect();

        // Update metrics on successful connection
        metrics.isHealthy = true;
        metrics.reconnectAttempts = 0;
        metrics.lastUpdate = Date.now();
      },
      `connect_data_source_${sourceId}`,
      {
        retries: 10,
        retryDelay: 1000,
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
      this.emit("sourceHealthy", sourceId);
    } else {
      this.logger.warn(`Data source ${sourceId} disconnected`);

      // Schedule reconnection for WebSocket sources
      const source = this.dataSources.get(sourceId);
      if (source && source.type === "websocket") {
        // Use the standardized retry mechanism
        void this.connectWithRetry(source);
      }

      this.emit("sourceDisconnected", sourceId);
      this.emit("sourceUnhealthy", sourceId);
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

  getServiceName(): string {
    return "ProductionDataManagerService";
  }

  // IBaseService interface methods
  async getPerformanceMetrics(): Promise<ServicePerformanceMetrics> {
    const uptime = process.uptime();
    const totalRequests = 0; // Will be implemented with actual cache stats
    const requestsPerSecond = totalRequests / uptime;

    // Will be implemented with actual metrics tracking
    const mockResponseTime = 100; // milliseconds

    return {
      uptime,
      responseTime: {
        average: mockResponseTime,
        p95: mockResponseTime * 1.5,
        max: mockResponseTime * 2,
      },
      requestsPerSecond,
      errorRate: 0,
    };
  }
}
