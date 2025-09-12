import { Module } from "@nestjs/common";
import type { AlertSeverity, AlertAction, MonitoringConfig } from "@/common/types/monitoring";

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
      useFactory: (config: MonitoringConfig) => new AccuracyMonitorService(config.thresholds),
      inject: ["MonitoringConfig"],
    },
    {
      provide: PerformanceMonitorService,
      useFactory: (config: MonitoringConfig) => new PerformanceMonitorService(config.thresholds),
      inject: ["MonitoringConfig"],
    },
    {
      provide: AlertingService,
      useFactory: (config: MonitoringConfig) => new AlertingService(config.alerting),
      inject: ["MonitoringConfig"],
    },
    PerformanceOptimizationCoordinatorService,
    {
      provide: "MonitoringConfig",
      useFactory: (_configService: ConfigService) => {
        return {
          accuracyThresholds: {
            maxConsensusDeviation: 0.5, // 0.5% FTSO requirement
            minAccuracyRate: 80, // 80% target
            minQualityScore: 70,
          },
          performanceThresholds: {
            maxResponseLatency: 80, // Reduced from 100ms for better performance target
            maxDataAge: 2000, // 2s target
            minThroughput: 150, // Increased from 100 for better performance
            minCacheHitRate: 90, // Increased from 80 for better caching
          },
          healthThresholds: {
            maxErrorRate: 3, // 3 errors per minute
            maxCpuUsage: 70, // 70% cpu
            maxMemoryUsage: 70, // 70% memory
            minConnectionRate: 95, // 95% of exchanges connected
          },
          monitoringInterval: 5000, // 5 seconds
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
                enabled: process.env.ALERT_EMAIL_ENABLED === "true",
                smtpHost: process.env.ALERT_SMTP_HOST || "localhost",
                smtpPort: parseInt(process.env.ALERT_SMTP_PORT || "587", 10),
                username: process.env.ALERT_SMTP_USERNAME || "",
                password: process.env.ALERT_SMTP_PASSWORD || "",
                from: process.env.ALERT_EMAIL_FROM || '"Alerting Service" <alerts@ftso-provider.com>',
                to: (process.env.ALERT_EMAIL_TO || "").split(",").filter(Boolean),
              },
              webhook: {
                enabled: process.env.ALERT_WEBHOOK_ENABLED === "true",
                url: process.env.ALERT_WEBHOOK_URL || "",
                headers: process.env.ALERT_WEBHOOK_HEADERS ? JSON.parse(process.env.ALERT_WEBHOOK_HEADERS) : {},
                timeout: parseInt(process.env.ALERT_WEBHOOK_TIMEOUT || "5000", 10),
              },
            },
            maxAlertsPerHour: parseInt(process.env.ALERT_MAX_PER_HOUR || "20", 10),
            alertRetention: parseInt(process.env.ALERT_RETENTION_DAYS || "30", 10),
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
