import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";

// Monitoring services
import { AccuracyMonitorService } from "@/monitoring/accuracy-monitor.service";

import { AlertingService } from "@/monitoring/alerting.service";

// Types and interfaces
import type { AggregatedPrice } from "@/common/types/services";
import {
  type HealthAlert,
  type SourceHealthStatus,
  type DetailedSystemHealthMetrics,
  type Alert,
  AlertSeverity,
} from "@/common/types/monitoring";
import type { AccuracyAlertData } from "@/common/types/monitoring";

@Injectable()
export class SystemHealthService extends EventDrivenService {
  private sourceHealthMap = new Map<string, SourceHealthStatus>();
  private aggregationErrors: Error[] = [];
  private healthMetrics: DetailedSystemHealthMetrics;

  constructor(
    private readonly accuracyMonitor: AccuracyMonitorService,
    private readonly alertingService: AlertingService
  ) {
    super({ useEnhancedLogging: true });

    this.healthMetrics = {
      status: "healthy",
      timestamp: Date.now(),
      sources: [],
      aggregation: {
        successRate: 100,
        errorCount: 0,
      },
      performance: {
        averageResponseTime: 0,
        errorRate: 0,
      },
      accuracy: {
        averageConfidence: 0,
        outlierRate: 0,
      },
    };
  }

  override async initialize(): Promise<void> {
    const operationId = `init_${Date.now()}`;
    this.startTimer(operationId);

    try {
      this.logCriticalOperation("system_health_initialization", {
        phase: "starting",
        timestamp: Date.now(),
      });

      // Step 1: Initialize monitoring services
      await this.initializeMonitoringServices();

      // Step 2: Setup monitoring alerts
      await this.setupMonitoringAlerts();

      // Step 3: Start health monitoring loop
      this.startHealthMonitoring();

      // initialized

      this.logCriticalOperation(
        "system_health_initialization",
        {
          phase: "completed",
          timestamp: Date.now(),
          initialized: true,
        },
        true
      );

      this.endTimer(operationId);
    } catch (error) {
      const errObj = error instanceof Error ? error : new Error(String(error));
      this.endTimer(operationId);
      this.logFatal(`System health initialization failed: ${errObj.message}`, "system_health_initialization", {
        severity: "critical",
        error: errObj.message,
        stack: errObj.stack,
      });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.logger.log("Shutting down System Health Service...");

    try {
      // Stop monitoring services
      await this.stopMonitoring();

      this.logger.log("System Health Service shutdown completed");
    } catch (error) {
      this.logger.error("Error during system health service shutdown:", error);
    }
  }

  recordSourceHealth(sourceId: string, status: "healthy" | "unhealthy" | "recovered"): void {
    try {
      const existingStatus = this.sourceHealthMap.get(sourceId);
      const now = Date.now();

      const healthStatus: SourceHealthStatus = {
        sourceId,
        status,
        lastUpdate: now,
        errorCount: existingStatus?.errorCount || 0,
        recoveryCount: existingStatus?.recoveryCount || 0,
      };

      if (status === "unhealthy") {
        healthStatus.errorCount++;
      } else if (status === "recovered") {
        healthStatus.recoveryCount++;
      }

      this.sourceHealthMap.set(sourceId, healthStatus);

      // Update overall health metrics
      this.updateHealthMetrics();

      // Send alert if necessary
      this.checkAndSendHealthAlert(sourceId, status);

      this.logger.debug(`Recorded source health: ${sourceId} = ${status}`);
    } catch (error) {
      this.logger.error(`Error recording source health for ${sourceId}:`, error);
    }
  }

  recordPriceAggregation(aggregatedPrice: AggregatedPrice): void {
    try {
      // Record accuracy metrics
      this.accuracyMonitor.recordPrice(aggregatedPrice);

      // Update aggregation success metrics
      this.updateAggregationMetrics(true);

      this.logger.debug(`Recorded price aggregation for ${aggregatedPrice.symbol}`);
    } catch (error) {
      this.logger.error(`Error recording price aggregation:`, error);
    }
  }

  recordAggregationError(error: Error): void {
    try {
      // Store error for metrics
      this.aggregationErrors.push(error);

      // Keep only recent errors (last 100)
      if (this.aggregationErrors.length > 100) {
        this.aggregationErrors = this.aggregationErrors.slice(-100);
      }

      // Update aggregation error metrics
      this.updateAggregationMetrics(false, error);

      // Send error alert
      this.sendErrorAlert(error);

      this.logger.error("Recorded aggregation error:", error);
    } catch (handlingError) {
      this.logger.error("Error recording aggregation error:", handlingError);
    }
  }

  getOverallHealth(): DetailedSystemHealthMetrics {
    // Update metrics before returning
    this.updateHealthMetrics();
    return { ...this.healthMetrics };
  }

  getSourceHealth(sourceId: string): SourceHealthStatus | null {
    return this.sourceHealthMap.get(sourceId) || null;
  }

  getAllSourcesHealth(): SourceHealthStatus[] {
    return Array.from(this.sourceHealthMap.values());
  }

  // Private methods
  private async initializeMonitoringServices(): Promise<void> {
    this.logger.log("Initializing monitoring services...");

    try {
      // Note: Monitoring services are initialized through their constructors
      // No explicit start methods needed

      this.logger.log("Monitoring services initialized");
    } catch (error) {
      this.logger.error("Failed to initialize monitoring services:", error);
      throw error;
    }
  }

  private async setupMonitoringAlerts(): Promise<void> {
    this.logger.log("Setting up monitoring alerts...");

    try {
      // Note: Performance monitor doesn't emit events directly
      // Performance alerts are handled through periodic health checks

      // Connect accuracy monitoring to alerting
      this.accuracyMonitor.on("accuracyAlert", (alert: unknown) => {
        this.handleAccuracyAlert(alert as AccuracyAlertData);
      });

      this.logger.log("Monitoring alerts configured");
    } catch (error) {
      this.logger.error("Failed to setup monitoring alerts:", error);
      throw error;
    }
  }

  private startHealthMonitoring(): void {
    // Start periodic health checks using managed interval
    this.createInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds

    this.logger.log("Health monitoring started");
  }

  private async stopMonitoring(): Promise<void> {
    try {
      // Note: Monitoring services don't have explicit stop methods
      // They will be cleaned up when the module is destroyed

      this.logger.log("All monitoring services stopped successfully");
    } catch (error) {
      this.logger.error("Error stopping monitoring:", error);
    }
  }

  private updateHealthMetrics(): void {
    try {
      const now = Date.now();
      const sources = Array.from(this.sourceHealthMap.values());

      // Calculate overall status
      const unhealthySources = sources.filter(s => s.status === "unhealthy").length;
      const totalSources = sources.length;
      const healthyRatio = totalSources > 0 ? (totalSources - unhealthySources) / totalSources : 1;

      let overallStatus: "healthy" | "degraded" | "unhealthy";
      if (healthyRatio >= 0.8) {
        overallStatus = "healthy";
      } else if (healthyRatio >= 0.5) {
        overallStatus = "degraded";
      } else {
        overallStatus = "unhealthy";
      }

      // Get performance metrics (using available methods)
      const performanceMetrics = { averageResponseTime: 0, errorRate: 0 };
      const accuracyMetrics = { averageConfidence: 0, outlierRate: 0 };

      // Calculate aggregation success rate
      const totalAggregations =
        this.healthMetrics.aggregation.errorCount + this.healthMetrics.aggregation.successRate * 100; // Approximate
      const successRate =
        totalAggregations > 0 ? ((totalAggregations - this.aggregationErrors.length) / totalAggregations) * 100 : 100;

      // Update monitoring mixin health status
      this.setHealthStatus(overallStatus);

      this.healthMetrics = {
        status: overallStatus,
        timestamp: now,
        sources,
        aggregation: {
          successRate,
          errorCount: this.aggregationErrors.length,
          lastError:
            this.aggregationErrors.length > 0
              ? this.aggregationErrors[this.aggregationErrors.length - 1].message
              : undefined,
        },
        performance: {
          averageResponseTime: performanceMetrics?.averageResponseTime || 0,
          errorRate: performanceMetrics?.errorRate || 0,
        },
        accuracy: {
          averageConfidence: accuracyMetrics?.averageConfidence || 0,
          outlierRate: accuracyMetrics?.outlierRate || 0,
        },
      };
    } catch (error) {
      this.logger.error("Error updating health metrics:", error);
    }
  }

  private updateAggregationMetrics(success: boolean, error?: Error): void {
    try {
      if (!success && error) {
        this.incrementCounter("aggregation_errors");
        this.healthMetrics.aggregation.errorCount++;
        this.healthMetrics.aggregation.lastError = error.message;
      } else if (success) {
        this.incrementCounter("aggregation_success");
      }

      // Recalculate success rate
      const totalOperations =
        this.healthMetrics.aggregation.errorCount + (this.healthMetrics.aggregation.successRate * 100) / 100;

      if (totalOperations > 0) {
        this.healthMetrics.aggregation.successRate =
          ((totalOperations - this.healthMetrics.aggregation.errorCount) / totalOperations) * 100;
      }
    } catch (error) {
      this.logger.error("Error updating aggregation metrics:", error);
    }
  }

  private checkAndSendHealthAlert(sourceId: string, status: string): void {
    try {
      let alertSeverity: "log" | "warning" | "error" | "critical" = "log";
      let alertMessage = `Data source ${sourceId} status changed to ${status}`;

      if (status === "unhealthy") {
        alertSeverity = "warning";
        alertMessage = `Data source ${sourceId} is unhealthy`;
      } else if (status === "recovered") {
        alertSeverity = "log";
        alertMessage = `Data source ${sourceId} has recovered`;
      }

      const alert: HealthAlert = {
        type: "source_health_change",
        sourceId,
        timestamp: Date.now(),
        severity: alertSeverity,
        message: alertMessage,
      };

      this.sendAlert(alert);
    } catch (error) {
      this.logger.error(`Error sending health alert for ${sourceId}:`, error);
    }
  }

  private sendErrorAlert(error: Error): void {
    try {
      const alert: HealthAlert = {
        type: "aggregation_error",
        timestamp: Date.now(),
        severity: "error",
        message: `Aggregation error: ${error.message}`,
      };

      this.sendAlert(alert);
    } catch (alertError) {
      this.logger.error("Error sending error alert:", alertError);
    }
  }

  private sendAlert(alert: HealthAlert): void {
    try {
      // Map HealthAlert to generic Alert for delivery service
      const mapped: Alert = {
        id: `health_${Date.now()}`,
        ruleId: alert.type,
        type: "health",
        title: alert.type,
        description: undefined,
        message: alert.message,
        timestamp: alert.timestamp,
        status: "active",
        resolved: false,
        severity:
          alert.severity === "critical"
            ? AlertSeverity.CRITICAL
            : alert.severity === "error"
              ? AlertSeverity.ERROR
              : alert.severity === "warning"
                ? AlertSeverity.WARNING
                : AlertSeverity.INFO,
      };

      // Send through alerting service
      void this.alertingService.sendAlert(mapped);

      // Emit for external consumers
      this.emit("healthAlert", alert);

      this.logger.debug(`Sent health alert: ${alert.type} - ${alert.message}`);
    } catch (error) {
      this.logger.error("Error sending alert:", error);
    }
  }

  private handleAccuracyAlert(alert: AccuracyAlertData): void {
    try {
      const healthAlert: HealthAlert = {
        type: "accuracy_alert",
        timestamp: Date.now(),
        severity: "warning",
        message: `Accuracy alert: deviation=${alert.deviation} threshold=${alert.threshold} feedId=${alert.feedId}`,
      };

      this.sendAlert(healthAlert);
    } catch (error) {
      this.logger.error("Error handling accuracy alert:", error);
    }
  }

  private performHealthCheck(): void {
    try {
      // Update overall health metrics
      this.updateHealthMetrics();

      // Check for critical conditions
      if (this.healthMetrics.status === "unhealthy") {
        const alert: HealthAlert = {
          type: "system_unhealthy",
          timestamp: Date.now(),
          severity: "critical",
          message: "System health is critical - multiple sources unhealthy",
        };

        this.sendAlert(alert);
      }

      // Check aggregation error rate
      if (this.healthMetrics.aggregation.successRate < 90) {
        const alert: HealthAlert = {
          type: "high_error_rate",
          timestamp: Date.now(),
          severity: "warning",
          message: `Aggregation success rate is low: ${this.healthMetrics.aggregation.successRate.toFixed(2)}%`,
        };

        this.sendAlert(alert);
      }

      this.logger.debug("Health check completed");
    } catch (error) {
      this.logger.error("Error during health check:", error);
    }
  }
}
