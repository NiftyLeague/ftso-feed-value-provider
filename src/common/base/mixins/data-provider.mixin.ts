import type { AnyConstructor, ConstructorArgs, ConstructorInstance, IBaseService } from "../../types/services";
import type { ProviderRateLimitConfig } from "../../types/rate-limiting";
import type { DataProviderCapabilities } from "../../types/services/mixin-capabilities.types";
import { ServiceStatus } from "../../types/services/mixin-capabilities.types";

/**
 * Mixin that adds data provider capabilities to a service
 */
export function WithDataProvider<TBase extends AnyConstructor>(
  Base: TBase
): AnyConstructor<ConstructorArgs<TBase>, ConstructorInstance<TBase> & DataProviderCapabilities> {
  return class DataProviderMixin extends Base implements DataProviderCapabilities {
    // TypeScript mixin constraint: constructor must be `(...args: any[])`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...(args as unknown[]));
      this._ensureRateLimitResetScheduled();
    }

    _connectionStatus: ServiceStatus = ServiceStatus.Unknown;
    _rateLimitConfig: ProviderRateLimitConfig = {
      maxRequestsPerWindow: 100,
      windowMs: 60000, // 1 minute
      burstLimit: 10,
    };
    _requestCount = 0;
    _successCount = 0;
    _errorCount = 0;
    _lastResetTime = Date.now();
    _resetInterval?: NodeJS.Timeout;

    private _ensureRateLimitResetScheduled(): void {
      if (this._resetInterval) {
        return;
      }

      const maybeCreateTimeout = (
        this as unknown as { createTimeout?: (cb: () => void, delay: number) => NodeJS.Timeout }
      ).createTimeout;
      if (!maybeCreateTimeout) {
        // If the base class doesn't provide lifecycle timers, skip scheduling.
        return;
      }

      this._scheduleRateLimitReset();
    }

    _scheduleRateLimitReset(): void {
      // Use managed timeout for rate limit reset
      const scheduleNextReset = () => {
        const timer = (
          this as unknown as { createTimeout: (cb: () => void, delay: number) => NodeJS.Timeout }
        ).createTimeout(() => {
          this.resetRateLimitCounters();
          scheduleNextReset(); // Schedule next reset
        }, this._rateLimitConfig.windowMs);
        this._resetInterval = timer;
      };
      scheduleNextReset();
    }

    public getConnectionStatus(): ServiceStatus {
      return this._connectionStatus;
    }

    public setConnectionStatus(status: ServiceStatus): void {
      this._connectionStatus = status;
      (this as unknown as IBaseService).logDebug(`Connection status changed to: ${status}`);
    }

    public getRateLimitConfig(): ProviderRateLimitConfig {
      return { ...this._rateLimitConfig };
    }

    public updateRateLimitConfig(config: Partial<ProviderRateLimitConfig>): void {
      this._rateLimitConfig = {
        ...this._rateLimitConfig,
        ...config,
      };
      (this as unknown as IBaseService).logDebug(`Updated rate limit config: ${JSON.stringify(this._rateLimitConfig)}`);

      // Reset interval with new window
      if (this._resetInterval) {
        (this as unknown as { clearTimer: (timer: NodeJS.Timeout) => void }).clearTimer(this._resetInterval);
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
      this._ensureRateLimitResetScheduled();
      this._requestCount++;
      this._successCount++;
    }

    public recordFailedRequest(): void {
      this._ensureRateLimitResetScheduled();
      this._requestCount++;
      this._errorCount++;
    }
  } as unknown as AnyConstructor<ConstructorArgs<TBase>, ConstructorInstance<TBase> & DataProviderCapabilities>;
}
