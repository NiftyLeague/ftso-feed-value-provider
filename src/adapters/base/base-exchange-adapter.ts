import { Logger } from "@nestjs/common";
import { ExchangeAdapter, ExchangeConnectionConfig } from "./exchange-adapter.interface";
import { PriceUpdate, VolumeUpdate } from "@/common/interfaces/core/data-source.interface";

/**
 * Base exchange adapter class that eliminates adapter boilerplate
 * Reduces adapter duplication by 200+ lines across adapters
 */
export abstract class BaseExchangeAdapter extends ExchangeAdapter {
  protected readonly logger: Logger;
  protected isConnectedFlag = false;
  protected subscriptions = new Set<string>();
  protected connectionRetryCount = 0;
  protected maxRetries = 3;
  protected retryDelay = 1000; // ms

  // Event callbacks
  protected onPriceUpdateCallback?: (update: PriceUpdate) => void;
  protected onVolumeUpdateCallback?: (update: VolumeUpdate) => void;
  protected onConnectionChangeCallback?: (connected: boolean) => void;
  protected onErrorCallback?: (error: Error) => void;

  constructor(config?: ExchangeConnectionConfig) {
    super(config);
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Standard connection implementation with retry logic
   */
  async connect(): Promise<void> {
    if (this.isConnectedFlag) {
      return;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        await this.doConnect();
        this.connectionRetryCount = 0;
        this.isConnectedFlag = true;
        this.logger.log(`Connected to ${this.exchangeName}`);
        this.onConnectionChangeCallback?.(true);
        return;
      } catch (error) {
        lastError = error as Error;
        this.connectionRetryCount = attempt + 1;

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
          this.logger.warn(`Connection attempt ${attempt + 1} failed, retrying in ${delay}ms: ${error}`);
          await this.sleep(delay);
        }
      }
    }

    this.isConnectedFlag = false;
    const finalError = new Error(
      `Failed to connect to ${this.exchangeName} after ${this.maxRetries + 1} attempts: ${lastError?.message}`
    );
    this.onErrorCallback?.(finalError);
    this.onConnectionChangeCallback?.(false);
    throw finalError;
  }

  /**
   * Standard disconnection implementation
   */
  async disconnect(): Promise<void> {
    if (!this.isConnectedFlag) {
      return;
    }

    try {
      await this.doDisconnect();
      this.isConnectedFlag = false;
      this.subscriptions.clear();
      this.logger.log(`Disconnected from ${this.exchangeName}`);
      this.onConnectionChangeCallback?.(false);
    } catch (error) {
      this.logger.error(`Error during disconnection from ${this.exchangeName}:`, error);
      throw error;
    }
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.isConnectedFlag;
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
      validSymbols.forEach(symbol => this.subscriptions.add(symbol));
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

    const subscribedSymbols = symbols.filter(symbol => this.subscriptions.has(symbol));
    if (subscribedSymbols.length === 0) {
      return; // Nothing to unsubscribe
    }

    try {
      await this.doUnsubscribe(subscribedSymbols);
      subscribedSymbols.forEach(symbol => this.subscriptions.delete(symbol));
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
   * Standard health check implementation
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (this.isConnected()) {
        return await this.doHealthCheck();
      }
      return false;
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
   * Utility method for safe data processing
   */
  protected safeProcessData<T>(data: any, processor: (data: any) => T, context: string): T | null {
    try {
      if (!this.validateResponse(data)) {
        this.logger.warn(`Invalid data received in ${context}:`, data);
        return null;
      }
      return processor(data);
    } catch (error) {
      this.logger.error(`Error processing data in ${context}:`, error);
      this.onErrorCallback?.(error as Error);
      return null;
    }
  }

  /**
   * Utility method for sleep/delay
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enhanced symbol validation with logging
   */
  validateSymbol(feedSymbol: string): boolean {
    try {
      const isValid = super.validateSymbol(feedSymbol);
      if (!isValid) {
        this.logger.debug(`Invalid symbol format: ${feedSymbol}`);
      }
      return isValid;
    } catch (error) {
      this.logger.error(`Symbol validation error for ${feedSymbol}:`, error);
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
