/**
 * Monitoring configuration types
 */

import type { BaseServiceConfig } from "../services/base.types";
import type { PerformanceThresholds } from "../utils";
import type { AlertingConfig, AccuracyThresholds, HealthThresholds } from ".";

export interface ThresholdsConfig extends BaseServiceConfig {
  accuracy: AccuracyThresholds;
  performance: PerformanceThresholds;
  health: HealthThresholds;
}

/**
 * Main monitoring configuration
 */
export interface MonitoringConfig extends BaseServiceConfig {
  /** Whether monitoring is enabled */
  enabled: boolean;
  /** Monitoring interval in milliseconds */
  interval: number;

  /** Threshold configurations */
  thresholds: ThresholdsConfig;

  /** Alerting configuration */
  alerting: AlertingConfig;
}
