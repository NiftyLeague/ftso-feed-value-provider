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

// Type guards for feed validation
export function isValidFeedCategory(category: number): category is FeedCategory {
  return Object.values(FeedCategory).includes(category);
}

export function isValidFeedId(feedId: any): feedId is EnhancedFeedId {
  return (
    feedId &&
    typeof feedId === "object" &&
    isValidFeedCategory(feedId.category) &&
    typeof feedId.name === "string" &&
    feedId.name.length > 0
  );
}
