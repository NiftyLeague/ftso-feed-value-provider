import { Module } from "@nestjs/common";
import type { AlertSeverity, AlertAction, MonitoringConfig } from "@/common/types/monitoring";
import { ENV } from "@/config";

import { AccuracyMonitorService } from "./accuracy-monitor.service";
import { PerformanceMonitorService } from "./performance-monitor.service";
import { AlertingService } from "./alerting.service";
import { PerformanceOptimizationCoordinatorService } from "./performance-optimization-coordinator.service";

// Import cache and aggregation modules for optimization coordinator
import { CacheModule } from "@/cache/cache.module";
import { AggregatorsModule } from "@/aggregators/aggregators.module";

@Module({
  imports: [CacheModule, AggregatorsModule],
  providers: [
    {
      provide: AccuracyMonitorService,
      useFactory: (config: MonitoringConfig) => {
        return new AccuracyMonitorService({
          accuracy: config.thresholds.accuracy,
          performance: config.thresholds.performance,
          health: config.thresholds.health,
        });
      },
      inject: ["MonitoringConfig"],
    },
    {
      provide: PerformanceMonitorService,
      useFactory: (config: MonitoringConfig) => {
        return new PerformanceMonitorService({
          accuracy: config.thresholds.accuracy,
          performance: config.thresholds.performance,
          health: config.thresholds.health,
        });
      },
      inject: ["MonitoringConfig"],
    },
    {
      provide: AlertingService,
      useFactory: (config: MonitoringConfig) => {
        return new AlertingService(config.alerting);
      },
      inject: ["MonitoringConfig"],
    },
    PerformanceOptimizationCoordinatorService,
    {
      provide: "MonitoringConfig",
      useFactory: () => {
        return {
          enabled: true,
          interval: ENV.INTERVALS.MONITORING_MS,
          thresholds: {
            accuracy: {
              maxConsensusDeviation: ENV.MONITORING.MAX_CONSENSUS_DEVIATION,
              minAccuracyRate: ENV.MONITORING.MIN_ACCURACY_RATE,
              minQualityScore: ENV.MONITORING.MIN_QUALITY_SCORE,
              warning: ENV.MONITORING.WARNING_THRESHOLD,
              critical: ENV.MONITORING.CRITICAL_THRESHOLD,
              maxDeviation: ENV.MONITORING.MAX_DEVIATION,
              minParticipants: ENV.MONITORING.MIN_PARTICIPANTS,
            },
            performance: {
              maxResponseLatency: ENV.MONITORING.MAX_RESPONSE_LATENCY_MS,
              maxDataAge: ENV.DATA_FRESHNESS.MAX_DATA_AGE_MS,
              minThroughput: ENV.MONITORING.MIN_THROUGHPUT,
              minCacheHitRate: ENV.MONITORING.MIN_CACHE_HIT_RATE,
            },
            health: {
              maxErrorRate: ENV.MONITORING.MAX_ERROR_RATE,
              maxCpuUsage: ENV.MONITORING.MAX_CPU_USAGE,
              maxMemoryUsage: ENV.MONITORING.MAX_MEMORY_USAGE,
              minConnectionRate: ENV.MONITORING.MIN_CONNECTION_RATE,
            },
          },
          alerting: {
            rules: [
              {
                id: "consensus_deviation_critical",
                name: "Critical Consensus Deviation",
                description: "Consensus deviation exceeds 1% (critical threshold)",
                metric: "consensus_deviation",
                threshold: ENV.ALERTS.CONSENSUS_DEVIATION_CRITICAL,
                operator: "gt",
                severity: "critical" as AlertSeverity,
                duration: 0,
                actions: ["log", "email", "webhook"] as AlertAction[],
                enabled: true,
                cooldown: ENV.MONITORING.ALERT_COOLDOWN_MS,
              },
              {
                id: "consensus_deviation_error",
                name: "Consensus Deviation Error",
                description: "Consensus deviation exceeds 0.5% (FTSO requirement)",
                metric: "consensus_deviation",
                threshold: ENV.ALERTS.CONSENSUS_DEVIATION_ERROR,
                operator: "gt",
                severity: "error" as AlertSeverity,
                duration: 0,
                actions: ["log", "email"] as AlertAction[],
                enabled: true,
                cooldown: ENV.MONITORING.ALERT_COOLDOWN_MS,
              },
              {
                id: "accuracy_rate_low",
                name: "Low Accuracy Rate",
                description: "Accuracy rate below 80% target",
                metric: "accuracy_rate",
                threshold: ENV.ALERTS.ACCURACY_RATE_LOW,
                operator: "lt",
                severity: "warning" as AlertSeverity,
                duration: ENV.MONITORING.ALERT_DURATION_MS,
                actions: ["log", "email"] as AlertAction[],
                enabled: true,
                cooldown: ENV.MONITORING.ALERT_COOLDOWN_MS,
              },
              {
                id: "response_latency_high",
                name: "High Response Latency",
                description: "API response latency exceeds 100ms target",
                metric: "response_latency",
                threshold: ENV.MONITORING.MAX_RESPONSE_LATENCY_MS,
                operator: "gt",
                severity: "warning" as AlertSeverity,
                duration: ENV.MONITORING.ALERT_DURATION_MS,
                actions: ["log"] as AlertAction[],
                enabled: true,
                cooldown: ENV.MONITORING.ALERT_COOLDOWN_MS,
              },
              {
                id: "data_freshness_stale",
                name: "Stale Data Alert",
                description: "Data age exceeds 2 second freshness requirement",
                metric: "data_freshness",
                threshold: ENV.DATA_FRESHNESS.MAX_DATA_AGE_MS,
                operator: "gt",
                severity: "error" as AlertSeverity,
                duration: 0,
                actions: ["log", "webhook"] as AlertAction[],
                enabled: true,
                cooldown: ENV.MONITORING.ALERT_COOLDOWN_MS,
              },
              {
                id: "connection_rate_low",
                name: "Low Exchange Connection Rate",
                description: "Exchange connection rate below 90%",
                metric: "connection_rate",
                threshold: ENV.ALERTS.CONNECTION_RATE_LOW,
                operator: "lt",
                severity: "error" as AlertSeverity,
                duration: ENV.MONITORING.ALERT_DURATION_MS,
                actions: ["log", "email", "webhook"] as AlertAction[],
                enabled: true,
                cooldown: ENV.MONITORING.ALERT_COOLDOWN_MS,
              },
              {
                id: "error_rate_high",
                name: "High Error Rate",
                description: "System error rate exceeds 5 errors per minute",
                metric: "error_rate",
                threshold: ENV.ALERTS.ERROR_RATE_HIGH,
                operator: "gt",
                severity: "error" as AlertSeverity,
                duration: ENV.MONITORING.ALERT_DURATION_MS,
                actions: ["log", "email"] as AlertAction[],
                enabled: true,
                cooldown: ENV.MONITORING.ALERT_COOLDOWN_MS,
              },
              {
                id: "quality_score_low",
                name: "Low Quality Score",
                description: "Overall quality score below acceptable threshold",
                metric: "quality_score",
                threshold: ENV.ALERTS.QUALITY_SCORE_LOW,
                operator: "lt",
                severity: "warning" as AlertSeverity,
                duration: ENV.MONITORING.ALERT_DURATION_MS,
                actions: ["log"] as AlertAction[],
                enabled: true,
                cooldown: ENV.MONITORING.ALERT_COOLDOWN_MS,
              },
            ],
            deliveryConfig: {
              email: {
                enabled: ENV.ALERTING.EMAIL.ENABLED,
                smtpHost: ENV.ALERTING.EMAIL.SMTP_HOST,
                smtpPort: ENV.ALERTING.EMAIL.SMTP_PORT,
                username: ENV.ALERTING.EMAIL.USERNAME,
                password: ENV.ALERTING.EMAIL.PASSWORD,
                from: ENV.ALERTING.EMAIL.FROM,
                to: ENV.ALERTING.EMAIL.TO,
              },
              webhook: {
                enabled: ENV.ALERTING.WEBHOOK.ENABLED,
                url: ENV.ALERTING.WEBHOOK.URL,
                headers: ENV.ALERTING.WEBHOOK.HEADERS,
                timeout: ENV.TIMEOUTS.WEBHOOK_MS,
              },
            },
            maxAlertsPerHour: ENV.MONITORING.MAX_ALERTS_PER_HOUR,
            alertRetention: ENV.MONITORING.ALERT_RETENTION_DAYS,
          },
        };
      },
      inject: [],
    },
  ],
  exports: [
    AccuracyMonitorService,
    PerformanceMonitorService,
    AlertingService,
    PerformanceOptimizationCoordinatorService,
  ],
})
export class MonitoringModule {}
