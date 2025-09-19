import { WebSocketConnectionManager } from "@/data-manager/websocket-connection-manager.service";
import { DataProviderService } from "@/common/base/composed.service";
import { FeedCategory } from "@/common/types/core";
import type { BaseServiceConfig } from "@/common/types/services";
import type { ExchangeCapabilities, ExchangeConnectionConfig, IExchangeAdapter } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import type { WSConnectionConfig } from "@/common/types/data-manager";
import { ENV, ENV_HELPERS } from "@/config";

/**
 * Extended configuration for exchange adapters
 */
export interface IExchangeAdapterConfig extends BaseServiceConfig {
  useEnhancedLogging?: boolean;
  connection?: ExchangeConnectionConfig;
}

/**
 * Base exchange adapter class that eliminates adapter boilerplate
 * Includes integrated WebSocket functionality and data provider capabilities
 */
export abstract class BaseExchangeAdapter extends DataProviderService implements IExchangeAdapter {
  protected subscriptions = new Set<string>();
  protected connectionRetryCount = 0;
  protected maxRetries = 3;
  protected retryDelay = 1000; // ms
  protected lastRetryTime = 0;
  protected isConnected_ = false;

  // Rate limiting for warnings
  private warningLastLogged = new Map<string, number>();
  private readonly WARNING_COOLDOWN_MS = 30000; // 30 seconds

  // Event callbacks
  protected onPriceUpdateCallback?: (update: PriceUpdate) => void;
  protected onVolumeUpdateCallback?: (update: VolumeUpdate) => void;
  protected onConnectionChangeCallback?: (connected: boolean) => void;
  protected onErrorCallback?: (error: Error) => void;

  // Integrated WebSocket functionality
  protected wsManager?: WebSocketConnectionManager;
  protected wsConnectionId?: string;

  constructor(config?: IExchangeAdapterConfig) {
    super(config || { connection: {} });
    this.initValidation();
  }

  /**
   * Initialize validation rules for the exchange adapter
   */
  protected initValidation(): void {
    // Use silent=true to allow child classes to override these rules
    this.addValidationRule(
      {
        name: "exchange-symbol-format",
        validate: (value: unknown) => typeof value === "string" && this.validateSymbol(value),
        message: "Invalid exchange symbol format",
      },
      true // silent mode to prevent duplicate rule errors
    );
  }

  // Abstract properties that must be implemented
  abstract readonly exchangeName: string;
  abstract readonly category: FeedCategory;
  abstract readonly capabilities: ExchangeCapabilities;

  // Abstract methods that must be implemented by concrete adapters
  abstract normalizePriceData(rawData: unknown): PriceUpdate;
  abstract normalizeVolumeData(rawData: unknown): VolumeUpdate;
  abstract validateResponse(rawData: unknown): boolean;

  /**
   * Standard connection implementation with retry logic
   */
  async connect(): Promise<void> {
    if (this.isConnected_) {
      return;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.doConnect();
        this.connectionRetryCount = 0;
        this.isConnected_ = true;
        this.logger.log(`Connected to ${this.exchangeName}`);
        this.onConnectionChangeCallback?.(true);
        return;
      } catch (error) {
        lastError = error as Error;
        this.connectionRetryCount = attempt + 1;

        if (attempt < this.maxRetries) {
          let delay = this.retryDelay * Math.pow(2, attempt); // Standard exponential backoff

          // Special handling for 429 (rate limiting) errors
          if (lastError.message.includes("429")) {
            // For 429 errors, use much longer delays with exponential backoff
            delay = Math.min(300000, this.retryDelay * Math.pow(3, attempt + 1)); // Max 5 minutes

            // Rate limit the warning to prevent spam
            const now = Date.now();
            const warningKey = `${this.exchangeName}_429_warning`;
            const lastLogged = this.warningLastLogged.get(warningKey) || 0;

            if (now - lastLogged > this.WARNING_COOLDOWN_MS) {
              this.logger.warn(`Rate limited (429) for ${this.exchangeName}, using extended backoff: ${delay}ms`);
              this.warningLastLogged.set(warningKey, now);
            }
          } else {
            // Rate limit other warnings too (but not in test mode)
            const now = Date.now();
            const warningKey = `${this.exchangeName}_connection_warning`;
            const lastLogged = this.warningLastLogged.get(warningKey) || 0;

            if (ENV_HELPERS.isTest() || now - lastLogged > this.WARNING_COOLDOWN_MS) {
              this.logger.warn(`Connection attempt ${attempt + 1} failed, retrying in ${delay}ms: ${error}`);
              this.warningLastLogged.set(warningKey, now);
            }
          }

          await this.sleep(delay);
        }
      }
    }

    this.isConnected_ = false;
    const finalError = new Error(
      `Failed to connect to ${this.exchangeName} after ${this.maxRetries + 1} attempts: ${lastError?.message}`
    );
    this.onErrorCallback?.(finalError);
    this.onConnectionChangeCallback?.(false);
    throw finalError;
  }

  /**
   * Standard disconnection implementation
   * @param code - The WebSocket close code (default: 1000)
   * @param reason - The WebSocket close reason (default: "Normal closure")
   */
  async disconnect(code = 1000, reason = "Normal closure"): Promise<void> {
    if (!this.isConnected_) {
      return;
    }

    try {
      // Disconnect WebSocket if connected
      if (this.isWebSocketConnected()) {
        try {
          await this.disconnectWebSocket(code, reason);
        } catch (error: unknown) {
          // Log the error but don't fail the disconnection
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          this.logger?.warn(`Error disconnecting WebSocket: ${errorMessage}`);
        }
      }

      // Call the adapter-specific disconnection logic
      try {
        await this.doDisconnect();
      } catch (error: unknown) {
        // Log the error but don't fail the disconnection
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        this.logger?.warn(`Error in adapter-specific disconnection: ${errorMessage}`);
      }

      // Update connection state
      const wasConnected = this.isConnected_;
      this.isConnected_ = false;
      this.connectionRetryCount = 0;
      this.subscriptions.clear();

      // Notify listeners if we were actually connected
      if (wasConnected) {
        this.onConnectionChangeCallback?.(false);
        this.logger.log(`Disconnected from ${this.exchangeName}`);
      }
    } catch (error) {
      this.logger.error(`Error disconnecting from ${this.exchangeName}:`, error);
      throw error;
    }
  }

  /**
   * Cleanup method to prevent memory leaks
   */
  override async cleanup(): Promise<void> {
    // Disconnect if connected
    if (this.isConnected_) {
      await this.disconnect();
    }

    // Destroy WebSocket manager if it exists
    if (this.wsManager) {
      this.wsManager.destroy();
      this.wsManager = undefined;
    }

    // Clear all maps and sets
    this.subscriptions.clear();
    this.warningLastLogged.clear();

    // Call parent cleanup if it exists
    if (super.cleanup) {
      await super.cleanup();
    }
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.isConnected_;
  }

  /**
   * Standard subscription management with validation
   */
  async subscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      throw new Error(`Cannot subscribe: not connected to ${this.exchangeName}`);
    }

    const validSymbols = symbols.filter(symbol => this.validateSymbol(symbol));
    if (validSymbols.length === 0) {
      throw new Error("No valid symbols provided for subscription");
    }

    if (validSymbols.length !== symbols.length) {
      this.logger.warn(
        `Some symbols were invalid and skipped: ${symbols.filter(s => !validSymbols.includes(s)).join(", ")}`
      );
    }

    try {
      await this.doSubscribe(validSymbols);
      this.trackSubscriptions(validSymbols);
      this.logger.debug(`Subscribed to ${validSymbols.length} symbols on ${this.exchangeName}`);
    } catch (error) {
      this.logger.error(`Subscription failed on ${this.exchangeName}:`, error);
      throw error;
    }
  }

  /**
   * Standard unsubscription management
   */
  async unsubscribe(symbols: string[]): Promise<void> {
    if (!this.isConnected()) {
      return; // Silently ignore if not connected
    }

    const subscribedSymbols = symbols.filter(symbol => this.isSubscribed(symbol));
    if (subscribedSymbols.length === 0) {
      return; // Nothing to unsubscribe
    }

    try {
      await this.doUnsubscribe(subscribedSymbols);
      this.untrackSubscriptions(subscribedSymbols);
      this.logger.debug(`Unsubscribed from ${subscribedSymbols.length} symbols on ${this.exchangeName}`);
    } catch (error) {
      this.logger.error(`Unsubscription failed on ${this.exchangeName}:`, error);
      throw error;
    }
  }

  /**
   * Get current subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Track subscriptions - can be overridden by adapters for custom behavior
   */
  protected trackSubscriptions(symbols: string[]): void {
    symbols.forEach(symbol => {
      const exchangeSymbol = this.getSymbolMapping(symbol);
      this.subscriptions.add(exchangeSymbol); // Default: exchange symbol as-is
    });
  }

  /**
   * Untrack subscriptions - can be overridden by adapters for custom behavior
   */
  protected untrackSubscriptions(symbols: string[]): void {
    symbols.forEach(symbol => {
      const exchangeSymbol = this.getSymbolMapping(symbol);
      this.subscriptions.delete(exchangeSymbol); // Default: exchange symbol as-is
    });
  }

  /**
   * Check if a symbol is subscribed - can be overridden by adapters for custom behavior
   */
  protected isSubscribed(symbol: string): boolean {
    const exchangeSymbol = this.getSymbolMapping(symbol);
    return this.subscriptions.has(exchangeSymbol); // Default: exchange symbol as-is
  }

  /**
   * Standard health check implementation
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (this.isConnected()) {
        return true;
      }
      return await this.doHealthCheck();
    } catch (error) {
      this.logger.error(`Health check failed for ${this.exchangeName}:`, error);
      return false;
    }
  }

  /**
   * Event handler registration
   */
  onPriceUpdate(callback: (update: PriceUpdate) => void): void {
    this.onPriceUpdateCallback = callback;
  }

  onVolumeUpdate(callback: (update: VolumeUpdate) => void): void {
    this.onVolumeUpdateCallback = callback;
  }

  onConnectionChange(callback: (connected: boolean) => void): void {
    this.onConnectionChangeCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * Symbol mapping - override if exchange needs symbol transformation
   */
  getSymbolMapping(feedSymbol: string): string {
    return feedSymbol;
  }

  /**
   * Enhanced symbol validation with logging
   */
  validateSymbol(feedSymbol: string): boolean {
    try {
      const exchangeSymbol = this.getSymbolMapping(feedSymbol);
      // Basic validation: ensure we got a non-empty string and it contains valid characters
      const isValid =
        typeof exchangeSymbol === "string" &&
        exchangeSymbol.length > 0 &&
        feedSymbol.includes("/") && // Must be a proper pair format
        feedSymbol.split("/").length === 2; // Must have exactly one separator

      if (!isValid) {
        this.logger.debug(`Invalid symbol format: ${feedSymbol}`);
      }
      return isValid;
    } catch (error) {
      this.logger.error(`Symbol validation error for ${feedSymbol}:`, error);
      return false;
    }
  }

  /**
   * Enhanced confidence calculation with multiple factors
   */
  protected calculateConfidence(
    rawData: unknown,
    additionalFactors?: {
      latency?: number;
      volume?: number;
      spread?: number;
    }
  ): number {
    let confidence = 1.0;

    // Base confidence from data quality
    if (!rawData || typeof rawData !== "object") {
      return 0.0;
    }

    // Adjust for latency (lower confidence for older data)
    if (additionalFactors?.latency) {
      const latencyPenalty = Math.min(additionalFactors.latency / 1000, ENV.PERFORMANCE.MAX_LATENCY_PENALTY);
      confidence -= latencyPenalty;
    }

    // Adjust for volume (higher volume = higher confidence)
    if (additionalFactors?.volume) {
      const volumeBonus = Math.min(Math.log10(additionalFactors.volume) / 10, 0.2); // Max 20% bonus
      confidence += volumeBonus;
    }

    // Adjust for spread (tighter spread = higher confidence)
    if (additionalFactors?.spread) {
      const spreadPenalty = Math.min(additionalFactors.spread / 10, ENV.PERFORMANCE.MAX_SPREAD_PENALTY);
      confidence -= spreadPenalty;
    }

    return Math.max(0.0, Math.min(1.0, confidence));
  }

  /**
   * Utility method to normalize timestamps
   */
  protected normalizeTimestamp(timestamp: unknown): number {
    if (typeof timestamp === "number") {
      // Handle both seconds and milliseconds
      return timestamp > 1e12 ? timestamp : timestamp * 1000;
    }

    if (typeof timestamp === "string") {
      return new Date(timestamp).getTime();
    }

    if (timestamp instanceof Date) {
      return timestamp.getTime();
    }

    // Fallback to current time
    return Date.now();
  }

  /**
   * Utility method to safely parse numeric values
   */
  protected parseNumber(value: unknown): number {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = parseFloat(value);
      if (isNaN(parsed)) {
        throw new Error(`Invalid numeric value: ${value}`);
      }
      return parsed;
    }

    throw new Error(`Cannot parse number from: ${typeof value}`);
  }

  /**
   * Get adapter configuration
   */
  override getConfig(): Readonly<BaseServiceConfig> & Partial<ExchangeConnectionConfig> {
    return {
      ...super.getConfig(),
      ...(super.getConfig() as IExchangeAdapterConfig).connection,
    };
  }

  /**
   * Update adapter configuration
   */
  updateConnectionConfig(config: Partial<ExchangeConnectionConfig>): void {
    const currentConfig = super.getConfig() as IExchangeAdapterConfig;
    super.updateConfig({
      ...currentConfig,
      connection: {
        ...(currentConfig?.connection || {}),
        ...config,
      },
    });
  }

  override updateConfig(config: Partial<BaseServiceConfig>): void {
    super.updateConfig(config);
  }

  /**
   * Initialize WebSocket connection manager for this adapter
   */
  protected initializeWebSocket(): void {
    if (!this.wsManager) {
      this.wsManager = new WebSocketConnectionManager();
      this.wsConnectionId = `${this.exchangeName}-ws`;
    }
  }

  /**
   * Connect to WebSocket using the centralized connection manager
   */
  protected async connectWebSocket(config: WSConnectionConfig): Promise<void> {
    this.initializeWebSocket();

    try {
      await this.wsManager!.createConnection(this.wsConnectionId!, config);

      // Set up message handler
      this.wsManager!.on("message", (...args: unknown[]) => {
        const [connectionId, data] = args as [string, unknown];
        if (connectionId === this.wsConnectionId) {
          this.handleWebSocketMessage(data);
        }
      });

      // Set up connection event handlers
      this.wsManager!.on("connectionClosed", (...args: unknown[]) => {
        const [connectionId] = args as [string];
        if (connectionId === this.wsConnectionId) {
          this.handleWebSocketClose();
        }
      });

      this.wsManager!.on("connectionError", (...args: unknown[]) => {
        const [connectionId, error] = args as [string, Error];
        if (connectionId === this.wsConnectionId) {
          this.handleWebSocketError(error);
        }
      });
    } catch (error) {
      this.logger.error(`Failed to connect WebSocket: ${error}`);
      throw error;
    }
  }

  /**
   * Disconnect WebSocket
   * @param code - The WebSocket close code
   * @param reason - The WebSocket close reason
   */
  protected async disconnectWebSocket(code?: number, reason?: string): Promise<void> {
    if (this.wsManager && this.wsConnectionId) {
      try {
        await this.wsManager.closeConnection(this.wsConnectionId, code, reason);
      } catch (error) {
        this.logger.error(`Failed to disconnect WebSocket: ${error}`);
        throw error;
      }
    }
  }

  /**
   * Check if WebSocket is connected
   */
  protected isWebSocketConnected(): boolean {
    return this.wsManager?.isConnected(this.wsConnectionId!) ?? false;
  }

  /**
   * Send message via WebSocket
   */
  protected async sendWebSocketMessage(message: string | Buffer): Promise<boolean> {
    if (this.wsManager && this.wsConnectionId) {
      return this.wsManager.sendMessage(this.wsConnectionId, message);
    }
    return false;
  }

  /**
   * Get WebSocket connection statistics
   */
  protected getWebSocketStats() {
    if (this.wsManager && this.wsConnectionId) {
      return this.wsManager.getConnectionStats(this.wsConnectionId);
    }
    return null;
  }

  /**
   * Get WebSocket latency
   */
  protected getWebSocketLatency(): number {
    if (this.wsManager && this.wsConnectionId) {
      return this.wsManager.getLatency(this.wsConnectionId);
    }
    return 0;
  }

  // Optional WebSocket event handlers (adapters can override these)
  protected handleWebSocketMessage(data: unknown): void {
    // Default implementation - adapters should override this
    this.logger.debug(`Received WebSocket message: ${JSON.stringify(data)}`);
  }

  protected handleWebSocketClose(): void {
    // Default implementation - adapters should override this
    this.logger.warn(`WebSocket connection closed for ${this.exchangeName}`);
    this.isConnected_ = false;
    this.onConnectionChangeCallback?.(false);
  }

  protected handleWebSocketError(error: Error): void {
    // Default implementation - adapters should override this
    this.logger.error(`WebSocket error for ${this.exchangeName}:`, error);
    this.onErrorCallback?.(error);
  }

  // Abstract methods that must be implemented by concrete adapters
  protected abstract doConnect(): Promise<void>;
  protected abstract doDisconnect(): Promise<void>;
  protected abstract doSubscribe(symbols: string[]): Promise<void>;
  protected abstract doUnsubscribe(symbols: string[]): Promise<void>;
  protected abstract doHealthCheck(): Promise<boolean>;
}
