export interface RealTimeCache {
  set(key: string, value: CacheEntry, ttl: number): void;
  get(key: string): CacheEntry | null;
  invalidate(key: string): void;
  getStats(): CacheStats;
}

export interface CacheEntry {
  value: number;
  timestamp: number;
  sources: string[];
  confidence: number;
  votingRound?: number;
}

export interface CacheStats {
  hitRate: number;
  missRate: number;
  totalRequests: number;
  totalEntries: number;
  memoryUsage: number;
}

export interface CacheConfig {
  maxTTL: number; // 1 second maximum TTL
  maxEntries: number;
  evictionPolicy: "LRU" | "LFU" | "TTL";
  memoryLimit: number; // in bytes
}
