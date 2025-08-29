import { Test, TestingModule } from "@nestjs/testing";
import { AlertingService } from "../alerting.service";
import { MonitoringConfig, AlertSeverity, AlertAction, AlertRule } from "../interfaces/monitoring.interfaces";
import axios from "axios";

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
      accuracyThresholds: {
        maxConsensusDeviation: 0.5,
        minAccuracyRate: 80,
        minQualityScore: 70,
      },
      performanceThresholds: {
        maxResponseLatency: 100,
        maxDataAge: 2000,
        minThroughput: 100,
        minCacheHitRate: 80,
      },
      healthThresholds: {
        maxErrorRate: 5,
        maxCpuUsage: 80,
        maxMemoryUsage: 80,
        minConnectionRate: 90,
      },
      monitoringInterval: 1000,
      alerting: {
        rules: [
          {
            id: "consensus_deviation",
            name: "Consensus Deviation Alert",
            description: "Alert when consensus deviation exceeds threshold",
            metric: "consensus_deviation",
            threshold: 0.5,
            operator: "gt",
            severity: AlertSeverity.ERROR,
            duration: 0,
            actions: [AlertAction.LOG, AlertAction.EMAIL],
            enabled: true,
            cooldown: 300000, // 5 minutes
          },
          {
            id: "response_latency",
            name: "Response Latency Alert",
            description: "Alert when response latency is too high",
            metric: "response_latency",
            threshold: 100,
            operator: "gt",
            severity: AlertSeverity.WARNING,
            duration: 0,
            actions: [AlertAction.LOG],
            enabled: true,
            cooldown: 60000, // 1 minute
          },
        ],
        deliveryConfig: {
          email: {
            enabled: false,
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
            timeout: 5000,
          },
        },
        maxAlertsPerHour: 10,
        alertRetention: 30,
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AlertingService, { provide: "MonitoringConfig", useValue: mockConfig }],
    }).compile();

    service = module.get<AlertingService>(AlertingService);

    // Clear any existing alerts
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
      const testService = new AlertingService(mockConfig);
      const rateLimitSpy = jest.spyOn(testService["logger"], "warn");

      // Trigger first alert (should work)
      testService.evaluateMetric("consensus_deviation", 0.8);

      // Reset cooldown to allow second alert attempt
      testService["alertCooldowns"].clear();

      // Try to trigger second alert (should be rate limited)
      testService.evaluateMetric("consensus_deviation", 0.9);

      // Should have logged rate limit warning
      expect(rateLimitSpy).toHaveBeenCalledWith(expect.stringContaining("Alert rate limit exceeded"));
    });
  });

  describe("alert resolution", () => {
    it("should resolve alerts when metric returns to normal", () => {
      const logSpy = jest.spyOn(service["logger"], "log");

      // Trigger alert
      service.evaluateMetric("consensus_deviation", 0.8);

      // Check that we have an active alert
      const activeAlerts = service.getActiveAlerts();
      expect(activeAlerts).toHaveLength(1);

      // Metric returns to normal
      service.evaluateMetric("consensus_deviation", 0.3);

      // Alert should be resolved
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
