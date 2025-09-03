/**
 * Core feed type definitions
 */

export enum FeedCategory {
  Crypto = 1,
  Forex = 2,
  Commodity = 3,
  Stock = 4,
}

export interface EnhancedFeedId {
  category: FeedCategory;
  name: string;
}

export function isValidFeedCategory(category: number): category is FeedCategory {
  return Object.values(FeedCategory).includes(category);
}

export function isValidFeedId(feedId: unknown): feedId is EnhancedFeedId {
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
