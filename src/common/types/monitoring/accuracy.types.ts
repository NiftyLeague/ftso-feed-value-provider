/**
 * Types related to accuracy metrics and monitoring
 */

import type { ITimestamped } from "../core/common.types";

/**
 * Metrics related to data accuracy
 */
export interface AccuracyMetrics extends ITimestamped {
  /** Deviation from expected value */
  deviation: number;

  /** How closely this aligns with consensus */
  consensusAlignment: number;

  /** Number of outliers detected */
  outlierCount: number;

  /** Overall quality score (0-1) */
  qualityScore: number;

  /** Deviation from consensus */
  consensusDeviation: number;

  /** Accuracy rate (0-1) */
  accuracyRate: number;

  /** ID of the feed this metric is for */
  feedId: string;

  /** Timestamp of the metric */
  timestamp: number;

  /** Optional voting round number */
  votingRound?: number;
}

/**
 * Performance metrics for the service
 */
export interface PerformanceMetrics extends ITimestamped {
  /** Response time in milliseconds */
  responseTime: number;

  /** Requests per second */
  throughput: number;

  /** Error rate (0-1) */
  errorRate: number;

  /** Service availability (0-1) */
  availability: number;

  /** Response latency in milliseconds */
  responseLatency: number;

  /** How fresh the data is in milliseconds */
  dataFreshness: number;

  /** Timestamp of the metric */
  timestamp: number;

  /** Cache hit rate (0-1) */
  cacheHitRate: number;
}

/**
 * Health metrics for the service
 */
export interface HealthMetrics extends ITimestamped {
  /** Uptime in seconds */
  uptime: number;

  /** Memory usage in bytes */
  memoryUsage: number;

  /** CPU usage (0-1) */
  cpuUsage: number;

  /** Number of active connections */
  connectionCount: number;

  /** Status of various connections */
  connectionStatus: Map<string, boolean>;

  /** Error rate (0-1) */
  errorRate: number;

  /** Timestamp of the metric */
  timestamp: number;
}

/**
 * Quality score metrics
 */
export interface QualityScore {
  /** Overall score (0-1) */
  overall: number;

  /** Accuracy score (0-1) */
  accuracy: number;

  /** Timeliness score (0-1) */
  timeliness: number;

  /** Completeness score (0-1) */
  completeness: number;

  /** Consistency score (0-1) */
  consistency: number;

  /** Latency score (0-1) */
  latency: number;

  /** Coverage score (0-1) */
  coverage: number;

  /** Reliability score (0-1) */
  reliability: number;
}

/**
 * Data related to consensus calculation
 */
export interface ConsensusData {
  /** Median value */
  median: number;

  /** Mean value */
  mean: number;

  /** Standard deviation */
  standardDeviation: number;

  /** Number of participants */
  participantCount: number;

  /** Whether consensus was reached */
  consensusReached: boolean;

  /** Deviation from expected */
  deviation: number;

  /** Optional source count */
  sourceCount?: number;
}

/**
 * Thresholds for accuracy monitoring
 */
export interface AccuracyThresholds {
  /** Warning threshold */
  warning: number;

  /** Critical threshold */
  critical: number;

  /** Maximum allowed deviation */
  maxDeviation: number;

  /** Minimum number of participants */
  minParticipants: number;
  maxConsensusDeviation: number;
  minAccuracyRate: number;
  minQualityScore: number;
}

/**
 * Thresholds for health monitoring
 */
export interface HealthThresholds {
  /** Maximum error rate (0-1) */
  maxErrorRate: number;

  /** Maximum CPU usage (0-1) */
  maxCpuUsage: number;

  /** Maximum memory usage in bytes */
  maxMemoryUsage: number;

  /** Minimum connection rate (0-1) */
  minConnectionRate: number;
}
