import { Test, TestingModule } from "@nestjs/testing";
import { CircuitBreakerState } from "@/common/types/error-handling";
import { ENV } from "@/config/environment.constants";
import { TestHelpers } from "@/__tests__/utils";
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

    it("does not reset state when re-registering an existing circuit", () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, { failureThreshold: 2, recoveryTimeout: 100, successThreshold: 1 });
      service.openCircuit(serviceId, "Test");
      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);

      // Re-register with different config should update config but keep the state.
      service.registerCircuit(serviceId, { failureThreshold: 99 });
      expect(service.getState(serviceId)).toBe(CircuitBreakerState.OPEN);
    });

    it("applies more lenient thresholds for adapter/integration-like service IDs", () => {
      const serviceId = "MyDataSourceAdapter";
      service.registerCircuit(serviceId, { failureThreshold: 1, recoveryTimeout: 999_999, successThreshold: 1 });

      const config = (service as any).configs.get(serviceId);
      expect(config.failureThreshold).toBeGreaterThanOrEqual(10);
      expect(config.recoveryTimeout).toBeLessThanOrEqual(20_000);
      expect(config.successThreshold).toBeGreaterThanOrEqual(3);
    });

    it("applies exchange-specific leniency when serviceId contains an active adapter name", () => {
      const exchange = ENV.ADAPTERS.ACTIVE_CUSTOM_ADAPTERS[0];
      const serviceId = `ws-${exchange}-source`;
      service.registerCircuit(serviceId, { failureThreshold: 1, recoveryTimeout: 999_999, successThreshold: 99 });

      const config = (service as any).configs.get(serviceId);
      expect(config.failureThreshold).toBeGreaterThanOrEqual(15);
      expect(config.recoveryTimeout).toBeLessThanOrEqual(30_000);
      expect(config.successThreshold).toBe(1);
      expect(config.monitoringWindow).toBe(60_000);
    });
  });

  describe("Initialization", () => {
    it("starts periodic health check only once", async () => {
      const startSpy = jest.spyOn(service as any, "startPeriodicHealthCheck");

      await service.initialize();
      await service.initialize();

      expect(startSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Warning cooldown", () => {
    it("rate-limits transitionToOpen warnings across open/close cycles", async () => {
      const serviceId = "cooldown-test";
      service.registerCircuit(serviceId, { failureThreshold: 1, recoveryTimeout: 100, successThreshold: 1 });

      const warnSpy = jest.spyOn((service as any).logger, "warn");

      let now = 1_700_000_000_000;
      await TestHelpers.withMockedNowAsync(
        () => now,
        async () => {
          // First failure opens and warns
          await service
            .execute(serviceId, async () => {
              throw new Error("fail");
            })
            .catch(() => undefined);
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Circuit breaker OPENED"), expect.anything());

          // Close, then open again within cooldown -> no extra warning
          service.closeCircuit(serviceId, "reset");
          warnSpy.mockClear();
          now += 1000;
          await service
            .execute(serviceId, async () => {
              throw new Error("fail");
            })
            .catch(() => undefined);
          expect(warnSpy).not.toHaveBeenCalledWith(
            expect.stringContaining("Circuit breaker OPENED"),
            expect.anything()
          );
        }
      );
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

    it("openCircuit warns when circuit is not registered", () => {
      const warnSpy = jest.spyOn((service as any).logger, "warn");
      service.openCircuit("missing", "Manual");
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot open circuit"));
    });

    it("closeCircuit debug-logs when circuit is not registered", () => {
      const debugSpy = jest.spyOn((service as any).logger, "debug");
      service.closeCircuit("missing", "Manual");
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot close circuit"));
    });

    it("re-emits circuitOpened/circuitClosed events with cooldown when state is unchanged", () => {
      const serviceId = "test-service";
      const openedSpy = jest.fn();
      const closedSpy = jest.fn();
      service.on("circuitOpened", openedSpy);
      service.on("circuitClosed", closedSpy);

      let now = 1_700_000_000_000;
      TestHelpers.withMockedNow(
        () => now,
        () => {
          // First open emits directly via transition.
          service.openCircuit(serviceId, "Test");
          openedSpy.mockClear();

          // Re-open after cooldown should re-emit.
          now += 6000;
          service.openCircuit(serviceId, "Test again");
          expect(openedSpy).toHaveBeenCalledTimes(1);

          // Re-open within cooldown should be suppressed.
          openedSpy.mockClear();
          now += 1000;
          service.openCircuit(serviceId, "Test again");
          expect(openedSpy).toHaveBeenCalledTimes(0);

          // Close emits directly via transition.
          now += 6000;
          service.closeCircuit(serviceId, "Manual");
          closedSpy.mockClear();

          // Re-close after cooldown should re-emit.
          now += 6000;
          service.closeCircuit(serviceId, "Manual");
          expect(closedSpy).toHaveBeenCalledTimes(1);

          // Re-close within cooldown should be suppressed.
          closedSpy.mockClear();
          now += 1000;
          service.closeCircuit(serviceId, "Manual");
          expect(closedSpy).toHaveBeenCalledTimes(0);
        }
      );
    });
  });

  describe("Internal cleanup and health check branches", () => {
    it("cleanHistory rate-limits and trims history to 500 entries", () => {
      const serviceId = "test-service";
      service.registerCircuit(serviceId, { monitoringWindow: 1_000_000 });

      const history = Array.from({ length: 600 }, () => ({
        timestamp: 1_700_000_000_000,
        success: true,
        responseTime: 1,
      }));
      (service as any).requestHistory.set(serviceId, history);

      let now = 1_700_000_000_000;
      TestHelpers.withMockedNow(
        () => now,
        () => {
          // Within cleanup interval -> no-op
          (service as any).lastCleanupTime.set(serviceId, now);
          (service as any).cleanHistory(serviceId);
          expect(((service as any).requestHistory.get(serviceId) as any[]).length).toBe(600);

          // After cleanup interval -> trims
          now += 10_001;
          (service as any).cleanHistory(serviceId);
          expect(((service as any).requestHistory.get(serviceId) as any[]).length).toBe(500);
        }
      );
    });

    it("performCircuitHealthCheck recovers stuck HALF_OPEN and forces stuck OPEN to HALF_OPEN", () => {
      const halfOpenId = "half-open";
      const openId = "open";

      service.registerCircuit(halfOpenId, { recoveryTimeout: 1000 });
      service.registerCircuit(openId, { recoveryTimeout: 1000 });

      // Force HALF_OPEN state
      (service as any).circuits.set(halfOpenId, CircuitBreakerState.HALF_OPEN);
      const halfStats = (service as any).stats.get(halfOpenId);
      halfStats.state = CircuitBreakerState.HALF_OPEN;
      halfStats.lastSuccessTime = undefined;
      halfStats.lastFailureTime = undefined;
      halfStats.uptime = 1_700_000_000_000;

      // Force OPEN state
      (service as any).circuits.set(openId, CircuitBreakerState.OPEN);
      const openStats = (service as any).stats.get(openId);
      openStats.state = CircuitBreakerState.OPEN;
      openStats.lastFailureTime = 1_700_000_000_000;

      const now = 1_700_000_000_000 + 100_000;
      TestHelpers.withMockedNow(now, () => {
        // HALF_OPEN has no requests for >60s -> should reset/close
        // OPEN has been open for > recoveryTimeout + 30s -> should force HALF_OPEN
        (service as any).performCircuitHealthCheck();

        expect(service.getState(halfOpenId)).toBe(CircuitBreakerState.CLOSED);
        expect(service.getState(openId)).toBe(CircuitBreakerState.HALF_OPEN);
      });
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
