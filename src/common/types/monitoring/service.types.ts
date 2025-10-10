/**
 * Service monitoring and statistics types
 */

import { CacheStats } from "../cache";
import { AggregationStatistics } from "./aggregation.types";

/**
 * Statistics about the service's operation
 */
export interface ServiceStatistics {
  /** Service uptime in seconds */
  uptime: number;
  /** Total number of requests processed */
  requestCount: number;
  /** Number of errors encountered */
  errorCount: number;
  /** Error rate (errors per request) */
  errorRate: number;
  /** Average response time in milliseconds */
  averageResponseTime: number;
  /** Cache statistics */
  cacheStats: CacheStats;
  /** Aggregation statistics */
  aggregationStats: AggregationStatistics;
  /** Current memory usage in bytes */
  memoryUsage: number;
  /** Current CPU usage (0-1) */
  cpuUsage: number;
  /** Number of active feeds */
  activeFeedCount: number;
}
