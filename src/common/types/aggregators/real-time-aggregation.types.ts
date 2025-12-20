export interface AggregationCacheStats {
  totalEntries: number;
  hitRate: number;
  missRate: number;
  evictionCount: number;
  averageAge: number;
}
