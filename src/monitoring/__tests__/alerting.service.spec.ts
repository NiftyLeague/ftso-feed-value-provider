import axios from "axios";
import { type MonitoringConfig, AlertSeverity, AlertAction } from "@/common/types/monitoring";
import { AlertingService } from "../alerting.service";

// Mock axios
jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock nodemailer
jest.mock("nodemailer", () => ({
  createTransporter: jest.fn(() => ({
    sendMail: jest.fn().mockResolvedValue({ messageId: "test-message-id" }),
  })),
}));

describe("AlertingService", () => {
  let service: AlertingService;
  let mockConfig: MonitoringConfig;

  beforeEach(async () => {
    mockConfig = {
      enabled: true,
      interval: 1000,
      thresholds: {
        accuracy: {
          // Required AccuracyThresholds
          warning: 0.5,
          critical: 1,
          maxDeviation: 1,
          minParticipants: 3,
          // Extended fields used by monitors
          maxConsensusDeviation: 0.5,
          minAccuracyRate: 80,
          minQualityScore: 70,
        },
        performance: {
          maxResponseLatency: 100,
          maxDataAge: 2000,
          minThroughput: 100,
          minCacheHitRate: 80,
        },
        health: {
          maxErrorRate: 5,
          maxCpuUsage: 80,
          maxMemoryUsage: 80,
          minConnectionRate: 90,
        },
      },
      alerting: {
        enabled: true,
        rules: [
          {
            id: "consensus_deviation",
            name: "Consensus Deviation Alert",
            description: "Alert when consensus deviation exceeds threshold",
            condition: {
              metric: "consensus_deviation",
              threshold: 0.5,
              operator: "gt",
            },
            severity: AlertSeverity.ERROR,
            actions: [AlertAction.LOG, AlertAction.EMAIL],
            enabled: true,
            cooldown: 300000, // 5 minutes
          },
          {
            id: "response_latency",
            name: "Response Latency Alert",
            description: "Alert when response latency is too high",
            condition: {
              metric: "response_latency",
              threshold: 100,
              operator: "gt",
            },
            severity: AlertSeverity.WARNING,
            actions: [AlertAction.LOG],
            enabled: true,
            cooldown: 60000, // 1 minute
          },
        ],
        rateLimits: {
          windowMs: 60_000,
          maxRequests: 1000,
        },
        deliveryConfig: {
          email: {
            enabled: false,
            subject: "FTSO Alerts",
            smtpHost: "smtp.test.com",
            smtpPort: 587,
            username: "test@test.com",
            password: "password",
            from: "alerts@ftso.com",
            to: ["admin@ftso.com"],
          },
          webhook: {
            enabled: true,
            url: "https://webhook.test.com/alerts",
            method: "POST",
            headers: {},
            timeout: 5000,
          },
        },
        maxAlertsPerHour: 10,
        alertRetention: 30,
      },
    };

    // Create service directly with alerting config
    service = new AlertingService(mockConfig.alerting);

    // Clear any existing alerts
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any intervals or timers that might be running
    if (service) {
      // Force cleanup of any internal timers
      (service as any).destroy?.();
    }
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("evaluateMetric", () => {
    it("should trigger alert when threshold is exceeded", () => {
      const logSpy = jest.spyOn(service["logger"], "error");

      // Consensus deviation of 0.8% exceeds 0.5% threshold
      service.evaluateMetric("consensus_deviation", 0.8, { feedId: "BTC/USD" });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Alert: Consensus Deviation Alert"),
        expect.any(Object)
      );
    });

    it("should not trigger alert when threshold is not exceeded", () => {
      const logSpy = jest.spyOn(service["logger"], "error");

      // Consensus deviation of 0.3% is below 0.5% threshold
      service.evaluateMetric("consensus_deviation", 0.3, { feedId: "BTC/USD" });

      expect(logSpy).not.toHaveBeenCalled();
    });

    it("should trigger alert for different operators", () => {
      const logSpy = jest.spyOn(service["logger"], "warn");

      // Response latency of 150ms exceeds 100ms threshold (gt operator)
      service.evaluateMetric("response_latency", 150);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Alert: Response Latency Alert"), expect.any(Object));
    });

    it("should not trigger disabled rules", () => {
      // Disable the rule
      mockConfig.alerting.rules[0].enabled = false;

      const logSpy = jest.spyOn(service["logger"], "warn");

      service.evaluateMetric("consensus_deviation", 0.8);

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe("alert cooldown", () => {
    it("should respect cooldown period", () => {
      const logSpy = jest.spyOn(service["logger"], "error");

      // Trigger first alert
      service.evaluateMetric("consensus_deviation", 0.8);
      expect(logSpy).toHaveBeenCalledTimes(1);

      // Try to trigger again immediately (should be blocked by cooldown)
      service.evaluateMetric("consensus_deviation", 0.9);
      expect(logSpy).toHaveBeenCalledTimes(1); // Still only 1 call
    });
  });

  describe("rate limiting", () => {
    it("should enforce rate limiting", () => {
      // Set a very low rate limit for testing
      mockConfig.alerting.maxAlertsPerHour = 1;

      // Create new service instance with updated config
      const testService = new AlertingService(mockConfig.alerting);

      // Spy on the enhancedLogger since that's what the service uses for rate limiting
      const rateLimitSpy = jest.spyOn(testService["enhancedLogger"] || testService["logger"], "warn");

      // Trigger first alert (should work)
      testService.evaluateMetric("consensus_deviation", 0.8);

      // Reset cooldown to allow second alert attempt
      testService["alertCooldowns"].clear();

      // Try to trigger second alert (should be rate limited)
      testService.evaluateMetric("consensus_deviation", 0.9);

      // Should have logged rate limit warning
      expect(rateLimitSpy).toHaveBeenCalledWith(
        expect.stringContaining("Alert rate limit exceeded"),
        expect.any(Object)
      );
    });
  });

  describe("alert resolution", () => {
    it("should resolve alerts when metric returns to normal", () => {
      // The resolved alert will have the same severity as the original rule (ERROR)
      // So it will be logged with logger.error(), not logger.log()
      const logSpy = jest.spyOn(service["logger"], "error");

      // Trigger alert
      service.evaluateMetric("consensus_deviation", 0.8);

      // Check that we have an active alert
      const activeAlerts = service.getActiveAlerts();
      expect(activeAlerts).toHaveLength(1);

      // Clear the spy to only capture the resolution log
      logSpy.mockClear();

      // Clear cooldowns to ensure resolution can happen
      service["alertCooldowns"].clear();

      // Metric returns to normal
      service.evaluateMetric("consensus_deviation", 0.3);

      // Alert should be resolved (logged as error because rule severity is ERROR)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Alert resolved"), expect.any(Object));

      const activeAlertsAfter = service.getActiveAlerts();
      expect(activeAlertsAfter).toHaveLength(0);
    });
  });

  describe("webhook delivery", () => {
    it("should send webhook alerts", async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: "success" });

      // Add webhook action to rule
      mockConfig.alerting.rules[0].actions = [AlertAction.WEBHOOK];

      service.evaluateMetric("consensus_deviation", 0.8, { feedId: "BTC/USD" });

      // Wait for async webhook delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://webhook.test.com/alerts",
        expect.objectContaining({
          alert: expect.objectContaining({
            severity: AlertSeverity.ERROR,
            message: expect.stringContaining("consensus_deviation"),
          }),
          rule: expect.objectContaining({
            id: "consensus_deviation",
            name: "Consensus Deviation Alert",
          }),
        }),
        expect.objectContaining({
          timeout: 5000,
        })
      );
    });

    it("should handle webhook delivery failures gracefully", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("Network error"));

      const errorSpy = jest.spyOn(service["logger"], "error");

      mockConfig.alerting.rules[0].actions = [AlertAction.WEBHOOK];

      service.evaluateMetric("consensus_deviation", 0.8);

      // Wait for async webhook delivery
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to send webhook alert"), expect.any(Error));
    });
  });

  describe("alert statistics", () => {
    it("should provide accurate alert statistics", () => {
      // Trigger some alerts
      service.evaluateMetric("consensus_deviation", 0.8); // ERROR
      service.evaluateMetric("response_latency", 150); // WARNING

      // Reset cooldowns to allow more alerts
      service["alertCooldowns"].clear();

      service.evaluateMetric("consensus_deviation", 0.9); // Another ERROR

      const stats = service.getAlertStats();

      expect(stats.total).toBeGreaterThan(0);
      expect(stats.active).toBeGreaterThan(0);
      expect(stats.bySeverity[AlertSeverity.ERROR]).toBeGreaterThan(0);
      expect(stats.bySeverity[AlertSeverity.WARNING]).toBeGreaterThan(0);
    });
  });

  describe("alert retrieval", () => {
    it("should retrieve alerts by severity", () => {
      // Trigger alerts of different severities
      service.evaluateMetric("consensus_deviation", 0.8); // ERROR
      service.evaluateMetric("response_latency", 150); // WARNING

      const errorAlerts = service.getAlertsBySeverity(AlertSeverity.ERROR);
      const warningAlerts = service.getAlertsBySeverity(AlertSeverity.WARNING);

      expect(errorAlerts.length).toBeGreaterThan(0);
      expect(warningAlerts.length).toBeGreaterThan(0);
      expect(errorAlerts[0].severity).toBe(AlertSeverity.ERROR);
      expect(warningAlerts[0].severity).toBe(AlertSeverity.WARNING);
    });

    it("should retrieve all alerts with limit", () => {
      // Trigger multiple alerts
      for (let i = 0; i < 5; i++) {
        service["alertCooldowns"].clear(); // Reset cooldowns
        service.evaluateMetric("consensus_deviation", 0.8 + i * 0.1);
      }

      const allAlerts = service.getAllAlerts(3);
      expect(allAlerts.length).toBeLessThanOrEqual(3);
    });
  });

  describe("test alert delivery", () => {
    it("should send test alerts", async () => {
      const logSpy = jest.spyOn(service["logger"], "log");

      await service.testAlertDelivery(AlertSeverity.INFO);

      expect(logSpy).toHaveBeenCalledWith("Test alert delivery completed");
    });
  });

  describe("message formatting", () => {
    it("should format alert messages correctly", () => {
      service.evaluateMetric("consensus_deviation", 0.8, {
        feedId: "BTC/USD",
        exchange: "binance",
      });

      const alerts = service.getAllAlerts(1);
      expect(alerts[0].message).toContain("consensus_deviation");
      expect(alerts[0].message).toContain("0.8");
      expect(alerts[0].message).toContain("0.5");
      expect(alerts[0].message).toContain("BTC/USD");
      expect(alerts[0].message).toContain("binance");
    });
  });
});
