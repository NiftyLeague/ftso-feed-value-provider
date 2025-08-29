import { Test, TestingModule } from "@nestjs/testing";
import { CircuitBreakerService, CircuitBreakerState } from "../circuit-breaker.service";

describe("CircuitBreakerService", () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerService],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  afterEach(() => {
    service.destroy();
  });

  describe("Circuit Registration", () => {
    it("should register a new circuit breaker", () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId);

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.CLOSED);
      expect(service.getStats(serviceId)).toBeDefined();
    });

    it("should use custom configuration", () => {
      const serviceId = "test-service";
      const config = {
        failureThreshold: 10,
        recoveryTimeout: 120000,
      };

      service.registerCircuit(serviceId, config);
      const stats = service.getStats(serviceId);

      expect(stats).toBeDefined();
      expect(stats!.state).toBe(CircuitBreakerState.CLOSED);
    });
  });

  describe("Circuit State Transitions", () => {
    beforeEach(() => {
      service.registerCircuit("test-service", {
        failureThreshold: 3,
        recoveryTimeout: 1000,
        successThreshold: 2,
      });
    });

    it("should transition to OPEN after failure threshold", async () => {
      const serviceId = "test-service";

      // Trigger failures
      for (let i = 0; i < 3; i++) {
        try {
          await service.execute(serviceId, async () => {
            throw new Error("Test failure");
          });
        } catch (error) {
          // Expected
        }
      }

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);
    });

    it("should fail fast when circuit is OPEN", async () => {
      const serviceId = "test-service";

      // Open the circuit
      service.openCircuit(serviceId, "Test");

      // Should fail fast
      const startTime = Date.now();
      try {
        await service.execute(serviceId, async () => {
          return "success";
        });
      } catch (error) {
        const duration = Date.now() - startTime;
        expect(duration).toBeLessThan(100); // Should fail fast
        expect(error.message).toContain("Circuit breaker is OPEN");
      }
    });

    it("should transition to HALF_OPEN after recovery timeout", async () => {
      const serviceId = "test-service";

      // Open the circuit
      service.openCircuit(serviceId, "Test");
      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Next request should transition to HALF_OPEN
      try {
        await service.execute(serviceId, async () => {
          return "success";
        });
      } catch (error) {
        // May fail, but state should be HALF_OPEN
      }

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.HALF_OPEN);
    });

    it("should transition to CLOSED after successful requests in HALF_OPEN", async () => {
      const serviceId = "test-service";

      // Manually set to HALF_OPEN
      service.openCircuit(serviceId, "Test");
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Execute successful requests
      for (let i = 0; i < 2; i++) {
        await service.execute(serviceId, async () => {
          return "success";
        });
      }

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.CLOSED);
    });

    it("should transition back to OPEN on failure in HALF_OPEN", async () => {
      const serviceId = "test-service";

      // Manually set to HALF_OPEN
      service.openCircuit(serviceId, "Test");
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Execute one successful request to get to HALF_OPEN
      await service.execute(serviceId, async () => {
        return "success";
      });

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.HALF_OPEN);

      // Now fail - should go back to OPEN
      try {
        await service.execute(serviceId, async () => {
          throw new Error("Test failure");
        });
      } catch (error) {
        // Expected
      }

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe("Request Execution", () => {
    beforeEach(() => {
      service.registerCircuit("test-service", {
        timeout: 1000,
        failureThreshold: 5,
      });
    });

    it("should execute successful requests", async () => {
      const result = await service.execute("test-service", async () => {
        return "success";
      });

      expect(result).toBe("success");
      expect(service.getState("test-service")).toBe(CircuitBreakerState.CLOSED);
    });

    it("should handle request timeouts", async () => {
      const serviceId = "test-service";

      try {
        await service.execute(serviceId, async () => {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Longer than timeout
          return "success";
        });
      } catch (error) {
        expect(error.message).toContain("Operation timeout");
      }

      const stats = service.getStats(serviceId);
      expect(stats!.totalFailures).toBe(1);
    });

    it("should track request metrics", async () => {
      const serviceId = "test-service";

      // Execute some requests
      await service.execute(serviceId, async () => "success");

      try {
        await service.execute(serviceId, async () => {
          throw new Error("Test failure");
        });
      } catch (error) {
        // Expected
      }

      const stats = service.getStats(serviceId);
      expect(stats!.totalRequests).toBe(2);
      expect(stats!.totalSuccesses).toBe(1);
      expect(stats!.totalFailures).toBe(1);
    });
  });

  describe("Metrics and Statistics", () => {
    beforeEach(() => {
      service.registerCircuit("test-service", {
        monitoringWindow: 5000,
      });
    });

    it("should provide accurate metrics", async () => {
      const serviceId = "test-service";

      // Execute requests with known response times
      await service.execute(serviceId, async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return "success";
      });

      const metrics = service.getMetrics(serviceId);
      expect(metrics).toBeDefined();
      expect(metrics!.requestCount).toBe(1);
      expect(metrics!.failureRate).toBe(0);
      expect(metrics!.averageResponseTime).toBeGreaterThan(90);
    });

    it("should calculate failure rate correctly", async () => {
      const serviceId = "test-service";

      // Execute 2 successful and 1 failed request
      await service.execute(serviceId, async () => "success");
      await service.execute(serviceId, async () => "success");

      try {
        await service.execute(serviceId, async () => {
          throw new Error("Test failure");
        });
      } catch (error) {
        // Expected
      }

      const metrics = service.getMetrics(serviceId);
      expect(metrics!.requestCount).toBe(3);
      expect(metrics!.failureRate).toBeCloseTo(1 / 3);
    });
  });

  describe("Health Summary", () => {
    it("should provide accurate health summary", () => {
      service.registerCircuit("service1");
      service.registerCircuit("service2");
      service.registerCircuit("service3");

      service.openCircuit("service2", "Test");

      const summary = service.getHealthSummary();
      expect(summary.total).toBe(3);
      expect(summary.closed).toBe(2);
      expect(summary.open).toBe(1);
      expect(summary.halfOpen).toBe(0);
      expect(summary.healthyPercentage).toBeCloseTo(66.67, 1);
    });
  });

  describe("Manual Control", () => {
    beforeEach(() => {
      service.registerCircuit("test-service");
    });

    it("should allow manual circuit opening", () => {
      const serviceId = "test-service";
      service.openCircuit(serviceId, "Manual test");

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);
    });

    it("should allow manual circuit closing", () => {
      const serviceId = "test-service";
      service.openCircuit(serviceId, "Test");
      service.closeCircuit(serviceId, "Manual recovery");

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.CLOSED);
    });

    it("should reset statistics", async () => {
      const serviceId = "test-service";

      // Generate some statistics
      await service.execute(serviceId, async () => "success");

      let stats = service.getStats(serviceId);
      expect(stats!.totalRequests).toBe(1);

      // Reset statistics
      service.resetStats(serviceId);

      stats = service.getStats(serviceId);
      expect(stats!.totalRequests).toBe(0);
      expect(stats!.totalSuccesses).toBe(0);
      expect(stats!.totalFailures).toBe(0);
    });
  });

  describe("Event Emission", () => {
    it("should emit circuit state change events", done => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, { failureThreshold: 1 });

      service.on("circuitOpened", emittedServiceId => {
        expect(emittedServiceId).toBe(serviceId);
        done();
      });

      // Trigger circuit opening
      service
        .execute(serviceId, async () => {
          throw new Error("Test failure");
        })
        .catch(() => {
          // Expected failure
        });
    });

    it("should emit request events", done => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId);

      service.on("requestSuccess", (emittedServiceId, responseTime) => {
        expect(emittedServiceId).toBe(serviceId);
        expect(responseTime).toBeGreaterThanOrEqual(0); // Allow 0 for very fast operations
        done();
      });

      service.execute(serviceId, async () => {
        // Add small delay to ensure measurable response time
        await new Promise(resolve => setTimeout(resolve, 1));
        return "success";
      });
    });
  });

  describe("Cleanup", () => {
    it("should unregister circuits properly", () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId);

      expect(service.getState(serviceId)).toBeDefined();

      service.unregisterCircuit(serviceId);

      expect(service.getState(serviceId)).toBeUndefined();
    });

    it("should clean up resources on destroy", () => {
      service.registerCircuit("service1");
      service.registerCircuit("service2");

      expect(service.getAllStates().size).toBe(2);

      service.destroy();

      expect(service.getAllStates().size).toBe(0);
    });
  });
});
