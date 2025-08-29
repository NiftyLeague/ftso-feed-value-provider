import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter } from "events";
import { EnhancedFeedId } from "@/types";
import { DataSource, PriceUpdate } from "@/interfaces";
import { AggregatedPrice } from "@/aggregators/base/aggregation.interfaces";
import {
  ProductionDataManager,
  ConnectionHealth,
  RealTimeDataManager,
  DataFreshnessPolicy,
} from "./interfaces/data-manager.interfaces";

interface ConnectionMetrics {
  latency: number;
  lastUpdate: number;
  reconnectAttempts: number;
  isHealthy: boolean;
}

interface SourceSubscription {
  feedId: EnhancedFeedId;
  symbols: string[];
  lastUpdate: number;
}

@Injectable()
export class ProductionDataManagerService extends EventEmitter implements ProductionDataManager, RealTimeDataManager {
  private readonly logger = new Logger(ProductionDataManagerService.name);

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
    immediateProcessing: true,
    streamingConnectionPreferred: true,
    preciseTimestamps: true,
    votingRoundTracking: true,
  };

  // Reconnection configuration
  private readonly reconnectConfig = {
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    maxAttempts: 10,
  };

  // Active reconnection timers
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private healthMonitorInterval?: NodeJS.Timeout;

  constructor() {
    super();
    this.setupHealthMonitoring();
  }

  // Cleanup method for tests
  cleanup(): void {
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

  // Connection management methods
  async addDataSource(source: DataSource): Promise<void> {
    try {
      this.logger.log(`Adding data source: ${source.id}`);

      // Initialize connection metrics
      this.connectionMetrics.set(source.id, {
        latency: 0,
        lastUpdate: Date.now(),
        reconnectAttempts: 0,
        isHealthy: false,
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

  // Real-time data management methods
  async subscribeToFeed(feedId: EnhancedFeedId): Promise<void> {
    this.logger.log(`Subscribing to feed: ${feedId.name}`);

    const symbol = feedId.name;
    const connectedSources = this.getConnectedSources();

    if (connectedSources.length === 0) {
      throw new Error("No connected data sources available");
    }

    // Subscribe to all compatible sources
    for (const source of connectedSources) {
      if (source.category === feedId.category) {
        try {
          await source.subscribe([symbol]);

          // Track subscription
          const sourceSubscriptions = this.subscriptions.get(source.id) || [];
          sourceSubscriptions.push({
            feedId,
            symbols: [symbol],
            lastUpdate: Date.now(),
          });
          this.subscriptions.set(source.id, sourceSubscriptions);
        } catch (error) {
          this.logger.error(`Failed to subscribe to ${symbol} on ${source.id}:`, error);
        }
      }
    }
  }

  async unsubscribeFromFeed(feedId: EnhancedFeedId): Promise<void> {
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

  async getDataFreshness(feedId: EnhancedFeedId): Promise<number> {
    let mostRecentUpdate = 0;

    for (const [sourceId, subscriptions] of this.subscriptions.entries()) {
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
    if (!this.dataFreshnessPolicy.immediateProcessing) {
      return;
    }

    // Validate data freshness
    const age = Date.now() - update.timestamp;
    if (age > this.maxDataAge) {
      this.logger.warn(`Rejecting stale data from ${update.source}: age ${age}ms`);
      return;
    }

    // Update subscription timestamp
    this.updateSubscriptionTimestamp(update);

    // Emit for immediate processing
    this.emit("priceUpdate", update);
  }

  maintainVotingRoundHistory(rounds: number): void {
    // This will be implemented when historical data storage is added
    this.logger.debug(`Maintaining history for ${rounds} voting rounds`);
  }

  // Placeholder methods for interface compliance
  async getCurrentPrice(feedId: EnhancedFeedId): Promise<AggregatedPrice> {
    // This will be implemented when aggregation is integrated
    throw new Error("getCurrentPrice not yet implemented - requires aggregation integration");
  }

  async getCurrentPrices(feedIds: EnhancedFeedId[]): Promise<AggregatedPrice[]> {
    // This will be implemented when aggregation is integrated
    throw new Error("getCurrentPrices not yet implemented - requires aggregation integration");
  }

  // Private helper methods
  private setupSourceEventHandlers(source: DataSource): void {
    // Handle price updates
    source.onPriceUpdate((update: PriceUpdate) => {
      this.updateConnectionMetrics(source.id, update.timestamp);
      this.processUpdateImmediately(update);
    });

    // Handle connection changes
    source.onConnectionChange((connected: boolean) => {
      this.handleConnectionChange(source.id, connected);
    });
  }

  private async connectWithRetry(source: DataSource): Promise<void> {
    const sourceId = source.id;
    const metrics = this.connectionMetrics.get(sourceId);

    if (!metrics) {
      throw new Error(`No metrics found for source ${sourceId}`);
    }

    try {
      // Attempt connection (this would be implemented in the actual DataSource)
      // For now, we'll simulate the connection attempt
      this.logger.log(`Attempting to connect to ${sourceId}`);

      // Update metrics on successful connection
      metrics.isHealthy = true;
      metrics.reconnectAttempts = 0;
      metrics.lastUpdate = Date.now();
    } catch (error) {
      this.logger.error(`Connection failed for ${sourceId}:`, error);

      // Schedule reconnection with exponential backoff
      this.scheduleReconnection(source);
    }
  }

  private scheduleReconnection(source: DataSource): void {
    const sourceId = source.id;
    const metrics = this.connectionMetrics.get(sourceId);

    if (!metrics || metrics.reconnectAttempts >= this.reconnectConfig.maxAttempts) {
      this.logger.error(`Max reconnection attempts reached for ${sourceId}`);
      return;
    }

    const delay = Math.min(
      this.reconnectConfig.initialDelay * Math.pow(this.reconnectConfig.backoffMultiplier, metrics.reconnectAttempts),
      this.reconnectConfig.maxDelay
    );

    this.logger.log(`Scheduling reconnection for ${sourceId} in ${delay}ms (attempt ${metrics.reconnectAttempts + 1})`);

    const timer = setTimeout(async () => {
      metrics.reconnectAttempts++;
      await this.connectWithRetry(source);
    }, delay);

    this.reconnectTimers.set(sourceId, timer);
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
    } else {
      this.logger.warn(`Data source ${sourceId} disconnected`);

      // Schedule reconnection for WebSocket sources
      const source = this.dataSources.get(sourceId);
      if (source && source.type === "websocket") {
        this.scheduleReconnection(source);
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
      this.performHealthCheck();
    }, 30000);
  }

  private async performHealthCheck(): Promise<void> {
    const now = Date.now();

    for (const [sourceId, metrics] of this.connectionMetrics.entries()) {
      const timeSinceLastUpdate = now - metrics.lastUpdate;

      // Mark as unhealthy if no updates for 60 seconds
      if (timeSinceLastUpdate > 60000) {
        if (metrics.isHealthy) {
          this.logger.warn(`Data source ${sourceId} marked as unhealthy - no updates for ${timeSinceLastUpdate}ms`);
          metrics.isHealthy = false;
          this.emit("sourceUnhealthy", sourceId);
        }
      }
    }
  }
}
