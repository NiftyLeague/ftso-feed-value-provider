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
  }

  // Core feed methods (actually used) - delegate to utilities
  getFeedConfigurations(): FeedConfiguration[] {
    return getAllFeedConfigurations();
  }

  getFeedConfiguration(feedId: CoreFeedId): FeedConfiguration | undefined {
    return getFeedConfigUtil(feedId);
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
