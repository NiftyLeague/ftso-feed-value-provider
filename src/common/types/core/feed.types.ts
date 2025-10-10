/**
 * Core feed type definitions
 */

export enum FeedCategory {
  Crypto = 1,
  Forex = 2,
  Commodity = 3,
  Stock = 4,
}

export interface CoreFeedId {
  category: FeedCategory;
  name: string;
}

export interface FeedConfiguration {
  feed: CoreFeedId;
  sources: {
    exchange: string;
    symbol: string;
  }[];
}

export function isValidFeedCategory(category: number): category is FeedCategory {
  return Object.values(FeedCategory).includes(category);
}

export function isValidCoreFeedId(feedId: unknown): feedId is CoreFeedId {
  return (
    feedId !== null &&
    typeof feedId === "object" &&
    "category" in feedId &&
    "name" in feedId &&
    isValidFeedCategory((feedId as { category: number }).category) &&
    typeof (feedId as { name: unknown }).name === "string" &&
    (feedId as { name: string }).name.length > 0
  );
}
