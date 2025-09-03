/**
 * Aggregation-related type definitions
 */

/**
 * Aggregation statistics
 */
export interface AggregationStatistics {
  /** Total number of aggregations performed */
  totalAggregations: number;
  /** Average time taken for aggregation in milliseconds */
  averageAggregationTime: number;
  /** Number of data sources */
  sourceCount: number;
  /** Rate of consensus achieved (0-1) */
  consensusRate: number;
  /** Overall quality score of aggregations (0-1) */
  qualityScore: number;
}
