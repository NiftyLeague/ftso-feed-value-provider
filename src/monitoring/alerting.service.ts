import axios from "axios";
import * as nodemailer from "nodemailer";
import { Injectable, Inject, OnModuleDestroy } from "@nestjs/common";

import { BaseService } from "@/common/base/base.service";
import { AlertSeverity, AlertAction } from "@/common/types/monitoring";
import type { Alert, AlertRule, MonitoringConfig } from "@/common/types/monitoring";
import type { LogLevel } from "@/common/types/logging";

@Injectable()
export class AlertingService extends BaseService implements OnModuleDestroy {
  private alerts: Map<string, Alert> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private alertCounts: Map<string, number> = new Map();
  private alertCooldowns: Map<string, number> = new Map();
  private emailTransporter?: nodemailer.Transporter;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(@Inject("MonitoringConfig") private readonly config: MonitoringConfig) {
    super("AlertingService", true);
    this.initializeEmailTransporter();
    this.startAlertCleanup();
  }

  /**
   * Cleanup resources when the module is destroyed
   */
  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.emailTransporter) {
      this.emailTransporter.close();
    }
  }

  /**
   * Initialize the email transporter for sending alert emails
   */
  private initializeEmailTransporter(): void {
    const emailConfig = this.config.alerting.deliveryConfig.email;
    if (emailConfig?.enabled) {
      this.emailTransporter = nodemailer.createTransport({
        host: emailConfig.smtpHost,
        port: emailConfig.smtpPort,
        secure: emailConfig.smtpPort === 465,
        auth: {
          user: emailConfig.username,
          pass: emailConfig.password,
        },
      });
      this.logger.log("Email transporter initialized");
    }
  }

  /**
   * Start the alert cleanup interval
   */
  private startAlertCleanup(): void {
    const cleanupIntervalMs = 3600000; // 1 hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldAlerts();
      this.resetHourlyAlertCounts();
    }, cleanupIntervalMs);
  }

  /**
   * Clean up old alerts from the system
   */
  private cleanupOldAlerts(): void {
    const retentionDays = this.config.alerting?.alertRetention || 7;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const cutoffTime = Date.now() - retentionMs;

    let deletedAlerts = 0;
    let deletedActiveAlerts = 0;

    // Clean up old alerts
    for (const [id, alert] of this.alerts.entries()) {
      if (alert.timestamp < cutoffTime) {
        this.alerts.delete(id);
        deletedAlerts++;
      }
    }

    // Clean up old active alerts
    for (const [id, alert] of this.activeAlerts.entries()) {
      if (alert.timestamp < cutoffTime) {
        this.activeAlerts.delete(id);
        deletedActiveAlerts++;
      }
    }

    if (deletedAlerts > 0 || deletedActiveAlerts > 0) {
      this.logger.debug(`Cleaned up ${deletedAlerts} old alerts and ${deletedActiveAlerts} old active alerts`);
    }
  }

  /**
   * Reset hourly alert counts
   */
  private resetHourlyAlertCounts(): void {
    this.alertCounts.clear();
  }

  /**
   * Get log level for alert severity
   */
  private getLogLevel(severity: AlertSeverity): LogLevel {
    switch (severity) {
      case AlertSeverity.CRITICAL:
      case AlertSeverity.ERROR:
        return "error";
      case AlertSeverity.WARNING:
      case AlertSeverity.HIGH:
        return "warn";
      case AlertSeverity.MEDIUM:
      case AlertSeverity.LOW:
      case AlertSeverity.INFO:
      default:
        return "info";
    }
  }

  /**
   * Log an alert with appropriate log level based on severity
   */
  private logAlert(alert: Alert): void {
    const logLevel = this.getLogLevel(alert.severity);
    const context = {
      alertId: alert.id,
      ruleId: alert.ruleId,
      severity: alert.severity,
      ...alert.metadata,
    } as const;

    switch (logLevel) {
      case "error":
        this.logger.error(alert.message, context);
        break;
      case "warn":
        this.logger.warn(alert.message, context);
        break;
      default:
        this.logger.log(alert.message, context);
        break;
    }
  }

  /**
   * Get all alerts, optionally limited by count
   */
  public getAllAlerts(limit: number = 100): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get active alerts
   */
  public getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get alerts filtered by severity
   */
  public getAlertsBySeverity(severity: AlertSeverity, limit: number = 100): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => alert.severity === severity)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get alert statistics
   */
  public getAlertStats(): { total: number; active: number; bySeverity: Record<AlertSeverity, number> } {
    const stats = {
      total: this.alerts.size,
      active: this.activeAlerts.size,
      bySeverity: Object.values(AlertSeverity).reduce(
        (acc, severity) => {
          acc[severity] = Array.from(this.alerts.values()).filter(alert => alert.severity === severity).length;
          return acc;
        },
        {} as Record<AlertSeverity, number>
      ),
    };

    return stats;
  }

  /**
   * Send alert directly (used by integration service)
   */
  public async sendAlert(alert: Alert): Promise<void> {
    try {
      // Create a temporary rule for direct alert sending
      const tempRule: AlertRule = {
        id: `temp_rule_${Date.now()}`,
        name: alert.type || "Direct Alert",
        description: alert.message || "Direct alert message",
        condition: {
          metric: "direct_alert",
          threshold: 0,
          operator: "gt",
        },
        severity: alert.severity || AlertSeverity.INFO,
        actions: [AlertAction.LOG],
        enabled: true,
        cooldown: 0,
      };

      await this.deliverAlert(alert, tempRule);
      this.logger.log("Direct alert sent successfully");
    } catch (error) {
      this.logger.error("Failed to send direct alert", { error });
      throw error;
    }
  }

  /**
   * Deliver alert through configured channels
   */
  private async deliverAlert(alert: Alert, rule: AlertRule): Promise<void> {
    try {
      // Log the alert
      this.logAlert(alert);

      // Store the alert
      this.alerts.set(alert.id, alert);

      if (!alert.resolved) {
        this.activeAlerts.set(alert.ruleId, alert);
      } else {
        this.activeAlerts.delete(alert.ruleId);
      }

      // Deliver through configured channels
      if (rule.actions.includes(AlertAction.EMAIL) && this.emailTransporter) {
        await this.sendEmailAlert(alert, rule);
      }

      if (rule.actions.includes(AlertAction.WEBHOOK)) {
        await this.sendWebhookAlert(alert, rule);
      }
    } catch (error) {
      this.logger.error("Error delivering alert", { error, alertId: alert.id });
      throw error;
    }
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(alert: Alert, rule: AlertRule): Promise<void> {
    if (!this.emailTransporter) {
      throw new Error("Email transporter not initialized");
    }

    const emailConfig = this.config.alerting.deliveryConfig.email;
    if (!emailConfig?.enabled || !emailConfig.to) {
      return;
    }

    const html = this.formatEmailAlert(alert, rule);

    await this.emailTransporter.sendMail({
      from: emailConfig.from || `"Alerting Service" <${emailConfig.username}>`,
      to: emailConfig.to,
      subject: `[${alert.severity}] ${alert.title || "New Alert"}`,
      html,
    });
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(alert: Alert, rule: AlertRule): Promise<void> {
    const webhookConfig = this.config.alerting.deliveryConfig.webhook;
    if (!webhookConfig?.enabled || !webhookConfig.url) {
      return;
    }

    const payload = {
      alert,
      rule: {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        severity: rule.severity,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      await axios.post(webhookConfig.url, payload, {
        headers: {
          "Content-Type": "application/json",
          ...(webhookConfig.headers || {}),
        },
        timeout: webhookConfig.timeout || 5000,
      });
    } catch (err) {
      // Tests expect a specific error message here
      this.logger.error("Failed to send webhook alert", err as Error);
    }
  }

  /**
   * Format email alert HTML
   */
  private formatEmailAlert(alert: Alert, rule: AlertRule): string {
    const color = this.getSeverityColor(alert.severity);

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: ${color}; color: white; padding: 15px; border-radius: 5px 5px 0 0;">
          <h2 style="margin: 0;">${alert.title || "New Alert"}</h2>
        </div>
        <div style="border: 1px solid #ddd; border-top: none; padding: 15px; border-radius: 0 0 5px 5px;">
          <p><strong>Severity:</strong> ${alert.severity}</p>
          <p><strong>Rule:</strong> ${rule.name}</p>
          <p><strong>Message:</strong> ${alert.message}</p>
          <p><strong>Timestamp:</strong> ${new Date(alert.timestamp).toLocaleString()}</p>
          ${
            alert.metadata
              ? `
            <div style="margin-top: 15px; border-top: 1px solid #eee; padding-top: 10px;">
              <h3 style="margin-top: 0;">Details:</h3>
              <pre style="background-color: #f5f5f5; padding: 10px; border-radius: 3px; overflow-x: auto;">
${JSON.stringify(alert.metadata, null, 2)}
              </pre>
            </div>
          `
              : ""
          }
        </div>
      </div>
    `;
  }

  /**
   * Get color for alert severity
   */
  private getSeverityColor(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return "#d32f2f"; // Red 700
      case AlertSeverity.ERROR:
        return "#f44336"; // Red 500
      case AlertSeverity.WARNING:
        return "#ff9800"; // Orange 500
      case AlertSeverity.HIGH:
        return "#ffa000"; // Amber 700
      case AlertSeverity.MEDIUM:
        return "#ffc107"; // Amber 500
      case AlertSeverity.LOW:
        return "#ffeb3b"; // Yellow 500
      case AlertSeverity.INFO:
      default:
        return "#2196f3"; // Blue 500
    }
  }

  /**
   * Evaluate a metric against configured rules and create/resolve alerts
   */
  public evaluateMetric(metric: string, value: number, metadata?: Record<string, unknown>): void {
    const rule = this.config.alerting?.rules?.find(r => r.condition.metric === metric);
    if (!rule || !rule.enabled) return;

    const now = Date.now();

    // Cooldown check
    const lastTs = this.alertCooldowns.get(rule.id) ?? 0;
    const cooldownMs = rule.cooldown ?? 0;
    if (cooldownMs > 0 && now - lastTs < cooldownMs) {
      return;
    }

    // Determine trigger based on operator
    const threshold = rule.condition.threshold;
    const op = rule.condition.operator;
    const compare = (v: number, t: number, operator: typeof op): boolean => {
      switch (operator) {
        case ">":
        case "gt":
          return v > t;
        case "gte":
          return v >= t;
        case "<":
        case "lt":
          return v < t;
        case "lte":
          return v <= t;
        case "==":
        case "eq":
          return v === t;
        default:
          return false;
      }
    };

    const triggered = compare(value, threshold, op);

    // If triggered, enforce global rate limit
    if (triggered) {
      const maxPerHour = this.config.alerting?.maxAlertsPerHour ?? Infinity;
      const totalCount = this.alertCounts.get("total") ?? 0;
      if (totalCount >= maxPerHour) {
        this.enhancedLogger?.warn("Alert rate limit exceeded", { ruleId: rule.id, metric, value, threshold });
        return;
      }
    }

    // Resolution path: previously active, now back to normal
    if (!triggered && this.activeAlerts.has(rule.id)) {
      const resolveAlert: Alert = {
        id: `${rule.id}_${now}`,
        ruleId: rule.id,
        type: "metric",
        title: `Alert resolved: ${rule.name}`,
        message: `Alert resolved: ${rule.name} - metric: ${metric} back to normal (value: ${value}, threshold: ${threshold})`,
        timestamp: now,
        status: "resolved",
        resolved: true,
        resolvedAt: now,
        metadata,
        severity: rule.severity,
      };
      // Deliver and clear active state
      void this.deliverAlert(resolveAlert, rule);
      return;
    }

    if (!triggered) return;

    // Build alert
    const details: string[] = [`metric: ${metric}`, `value: ${value}`, `threshold: ${threshold}`];
    if (metadata) {
      if (typeof metadata.feedId === "string") details.push(`feedId: ${String(metadata.feedId)}`);
      if (typeof metadata.exchange === "string") details.push(`exchange: ${String(metadata.exchange)}`);
    }

    const alert: Alert = {
      id: `${rule.id}_${now}`,
      ruleId: rule.id,
      type: "metric",
      title: `Alert: ${rule.name}`,
      message: `Alert: ${rule.name} - ${details.join(", ")}`,
      timestamp: now,
      status: "active",
      resolved: false,
      metadata: { metric, value, threshold, ...(metadata || {}) },
      severity: rule.severity,
    };

    // Update counters and cooldowns
    this.alertCounts.set("total", (this.alertCounts.get("total") ?? 0) + 1);
    if (cooldownMs > 0) this.alertCooldowns.set(rule.id, now);

    // Deliver alert (logs appropriately and stores active)
    void this.deliverAlert(alert, rule);
  }

  /**
   * Send a test alert to verify delivery configuration
   */
  public async testAlertDelivery(severity: AlertSeverity = AlertSeverity.INFO): Promise<void> {
    const now = Date.now();
    const rule: AlertRule = {
      id: `test_rule_${now}`,
      name: "Test Alert",
      description: "Test alert to verify delivery configuration",
      condition: { metric: "test_metric", threshold: 0, operator: "gt" },
      severity,
      actions: [AlertAction.LOG],
      enabled: true,
      cooldown: 0,
    };

    const alert: Alert = {
      id: `test_alert_${now}`,
      ruleId: rule.id,
      type: "system",
      title: `Test Alert (${severity})`,
      message: `Test alert generated at ${new Date(now).toISOString()}`,
      timestamp: now,
      status: "active",
      resolved: false,
      severity,
    };

    await this.deliverAlert(alert, rule);
    this.logger.log("Test alert delivery completed");
  }
}
