import { Injectable, Logger } from "@nestjs/common";

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitInfo {
  totalHits: number;
  totalHitsInWindow: number;
  remainingPoints: number;
  msBeforeNext: number;
  isBlocked: boolean;
}

interface ClientRecord {
  requests: number[];
  totalRequests: number;
  firstRequest: number;
}

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly clients = new Map<string, ClientRecord>();
  private readonly config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      windowMs: 60000, // 1 minute default
      maxRequests: 1000, // 1000 requests per minute default
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      ...config,
    };

    // Clean up old records every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);

    this.logger.log(`Rate limiter initialized: ${this.config.maxRequests} requests per ${this.config.windowMs}ms`);
  }

  /**
   * Check if a client is within rate limits
   */
  checkRateLimit(clientId: string): RateLimitInfo {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

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
    const remainingPoints = Math.max(0, this.config.maxRequests - totalHitsInWindow);
    const isBlocked = totalHitsInWindow >= this.config.maxRequests;

    // Calculate time until next request is allowed
    let msBeforeNext = 0;
    if (isBlocked && client.requests.length > 0) {
      const oldestRequest = Math.min(...client.requests);
      msBeforeNext = Math.max(0, oldestRequest + this.config.windowMs - now);
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
    if ((isSuccessful && this.config.skipSuccessfulRequests) || (!isSuccessful && this.config.skipFailedRequests)) {
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
  getStats(): {
    totalClients: number;
    activeClients: number;
    totalRequests: number;
    blockedRequests: number;
  } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let totalRequests = 0;
    let activeClients = 0;
    let blockedRequests = 0;

    for (const [, client] of this.clients) {
      totalRequests += client.totalRequests;

      // Count active clients (those with requests in current window)
      const recentRequests = client.requests.filter(timestamp => timestamp > windowStart);
      if (recentRequests.length > 0) {
        activeClients++;

        // Count blocked requests
        if (recentRequests.length >= this.config.maxRequests) {
          blockedRequests += recentRequests.length - this.config.maxRequests;
        }
      }
    }

    return {
      totalClients: this.clients.size,
      activeClients,
      totalRequests,
      blockedRequests,
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
  getConfig(): RateLimitConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RateLimitConfig>): void {
    Object.assign(this.config, newConfig);
    this.logger.log(`Rate limiter config updated: ${this.config.maxRequests} requests per ${this.config.windowMs}ms`);
  }

  /**
   * Cleanup old client records
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.config.windowMs * 2; // Keep records for 2x window size
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
