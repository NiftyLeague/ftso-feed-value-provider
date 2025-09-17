import { Module } from "@nestjs/common";
import type { AlertSeverity, AlertAction, MonitoringConfig } from "@/common/types/monitoring";
import { EnvironmentUtils } from "@/common/utils/environment.utils";

import { AccuracyMonitorService } from "./accuracy-monitor.service";
import { PerformanceMonitorService } from "./performance-monitor.service";
import { AlertingService } from "./alerting.service";
import { PerformanceOptimizationCoordinatorService } from "./performance-optimization-coordinator.service";

// Import cache and aggregation modules for optimization coordinator
import { CacheModule } from "@/cache/cache.module";
import { AggregatorsModule } from "@/aggregators/aggregators.module";
import { ConfigModule } from "@/config/config.module";
import { ConfigService } from "@/config/config.service";

@Module({
  imports: [CacheModule, AggregatorsModule, ConfigModule],
  providers: [
    {
      provide: AccuracyMonitorService,
      useFactory: (config: MonitoringConfig) => {
        return new AccuracyMonitorService(config.thresholds);
      },
      inject: ["MonitoringConfig"],
    },
    {
      provide: PerformanceMonitorService,
      useFactory: (config: MonitoringConfig) => {
        return new PerformanceMonitorService(config.thresholds);
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
      useFactory: (_configService: ConfigService) => {
        return {
          accuracyThresholds: {
            maxConsensusDeviation: EnvironmentUtils.parseFloat("MAX_CONSENSUS_DEVIATION", 0.5, { min: 0, max: 10 }),
            minAccuracyRate: EnvironmentUtils.parseInt("MIN_ACCURACY_RATE", 80, { min: 0, max: 100 }),
            minQualityScore: EnvironmentUtils.parseInt("MIN_QUALITY_SCORE", 70, { min: 0, max: 100 }),
          },
          performanceThresholds: {
            maxResponseLatency: EnvironmentUtils.parseInt("MAX_RESPONSE_LATENCY", 80, { min: 1, max: 10000 }),
            maxDataAge: EnvironmentUtils.parseInt("MAX_DATA_AGE", 2000, { min: 100, max: 60000 }),
            minThroughput: EnvironmentUtils.parseInt("MIN_THROUGHPUT", 150, { min: 1, max: 10000 }),
            minCacheHitRate: EnvironmentUtils.parseInt("MIN_CACHE_HIT_RATE", 90, { min: 0, max: 100 }),
          },
          healthThresholds: {
            maxErrorRate: EnvironmentUtils.parseInt("MAX_ERROR_RATE", 3, { min: 0, max: 1000 }),
            maxCpuUsage: EnvironmentUtils.parseInt("MAX_CPU_USAGE", 70, { min: 0, max: 100 }),
            maxMemoryUsage: EnvironmentUtils.parseInt("MAX_MEMORY_USAGE", 70, { min: 0, max: 100 }),
            minConnectionRate: EnvironmentUtils.parseInt("MIN_CONNECTION_RATE", 95, { min: 0, max: 100 }),
          },
          monitoringInterval: EnvironmentUtils.parseInt("MONITORING_INTERVAL", 5000, { min: 1000, max: 60000 }),
          alerting: {
            rules: [
              {
                id: "consensus_deviation_critical",
                name: "Critical Consensus Deviation",
                description: "Consensus deviation exceeds 1% (critical threshold)",
                metric: "consensus_deviation",
                threshold: 1.0,
                operator: "gt",
                severity: "critical" as AlertSeverity,
                duration: 0,
                actions: ["log", "email", "webhook"] as AlertAction[],
                enabled: true,
                cooldown: 300000, // 5 minutes
              },
              {
                id: "consensus_deviation_error",
                name: "Consensus Deviation Error",
                description: "Consensus deviation exceeds 0.5% (FTSO requirement)",
                metric: "consensus_deviation",
                threshold: 0.5,
                operator: "gt",
                severity: "error" as AlertSeverity,
                duration: 0,
                actions: ["log", "email"] as AlertAction[],
                enabled: true,
                cooldown: 300000, // 5 minutes
              },
              {
                id: "accuracy_rate_low",
                name: "Low Accuracy Rate",
                description: "Accuracy rate below 80% target",
                metric: "accuracy_rate",
                threshold: 80,
                operator: "lt",
                severity: "warning" as AlertSeverity,
                duration: 60000, // 1 minute
                actions: ["log", "email"] as AlertAction[],
                enabled: true,
                cooldown: 600000, // 10 minutes
              },
              {
                id: "response_latency_high",
                name: "High Response Latency",
                description: "API response latency exceeds 100ms target",
                metric: "response_latency",
                threshold: 100,
                operator: "gt",
                severity: "warning" as AlertSeverity,
                duration: 30000, // 30 seconds
                actions: ["log"] as AlertAction[],
                enabled: true,
                cooldown: 300000, // 5 minutes
              },
              {
                id: "data_freshness_stale",
                name: "Stale Data Alert",
                description: "Data age exceeds 2 second freshness requirement",
                metric: "data_freshness",
                threshold: 2000,
                operator: "gt",
                severity: "error" as AlertSeverity,
                duration: 0,
                actions: ["log", "webhook"] as AlertAction[],
                enabled: true,
                cooldown: 60000, // 1 minute
              },
              {
                id: "connection_rate_low",
                name: "Low Exchange Connection Rate",
                description: "Exchange connection rate below 90%",
                metric: "connection_rate",
                threshold: 90,
                operator: "lt",
                severity: "error" as AlertSeverity,
                duration: 30000, // 30 seconds
                actions: ["log", "email", "webhook"] as AlertAction[],
                enabled: true,
                cooldown: 300000, // 5 minutes
              },
              {
                id: "error_rate_high",
                name: "High Error Rate",
                description: "System error rate exceeds 5 errors per minute",
                metric: "error_rate",
                threshold: 5,
                operator: "gt",
                severity: "error" as AlertSeverity,
                duration: 60000, // 1 minute
                actions: ["log", "email"] as AlertAction[],
                enabled: true,
                cooldown: 300000, // 5 minutes
              },
              {
                id: "quality_score_low",
                name: "Low Quality Score",
                description: "Overall quality score below acceptable threshold",
                metric: "quality_score",
                threshold: 70,
                operator: "lt",
                severity: "warning" as AlertSeverity,
                duration: 120000, // 2 minutes
                actions: ["log"] as AlertAction[],
                enabled: true,
                cooldown: 600000, // 10 minutes
              },
            ],
            deliveryConfig: {
              email: {
                enabled: EnvironmentUtils.parseBoolean("ALERT_EMAIL_ENABLED", false),
                smtpHost: EnvironmentUtils.parseString("ALERT_SMTP_HOST", "localhost"),
                smtpPort: EnvironmentUtils.parseInt("ALERT_SMTP_PORT", 587, { min: 1, max: 65535 }),
                username: EnvironmentUtils.parseString("ALERT_SMTP_USERNAME", ""),
                password: EnvironmentUtils.parseString("ALERT_SMTP_PASSWORD", ""),
                from: EnvironmentUtils.parseString("ALERT_EMAIL_FROM", '"Alerting Service" <alerts@ftso-provider.com>'),
                to: EnvironmentUtils.parseList("ALERT_EMAIL_TO", []),
              },
              webhook: {
                enabled: EnvironmentUtils.parseBoolean("ALERT_WEBHOOK_ENABLED", false),
                url: EnvironmentUtils.parseString("ALERT_WEBHOOK_URL", ""),
                headers: EnvironmentUtils.parseJSON("ALERT_WEBHOOK_HEADERS", {}),
                timeout: EnvironmentUtils.parseInt("ALERT_WEBHOOK_TIMEOUT", 5000, { min: 1000, max: 30000 }),
              },
            },
            maxAlertsPerHour: EnvironmentUtils.parseInt("ALERT_MAX_PER_HOUR", 20, { min: 1, max: 1000 }),
            alertRetention: EnvironmentUtils.parseInt("ALERT_RETENTION_DAYS", 30, { min: 1, max: 365 }),
          },
        };
      },
      inject: [ConfigService],
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
