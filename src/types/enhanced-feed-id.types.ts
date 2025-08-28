import { FeedCategory } from "./feed-category.enum";

export interface EnhancedFeedId {
  category: FeedCategory;
  name: string;
}

export interface FeedIdWithHex extends EnhancedFeedId {
  hexName?: string; // For hex-encoded feed names
  paddedName?: string; // For zero-padded names
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

// Feed ID encoding utilities for FTSO compatibility
export class FeedIdEncoder {
  static encodeToHex(name: string): string {
    return Buffer.from(name, "utf8").toString("hex");
  }

  static decodeFromHex(hexName: string): string {
    return Buffer.from(hexName, "hex").toString("utf8");
  }

  static padName(name: string, length: number = 21): string {
    return name.padEnd(length, "\0");
  }

  static generateFeedId(category: FeedCategory, name: string): EnhancedFeedId {
    return {
      category,
      name: name.trim(),
    };
  }
}
