import { Test, TestingModule } from "@nestjs/testing";
import { CircuitBreakerState } from "@/common/types/error-handling";
import { CircuitBreakerService } from "../circuit-breaker.service";

describe("CircuitBreakerService", () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerService],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  afterEach(async () => {
    await service.cleanup();
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
        recoveryTimeout: 100,
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
        const err: any = error as any;
        expect(err.message).toContain("Circuit breaker is OPEN");
      }
    });

    it("should transition to HALF_OPEN after recovery timeout", async () => {
      const serviceId = "test-service";

      // Open the circuit
      service.openCircuit(serviceId, "Test");
      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 150));

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

    it("should reset failure count when transitioning to CLOSED", async () => {
      const serviceId = "test-service";

      // Generate some failures but not enough to open circuit
      try {
        await service.execute(serviceId, async () => {
          throw new Error("Test failure");
        });
      } catch (error) {
        // Expected
      }

      let stats = service.getStats(serviceId);
      expect(stats!.failureCount).toBe(1);

      // Execute successful request - should reset failure count
      await service.execute(serviceId, async () => {
        return "success";
      });

      stats = service.getStats(serviceId);
      expect(stats!.failureCount).toBe(0);
      expect(service.getState(serviceId)).toBe(CircuitBreakerState.CLOSED);
    });

    it("should handle automatic recovery timeout correctly", async () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, {
        failureThreshold: 1,
        recoveryTimeout: 200,
        successThreshold: 1,
      });

      // Open circuit by causing failure
      try {
        await service.execute(serviceId, async () => {
          throw new Error("Test failure");
        });
      } catch (error) {
        // Expected
      }

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);

      // Wait for recovery timeout
      await new Promise(resolve => setTimeout(resolve, 250));

      // Next successful request should close the circuit
      await service.execute(serviceId, async () => {
        return "success";
      });

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.CLOSED);
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
        const err: any = error as any;
        expect(err.message).toContain("Operation timeout");
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

      const metrics = service.getCircuitMetrics(serviceId);
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

      const metrics = service.getCircuitMetrics(serviceId);
      expect(metrics!.requestCount).toBe(3);
      expect(metrics!.failureRate).toBeCloseTo(1 / 3);
    });

    it("should track response times accurately", async () => {
      const serviceId = "test-service";

      // Execute requests with different response times
      await service.execute(serviceId, async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return "fast";
      });

      await service.execute(serviceId, async () => {
        await new Promise(resolve => setTimeout(resolve, 150));
        return "slow";
      });

      const metrics = service.getCircuitMetrics(serviceId);
      expect(metrics!.requestCount).toBe(2);
      expect(metrics!.averageResponseTime).toBeGreaterThan(90);
      expect(metrics!.averageResponseTime).toBeLessThan(120);
    });

    it("should clean old history outside monitoring window", async () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, { monitoringWindow: 100 });

      // Execute a request
      await service.execute(serviceId, async () => "old-request");

      // Wait for monitoring window to pass
      await new Promise(resolve => setTimeout(resolve, 150));

      // Execute another request
      await service.execute(serviceId, async () => "new-request");

      const metrics = service.getCircuitMetrics(serviceId);
      // Should only count the new request
      expect(metrics!.requestCount).toBe(1);
    });

    it("should handle stats updates correctly", async () => {
      const serviceId = "test-service";

      const initialStats = service.getStats(serviceId);
      expect(initialStats!.totalRequests).toBe(0);
      expect(initialStats!.totalSuccesses).toBe(0);
      expect(initialStats!.totalFailures).toBe(0);

      // Execute successful request
      await service.execute(serviceId, async () => "success");

      let stats = service.getStats(serviceId);
      expect(stats!.totalRequests).toBe(1);
      expect(stats!.totalSuccesses).toBe(1);
      expect(stats!.totalFailures).toBe(0);
      expect(stats!.lastSuccessTime).toBeDefined();

      // Execute failed request
      try {
        await service.execute(serviceId, async () => {
          throw new Error("Test failure");
        });
      } catch (error) {
        // Expected
      }

      stats = service.getStats(serviceId);
      expect(stats!.totalRequests).toBe(2);
      expect(stats!.totalSuccesses).toBe(1);
      expect(stats!.totalFailures).toBe(1);
      expect(stats!.lastFailureTime).toBeDefined();
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

      void service.execute(serviceId, async () => {
        // Add small delay to ensure measurable response time
        await new Promise(resolve => setTimeout(resolve, 1));
        return "success";
      });
    });

    it("should emit circuit closed events", done => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, { failureThreshold: 1, successThreshold: 1 });

      // First open the circuit
      service.openCircuit(serviceId, "Test");

      service.on("circuitClosed", emittedServiceId => {
        expect(emittedServiceId).toBe(serviceId);
        done();
      });

      // Manually close the circuit to trigger event
      service.closeCircuit(serviceId, "Manual recovery");
    });

    it("should emit circuit half-open events", done => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, { recoveryTimeout: 100 });

      service.on("circuitHalfOpen", emittedServiceId => {
        expect(emittedServiceId).toBe(serviceId);
        done();
      });

      // Open circuit and wait for automatic transition to half-open
      service.openCircuit(serviceId, "Test");
    });

    it("should emit request failure events", done => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId);

      service.on("requestFailure", (emittedServiceId, responseTime) => {
        expect(emittedServiceId).toBe(serviceId);
        expect(responseTime).toBeGreaterThanOrEqual(0);
        done();
      });

      service
        .execute(serviceId, async () => {
          throw new Error("Test failure");
        })
        .catch(() => {
          // Expected failure
        });
    });
  });

  describe("Edge Cases and Error Conditions", () => {
    it("should handle execution on non-existent circuit", async () => {
      const serviceId = "non-existent-service";

      await expect(service.execute(serviceId, async () => "success")).rejects.toThrow(
        "Circuit breaker not registered for service: non-existent-service"
      );
    });

    it("should handle multiple rapid failures correctly", async () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, { failureThreshold: 3 });

      // Execute multiple failures rapidly
      const promises = Array.from({ length: 5 }, () =>
        service
          .execute(serviceId, async () => {
            throw new Error("Rapid failure");
          })
          .catch(() => {
            // Expected failures
          })
      );

      await Promise.all(promises);

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);
      const stats = service.getStats(serviceId);
      expect(stats!.totalFailures).toBe(5);
    });

    it("should handle concurrent executions correctly", async () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId);

      // Execute multiple concurrent operations
      const promises = Array.from({ length: 10 }, (_, i) =>
        service.execute(serviceId, async () => {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
          return `result-${i}`;
        })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result).toBe(`result-${i}`);
      });

      const stats = service.getStats(serviceId);
      expect(stats!.totalSuccesses).toBe(10);
    });

    it("should handle circuit registration with invalid config gracefully", () => {
      const serviceId = "test-service";

      // Register with partial config - should use defaults for missing values
      service.registerCircuit(serviceId, { failureThreshold: -1 }); // Invalid threshold

      expect(service.getState(serviceId)).toBe(CircuitBreakerState.CLOSED);
      expect(service.getStats(serviceId)).toBeDefined();
    });

    it("should handle metrics calculation with no requests", () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId);

      const metrics = service.getCircuitMetrics(serviceId);
      expect(metrics).toBeDefined();
      expect(metrics!.requestCount).toBe(0);
      expect(metrics!.failureRate).toBe(0);
      expect(metrics!.averageResponseTime).toBe(0);
    });

    it("should handle state queries for non-existent circuits", () => {
      expect(service.getState("non-existent")).toBeUndefined();
      expect(service.getStats("non-existent")).toBeUndefined();
      expect(service.getCircuitMetrics("non-existent")).toBeUndefined();
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

    it("should clean up resources on destroy", async () => {
      service.registerCircuit("service1");
      service.registerCircuit("service2");

      expect(service.getAllStates().size).toBe(2);

      await service.cleanup();

      expect(service.getAllStates().size).toBe(0);
    });

    it("should clear pending timers on unregister", async () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, { recoveryTimeout: 5000 });

      // Open circuit to start recovery timer
      service.openCircuit(serviceId, "Test");
      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);

      // Unregister should clear the timer
      service.unregisterCircuit(serviceId);
      expect(service.getState(serviceId)).toBeUndefined();

      // Wait a bit to ensure timer was cleared (no state change should occur)
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(service.getState(serviceId)).toBeUndefined();
    });

    it("should handle multiple cleanup calls gracefully", async () => {
      service.registerCircuit("service1");
      service.registerCircuit("service2");

      expect(service.getAllStates().size).toBe(2);

      // First cleanup
      await service.cleanup();
      expect(service.getAllStates().size).toBe(0);

      // Second cleanup should not throw
      await expect(service.cleanup()).resolves.not.toThrow();
    });
  });
});
