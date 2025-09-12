import type { Constructor, AbstractConstructor, IBaseService } from "../../types/services";
import type { RateLimitConfig } from "../../types/rate-limiting";

// Define ServiceStatus enum (since it's not available in the monitoring types)
export enum ServiceStatus {
  Unknown = "unknown",
  Connected = "connected",
  Disconnected = "disconnected",
  Error = "error",
  RateLimited = "rate_limited",
}

/**
 * Data provider capabilities interface
 */
export interface DataProviderCapabilities {
  /**
   * Get the current status of the data provider connection
   */
  getConnectionStatus(): ServiceStatus;

  /**
   * Get current rate limit configuration
   */
  getRateLimitConfig(): RateLimitConfig;

  /**
   * Update rate limit configuration
   */
  updateRateLimitConfig(config: Partial<RateLimitConfig>): void;

  /**
   * Get current request count within rate limit window
   */
  getCurrentRequestCount(): number;

  /**
   * Check if requests are currently being rate limited
   */
  isRateLimited(): boolean;

  /**
   * Get time until next rate limit window reset
   */
  getTimeToRateLimitReset(): number;

  /**
   * Get the error rate for this provider (errors/total requests)
   */
  getErrorRate(): number;

  /**
   * Get the success rate for this provider (successful/total requests)
   */
  getSuccessRate(): number;

  /**
   * Reset rate limit counters
   */
  resetRateLimitCounters(): void;
}

/**
 * Mixin that adds data provider capabilities to a service
 */
export function WithDataProvider<TBase extends Constructor | AbstractConstructor>(Base: TBase) {
  return class DataProviderMixin extends Base implements DataProviderCapabilities {
    _connectionStatus: ServiceStatus = ServiceStatus.Unknown;
    _rateLimitConfig: RateLimitConfig = {
      maxRequestsPerWindow: 100,
      windowMs: 60000, // 1 minute
      burstLimit: 10,
    };
    _requestCount = 0;
    _successCount = 0;
    _errorCount = 0;
    _lastResetTime = Date.now();
    _resetInterval?: NodeJS.Timeout;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      this._scheduleRateLimitReset();
    }

    _scheduleRateLimitReset(): void {
      this._resetInterval = setInterval(() => {
        this.resetRateLimitCounters();
      }, this._rateLimitConfig.windowMs);
    }

    public getConnectionStatus(): ServiceStatus {
      return this._connectionStatus;
    }

    public setConnectionStatus(status: ServiceStatus): void {
      this._connectionStatus = status;
      (this as unknown as IBaseService).logDebug(`Connection status changed to: ${status}`);
    }

    public getRateLimitConfig(): RateLimitConfig {
      return { ...this._rateLimitConfig };
    }

    public updateRateLimitConfig(config: Partial<RateLimitConfig>): void {
      this._rateLimitConfig = {
        ...this._rateLimitConfig,
        ...config,
      };
      (this as unknown as IBaseService).logDebug(`Updated rate limit config: ${JSON.stringify(this._rateLimitConfig)}`);

      // Reset interval with new window
      if (this._resetInterval) {
        clearInterval(this._resetInterval);
      }
      this._scheduleRateLimitReset();
    }

    public getCurrentRequestCount(): number {
      return this._requestCount;
    }

    public isRateLimited(): boolean {
      const isLimited = this._requestCount >= this._rateLimitConfig.maxRequestsPerWindow;
      if (isLimited && this._connectionStatus !== ServiceStatus.RateLimited) {
        this.setConnectionStatus(ServiceStatus.RateLimited);
      }
      return isLimited;
    }

    public getTimeToRateLimitReset(): number {
      const elapsedTime = Date.now() - this._lastResetTime;
      return Math.max(0, this._rateLimitConfig.windowMs - elapsedTime);
    }

    public getErrorRate(): number {
      const total = this._successCount + this._errorCount;
      return total === 0 ? 0 : this._errorCount / total;
    }

    public getSuccessRate(): number {
      const total = this._successCount + this._errorCount;
      return total === 0 ? 0 : this._successCount / total;
    }

    public resetRateLimitCounters(): void {
      this._requestCount = 0;
      this._lastResetTime = Date.now();
      (this as unknown as IBaseService).logDebug("Rate limit counters reset");

      // Auto-restore normal status if we were rate limited
      if (this._connectionStatus === ServiceStatus.RateLimited) {
        this.setConnectionStatus(ServiceStatus.Connected);
      }
    }

    public recordSuccessfulRequest(): void {
      this._requestCount++;
      this._successCount++;
    }

    public recordFailedRequest(): void {
      this._requestCount++;
      this._errorCount++;
    }
  };
}
