/**
 * Monitoring configuration types
 */

import { AlertRule, AlertDeliveryConfig, AccuracyThresholds, HealthThresholds } from ".";
import { RateLimitConfig, PerformanceThresholds } from "../utils";

/**
 * Main monitoring configuration
 */
export interface MonitoringConfig {
  /** Whether monitoring is enabled */
  enabled: boolean;
  /** Monitoring interval in milliseconds */
  interval: number;

  /** Threshold configurations */
  thresholds: {
    accuracy: AccuracyThresholds & {
      maxConsensusDeviation: number;
      minAccuracyRate: number;
      minQualityScore: number;
    };
    performance: PerformanceThresholds;
    health: HealthThresholds;
  };

  /** Alerting configuration */
  alerting: {
    /** Whether alerting is enabled */
    enabled: boolean;
    /** List of alert rules */
    rules: AlertRule[];
    /** Rate limiting configuration */
    rateLimits: RateLimitConfig;
    /** Maximum number of alerts that can be sent per hour */
    maxAlertsPerHour: number;
    /** How long to retain alert history (in days) */
    alertRetention: number;
    /** Alert delivery configuration */
    deliveryConfig: AlertDeliveryConfig;
  };
}
