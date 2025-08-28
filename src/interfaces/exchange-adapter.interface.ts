import { FeedCategory } from "@/types/feed-category.enum";
import { PriceUpdate, VolumeUpdate } from "./data-source.interface";

export abstract class ExchangeAdapter {
  abstract exchangeName: string;
  abstract category: FeedCategory;

  // Normalize different exchange response formats to unified PriceUpdate
  abstract normalizePriceData(rawData: any): PriceUpdate;
  abstract normalizeVolumeData(rawData: any): VolumeUpdate;
  abstract getSymbolMapping(feedSymbol: string): string;
  abstract validateResponse(rawData: any): boolean;

  protected calculateConfidence(rawData: any): number {
    // Default confidence calculation - can be overridden by specific adapters
    return 1.0;
  }
}
