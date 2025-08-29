import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter } from "events";
import { DataSource, PriceUpdate, ExchangeAdapter } from "@/interfaces";
import { FeedCategory } from "@/types/feed-category.enum";

/**
 * Factory for creating DataSource instances from ExchangeAdapter instances
 * This bridges the gap between the adapter pattern and the data source interface
 */
@Injectable()
export class DataSourceFactory {
  private readonly logger = new Logger(DataSourceFactory.name);

  /**
   * Create a DataSource from an ExchangeAdapter
   */
  createFromAdapter(adapter: ExchangeAdapter, priority: number = 1): DataSource {
    return new AdapterDataSource(adapter, priority);
  }

  /**
   * Create multiple DataSources from adapters
   */
  createFromAdapters(adapters: { adapter: ExchangeAdapter; priority: number }[]): DataSource[] {
    return adapters.map(({ adapter, priority }) => this.createFromAdapter(adapter, priority));
  }
}

/**
 * DataSource implementation that wraps an ExchangeAdapter
 */
class AdapterDataSource extends EventEmitter implements DataSource {
  private readonly logger: Logger;
  private connected = false;
  private subscriptions = new Set<string>();
  private lastLatency = 0;

  constructor(
    private readonly adapter: ExchangeAdapter,
    public readonly priority: number
  ) {
    super();
    this.logger = new Logger(`AdapterDataSource:${this.adapter.exchangeName}`);
    this.setupAdapterEventHandlers();
  }

  get id(): string {
    return this.adapter.exchangeName;
  }

  get type(): "websocket" | "rest" {
    return this.adapter.capabilities.supportsWebSocket ? "websocket" : "rest";
  }

  get category(): FeedCategory {
    return this.adapter.category;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getLatency(): number {
    return this.lastLatency;
  }

  async subscribe(symbols: string[]): Promise<void> {
    try {
      this.logger.debug(`Subscribing to symbols: ${symbols.join(", ")}`);

      // Validate symbols first
      const validSymbols = symbols.filter(symbol => this.adapter.validateSymbol(symbol));

      if (validSymbols.length !== symbols.length) {
        const invalidSymbols = symbols.filter(symbol => !this.adapter.validateSymbol(symbol));
        this.logger.warn(`Invalid symbols for ${this.adapter.exchangeName}: ${invalidSymbols.join(", ")}`);
      }

      if (validSymbols.length === 0) {
        throw new Error(`No valid symbols to subscribe to for ${this.adapter.exchangeName}`);
      }

      // Subscribe through the adapter
      await this.adapter.subscribe(validSymbols);

      // Track subscriptions
      validSymbols.forEach(symbol => this.subscriptions.add(symbol));

      this.logger.debug(`Successfully subscribed to ${validSymbols.length} symbols`);
    } catch (error) {
      this.logger.error(`Failed to subscribe to symbols:`, error);

      // Emit error event for error handling services
      this.emit("error", error);

      throw error;
    }
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    try {
      this.logger.debug(`Unsubscribing from symbols: ${symbols.join(", ")}`);

      // Unsubscribe through the adapter
      await this.adapter.unsubscribe(symbols);

      // Remove from tracked subscriptions
      symbols.forEach(symbol => this.subscriptions.delete(symbol));

      this.logger.debug(`Successfully unsubscribed from ${symbols.length} symbols`);
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from symbols:`, error);
      throw error;
    }
  }

  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    this.on("priceUpdate", callback);
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.on("connectionChange", callback);
  }

  onError(callback: (error: Error) => void): void {
    this.on("error", callback);
  }

  // Additional methods for adapter management
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  getAdapter(): ExchangeAdapter {
    return this.adapter;
  }

  // Health monitoring methods
  async performHealthCheck(): Promise<boolean> {
    try {
      // Use adapter's health check if available
      if ("healthCheck" in this.adapter && typeof (this.adapter as any).healthCheck === "function") {
        return await (this.adapter as any).healthCheck();
      }

      // Fallback: check connection status and recent activity
      if (!this.isConnected()) {
        return false;
      }

      // Check if we've received data recently (within last 60 seconds)
      const timeSinceLastUpdate = Date.now() - (this.lastLatency > 0 ? Date.now() - this.lastLatency : 0);
      return timeSinceLastUpdate < 60000;
    } catch (error) {
      this.logger.error(`Health check failed for ${this.adapter.exchangeName}:`, error);
      return false;
    }
  }

  getHealthMetrics(): {
    isConnected: boolean;
    latency: number;
    subscriptionCount: number;
    exchangeName: string;
    type: string;
    lastActivity: number;
  } {
    return {
      isConnected: this.connected,
      latency: this.lastLatency,
      subscriptionCount: this.subscriptions.size,
      exchangeName: this.adapter.exchangeName,
      type: this.type,
      lastActivity: this.lastLatency > 0 ? Date.now() - this.lastLatency : 0,
    };
  }

  // Failover support methods
  async attemptReconnection(): Promise<boolean> {
    try {
      this.logger.log(`Attempting reconnection for ${this.adapter.exchangeName}...`);

      // Disconnect first if still connected
      if (this.connected) {
        await this.disconnect();
      }

      // Wait a moment before reconnecting
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Attempt reconnection
      await this.connect();

      // Resubscribe to previous subscriptions
      if (this.subscriptions.size > 0) {
        const symbols = Array.from(this.subscriptions);
        await this.subscribe(symbols);
      }

      this.logger.log(`Reconnection successful for ${this.adapter.exchangeName}`);
      return true;
    } catch (error) {
      this.logger.error(`Reconnection failed for ${this.adapter.exchangeName}:`, error);
      return false;
    }
  }

  // REST API fallback for WebSocket failures
  async fetchPriceViaREST(symbol: string): Promise<PriceUpdate | null> {
    try {
      // Use adapter's REST fallback if available
      if ("fetchTickerREST" in this.adapter && typeof (this.adapter as any).fetchTickerREST === "function") {
        return await (this.adapter as any).fetchTickerREST(symbol);
      }

      this.logger.warn(`No REST fallback available for ${this.adapter.exchangeName}`);
      return null;
    } catch (error) {
      this.logger.error(`REST fallback failed for ${this.adapter.exchangeName} symbol ${symbol}:`, error);
      return null;
    }
  }

  async connect(): Promise<void> {
    try {
      this.logger.debug(`Connecting to ${this.adapter.exchangeName}...`);

      // Connect through the adapter
      await this.adapter.connect();

      this.connected = true;
      this.emit("connectionChange", true);

      this.logger.log(`Connected to ${this.adapter.exchangeName}`);
    } catch (error) {
      this.logger.error(`Failed to connect to ${this.adapter.exchangeName}:`, error);
      this.connected = false;
      this.emit("connectionChange", false);

      // Emit error event for error handling services
      this.emit("error", error);

      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      this.logger.debug(`Disconnecting from ${this.adapter.exchangeName}...`);

      // Disconnect through the adapter
      await this.adapter.disconnect();

      this.connected = false;
      this.subscriptions.clear();
      this.emit("connectionChange", false);

      this.logger.log(`Disconnected from ${this.adapter.exchangeName}`);
    } catch (error) {
      this.logger.error(`Failed to disconnect from ${this.adapter.exchangeName}:`, error);
      throw error;
    }
  }

  private setupAdapterEventHandlers(): void {
    this.logger.debug(`Setting up event handlers for ${this.adapter.exchangeName}`);

    // Set up price update handler - this is required for all adapters
    this.adapter.onPriceUpdate((update: PriceUpdate) => {
      try {
        // Calculate latency for health monitoring
        this.lastLatency = Date.now() - update.timestamp;

        // Validate price update before emitting
        if (this.validatePriceUpdate(update)) {
          this.emit("priceUpdate", update);
        } else {
          const validationError = new Error(
            `Invalid price update from ${this.adapter.exchangeName}: ${JSON.stringify(update)}`
          );
          this.logger.warn(validationError.message);
          this.emit("error", validationError);
        }
      } catch (error) {
        this.logger.error(`Error handling price update from ${this.adapter.exchangeName}:`, error);
        this.emit("error", error);
      }
    });

    // Set up connection change handler if adapter supports it
    if (this.adapter.onConnectionChange && typeof this.adapter.onConnectionChange === "function") {
      this.adapter.onConnectionChange((connected: boolean) => {
        try {
          const previousState = this.connected;
          this.connected = connected;

          // Only emit if state actually changed
          if (previousState !== connected) {
            this.logger.log(
              `Connection state changed for ${this.adapter.exchangeName}: ${connected ? "connected" : "disconnected"}`
            );
            this.emit("connectionChange", connected);

            // Reset latency on disconnection
            if (!connected) {
              this.lastLatency = 0;
            }
          }
        } catch (error) {
          this.logger.error(`Error handling connection change from ${this.adapter.exchangeName}:`, error);
          this.emit("error", error);
        }
      });
    } else {
      this.logger.debug(`Adapter ${this.adapter.exchangeName} does not support connection change events`);
    }

    // Set up error handler if adapter supports it
    if (this.adapter.onError && typeof this.adapter.onError === "function") {
      this.adapter.onError((error: Error) => {
        this.logger.error(`Error from adapter ${this.adapter.exchangeName}:`, error);

        // Classify error for better handling
        const classifiedError = this.classifyAdapterError(error);
        this.emit("error", classifiedError);

        // Update connection state if it's a connection-related error
        if (this.isConnectionError(error)) {
          this.connected = false;
          this.emit("connectionChange", false);
        }
      });
    } else {
      this.logger.debug(`Adapter ${this.adapter.exchangeName} does not support error events`);
    }

    this.logger.log(`Event handlers configured for ${this.adapter.exchangeName}`);
  }

  private validatePriceUpdate(update: PriceUpdate): boolean {
    try {
      // Basic validation
      if (!update || typeof update !== "object") {
        return false;
      }

      // Required fields validation
      if (!update.symbol || typeof update.symbol !== "string") {
        return false;
      }

      if (typeof update.price !== "number" || isNaN(update.price) || update.price <= 0) {
        return false;
      }

      if (typeof update.timestamp !== "number" || isNaN(update.timestamp) || update.timestamp <= 0) {
        return false;
      }

      if (!update.source || typeof update.source !== "string") {
        return false;
      }

      if (
        typeof update.confidence !== "number" ||
        isNaN(update.confidence) ||
        update.confidence < 0 ||
        update.confidence > 1
      ) {
        return false;
      }

      // Check for reasonable timestamp (not too old, not in future)
      const now = Date.now();
      const age = now - update.timestamp;
      if (age > 300000 || age < -60000) {
        // More than 5 minutes old or more than 1 minute in future
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(`Error validating price update:`, error);
      return false;
    }
  }

  private classifyAdapterError(error: Error): Error {
    const message = error.message.toLowerCase();

    // Add error classification metadata
    const classifiedError = new Error(error.message);
    classifiedError.stack = error.stack;

    // Add classification properties
    (classifiedError as any).exchangeName = this.adapter.exchangeName;
    (classifiedError as any).adapterType = this.type;
    (classifiedError as any).timestamp = Date.now();

    if (message.includes("websocket") || message.includes("connection") || message.includes("network")) {
      (classifiedError as any).errorType = "CONNECTION_ERROR";
    } else if (message.includes("timeout") || message.includes("timed out")) {
      (classifiedError as any).errorType = "TIMEOUT_ERROR";
    } else if (message.includes("rate limit") || message.includes("too many requests")) {
      (classifiedError as any).errorType = "RATE_LIMIT_ERROR";
    } else if (message.includes("parse") || message.includes("json") || message.includes("invalid")) {
      (classifiedError as any).errorType = "PARSING_ERROR";
    } else {
      (classifiedError as any).errorType = "EXCHANGE_ERROR";
    }

    return classifiedError;
  }

  private isConnectionError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return (
      message.includes("websocket") ||
      message.includes("connection") ||
      message.includes("network") ||
      message.includes("disconnected") ||
      message.includes("closed")
    );
  }
}

export { AdapterDataSource };
