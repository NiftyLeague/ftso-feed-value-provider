import WebSocket from "ws";
import { OnModuleDestroy } from "@nestjs/common";
import { DataProviderService } from "@/common/base/composed.service";
import { FeedCategory } from "@/common/types/core";
import type { BaseServiceConfig } from "@/common/types/services";
import type { ExchangeCapabilities, ExchangeConnectionConfig, IExchangeAdapter } from "@/common/types/adapters";
import type { PriceUpdate, VolumeUpdate } from "@/common/types/core";
import type { WSConnectionConfig } from "@/common/types/data-manager";
import { ENV, ENV_HELPERS } from "@/config/environment.constants";
import {
  categorizeConnectionError,
  extractStatusCode,
  getBackoffParameters,
} from "@/common/utils/error-classification.utils";

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
export abstract class BaseExchangeAdapter extends DataProviderService implements IExchangeAdapter, OnModuleDestroy {
  protected subscriptions = new Set<string>();
  protected connectionRetryCount = 0;
  protected maxRetries = 3;
  protected retryDelay = 1000; // ms
  protected lastRetryTime = 0;
  protected isConnected_ = false;
  protected isShuttingDown = false;

  // Rate limiting for warnings
  private warningLastLogged = new Map<string, number>();
  private readonly WARNING_COOLDOWN_MS = 30000; // 30 seconds

  // Event callbacks
  protected onPriceUpdateCallback?: (update: PriceUpdate) => void;
  protected onVolumeUpdateCallback?: (update: VolumeUpdate) => void;
  protected onConnectionChangeCallback?: (connected: boolean) => void;
  protected onErrorCallback?: (error: Error) => void;

  // Direct WebSocket connection management
  protected ws?: WebSocket;
  protected wsConfig?: WSConnectionConfig;
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;

  // Connection health tracking
  private connectionHealthScore = 100; // 0-100, 100 = perfect
  private recentDisconnections: number[] = []; // Timestamps of recent disconnections
  private readonly HEALTH_WINDOW_MS = 300000; // 5 minutes
  private readonly MAX_DISCONNECTIONS_PER_WINDOW = 5; // Increased from 3 to 5 to reduce false warnings
  private pingTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private maxReconnectAttempts = ENV.WEBSOCKET.MAX_RECONNECT_ATTEMPTS;
  private lastPongReceived = 0;
  private lastMessageReceived = 0;

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
          // Use centralized error classification for intelligent backoff
          const errorCategory = categorizeConnectionError(lastError);
          const backoffParams = getBackoffParameters(lastError);

          // Calculate delay using centralized backoff parameters
          const baseDelay = Math.max(this.retryDelay, backoffParams.minDelay);
          let delay = Math.min(
            baseDelay * Math.pow(backoffParams.multiplier, attempt),
            300000 // Max 5 minutes
          );

          // Rate limit the warning to prevent spam
          const now = Date.now();
          const warningKey = `${this.exchangeName}_${errorCategory.type}_warning`;
          const lastLogged = this.warningLastLogged.get(warningKey) || 0;

          if (ENV_HELPERS.isTest() || now - lastLogged > this.WARNING_COOLDOWN_MS) {
            this.logger.warn(
              `${errorCategory.type} error for ${this.exchangeName}, retrying in ${delay}ms (attempt ${attempt + 1}): ${lastError.message}`
            );
            this.warningLastLogged.set(warningKey, now);
          }

          // Use waitForCondition instead of sleep
          await this.waitForCondition(
            () => !this.isDestroyed, // Don't continue if adapter is being destroyed
            { maxAttempts: 1, checkInterval: delay, timeout: delay }
          );
        }
      }
    }

    this.isConnected_ = false;
    const finalError = new Error(
      `Failed to connect to ${this.exchangeName} after ${this.maxRetries + 1} attempts: ${lastError?.message}`
    );

    // Always allow graceful degradation to REST API fallback
    // This ensures consistent behavior across all environments
    this.logger.warn(
      `Connection failed for ${this.exchangeName}, continuing with REST API fallback: ${finalError.message}`
    );
    this.onConnectionChangeCallback?.(false);
    this.onErrorCallback?.(finalError);
    // Don't throw the error - let the adapter work in REST-only mode
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
   * NestJS lifecycle hook for graceful shutdown
   */
  override async onModuleDestroy(): Promise<void> {
    await this.cleanup();
  }

  /**
   * Cleanup method to prevent memory leaks
   */
  override async cleanup(): Promise<void> {
    // Set shutdown flag to avoid warning logs during normal shutdown
    this.isShuttingDown = true;

    // Disconnect if connected
    if (this.isConnected_) {
      await this.disconnect();
    }

    // Close WebSocket connection if it exists and is in a valid state
    if (this.ws) {
      try {
        // Only close if WebSocket is in a state that allows closing
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch (error) {
        // Silently ignore errors during cleanup - WebSocket may already be closed
        // This is expected during shutdown and doesn't indicate a problem
        if (!this.isShuttingDown) {
          this.logger.debug(`WebSocket close error during cleanup:`, error);
        }
      } finally {
        this.ws = undefined;
      }
    }

    // Clear timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
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

    // Filter out already subscribed symbols to avoid duplicates
    const newSymbols = validSymbols.filter(symbol => !this.isSubscribed(symbol));
    if (newSymbols.length === 0) {
      this.logger.debug(`All symbols already subscribed on ${this.exchangeName}`);
      return;
    }

    try {
      await this.doSubscribe(newSymbols);
      this.trackSubscriptions(newSymbols);
      this.logger.debug(`Subscribed to ${newSymbols.length} symbols on ${this.exchangeName}`);
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
   * Reverse symbol mapping - convert exchange symbol back to normalized format
   * Override if exchange uses different symbol format
   */
  protected normalizeSymbolFromExchange(exchangeSymbol: string): string {
    // Default implementation - assumes symbols are already normalized
    return exchangeSymbol;
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
        this.logger.debug(`Invalid or unsupported symbol: ${feedSymbol} -> ${exchangeSymbol}`);
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
      const parsed = new Date(timestamp).getTime();
      return isNaN(parsed) ? Date.now() : parsed;
    }

    if (timestamp instanceof Date) {
      const time = timestamp.getTime();
      return isNaN(time) ? Date.now() : time;
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
   * Helper method for REST API calls with standardized error handling and rate limiting
   */
  protected async fetchRestApi(url: string, errorContext: string, retryCount = 0): Promise<Response> {
    const maxRetries = 2; // Reduced from 3 to 2 to be less aggressive
    const baseDelay = 2000; // Increased from 1s to 2s base delay

    try {
      const response = await fetch(url);

      // Handle rate limiting (429) with exponential backoff
      if (response.status === 429) {
        if (retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
          // Use debug level for rate limiting warnings to reduce log noise
          this.logger.debug(
            `Rate limited by ${this.exchangeName}, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries + 1})`
          );

          await new Promise(resolve => setTimeout(resolve, delay));
          return this.fetchRestApi(url, errorContext, retryCount + 1);
        } else {
          this.logger.warn(
            `Rate limit exceeded for ${this.exchangeName} after ${maxRetries + 1} attempts, skipping request`
          );
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`${errorContext}: ${errorMessage}`);
    }
  }

  /**
   * Calculate spread percentage for confidence calculation
   */
  protected calculateSpreadPercent(bid: number, ask: number, price: number): number {
    const spread = ask - bid;
    return (spread / price) * 100;
  }

  /**
   * Helper to add slash to symbol by detecting common quote currencies
   */
  protected addSlashToSymbol(exchangeSymbol: string, quotes: string[] = ["USDT", "USDC", "USD", "EUR"]): string {
    if (exchangeSymbol.includes("/")) {
      return exchangeSymbol;
    }

    for (const quote of quotes) {
      if (exchangeSymbol.endsWith(quote)) {
        const base = exchangeSymbol.slice(0, -quote.length);
        if (base.length > 0) {
          return `${base}/${quote}`;
        }
      }
    }

    return exchangeSymbol;
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
   * Standardized symbol normalization - handles common patterns
   */
  protected standardizeSymbolFromExchange(exchangeSymbol: string, separators: string[] = ["-", "_"]): string {
    // Try each separator and convert to standard "/" format
    for (const separator of separators) {
      if (exchangeSymbol.includes(separator)) {
        return exchangeSymbol.replace(separator, "/");
      }
    }

    // If no separator found, try to add slash using common quote currencies
    return this.addSlashToSymbol(exchangeSymbol, ["USDT", "USDC", "USD", "EUR", "BTC", "ETH"]);
  }

  /**
   * Standardized spread calculation for confidence
   */
  protected calculateSpreadForConfidence(bid: number, ask: number, price: number): number {
    return this.calculateSpreadPercent(bid, ask, price);
  }

  /**
   * Standardized timestamp handling
   */
  protected standardizeTimestamp(timestamp: string | number | undefined): number {
    if (!timestamp) {
      return Date.now();
    }

    if (typeof timestamp === "string") {
      return this.normalizeTimestamp(timestamp);
    }

    return timestamp;
  }

  /**
   * Standardized REST API error handling
   */
  protected handleRestApiError(result: unknown, exchangeName: string): void {
    // Type guard to safely access properties
    const apiResult = result as {
      error?: string | string[];
      errors?: string | string[];
      code?: string | number;
      msg?: string;
      message?: string;
      status?: string;
    };

    // Common error patterns across exchanges
    if (apiResult?.error || apiResult?.errors) {
      const errorMsg = Array.isArray(apiResult.error)
        ? apiResult.error.join(", ")
        : apiResult.error || apiResult.errors;

      // Handle empty error messages
      const errorMsgStr = typeof errorMsg === "string" ? errorMsg : String(errorMsg);
      if (!errorMsg || errorMsgStr.trim() === "") {
        throw new Error(
          `${exchangeName} API error: Empty error message returned (possible rate limiting or service issue)`
        );
      }

      throw new Error(`${exchangeName} API error: ${errorMsg}`);
    }

    if (apiResult?.code && apiResult.code !== "0" && apiResult.code !== 0) {
      throw new Error(`${exchangeName} API error: ${apiResult.msg || apiResult.message || apiResult.code}`);
    }

    if (apiResult?.status && apiResult.status !== "ok" && apiResult.status !== "online") {
      throw new Error(`${exchangeName} API error: ${apiResult.status}`);
    }
  }

  /**
   * Standardized health check implementation
   */
  protected async performStandardHealthCheck(healthEndpoint: string): Promise<boolean> {
    try {
      const response = await this.fetchRestApi(healthEndpoint, `${this.exchangeName} health check failed`);

      if (!response.ok) {
        return false;
      }

      // For simple ping endpoints, just check if response is ok
      if (healthEndpoint.includes("/ping")) {
        return true;
      }

      // For endpoints that return JSON, check the result
      try {
        const result = await response.json();
        this.handleRestApiError(result, this.exchangeName);
        return true;
      } catch (error) {
        // If handleRestApiError throws (API error), return false
        // If JSON parsing fails but response was ok, consider it healthy
        if (error instanceof Error && error.message.includes("API error")) {
          return false;
        }
        return true;
      }
    } catch {
      return false;
    }
  }

  /**
   * Create standardized WebSocket configuration with exchange-specific overrides
   */
  protected createWebSocketConfig(url: string, overrides?: Partial<WSConnectionConfig>): WSConnectionConfig {
    const standardConfig: WSConnectionConfig = {
      url,
      reconnectInterval: ENV.WEBSOCKET.RECONNECT_DELAY_MS,
      maxReconnectAttempts: ENV.WEBSOCKET.MAX_RECONNECT_ATTEMPTS,
      pingInterval: ENV.WEBSOCKET.PING_INTERVAL_MS,
      pongTimeout: ENV.WEBSOCKET.PONG_TIMEOUT_MS,
      connectionTimeout: ENV.WEBSOCKET.CONNECTION_TIMEOUT_MS,
      headers: {
        "User-Agent": "FTSO-Provider/1.0",
        "Accept-Encoding": "gzip, deflate",
      },
    };

    return { ...standardConfig, ...overrides };
  }

  /**
   * Connect to WebSocket with graceful degradation to REST API fallback
   * This method implements resilient connection handling that works consistently
   * across all environments (development, staging, production)
   */
  protected async connectWebSocket(config: WSConnectionConfig): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.logger.debug(`WebSocket already connected for ${this.exchangeName}`);
      return;
    }

    this.wsConfig = config;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(config.url, config.protocols, {
          headers: config.headers,
        });

        // Use condition-based connection waiting instead of timeout
        const connectionTimeout = config.connectionTimeout || 10000;
        void this.waitForCondition(() => this.ws?.readyState === WebSocket.OPEN, {
          maxAttempts: connectionTimeout / 100,
          checkInterval: 100,
          timeout: connectionTimeout,
        }).then(connected => {
          if (!connected && this.ws?.readyState === WebSocket.CONNECTING) {
            this.ws.terminate();
            this.logger.warn(`WebSocket connection timeout for ${this.exchangeName}, falling back to REST API`);
            resolve(); // Always resolve to allow REST-only mode
          }
        });

        // Set up event handlers
        this.ws.on("open", () => {
          // Connection successful, no need to clear timeout as waitForCondition handles it
          this.logger.log(`WebSocket connected for ${this.exchangeName}`);
          this.reconnectAttempts = 0;

          // Reset health score on successful connection
          this.connectionHealthScore = Math.min(100, this.connectionHealthScore + 10);

          // Set up ping timer if configured
          if (config.pingInterval) {
            this.setupPingTimer(config.pingInterval);
          }

          resolve();
        });

        this.ws.on("message", (data: WebSocket.Data) => {
          this.logger.debug(`[DEBUG] ${this.exchangeName} received WebSocket message of type: ${typeof data}`);
          this.lastMessageReceived = Date.now();
          this.handleWebSocketMessage(data);
        });

        this.ws.on("close", (code: number, reason: string) => {
          clearTimeout(connectionTimeout);

          // Track disconnection for health monitoring
          this.trackDisconnection();

          // Let child classes handle specific logging first
          const handled = this.handleWebSocketClose(code, reason);

          // Only log here if child class didn't handle it
          if (!handled) {
            // Handle different close codes appropriately
            if (code === 1006) {
              this.logger.warn(
                `WebSocket closed for ${this.exchangeName}: ${code} - abnormal closure (connection lost)`
              );
            } else if (code === 1000) {
              this.logger.log(`WebSocket closed for ${this.exchangeName}: ${code} - normal closure`);
            } else {
              this.logger.warn(`WebSocket closed for ${this.exchangeName}: ${code} - ${reason}`);
            }
          }

          // Auto-reconnect if configured and not a normal closure during shutdown
          if (config.reconnectInterval && this.reconnectAttempts < this.maxReconnectAttempts && !this.isShuttingDown) {
            let reconnectDelay = config.reconnectInterval;

            // For abnormal closures (1006), add a longer delay
            if (code === 1006) {
              reconnectDelay = Math.max(config.reconnectInterval * 2, 5000);
            }

            // If connection is unstable, use exponential backoff
            if (this.isConnectionUnstable()) {
              const backoffMultiplier = Math.min(Math.pow(2, this.reconnectAttempts), 8); // Cap at 8x
              reconnectDelay = Math.min(reconnectDelay * backoffMultiplier, 60000); // Cap at 1 minute
              this.logger.warn(
                `Connection unstable for ${this.exchangeName}, using exponential backoff: ${reconnectDelay}ms`
              );
            }

            this.scheduleReconnect(reconnectDelay);
          }
        });

        this.ws.on("error", (error: Error) => {
          clearTimeout(connectionTimeout);

          // During shutdown, suppress WebSocket connection errors as they're expected
          if (this.isShuttingDown) {
            resolve(); // Allow graceful shutdown without error logging
            return;
          }

          // Use centralized error categorization to determine if error is recoverable
          const errorCategory = categorizeConnectionError(error);
          const isRecoverableError =
            errorCategory.retryable &&
            (errorCategory.type === "network" ||
              errorCategory.type === "timeout" ||
              errorCategory.type === "connection");

          if (isRecoverableError) {
            // For recoverable errors, gracefully degrade to REST API
            this.logger.warn(
              `WebSocket ${errorCategory.type} error for ${this.exchangeName}, falling back to REST API: ${error.message}`
            );
            this.handleWebSocketError(error);
            resolve(); // Resolve to allow REST-only mode
          } else {
            // For non-recoverable errors (authentication, protocol, etc.), these are likely configuration issues
            this.logger.error(`WebSocket ${errorCategory.type} error for ${this.exchangeName}:`, error);
            this.handleWebSocketError(error);
            reject(error);
          }
        });

        this.ws.on("pong", () => {
          // Handle pong response
          this.logger.debug(`Received pong from ${this.exchangeName}`);
        });
      } catch (error) {
        const createError = error as Error;
        // For creation errors, log and allow REST fallback
        this.logger.warn(
          `Failed to create WebSocket for ${this.exchangeName}, falling back to REST API: ${createError.message}`
        );
        resolve(); // Always resolve to allow REST-only mode
      }
    });
  }

  /**
   * Disconnect WebSocket
   * @param code - The WebSocket close code
   * @param reason - The WebSocket close reason
   */
  protected async disconnectWebSocket(code?: number, reason?: string): Promise<void> {
    // Clear timers
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }

    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(code, reason);
      this.ws = undefined;
    }
  }

  /**
   * Check if WebSocket is connected
   */
  protected isWebSocketConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Send message via WebSocket
   */
  protected async sendWebSocketMessage(message: string | Buffer): Promise<boolean> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(message);
        return true;
      } catch (error) {
        this.logger.error(`Failed to send WebSocket message for ${this.exchangeName}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Get WebSocket connection statistics
   */
  protected getWebSocketStats() {
    if (this.ws) {
      return {
        readyState: this.ws.readyState,
        url: this.ws.url,
        protocol: this.ws.protocol,
        reconnectAttempts: this.reconnectAttempts,
      };
    }
    return null;
  }

  /**
   * Get WebSocket latency (simplified - would need ping/pong timing for accuracy)
   */
  protected getWebSocketLatency(): number {
    // This would require implementing ping/pong timing
    // For now, return 0 as a placeholder
    return 0;
  }

  /**
   * Set up ping timer for keeping connection alive
   */
  private setupPingTimer(interval: number): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }

    this.logger.debug(`Setting up event-driven ping for ${this.exchangeName} with ${interval}ms interval`);

    // Use recursive timeout instead of setInterval for better control
    const schedulePing = () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Check if we received a pong for the last ping (if pong timeout is configured)
        const pongTimeout = this.wsConfig?.pongTimeout;
        if (pongTimeout && this.lastPongReceived > 0) {
          const timeSinceLastPong = Date.now() - this.lastPongReceived;
          const timeSinceLastMessage = Date.now() - this.lastMessageReceived;
          // Add 50% buffer to pong timeout to reduce false positives
          const adjustedTimeout = pongTimeout * 1.5;

          // Only timeout if we haven't received any messages recently
          if (timeSinceLastPong > adjustedTimeout && timeSinceLastMessage > pongTimeout) {
            this.logger.warn(
              `Pong timeout exceeded for ${this.exchangeName} (${timeSinceLastPong}ms > ${adjustedTimeout}ms), closing connection`
            );
            this.ws.close(1001, "Pong timeout");
            return;
          }
        }

        // Send ping and set up pong timeout if configured
        try {
          this.sendPingMessage();
          if (pongTimeout) {
            this.setupPongTimeout(pongTimeout);
          }
        } catch (error) {
          this.logger.warn(`Failed to send ping to ${this.exchangeName}:`, error);
          // Don't close connection immediately on ping failure, let pong timeout handle it
        }
      } else {
        this.logger.debug(
          `Ping timer fired but WebSocket not ready for ${this.exchangeName} (state: ${this.ws?.readyState})`
        );
      }

      // Schedule next ping
      this.pingTimer = this.createTimeout(schedulePing, interval);
    };

    // Start ping cycle
    schedulePing();
  }

  /**
   * Set up pong timeout for the current ping
   */
  private setupPongTimeout(timeout: number): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
    }

    // Use condition-based waiting for pong timeout
    const adjustedTimeout = timeout * 1.5;

    // Store the timeout promise for cleanup
    this.pongTimer = this.createTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Check if we've received recent data (which might indicate connection is healthy)
        const timeSinceLastMessage = Date.now() - (this.lastMessageReceived || 0);
        // Be more lenient - if we received any data within the original timeout, keep connection
        if (timeSinceLastMessage < timeout * 1.2) {
          this.logger.debug(
            `Pong timeout for ${this.exchangeName} but received recent data (${timeSinceLastMessage}ms ago), keeping connection`
          );
          return;
        }

        this.logger.warn(`Pong timeout for ${this.exchangeName} after ${adjustedTimeout}ms, closing connection`);
        this.ws.close(1001, "Pong timeout");
      }
    }, adjustedTimeout);
  }

  /**
   * Called when a pong is received - should be called by adapters in their message handlers
   */
  protected onPongReceived(): void {
    this.lastPongReceived = Date.now();
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
    this.logger.debug(`Pong received for ${this.exchangeName} - connection healthy`);
  }

  /**
   * Send ping message - can be overridden by adapters for exchange-specific ping formats
   */
  protected sendPingMessage(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Default WebSocket ping
      this.ws.ping();
    }
  }

  /**
   * Track connection disconnection for health monitoring
   */
  private trackDisconnection(): void {
    const now = Date.now();
    this.recentDisconnections.push(now);

    // Clean old disconnections outside the window
    this.recentDisconnections = this.recentDisconnections.filter(timestamp => now - timestamp < this.HEALTH_WINDOW_MS);

    // Update health score based on recent disconnections
    const disconnectionCount = this.recentDisconnections.length;
    if (disconnectionCount >= this.MAX_DISCONNECTIONS_PER_WINDOW) {
      this.connectionHealthScore = Math.max(0, this.connectionHealthScore - 15); // Reduced penalty from 20 to 15

      // Only log warning if health score drops below 60% (was logging at any degradation)
      if (this.connectionHealthScore < 60) {
        this.logger.warn(
          `Connection health degraded for ${this.exchangeName}: ${disconnectionCount} disconnections in ${this.HEALTH_WINDOW_MS / 1000}s (health: ${this.connectionHealthScore}%)`
        );
      } else {
        // Log at debug level for moderate degradation
        this.logger.debug(
          `Connection health moderate degradation for ${this.exchangeName}: ${disconnectionCount} disconnections in ${this.HEALTH_WINDOW_MS / 1000}s (health: ${this.connectionHealthScore}%)`
        );
      }
    } else {
      // Gradually recover health score
      this.connectionHealthScore = Math.min(100, this.connectionHealthScore + 5);
    }
  }

  /**
   * Get connection health score (0-100)
   */
  public getConnectionHealth(): number {
    return this.connectionHealthScore;
  }

  /**
   * Check if connection should be considered unstable
   */
  private isConnectionUnstable(): boolean {
    return this.connectionHealthScore < 50 || this.recentDisconnections.length >= this.MAX_DISCONNECTIONS_PER_WINDOW;
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(delay: number): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    this.logger.log(`Scheduling reconnection attempt ${this.reconnectAttempts} for ${this.exchangeName} in ${delay}ms`);

    // Use managed timeout for reconnection
    this.reconnectTimer = this.createTimeout(async () => {
      if (this.wsConfig) {
        try {
          await this.connectWebSocket(this.wsConfig);
        } catch (error) {
          this.logger.error(`Reconnection failed for ${this.exchangeName}:`, error);
        }
      }
    }, delay);
  }

  // Optional WebSocket event handlers (adapters can override these)
  protected handleWebSocketMessage(data: unknown): void {
    // Default implementation - adapters should override this
    this.logger.debug(`[DEBUG] ${this.exchangeName} handleWebSocketMessage called with type: ${typeof data}`);
  }

  /**
   * Check if a string message is a common WebSocket control message
   * @param message String message to check
   * @returns True if it's a control message
   */
  protected isControlMessage(message: string): boolean {
    const controlMessages = ["pong", "ping", "heartbeat", "keepalive"];
    return controlMessages.includes(message.toLowerCase());
  }

  /**
   * Safely parse WebSocket data, handling Buffer objects and various data types
   * @param data Raw WebSocket data
   * @returns Parsed message object or null if parsing fails
   */
  protected parseWebSocketData(data: unknown): unknown | null {
    try {
      // Handle Buffer data from WebSocket (with type and data properties)
      if (data && typeof data === "object" && "type" in data && "data" in data) {
        const bufferData = data as { type: string; data: number[] };
        if (bufferData.type === "Buffer") {
          const buffer = Buffer.from(bufferData.data);
          const jsonString = buffer.toString("utf8");

          // Check if it's a control message before JSON parsing
          if (this.isControlMessage(jsonString)) {
            return jsonString;
          }

          try {
            const parsed = JSON.parse(jsonString);
            return parsed;
          } catch {
            // If JSON parsing fails, log and return the string as-is
            this.logger.debug(`Received non-JSON buffer data: ${jsonString}`);
            return jsonString;
          }
        }
      }

      // Handle raw array data (likely Uint8Array or similar from WebSocket)
      if (data && typeof data === "object" && Array.isArray(data)) {
        const buffer = Buffer.from(data);
        const jsonString = buffer.toString("utf8");

        // Check if it's a control message before JSON parsing
        if (this.isControlMessage(jsonString)) {
          return jsonString;
        }

        try {
          const parsed = JSON.parse(jsonString);
          return parsed;
        } catch {
          // If JSON parsing fails, log and return the string as-is
          this.logger.debug(`Received non-JSON array message: ${jsonString}`);
          return jsonString;
        }
      }

      // Handle array-like object with numeric keys (Uint8Array, etc.)
      if (data && typeof data === "object" && !Array.isArray(data) && data !== null) {
        const keys = Object.keys(data);
        // Check if it looks like a byte array (all numeric keys)
        if (keys.length > 0 && keys.every(key => /^\d+$/.test(key))) {
          const byteArray = keys.map(key => (data as Record<string, number>)[key]);
          const buffer = Buffer.from(byteArray);
          const jsonString = buffer.toString("utf8");

          // Check if it's a control message before JSON parsing
          if (this.isControlMessage(jsonString)) {
            return jsonString;
          }

          try {
            const parsed = JSON.parse(jsonString);
            return parsed;
          } catch {
            // If JSON parsing fails, log and return the string as-is
            this.logger.debug(`Received non-JSON buffer message: ${jsonString}`);
            return jsonString;
          }
        }
      }

      // Handle string data
      if (typeof data === "string") {
        // Check if it's a common WebSocket control message before trying JSON parsing
        if (this.isControlMessage(data)) {
          return data; // Return as-is for control messages
        }

        try {
          return JSON.parse(data);
        } catch {
          // If JSON parsing fails, log and return the string as-is
          // This allows adapters to handle non-JSON string messages
          this.logger.debug(`Received non-JSON string message: ${data}`);
          return data;
        }
      }

      // Handle already parsed object data
      if (typeof data === "object" && data !== null) {
        return data;
      }

      // Handle other types (numbers, booleans, etc.)
      return data;
    } catch (error) {
      this.logger.error(`Error parsing WebSocket data:`, error);
      return null;
    }
  }

  protected handleWebSocketClose(_code?: number, _reason?: string): boolean {
    // Default implementation - adapters should override this
    // Handle connection state changes
    this.isConnected_ = false;
    this.onConnectionChangeCallback?.(false);
    // Return false to indicate base class should handle logging
    return false;
  }

  protected handleWebSocketError(error: Error): void {
    // During shutdown, suppress error handling as errors are expected
    if (this.isShuttingDown) {
      return;
    }

    // Use centralized error categorization
    const category = categorizeConnectionError(error);
    const statusCode = extractStatusCode(error.message);

    // Log appropriate message based on error category and severity
    const logMessage = `WebSocket ${category.type} error for ${this.exchangeName}${statusCode ? ` (${statusCode})` : ""}: ${error.message}`;

    switch (category.severity) {
      case "critical":
        this.logger.error(logMessage);
        break;
      case "high":
        this.logger.warn(logMessage);
        break;
      case "medium":
      case "low":
      default:
        this.logger.warn(logMessage);
        break;
    }

    // Log error event for monitoring with detailed categorization
    this.logger.debug("WebSocket error categorized", {
      exchange: this.exchangeName,
      category: category.type,
      severity: category.severity,
      retryable: category.retryable,
      statusCode,
      timestamp: Date.now(),
    });

    this.onErrorCallback?.(error);
  }

  /**
   * Public health check method for data manager compatibility
   * This method is used by the data manager to determine if the adapter is healthy
   */
  async performHealthCheck(): Promise<boolean> {
    try {
      // For adapters that are receiving data recently, consider them healthy
      // even if the REST health check fails (network issues are common)
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageReceived;

      // If we've received data in the last 5 minutes, consider the adapter healthy
      if (this.lastMessageReceived > 0 && timeSinceLastMessage < 300000) {
        return true;
      }

      // If no recent data, check basic connectivity using the adapter-specific health check
      const basicHealth = await this.doHealthCheck();
      if (!basicHealth) {
        return false;
      }

      // Check if we're receiving reasonably fresh data
      // Allow up to 15 minutes of stale data before marking as unhealthy (increased tolerance)
      if (this.lastMessageReceived > 0 && timeSinceLastMessage > 900000) {
        this.logger.debug(`${this.exchangeName} health check failed: no fresh data for ${timeSinceLastMessage}ms`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.debug(`${this.exchangeName} health check failed:`, error);
      return false;
    }
  }

  // Abstract methods that must be implemented by concrete adapters
  protected abstract doConnect(): Promise<void>;
  protected abstract doDisconnect(): Promise<void>;
  protected abstract doSubscribe(symbols: string[]): Promise<void>;
  protected abstract doUnsubscribe(symbols: string[]): Promise<void>;
  protected abstract doHealthCheck(): Promise<boolean>;
}
