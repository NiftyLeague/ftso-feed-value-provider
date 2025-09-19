/**
 * Feed Mapping Utilities
 * Simple utilities for mapping symbols to feed IDs without requiring ConfigService
 */

import { readFileSync } from "fs";
import { join } from "path";
import { type CoreFeedId, type FeedConfiguration } from "@/common/types/core";

// Raw JSON structure from feeds.json
interface RawFeedData {
  feed: {
    category: number;
    name: string;
  };
  sources: {
    exchange: string;
    symbol: string;
  }[];
}

let feedConfigurations: FeedConfiguration[] | null = null;

/**
 * Load feed configurations once from feeds.json
 */
function loadFeedConfigurations(): FeedConfiguration[] {
  if (feedConfigurations === null) {
    try {
      const feedsFilePath = join(process.cwd(), "src", "config", "feeds.json");
      const feedsData = readFileSync(feedsFilePath, "utf8");
      const feedsJson = JSON.parse(feedsData) as RawFeedData[];

      feedConfigurations = feedsJson.map(feedData => ({
        feed: {
          category: feedData.feed.category,
          name: feedData.feed.name,
        },
        sources: feedData.sources,
      }));
    } catch (error) {
      console.error("Failed to load feed configurations:", error);
      feedConfigurations = [];
    }
  }
  return feedConfigurations || [];
}

/**
 * Get feed ID from symbol
 */
export function getFeedIdFromSymbol(symbol: string): CoreFeedId | null {
  const feedConfigs = loadFeedConfigurations();
  const config = feedConfigs.find(config => config.feed.name === symbol);
  return config ? config.feed : null;
}

/**
 * Get all feed configurations
 */
export function getAllFeedConfigurations(): FeedConfiguration[] {
  return loadFeedConfigurations();
}

/**
 * Get feed configuration by feed ID
 */
export function getFeedConfiguration(feedId: CoreFeedId): FeedConfiguration | undefined {
  const feedConfigs = loadFeedConfigurations();
  return feedConfigs.find(config => config.feed.category === feedId.category && config.feed.name === feedId.name);
}

/**
 * Check if exchange has a custom adapter
 */
export function hasCustomAdapter(exchange: string): boolean {
  const customAdapterExchanges = ["binance", "coinbase", "cryptocom", "kraken", "okx"];
  return customAdapterExchanges.includes(exchange);
}

/**
 * Force reload of feed configurations from feeds.json
 */
export function reloadFeedConfigurations(): void {
  feedConfigurations = null; // Clear cache to force reload
}
