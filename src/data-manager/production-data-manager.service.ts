import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { ErrorCode } from "@/common/types/error-handling";
import { getFeedConfiguration, hasCustomAdapter } from "@/common/utils";
import { ENV } from "@/config/environment.constants";

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
  readonly maxCacheTTL = ENV.CACHE.TTL_MS;

  // Data freshness policy
  private readonly dataFreshnessPolicy: DataFreshnessPolicy = {
    rejectStaleData: false, // Never reject data based on age
    staleThresholdMs: ENV.DATA_FRESHNESS.FRESH_DATA_MS,
    realTimePriority: true,
    cacheBypassOnFreshData: true,
  };

  // Active reconnection timers
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private healthMonitorInterval?: NodeJS.Timeout;

  // Data source initialization tracking
  private dataSourcesInitialized = new Set<string>();

  // Rate limiting for quality warnings only
  private qualityWarningLastLogged = new Map<string, number>();
  private readonly QUALITY_WARNING_COOLDOWN_MS = ENV.MONITORING.QUALITY_WARNING_COOLDOWN_MS; // 5 minutes - much less frequent for quality warnings

  constructor() {
    super({
      initialDelay: ENV.AGGREGATION.INITIAL_DELAY_MS,
      maxDelay: ENV.AGGREGATION.MAX_DELAY_MS,
      backoffMultiplier: ENV.PERFORMANCE.COMMON_BACKOFF_MULTIPLIER,
      maxAttempts: ENV.AGGREGATION.MAX_ATTEMPTS,
      useEnhancedLogging: true,
    });
    // Don't start health monitoring until service is initialized
  }

  private setupHealthMonitoring(): void {
    // Use event-driven health monitoring instead of fixed intervals
    this.setupEventDrivenHealthMonitoring();
  }

  private setupEventDrivenHealthMonitoring(): void {
    // Create event-driven scheduler that batches health checks
    const scheduleHealthCheck = this.createEventDrivenScheduler(() => {
      void this.performHealthCheck();
    }, 500); // Batch events within 500ms

    // Monitor for connection changes and data updates
    this.on("sourceConnected", scheduleHealthCheck);
    this.on("sourceDisconnected", scheduleHealthCheck);
    this.on("priceUpdate", scheduleHealthCheck);
    this.on("sourceError", scheduleHealthCheck);

    // Initial health check
    scheduleHealthCheck();
  }

  private async performHealthCheck(): Promise<void> {
    // Only perform health checks if service is fully initialized
    if (!this.isServiceInitialized()) {
      return;
    }

    const now = Date.now();

    for (const [sourceId, metrics] of this.connectionMetrics.entries()) {
      const source = this.dataSources.get(sourceId);
      if (!source) continue;

      const timeSinceLastUpdate = now - metrics.lastUpdate;

      // Perform comprehensive health check
      let isHealthy = metrics.isHealthy;

      // Skip health checks for data sources that aren't fully initialized yet
      if (!this.isServiceInitialized() || !this.dataSourcesInitialized.has(sourceId)) {
        continue;
      }

      // Check connection status
      if (!source.isConnected()) {
        isHealthy = false;
      }

      // Check latency - more lenient threshold for real-time data
      if (source.getLatency() > 10000) {
        // 10 second latency threshold
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
          // Only emit unhealthy events if service is initialized and data source is ready
          if (this.isServiceInitialized() && this.dataSourcesInitialized.has(sourceId)) {
            this.logger.warn(`Data source ${sourceId} marked as unhealthy - last update: ${timeSinceLastUpdate}ms ago`);
            this.emit("sourceUnhealthy", sourceId);
          }
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
      if (healthyRatio >= ENV.PERFORMANCE.HEALTHY_CONNECTION_RATIO) {
        this.setHealthStatus("healthy");
      } else if (healthyRatio >= ENV.PERFORMANCE.DEGRADED_CONNECTION_RATIO) {
        this.setHealthStatus("degraded");
      } else {
        this.setHealthStatus("unhealthy");
      }
    }
  }

  /**
   * Mark a data source as initialized and ready for health checks
   */
  markDataSourceInitialized(sourceId: string): void {
    this.dataSourcesInitialized.add(sourceId);
    this.logger.debug(`Data source ${sourceId} marked as initialized`);
  }

  /**
   * Check if a data source is initialized
   */
  isDataSourceInitialized(sourceId: string): boolean {
    return this.dataSourcesInitialized.has(sourceId);
  }

  /**
   * Standard initialization method from lifecycle mixin
   */
  override async initialize(): Promise<void> {
    // Start health monitoring only after service is initialized
    this.setupHealthMonitoring();

    this.logger.log("ProductionDataManagerService initialization completed");
    // Emit the standard initialized event
    this.emitWithLogging("initialized");
  }

  override async cleanup(): Promise<void> {
    // Clear all reconnection timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Clear health monitoring interval (if still using legacy approach)
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = undefined;
    }

    // Clear rate limiting maps to free memory
    this.qualityWarningLastLogged.clear();

    // Clear connection metrics
    this.connectionMetrics.clear();
    this.subscriptions.clear();
  }

  /**
   * Wait for source to be actually ready instead of assuming connection success
   */
  private async waitForSourceReadiness(source: DataSource, maxAttempts = 30): Promise<void> {
    const startTime = Date.now();
    const isReady = await this.waitForCondition(
      async () => {
        // Check if source is truly ready
        if (!source.isConnected()) {
          return false;
        }

        // Be more lenient with latency check for newly connected sources
        // Allow up to 10 seconds of high latency for initial data reception
        const connectionAge = Date.now() - startTime;
        const latency = source.getLatency();

        if (connectionAge > 10000 && latency >= 5000) {
          // Only fail on high latency after connection has been established for 10+ seconds
          this.logger.debug(`Source ${source.id} has high latency (${latency}ms) after ${connectionAge}ms`);
          return false;
        }

        // For sources that support health checks, verify they pass
        if (hasHealthCheckCapability(source)) {
          try {
            const healthResult = await source.performHealthCheck();
            if (!healthResult) {
              this.logger.debug(`Health check failed for ${source.id}`);
              return false;
            }
            return true;
          } catch (error) {
            this.logger.debug(`Health check failed for ${source.id}:`, error);
            // For newly connected sources, be more lenient with health check failures
            if (connectionAge < 5000) {
              this.logger.debug(`Allowing health check failure for newly connected source ${source.id}`);
              return true;
            }
            return false;
          }
        }

        // For sources without health checks, connection is sufficient
        return true;
      },
      {
        maxAttempts,
        checkInterval: 500, // Check every 500ms
        timeout: maxAttempts * 1000, // Overall timeout
      }
    );

    if (!isReady) {
      throw new Error(`Source ${source.id} failed to become ready after ${maxAttempts} attempts`);
    }

    this.logger.debug(`Source ${source.id} is ready`);
  }

  /**
   * Calculate adaptive delay based on connection state and history
   */
  private calculateAdaptiveDelay(reconnectAttempts: number): number {
    // Start with base delay and increase based on failure history
    const baseDelay = 1000;
    const maxDelay = 30000;

    // Exponential backoff with jitter
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxDelay);
    const jitter = Math.random() * 0.3; // 30% jitter

    return Math.floor(exponentialDelay * (1 + jitter));
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
      // Check if data source already exists
      if (this.dataSources.has(source.id)) {
        this.logger.log(`Data source ${source.id} already exists, skipping`);
        return;
      }

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

      // Mark data source as initialized after successful connection attempt
      this.markDataSourceInitialized(source.id);

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
    const feedConfig = getFeedConfiguration(feedId);
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
    if (hasCustomAdapter(exchange)) {
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

    this.logger.debug(`Getting price updates for ${feedId.name} from exchanges: ${configuredExchanges.join(", ")}`);

    for (const exchange of configuredExchanges) {
      try {
        const source = this.getDataSourceForExchange(exchange);
        if (!source) {
          this.logger.warn(`Source not found for exchange ${exchange} for feed ${feedId.name}`);
          continue;
        }

        this.logger.log(`Found source for ${exchange}, checking if custom adapter: ${hasCustomAdapter(exchange)}`);

        if (hasRestFallbackCapability(source)) {
          this.logger.log(`Source ${exchange} has REST fallback capability`);
        } else {
          this.logger.warn(`Source ${exchange} does not have REST fallback capability`);
        }

        // Check if this is a CCXT exchange
        if (!hasCustomAdapter(exchange)) {
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
            // Get the exchange-specific symbol from feed configuration
            const feedConfig = getFeedConfiguration(feedId);
            const sourceConfig = feedConfig?.sources.find(s => s.exchange === exchange);
            const exchangeSymbol = sourceConfig?.symbol || feedId.name;

            // Check if source supports REST fallback - custom adapters use fetchTickerREST
            if (source.fetchTickerREST) {
              this.logger.debug(`Calling fetchTickerREST for ${exchange} with symbol ${exchangeSymbol}`);
              const restUpdate = await source.fetchTickerREST(exchangeSymbol);
              if (restUpdate) {
                this.logger.debug(`Got REST update from ${exchange}: ${restUpdate.price}`);
                priceUpdates.push(restUpdate);
              } else {
                this.logger.debug(`No REST update from ${exchange} for ${exchangeSymbol}`);
              }
            } else if (source.fetchPriceViaREST) {
              this.logger.log(`Calling fetchPriceViaREST for ${exchange} with symbol ${exchangeSymbol}`);
              const restUpdate = await source.fetchPriceViaREST(exchangeSymbol);
              if (restUpdate) {
                this.logger.log(`Got REST update from ${exchange}: ${restUpdate.price}`);
                priceUpdates.push(restUpdate);
              } else {
                this.logger.warn(`No REST update from ${exchange} for ${exchangeSymbol}`);
              }
            } else {
              this.logger.warn(`Source ${exchange} does not have fetchTickerREST or fetchPriceViaREST methods`);
            }
          }
        }
      } catch (error) {
        this.logger.error(`Failed to get price from ${exchange} for ${feedId.name}:`, error);
      }
    }

    this.logger.debug(`Returning ${priceUpdates.length} price updates for ${feedId.name}`);
    return priceUpdates;
  }

  // Real-time data management methods
  async subscribeToFeed(feedId: CoreFeedId): Promise<void> {
    this.logger.log(`Tracking subscription for feed: ${feedId.name} (actual subscription handled by orchestrator)`);

    // Validate that all configured exchanges are available
    const validation = this.validateFeedSources(feedId);
    if (!validation.isValid) {
      this.logger.warn(`Missing exchanges for feed ${feedId.name}: ${validation.missingExchanges.join(", ")}`);
    }

    // Get feed configuration to get exchange-specific symbols
    const feedConfig = getFeedConfiguration(feedId);
    if (!feedConfig) {
      throw new Error(`No configuration found for feed: ${feedId.name}`);
    }

    this.logger.debug(`Tracking ${feedConfig.sources.length} configured sources for feed ${feedId.name}`);

    // Track subscriptions for monitoring purposes (actual subscription handled by orchestrator)
    for (const sourceConfig of feedConfig.sources) {
      try {
        const source = this.getDataSourceForExchange(sourceConfig.exchange);
        if (!source) {
          this.logger.warn(`Source ${sourceConfig.exchange} not available for feed ${feedId.name}`);
          continue;
        }

        // Track subscription (but don't actually subscribe - orchestrator handles this)
        const sourceSubscriptions = this.subscriptions.get(source.id) || [];
        sourceSubscriptions.push({
          sourceId: source.id,
          feedId,
          symbols: [sourceConfig.symbol],
          timestamp: Date.now(),
          lastUpdate: Date.now(),
          active: true,
        });
        this.subscriptions.set(source.id, sourceSubscriptions);

        this.logger.debug(`Tracked subscription ${source.id} to ${sourceConfig.symbol} for feed ${feedId.name}`);
      } catch (error) {
        this.logger.error(
          `Failed to track subscription to ${sourceConfig.symbol} on ${sourceConfig.exchange} for feed ${feedId.name}:`,
          error
        );
      }
    }
  }

  async unsubscribeFromFeed(feedId: CoreFeedId): Promise<void> {
    this.logger.log(`Unsubscribing from feed: ${feedId.name}`);

    // Get feed configuration to get exchange-specific symbols
    const feedConfig = getFeedConfiguration(feedId);
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
        // Try to get fresh data from exchanges if no cached data exists
        const priceUpdates = await this.getPriceUpdatesForFeed(feedId);
        if (priceUpdates.length === 0) {
          throw new Error(`No price data available for feed ${feedId.name}`);
        }
        // Process the updates we just fetched
        return this.createAggregatedPriceFromUpdates(feedId, priceUpdates);
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
      const validUpdates = priceUpdates.filter(update => update.price > 0);

      if (validUpdates.length === 0) {
        throw new Error(`No valid price updates for feed ${feedId.name}`);
      }

      // Simple aggregation: weighted average by confidence
      const totalWeight = validUpdates.reduce(
        (sum, update) => sum + (update.confidence || ENV.PERFORMANCE.DEFAULT_CONFIDENCE_FALLBACK),
        0
      );
      const weightedPrice = validUpdates.reduce(
        (sum, update) => sum + update.price * (update.confidence || ENV.PERFORMANCE.DEFAULT_CONFIDENCE_FALLBACK),
        0
      );

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

        // Validate update quality and process accordingly
        if (this.validatePriceUpdateQuality(update)) {
          this.processUpdateImmediately(update);
        } else {
          // Low quality data - log once and skip processing to reduce noise
          const warningKey = `${source.id}_rejected_${update.symbol}`;
          const now = Date.now();
          const lastLogged = this.qualityWarningLastLogged.get(warningKey) || 0;

          if (now - lastLogged > this.QUALITY_WARNING_COOLDOWN_MS) {
            this.enhancedLogger?.debug(
              `Rejected low quality price update from ${source.id} for ${update.symbol}: confidence ${update.confidence}`,
              {
                component: "ProductionDataManager",
                operation: "quality_check",
                sourceId: source.id,
                metadata: {
                  confidence: update.confidence,
                  symbol: update.symbol,
                  minThreshold: 0.5,
                },
              }
            );
            this.qualityWarningLastLogged.set(warningKey, now);
          }
          // Skip processing low quality data instead of processing with lower priority
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
    // More reasonable confidence thresholds based on market conditions
    const MIN_CONFIDENCE = ENV.PERFORMANCE.MIN_CONFIDENCE_THRESHOLD;
    const WARN_CONFIDENCE = ENV.PERFORMANCE.WARN_CONFIDENCE_THRESHOLD;

    if (update.confidence < MIN_CONFIDENCE) {
      return false;
    }

    // Log quality warning only if confidence is between MIN and WARN thresholds (with rate limiting)
    if (update.confidence < WARN_CONFIDENCE) {
      const warningKey = `${update.source}_quality_warning`;
      const now = Date.now();
      const lastLogged = this.qualityWarningLastLogged.get(warningKey) || 0;

      if (now - lastLogged > this.QUALITY_WARNING_COOLDOWN_MS) {
        this.enhancedLogger?.debug(
          `Moderate quality price update from ${update.source} for ${update.symbol}: confidence ${update.confidence}`,
          {
            component: "ProductionDataManager",
            operation: "validate_price_quality",
            sourceId: update.source,
            metadata: {
              confidence: update.confidence,
              minThreshold: MIN_CONFIDENCE,
              warnThreshold: WARN_CONFIDENCE,
              symbol: update.symbol,
            },
          }
        );
        this.qualityWarningLastLogged.set(warningKey, now);
      }
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

        // Wait for actual connection readiness instead of assuming success
        await this.waitForSourceReadiness(source);

        // Update metrics on successful connection
        metrics.isHealthy = true;
        metrics.reconnectAttempts = 0;
        metrics.lastUpdate = Date.now();
      },
      `connect_data_source_${sourceId}`,
      {
        retries: 10,
        retryDelay: this.calculateAdaptiveDelay(metrics.reconnectAttempts),
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

      // Mark data source as initialized when it successfully connects
      this.markDataSourceInitialized(sourceId);

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
    const mockResponseTime = ENV.PERFORMANCE.RESPONSE_TIME_TARGET_MS;

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

  /**
   * Create an aggregated price from raw price updates (fallback during startup)
   */
  private createAggregatedPriceFromUpdates(feedId: CoreFeedId, updates: PriceUpdate[]): AggregatedPrice {
    const validUpdates = updates.filter(update => update.price > 0);

    if (validUpdates.length === 0) {
      throw new Error(`No valid price updates for feed ${feedId.name}`);
    }

    // Simple aggregation: weighted average by confidence
    const totalWeight = validUpdates.reduce(
      (sum, update) => sum + (update.confidence || ENV.PERFORMANCE.DEFAULT_CONFIDENCE_FALLBACK),
      0
    );

    const weightedPrice = validUpdates.reduce(
      (sum, update) => sum + update.price * (update.confidence || ENV.PERFORMANCE.DEFAULT_CONFIDENCE_FALLBACK),
      0
    );

    const averagePrice = weightedPrice / totalWeight;
    const averageConfidence = totalWeight / validUpdates.length;

    return {
      symbol: feedId.name,
      price: averagePrice,
      confidence: Math.min(averageConfidence, 1.0),
      timestamp: Math.max(...validUpdates.map(u => u.timestamp)),
      sources: validUpdates.map(u => u.source),
      votingRound: 0, // Default for startup
      consensusScore: validUpdates.length > 1 ? 0.8 : 0.5, // Lower consensus for single source
    };
  }
}
