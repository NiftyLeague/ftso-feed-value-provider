import { Injectable, Logger, Inject } from "@nestjs/common";
import {
  Alert,
  AlertRule,
  AlertSeverity,
  AlertAction,
  AlertingConfig,
  MonitoringConfig,
} from "./interfaces/monitoring.interfaces";
import * as nodemailer from "nodemailer";
import axios from "axios";

@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);
  private alerts: Map<string, Alert> = new Map();
  private activeAlerts: Map<string, Alert> = new Map();
  private alertCooldowns: Map<string, number> = new Map();
  private alertCounts: Map<string, number> = new Map();
  private emailTransporter?: nodemailer.Transporter;

  constructor(@Inject("MonitoringConfig") private readonly config: MonitoringConfig) {
    this.initializeEmailTransporter();
    this.startAlertCleanup();
  }

  /**
   * Evaluate metric against alert rules
   * Requirement 4.2: Configurable alert rules for accuracy thresholds
   */
  evaluateMetric(metric: string, value: number, metadata: Record<string, any> = {}): void {
    const applicableRules = this.config.alerting.rules.filter(rule => rule.enabled && rule.metric === metric);

    for (const rule of applicableRules) {
      const shouldTrigger = this.evaluateRule(rule, value);

      if (shouldTrigger) {
        this.triggerAlert(rule, value, metadata);
      } else {
        this.resolveAlert(rule.id);
      }
    }
  }

  /**
   * Trigger an alert
   * Requirement 4.3: Alert severity levels (INFO, WARNING, ERROR, CRITICAL)
   */
  private async triggerAlert(rule: AlertRule, value: number, metadata: Record<string, any>): Promise<void> {
    const alertId = `${rule.id}_${Date.now()}`;
    const now = Date.now();

    // Check cooldown period
    const lastAlertTime = this.alertCooldowns.get(rule.id);
    if (lastAlertTime && now - lastAlertTime < rule.cooldown) {
      return; // Still in cooldown period
    }

    // Check rate limiting
    if (!this.checkRateLimit(rule.id)) {
      this.logger.warn(`Alert rate limit exceeded for rule ${rule.id}`);
      return;
    }

    const alert: Alert = {
      id: alertId,
      ruleId: rule.id,
      severity: rule.severity,
      message: this.formatAlertMessage(rule, value, metadata),
      timestamp: now,
      resolved: false,
      metadata: { ...metadata, value, threshold: rule.threshold },
    };

    // Store alert
    this.alerts.set(alertId, alert);
    this.activeAlerts.set(rule.id, alert);
    this.alertCooldowns.set(rule.id, now);

    // Log alert
    this.logAlert(alert);

    // Deliver alert through configured channels
    await this.deliverAlert(alert, rule);

    this.logger.warn(`Alert triggered: ${rule.name} - ${alert.message}`, {
      alertId,
      ruleId: rule.id,
      severity: rule.severity,
    });
  }

  /**
   * Resolve an active alert
   */
  private resolveAlert(ruleId: string): void {
    const activeAlert = this.activeAlerts.get(ruleId);

    if (activeAlert && !activeAlert.resolved) {
      activeAlert.resolved = true;
      activeAlert.resolvedAt = Date.now();

      this.activeAlerts.delete(ruleId);
      this.alerts.set(activeAlert.id, activeAlert);

      this.logger.log(`Alert resolved: ${activeAlert.message}`, { alertId: activeAlert.id, ruleId });
    }
  }

  /**
   * Deliver alert through configured channels
   * Requirement 4.4: Alert delivery mechanisms (log, email, webhook)
   */
  private async deliverAlert(alert: Alert, rule: AlertRule): Promise<void> {
    const deliveryPromises: Promise<void>[] = [];

    for (const action of rule.actions) {
      switch (action) {
        case AlertAction.LOG:
          // Already logged in triggerAlert
          break;

        case AlertAction.EMAIL:
          if (this.config.alerting.deliveryConfig.email?.enabled) {
            deliveryPromises.push(this.sendEmailAlert(alert, rule));
          }
          break;

        case AlertAction.WEBHOOK:
          if (this.config.alerting.deliveryConfig.webhook?.enabled) {
            deliveryPromises.push(this.sendWebhookAlert(alert, rule));
          }
          break;
      }
    }

    try {
      await Promise.allSettled(deliveryPromises);
    } catch (error) {
      this.logger.error(`Failed to deliver alert ${alert.id}:`, error);
    }
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(alert: Alert, rule: AlertRule): Promise<void> {
    if (!this.emailTransporter) {
      this.logger.warn("Email transporter not configured");
      return;
    }

    const emailConfig = this.config.alerting.deliveryConfig.email!;

    const mailOptions = {
      from: emailConfig.from,
      to: emailConfig.to.join(", "),
      subject: `[${alert.severity.toUpperCase()}] FTSO Alert: ${rule.name}`,
      html: this.formatEmailAlert(alert, rule),
    };

    try {
      await this.emailTransporter.sendMail(mailOptions);
      this.logger.log(`Email alert sent for ${alert.id}`);
    } catch (error) {
      this.logger.error(`Failed to send email alert ${alert.id}:`, error);
    }
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(alert: Alert, rule: AlertRule): Promise<void> {
    const webhookConfig = this.config.alerting.deliveryConfig.webhook!;

    const payload = {
      alert: {
        id: alert.id,
        ruleId: alert.ruleId,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp,
        metadata: alert.metadata,
      },
      rule: {
        id: rule.id,
        name: rule.name,
        description: rule.description,
      },
    };

    try {
      await axios.post(webhookConfig.url, payload, {
        headers: webhookConfig.headers || {},
        timeout: webhookConfig.timeout,
      });

      this.logger.log(`Webhook alert sent for ${alert.id}`);
    } catch (error) {
      this.logger.error(`Failed to send webhook alert ${alert.id}:`, error);
    }
  }

  /**
   * Evaluate if a rule should trigger
   */
  private evaluateRule(rule: AlertRule, value: number): boolean {
    switch (rule.operator) {
      case "gt":
        return value > rule.threshold;
      case "gte":
        return value >= rule.threshold;
      case "lt":
        return value < rule.threshold;
      case "lte":
        return value <= rule.threshold;
      case "eq":
        return value === rule.threshold;
      default:
        return false;
    }
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(ruleId: string): boolean {
    const now = Date.now();
    const hourAgo = now - 3600000; // 1 hour ago

    // Clean old counts
    const currentCount = this.alertCounts.get(ruleId) || 0;

    if (currentCount >= this.config.alerting.maxAlertsPerHour) {
      return false;
    }

    this.alertCounts.set(ruleId, currentCount + 1);
    return true;
  }

  /**
   * Format alert message
   */
  private formatAlertMessage(rule: AlertRule, value: number, metadata: Record<string, any>): string {
    const direction = ["gt", "gte"].includes(rule.operator) ? "above" : "below";
    let message = `${rule.name}: ${rule.metric} is ${direction} threshold (${value} ${rule.operator} ${rule.threshold})`;

    if (metadata.feedId) {
      message += ` for feed ${metadata.feedId}`;
    }

    if (metadata.exchange) {
      message += ` on exchange ${metadata.exchange}`;
    }

    return message;
  }

  /**
   * Format email alert HTML
   */
  private formatEmailAlert(alert: Alert, rule: AlertRule): string {
    const severityColor = this.getSeverityColor(alert.severity);

    return `
      <html>
        <body>
          <h2 style="color: ${severityColor};">[${alert.severity.toUpperCase()}] FTSO Alert</h2>
          <h3>${rule.name}</h3>
          <p><strong>Description:</strong> ${rule.description}</p>
          <p><strong>Message:</strong> ${alert.message}</p>
          <p><strong>Timestamp:</strong> ${new Date(alert.timestamp).toISOString()}</p>
          <p><strong>Alert ID:</strong> ${alert.id}</p>
          
          ${
            alert.metadata
              ? `
            <h4>Additional Information:</h4>
            <ul>
              ${Object.entries(alert.metadata)
                .map(([key, value]) => `<li><strong>${key}:</strong> ${value}</li>`)
                .join("")}
            </ul>
          `
              : ""
          }
          
          <hr>
          <p><em>This alert was generated by the FTSO Feed Value Provider monitoring system.</em></p>
        </body>
      </html>
    `;
  }

  /**
   * Get severity color for HTML formatting
   */
  private getSeverityColor(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.INFO:
        return "#2196F3";
      case AlertSeverity.WARNING:
        return "#FF9800";
      case AlertSeverity.ERROR:
        return "#F44336";
      case AlertSeverity.CRITICAL:
        return "#9C27B0";
      default:
        return "#666666";
    }
  }

  /**
   * Log alert to console/file
   */
  private logAlert(alert: Alert): void {
    const logLevel = this.getLogLevel(alert.severity);
    const message = `Alert: ${alert.message}`;
    const context = { alertId: alert.id, severity: alert.severity, metadata: alert.metadata };

    switch (logLevel) {
      case "info":
        this.logger.log(message, context);
        break;
      case "warn":
        this.logger.warn(message, context);
        break;
      case "error":
        this.logger.error(message, context);
        break;
    }
  }

  /**
   * Get log level for alert severity
   */
  private getLogLevel(severity: AlertSeverity): "info" | "warn" | "error" {
    switch (severity) {
      case AlertSeverity.INFO:
        return "info";
      case AlertSeverity.WARNING:
        return "warn";
      case AlertSeverity.ERROR:
      case AlertSeverity.CRITICAL:
        return "error";
      default:
        return "info";
    }
  }

  /**
   * Get all alerts
   */
  getAllAlerts(limit: number = 100): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get active alerts
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get alerts by severity
   */
  getAlertsBySeverity(severity: AlertSeverity, limit: number = 50): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => alert.severity === severity)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get alert statistics
   */
  getAlertStats(): {
    total: number;
    active: number;
    resolved: number;
    bySeverity: Record<AlertSeverity, number>;
    last24Hours: number;
  } {
    const allAlerts = Array.from(this.alerts.values());
    const now = Date.now();
    const dayAgo = now - 86400000; // 24 hours ago

    const bySeverity = {
      [AlertSeverity.INFO]: 0,
      [AlertSeverity.WARNING]: 0,
      [AlertSeverity.ERROR]: 0,
      [AlertSeverity.CRITICAL]: 0,
    };

    let resolved = 0;
    let last24Hours = 0;

    for (const alert of allAlerts) {
      bySeverity[alert.severity]++;

      if (alert.resolved) {
        resolved++;
      }

      if (alert.timestamp > dayAgo) {
        last24Hours++;
      }
    }

    return {
      total: allAlerts.length,
      active: this.activeAlerts.size,
      resolved,
      bySeverity,
      last24Hours,
    };
  }

  /**
   * Initialize email transporter
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
   * Start periodic alert cleanup
   */
  private startAlertCleanup(): void {
    setInterval(() => {
      this.cleanupOldAlerts();
      this.resetHourlyAlertCounts();
    }, 3600000); // Every hour
  }

  /**
   * Clean up old alerts
   */
  private cleanupOldAlerts(): void {
    const now = Date.now();
    const retentionPeriod = this.config.alerting.alertRetention * 86400000; // Days to ms
    const cutoffTime = now - retentionPeriod;

    for (const [alertId, alert] of this.alerts.entries()) {
      if (alert.timestamp < cutoffTime) {
        this.alerts.delete(alertId);
      }
    }
  }

  /**
   * Reset hourly alert counts
   */
  private resetHourlyAlertCounts(): void {
    this.alertCounts.clear();
  }

  /**
   * Test alert delivery (for testing purposes)
   */
  async testAlertDelivery(severity: AlertSeverity = AlertSeverity.INFO): Promise<void> {
    const testRule: AlertRule = {
      id: "test_rule",
      name: "Test Alert",
      description: "This is a test alert to verify delivery mechanisms",
      metric: "test_metric",
      threshold: 0,
      operator: "gt",
      severity,
      duration: 0,
      actions: [AlertAction.LOG, AlertAction.EMAIL, AlertAction.WEBHOOK],
      enabled: true,
      cooldown: 0,
    };

    const testAlert: Alert = {
      id: `test_alert_${Date.now()}`,
      ruleId: testRule.id,
      severity,
      message: "This is a test alert message",
      timestamp: Date.now(),
      resolved: false,
      metadata: { test: true },
    };

    await this.deliverAlert(testAlert, testRule);
    this.logger.log("Test alert delivery completed");
  }
}
