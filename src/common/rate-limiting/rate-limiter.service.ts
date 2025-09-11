import { Injectable } from "@nestjs/common";
import { StandardService } from "../base";
import type { RateLimitInfo, ClientRecord, RateLimitMetrics, RateLimitConfig } from "../types/utils";

@Injectable()
export class RateLimiterService extends StandardService {
  private readonly clients = new Map<string, ClientRecord>();
  private cleanupInterval: NodeJS.Timeout;

  constructor(config?: Partial<RateLimitConfig>) {
    super({
      useEnhancedLogging: false,
      windowMs: 60000, // 1 minute default
      maxRequests: 1000, // 1000 requests per minute default
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      ...config,
    });

    // Clean up old records every minute
    this.cleanupInterval = setInterval(() => {
      void this.cleanup();
    }, 60000);

    this.logger.log(
      `Rate limiter initialized: ${this.rateLimitConfig.maxRequests} requests per ${this.rateLimitConfig.windowMs}ms`
    );
  }

  /**
   * Get the typed configuration for this service
   */
  private get rateLimitConfig(): RateLimitConfig {
    return this.config as RateLimitConfig;
  }

  /**
   * Check if a client is within rate limits
   */
  checkRateLimit(clientId: string): RateLimitInfo {
    const now = Date.now();
    const windowStart = now - this.rateLimitConfig.windowMs;

    // Get or create client record
    let client = this.clients.get(clientId);
    if (!client) {
      client = {
        requests: [],
        totalRequests: 0,
        firstRequest: now,
      };
      this.clients.set(clientId, client);
    }

    // Remove requests outside the current window
    client.requests = client.requests.filter(timestamp => timestamp > windowStart);

    const totalHitsInWindow = client.requests.length;
    const remainingPoints = Math.max(0, this.rateLimitConfig.maxRequests - totalHitsInWindow);
    const isBlocked = totalHitsInWindow >= this.rateLimitConfig.maxRequests;

    // Calculate time until next request is allowed
    let msBeforeNext = 0;
    if (isBlocked && client.requests.length > 0) {
      const oldestRequest = Math.min(...client.requests);
      msBeforeNext = Math.max(0, oldestRequest + this.rateLimitConfig.windowMs - now);
    }

    return {
      totalHits: client.totalRequests,
      totalHitsInWindow,
      remainingPoints,
      msBeforeNext,
      isBlocked,
    };
  }

  /**
   * Record a request for a client
   */
  recordRequest(clientId: string, isSuccessful: boolean = true): RateLimitInfo {
    const now = Date.now();

    // Skip recording based on configuration
    if (
      (isSuccessful && this.rateLimitConfig.skipSuccessfulRequests) ||
      (!isSuccessful && this.rateLimitConfig.skipFailedRequests)
    ) {
      return this.checkRateLimit(clientId);
    }

    let client = this.clients.get(clientId);
    if (!client) {
      client = {
        requests: [],
        totalRequests: 0,
        firstRequest: now,
      };
      this.clients.set(clientId, client);
    }

    // Add the current request
    client.requests.push(now);
    client.totalRequests++;

    return this.checkRateLimit(clientId);
  }

  /**
   * Get rate limit statistics
   */
  getStats(): RateLimitMetrics {
    const now = Date.now();
    const windowStart = now - this.rateLimitConfig.windowMs;

    let totalRequests = 0;
    let blockedRequests = 0;

    for (const [, client] of this.clients) {
      totalRequests += client.totalRequests;

      // Count active clients (those with requests in current window)
      const recentRequests = client.requests.filter(timestamp => timestamp > windowStart);
      if (recentRequests.length >= this.rateLimitConfig.maxRequests) {
        blockedRequests += recentRequests.length - this.rateLimitConfig.maxRequests;
      }
    }

    const allowedRequests = Math.max(0, totalRequests - blockedRequests);
    const hitRate = totalRequests > 0 ? allowedRequests / totalRequests : 1;

    return {
      totalRequests,
      allowedRequests,
      blockedRequests,
      hitRate,
      averageResponseTime: 0,
    };
  }

  /**
   * Reset rate limit for a specific client
   */
  resetClient(clientId: string): void {
    this.clients.delete(clientId);
    this.logger.debug(`Reset rate limit for client: ${clientId}`);
  }

  /**
   * Clear all rate limit data
   */
  reset(): void {
    this.clients.clear();
    this.logger.log("Rate limiter reset - all client data cleared");
  }

  /**
   * Get configuration
   */
  getRateLimitConfig(): RateLimitConfig {
    return this.rateLimitConfig;
  }

  /**
   * Update configuration
   */
  updateRateLimitConfig(newConfig: Partial<RateLimitConfig>): void {
    this.updateConfig(newConfig);
    this.logger.log(
      `Rate limiter config updated: ${this.rateLimitConfig.maxRequests} requests per ${this.rateLimitConfig.windowMs}ms`
    );
  }

  /**
   * Cleanup old client records
   */
  public override async cleanup(): Promise<void> {
    const now = Date.now();
    const cutoff = now - this.rateLimitConfig.windowMs * 2; // Keep records for 2x window size
    let cleanedCount = 0;

    for (const [clientId, client] of this.clients) {
      // Remove clients with no recent activity
      if (client.requests.length === 0 || Math.max(...client.requests) < cutoff) {
        this.clients.delete(clientId);
        cleanedCount++;
      } else {
        // Clean up old requests within active clients
        const originalLength = client.requests.length;
        client.requests = client.requests.filter(timestamp => timestamp > cutoff);

        if (client.requests.length !== originalLength) {
          cleanedCount++;
        }
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} old rate limit records`);
    }
  }

  /**
   * Destroy the service and clean up resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clients.clear();
    this.logger.log("Rate limiter service destroyed");
  }
}
