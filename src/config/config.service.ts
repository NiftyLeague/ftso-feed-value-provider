/**
 * Config Service
 * Simple configuration service that provides feed management and adapter utilities
 */

import { Injectable } from "@nestjs/common";
import { StandardService } from "@/common/base/composed.service";
import { ENV } from "./environment.constants";
import { type CoreFeedId, FeedCategory } from "@/common/types/core";
import { type IConfigurationService } from "@/common/types";
import { type FeedConfiguration } from "@/common/types/core";
import {
  getAllFeedConfigurations,
  getFeedConfiguration as getFeedConfigUtil,
  hasCustomAdapter as hasCustomAdapterUtil,
  reloadFeedConfigurations as reloadFeedConfigsUtil,
} from "@/common/utils";

/**
 * Simple configuration service - most code should use ENV constants directly
 * This service reuses the utilities from @/common/utils for consistency
 */
@Injectable()
export class ConfigService extends StandardService implements IConfigurationService {
  constructor() {
    super({ useEnhancedLogging: true });

    // Log feed count at startup to verify correct loading
    this.logFeedCountAtStartup();
  }

  /**
   * Log feed count at startup for verification
   */
  private logFeedCountAtStartup(): void {
    try {
      const count = this.getFeedsCount();
      this.logger.log(`✅ Feeds configuration loaded successfully: ${count} feeds from feeds.json`);
    } catch (error) {
      this.logger.error("❌ Failed to load feeds configuration at startup:", error);
    }
  }

  // Core feed methods (actually used) - delegate to utilities
  getFeedConfigurations(): FeedConfiguration[] {
    return getAllFeedConfigurations();
  }

  getFeedConfiguration(feedId: CoreFeedId): FeedConfiguration | undefined {
    return getFeedConfigUtil(feedId);
  }

  /**
   * Get the total count of feeds from feeds.json
   * @returns number of feeds configured
   */
  getFeedsCount(): number {
    try {
      const feeds = this.getFeedConfigurations();
      const count = feeds.length;
      this.logger.debug(`Loaded feeds count: ${count} from feeds.json`);
      return count;
    } catch (error) {
      this.logger.error("Failed to load feeds count from configuration:", error);
      throw new Error(`Failed to get feeds count: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get feeds count with fallback to known value
   * @param fallbackCount - fallback count if loading fails (default: 64)
   * @returns number of feeds
   */
  getFeedsCountWithFallback(fallbackCount: number = 64): number {
    try {
      return this.getFeedsCount();
    } catch (error) {
      this.logger.warn(`Failed to load feeds count, using fallback: ${fallbackCount}`, error);
      return fallbackCount;
    }
  }

  /**
   * Get all feed symbols from feeds.json
   * @returns array of feed symbols (e.g., ["BTC/USD", "ETH/USD", ...])
   */
  getAllFeedSymbols(): string[] {
    try {
      const feeds = this.getFeedConfigurations();
      const symbols = feeds.map(config => config.feed.name);
      this.logger.debug(`Loaded ${symbols.length} feed symbols from feeds.json`);
      return symbols;
    } catch (error) {
      this.logger.error("Failed to load feed symbols from configuration:", error);
      throw new Error(`Failed to get feed symbols: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // Core adapter method (actually used) - delegate to utility
  hasCustomAdapter(exchange: string): boolean {
    return hasCustomAdapterUtil(exchange);
  }

  // Environment config - return ENV constants directly
  getEnvironmentConfig() {
    return ENV;
  }

  // Interface compatibility methods (rarely used)
  getFeedConfigurationsByCategory(category: FeedCategory): FeedConfiguration[] {
    return getAllFeedConfigurations().filter(config => config.feed.category === category);
  }

  validateConfiguration() {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation - delegate to ENV_HELPERS for complex logic
    if (ENV.APPLICATION.PORT < 1 || ENV.APPLICATION.PORT > 65535) {
      errors.push(`Invalid port: ${ENV.APPLICATION.PORT}`);
    }

    if (ENV.ALERTING.EMAIL.ENABLED && !ENV.ALERTING.EMAIL.SMTP_HOST) {
      errors.push("Email alerting enabled but SMTP host not configured");
    }

    if (ENV.ALERTING.WEBHOOK.ENABLED && !ENV.ALERTING.WEBHOOK.URL) {
      errors.push("Webhook alerting enabled but URL not configured");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      missingRequired: [],
      invalidValues: [],
    };
  }

  // Interface compatibility methods (simple implementations)
  getAdapterClass(exchange: string): string | undefined {
    const adapters: Record<string, string> = {
      binance: "BinanceAdapter",
      coinbase: "CoinbaseAdapter",
      cryptocom: "CryptocomAdapter",
      kraken: "KrakenAdapter",
      okx: "OkxAdapter",
    };
    return adapters[exchange];
  }

  getCcxtId(exchange: string): string | undefined {
    const customExchanges = ["binance", "coinbase", "cryptocom", "kraken", "okx"];
    return customExchanges.includes(exchange) ? undefined : exchange;
  }

  reloadFeedConfigurations(): void {
    reloadFeedConfigsUtil();
    this.logger.log("Feed configurations reloaded from feeds.json");
  }

  reloadConfiguration(): void {
    // Same as reloadFeedConfigurations since we only have feed configs to reload
    this.reloadFeedConfigurations();
  }

  // Required by interface
  getServiceName(): string {
    return "ConfigService";
  }
}
