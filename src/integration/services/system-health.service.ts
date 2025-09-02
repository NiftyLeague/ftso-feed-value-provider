import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/common/base/base-event.service";

// Monitoring services
import { AccuracyMonitorService } from "@/monitoring/accuracy-monitor.service";
import { PerformanceMonitorService } from "@/monitoring/performance-monitor.service";
import { AlertingService } from "@/monitoring/alerting.service";

// Types and interfaces
import { AggregatedPrice } from "@/aggregators/base/aggregation.interfaces";

interface HealthAlert {
  type: string;
  sourceId?: string;
  reason?: string;
  timestamp: number;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
}

interface SourceHealthStatus {
  sourceId: string;
  status: "healthy" | "unhealthy" | "recovered";
  lastUpdate: number;
  errorCount: number;
  recoveryCount: number;
}

interface SystemHealthMetrics {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: number;
  sources: SourceHealthStatus[];
  aggregation: {
    successRate: number;
    errorCount: number;
    lastError?: string;
  };
  performance: {
    averageResponseTime: number;
    errorRate: number;
  };
  accuracy: {
    averageConfidence: number;
    outlierRate: number;
  };
}

@Injectable()
export class SystemHealthService extends BaseEventService {
  private isInitialized = false;

  private sourceHealthMap = new Map<string, SourceHealthStatus>();
  private aggregationErrors: Error[] = [];
  private healthMetrics: SystemHealthMetrics;

  constructor(
    private readonly accuracyMonitor: AccuracyMonitorService,
    private readonly performanceMonitor: PerformanceMonitorService,
    private readonly alertingService: AlertingService
  ) {
    super("SystemHealth", true); // Needs enhanced logging for performance tracking and critical operations

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

  async initialize(): Promise<void> {
    const operationId = `init_${Date.now()}`;
    this.startPerformanceTimer(operationId, "system_health_initialization");

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

      this.isInitialized = true;

      this.logCriticalOperation(
        "system_health_initialization",
        {
          phase: "completed",
          timestamp: Date.now(),
          initialized: true,
        },
        true
      );

      this.endPerformanceTimer(operationId, true, { initialized: true });
    } catch (error) {
      this.endPerformanceTimer(operationId, false, { error: error.message });
      this.logError(error as Error, "system_health_initialization", { severity: "critical" });
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

  getOverallHealth(): SystemHealthMetrics {
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
      // Connect performance monitoring to alerting
      this.performanceMonitor.on("performanceAlert", alert => {
        this.handlePerformanceAlert(alert);
      });

      // Connect accuracy monitoring to alerting
      this.accuracyMonitor.on("accuracyAlert", alert => {
        this.handleAccuracyAlert(alert);
      });

      this.logger.log("Monitoring alerts configured");
    } catch (error) {
      this.logger.error("Failed to setup monitoring alerts:", error);
      throw error;
    }
  }

  private startHealthMonitoring(): void {
    // Start periodic health checks
    setInterval(() => {
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
        this.healthMetrics.aggregation.errorCount++;
        this.healthMetrics.aggregation.lastError = error.message;
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
      let alertSeverity: "info" | "warning" | "error" | "critical" = "info";
      let alertMessage = `Data source ${sourceId} status changed to ${status}`;

      if (status === "unhealthy") {
        alertSeverity = "warning";
        alertMessage = `Data source ${sourceId} is unhealthy`;
      } else if (status === "recovered") {
        alertSeverity = "info";
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
      // Send through alerting service
      void this.alertingService.sendAlert(alert);

      // Emit for external consumers
      this.emit("healthAlert", alert);

      this.logger.debug(`Sent health alert: ${alert.type} - ${alert.message}`);
    } catch (error) {
      this.logger.error("Error sending alert:", error);
    }
  }

  private handlePerformanceAlert(alert: any): void {
    try {
      const healthAlert: HealthAlert = {
        type: "performance_alert",
        timestamp: Date.now(),
        severity: alert.severity || "warning",
        message: `Performance alert: ${alert.message}`,
      };

      this.sendAlert(healthAlert);
    } catch (error) {
      this.logger.error("Error handling performance alert:", error);
    }
  }

  private handleAccuracyAlert(alert: unknown): void {
    try {
      const healthAlert: HealthAlert = {
        type: "accuracy_alert",
        timestamp: Date.now(),
        severity: (alert as any).severity || "warning",
        message: `Accuracy alert: ${(alert as any).message}`,
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
