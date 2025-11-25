import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import { createTimer } from "@/common/utils/performance.utils";
import { handleAsyncOperation } from "@/common/utils/http-response.utils";
import { CircuitBreakerState } from "@/common/types/error-handling";
import type { CircuitBreakerConfig, CircuitBreakerStats, CircuitBreakerMetrics } from "@/common/types/error-handling";
import { ENV } from "@/config/environment.constants";

@Injectable()
export class CircuitBreakerService extends EventDrivenService {
  private circuits = new Map<string, CircuitBreakerState>();
  private configs = new Map<string, CircuitBreakerConfig>();
  private stats = new Map<string, CircuitBreakerStats>();
  private circuitTimers = new Map<string, NodeJS.Timeout>();
  private requestHistory = new Map<string, Array<{ timestamp: number; success: boolean; responseTime: number }>>();

  // Rate limiting for warnings
  private warningLastLogged = new Map<string, number>();
  private readonly WARNING_COOLDOWN_MS = 30000; // 30 seconds

  // Health check interval for probing HALF_OPEN circuits
  private healthCheckInterval?: NodeJS.Timeout;

  constructor() {
    super({
      failureThreshold: ENV.CIRCUIT_BREAKER.SUCCESS_THRESHOLD,
      recoveryTimeout: ENV.TIMEOUTS.CIRCUIT_BREAKER_MS,
      successThreshold: ENV.CIRCUIT_BREAKER.SUCCESS_THRESHOLD,
      timeout: ENV.TIMEOUTS.CIRCUIT_BREAKER_MS,
      monitoringWindow: ENV.CIRCUIT_BREAKER.MONITORING_WINDOW_MS,
    });

    // Start periodic health check for stuck circuits
    this.startPeriodicHealthCheck();
  }

  /**
   * Get the typed configuration for this service
   */
  private get circuitBreakerConfig(): CircuitBreakerConfig {
    return this.config as CircuitBreakerConfig;
  }

  /**
   * Register a new circuit breaker for a service
   */
  registerCircuit(serviceId: string, config?: Partial<CircuitBreakerConfig>): void {
    this.logger.log(`Registering circuit breaker for service: ${serviceId}`);

    const fullConfig = { ...this.circuitBreakerConfig, ...config };

    // Adjust thresholds for data source integration services to reduce false positives
    if (serviceId.includes("Adapter") || serviceId.includes("DataSource") || serviceId.includes("Integration")) {
      fullConfig.failureThreshold = Math.max(fullConfig.failureThreshold, 10); // More lenient for adapters
      fullConfig.recoveryTimeout = Math.min(fullConfig.recoveryTimeout, 20000); // Faster recovery for adapters
      fullConfig.successThreshold = Math.max(fullConfig.successThreshold, 3); // Require more successes
    }

    // Even more lenient thresholds for individual exchange sources (binance, coinbase, etc.)
    // These naturally disconnect/reconnect and shouldn't trigger circuit breakers aggressively
    const exchangeNames = ["binance", "coinbase", "kraken", "okx", "cryptocom"];
    if (exchangeNames.some(name => serviceId.toLowerCase().includes(name))) {
      fullConfig.failureThreshold = Math.max(fullConfig.failureThreshold, 15); // Very lenient for exchanges
      fullConfig.recoveryTimeout = Math.min(fullConfig.recoveryTimeout, 30000); // Fast recovery (30s)
      fullConfig.successThreshold = 1; // Only need 1 success to recover
      fullConfig.monitoringWindow = 60000; // Shorter monitoring window (1 minute)
    }

    this.configs.set(serviceId, fullConfig);
    this.circuits.set(serviceId, CircuitBreakerState.CLOSED);
    this.requestHistory.set(serviceId, []);

    this.stats.set(serviceId, {
      state: CircuitBreakerState.CLOSED,
      failureCount: 0,
      successCount: 0,
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      uptime: Date.now(),
    });

    this.emit("circuitRegistered", serviceId, fullConfig);
  }

  /**
   * Execute a request through the circuit breaker
   */
  async execute<T>(serviceId: string, operation: () => Promise<T>): Promise<T> {
    const state = this.circuits.get(serviceId);
    const config = this.configs.get(serviceId);
    const stats = this.stats.get(serviceId);

    if (!state || !config || !stats) {
      throw new Error(`Circuit breaker not registered for service: ${serviceId}`);
    }

    stats.totalRequests++;

    // Check if circuit is open
    if (state === CircuitBreakerState.OPEN) {
      const timeSinceLastFailure = Date.now() - (stats.lastFailureTime || 0);

      if (timeSinceLastFailure < config.recoveryTimeout) {
        const error = new Error(`Circuit breaker is OPEN for service: ${serviceId}`);
        this.recordFailure(serviceId, 0);
        throw error;
      } else {
        // Transition to half-open state
        this.transitionToHalfOpen(serviceId);
      }
    }

    // Execute the operation with timeout using performance utilities
    const timer = createTimer();
    try {
      const result = await handleAsyncOperation(operation, `circuit-breaker-${serviceId}`, { timeout: config.timeout });

      const responseTime = timer.end();
      this.recordSuccess(serviceId, responseTime);
      return result;
    } catch (error) {
      const responseTime = timer.end();
      this.recordFailure(serviceId, responseTime);
      throw error;
    }
  }

  /**
   * Get current state of a circuit breaker
   */
  getState(serviceId: string): CircuitBreakerState | undefined {
    return this.circuits.get(serviceId);
  }

  /**
   * Get statistics for a circuit breaker
   */
  getStats(serviceId: string): CircuitBreakerStats | undefined {
    return this.stats.get(serviceId);
  }

  /**
   * Get metrics for a specific circuit breaker
   */
  getCircuitMetrics(serviceId: string): CircuitBreakerMetrics | undefined {
    const history = this.requestHistory.get(serviceId);
    const stats = this.stats.get(serviceId);

    if (!history || !stats) {
      return undefined;
    }

    const now = Date.now();
    const config = this.configs.get(serviceId);
    const windowStart = now - (config?.monitoringWindow || this.circuitBreakerConfig.monitoringWindow);

    // Filter requests within monitoring window
    const recentRequests = history.filter(req => req.timestamp >= windowStart);

    if (recentRequests.length === 0) {
      return {
        requestCount: 0,
        failureRate: 0,
        averageResponseTime: 0,
        lastStateChange: stats.uptime,
      };
    }

    const failures = recentRequests.filter(req => !req.success);
    const totalResponseTime = recentRequests.reduce((sum, req) => sum + req.responseTime, 0);

    return {
      requestCount: recentRequests.length,
      failureRate: failures.length / recentRequests.length,
      averageResponseTime: totalResponseTime / recentRequests.length,
      lastStateChange: stats.uptime,
    };
  }

  /**
   * Override base getMetrics to provide circuit breaker overview metrics
   */
  override getMetrics(): Record<string, number> {
    const baseMetrics = super.getMetrics();

    // Add circuit breaker specific metrics
    const circuitCount = this.circuits.size;
    const openCircuits = Array.from(this.circuits.values()).filter(state => state === CircuitBreakerState.OPEN).length;
    const halfOpenCircuits = Array.from(this.circuits.values()).filter(
      state => state === CircuitBreakerState.HALF_OPEN
    ).length;
    const closedCircuits = Array.from(this.circuits.values()).filter(
      state => state === CircuitBreakerState.CLOSED
    ).length;

    // Calculate total history size for memory monitoring
    let totalHistorySize = 0;
    for (const history of this.requestHistory.values()) {
      totalHistorySize += history.length;
    }

    return {
      ...baseMetrics,
      total_circuits: circuitCount,
      open_circuits: openCircuits,
      half_open_circuits: halfOpenCircuits,
      closed_circuits: closedCircuits,
      total_history_entries: totalHistorySize,
    };
  }

  /**
   * Manually open a circuit breaker
   */
  openCircuit(serviceId: string, reason?: string): void {
    // Rate limit manual circuit opening warnings
    const now = Date.now();
    const warningKey = `${serviceId}_manual_open`;
    const lastLogged = this.warningLastLogged.get(warningKey) || 0;

    if (now - lastLogged > this.WARNING_COOLDOWN_MS) {
      this.logger.warn(`Manually opening circuit for ${serviceId}: ${reason || "Manual trigger"}`);
      this.warningLastLogged.set(warningKey, now);
    }

    this.transitionToOpen(serviceId);
  }

  /**
   * Manually close a circuit breaker
   */
  closeCircuit(serviceId: string, reason?: string): void {
    this.logger.log(`Manually closing circuit for ${serviceId}: ${reason || "Manual trigger"}`);
    this.transitionToClosed(serviceId);
  }

  /**
   * Reset circuit breaker statistics
   */
  resetStats(serviceId: string): void {
    const stats = this.stats.get(serviceId);
    if (stats) {
      stats.failureCount = 0;
      stats.successCount = 0;
      stats.totalRequests = 0;
      stats.totalFailures = 0;
      stats.totalSuccesses = 0;
      stats.lastFailureTime = undefined;
      stats.lastSuccessTime = undefined;
    }

    this.requestHistory.set(serviceId, []);
    this.logger.log(`Reset statistics for circuit breaker: ${serviceId}`);
  }

  /**
   * Get all circuit breaker states
   */
  getAllStates(): Map<string, CircuitBreakerState> {
    return new Map(this.circuits);
  }

  /**
   * Get health summary for all circuits
   */
  getHealthSummary(): {
    total: number;
    closed: number;
    open: number;
    halfOpen: number;
    healthyPercentage: number;
  } {
    const states = Array.from(this.circuits.values());
    const total = states.length;
    const closed = states.filter(s => s === CircuitBreakerState.CLOSED).length;
    const open = states.filter(s => s === CircuitBreakerState.OPEN).length;
    const halfOpen = states.filter(s => s === CircuitBreakerState.HALF_OPEN).length;

    return {
      total,
      closed,
      open,
      halfOpen,
      healthyPercentage: total > 0 ? (closed / total) * 100 : 0,
    };
  }

  /**
   * Unregister a circuit breaker
   */
  unregisterCircuit(serviceId: string): void {
    this.logger.log(`Unregistering circuit breaker for service: ${serviceId}`);

    // Clear any pending timers
    const timer = this.circuitTimers.get(serviceId);
    if (timer) {
      clearTimeout(timer);
      this.circuitTimers.delete(serviceId);
    }

    // Clean up all data
    this.circuits.delete(serviceId);
    this.configs.delete(serviceId);
    this.stats.delete(serviceId);
    this.requestHistory.delete(serviceId);

    this.emit("circuitUnregistered", serviceId);
  }

  private recordSuccess(serviceId: string, responseTime: number): void {
    const stats = this.stats.get(serviceId);
    const config = this.configs.get(serviceId);
    const history = this.requestHistory.get(serviceId);

    if (!stats || !config || !history) return;

    stats.successCount++;
    stats.totalSuccesses++;
    stats.lastSuccessTime = Date.now();

    // Add to history
    history.push({
      timestamp: Date.now(),
      success: true,
      responseTime,
    });

    // Clean old history
    this.cleanHistory(serviceId);

    const currentState = this.circuits.get(serviceId);

    if (currentState === CircuitBreakerState.HALF_OPEN) {
      if (stats.successCount >= config.successThreshold) {
        this.transitionToClosed(serviceId);
      }
    } else if (currentState === CircuitBreakerState.CLOSED) {
      // Reset failure count on success
      stats.failureCount = 0;
    }

    this.emit("requestSuccess", serviceId, responseTime);
  }

  private recordFailure(serviceId: string, responseTime: number): void {
    const stats = this.stats.get(serviceId);
    const config = this.configs.get(serviceId);
    const history = this.requestHistory.get(serviceId);

    if (!stats || !config || !history) return;

    stats.failureCount++;
    stats.totalFailures++;
    stats.lastFailureTime = Date.now();

    // Add to history
    history.push({
      timestamp: Date.now(),
      success: false,
      responseTime,
    });

    // Clean old history
    this.cleanHistory(serviceId);

    const currentState = this.circuits.get(serviceId);

    if (currentState === CircuitBreakerState.HALF_OPEN) {
      // Any failure in half-open state opens the circuit
      this.transitionToOpen(serviceId);
    } else if (currentState === CircuitBreakerState.CLOSED) {
      // Check if we should open the circuit
      if (stats.failureCount >= config.failureThreshold) {
        this.transitionToOpen(serviceId);
      }
    }

    this.emit("requestFailure", serviceId, responseTime);
  }

  private transitionToClosed(serviceId: string): void {
    this.circuits.set(serviceId, CircuitBreakerState.CLOSED);
    const stats = this.stats.get(serviceId);

    if (stats) {
      stats.state = CircuitBreakerState.CLOSED;
      stats.failureCount = 0;
      stats.successCount = 0;
    }

    // Clear any recovery timer
    const timer = this.circuitTimers.get(serviceId);
    if (timer) {
      clearTimeout(timer);
      this.circuitTimers.delete(serviceId);
    }

    this.logger.log(`Circuit breaker CLOSED for service: ${serviceId}`);
    this.emit("circuitClosed", serviceId);
  }

  private transitionToOpen(serviceId: string): void {
    this.circuits.set(serviceId, CircuitBreakerState.OPEN);
    const stats = this.stats.get(serviceId);
    const config = this.configs.get(serviceId);

    if (stats) {
      stats.state = CircuitBreakerState.OPEN;
      stats.successCount = 0;
    }

    if (config) {
      // ✅ Use managed timeout for circuit breaker recovery
      const timer = this.createTimeout(() => {
        this.transitionToHalfOpen(serviceId);
      }, config.recoveryTimeout);

      this.circuitTimers.set(serviceId, timer);
    }

    // Rate limit the warning to prevent spam
    const now = Date.now();
    const lastLogged = this.warningLastLogged.get(serviceId) || 0;

    if (now - lastLogged > this.WARNING_COOLDOWN_MS) {
      // Provide more context in the error message
      const failureCount = stats?.failureCount || 0;
      const totalRequests = stats?.totalRequests || 0;
      const failureRate = totalRequests > 0 ? ((failureCount / totalRequests) * 100).toFixed(2) : "0";

      this.logger.warn(`Circuit breaker OPENED for service: ${serviceId}`, {
        failureCount,
        totalRequests,
        failureRate: `${failureRate}%`,
        recoveryTimeout: config?.recoveryTimeout,
        component: "CircuitBreakerService",
        operation: "transitionToOpen",
        severity: "high",
      });
      this.warningLastLogged.set(serviceId, now);
    }

    this.emit("circuitOpened", serviceId);
  }

  private transitionToHalfOpen(serviceId: string): void {
    this.circuits.set(serviceId, CircuitBreakerState.HALF_OPEN);
    const stats = this.stats.get(serviceId);

    if (stats) {
      stats.state = CircuitBreakerState.HALF_OPEN;
      stats.successCount = 0;
      stats.failureCount = 0;
    }

    this.logger.log(`Circuit breaker HALF-OPEN for service: ${serviceId}`);
    this.emit("circuitHalfOpen", serviceId);
  }

  // Track last cleanup time to avoid excessive cleanup operations
  private lastCleanupTime = new Map<string, number>();
  private readonly CLEANUP_INTERVAL_MS = 10000; // Only cleanup every 10 seconds

  private cleanHistory(serviceId: string): void {
    const history = this.requestHistory.get(serviceId);
    const config = this.configs.get(serviceId);

    if (!history || !config) return;

    // Rate limit cleanup operations to reduce CPU usage
    const now = Date.now();
    const lastCleanup = this.lastCleanupTime.get(serviceId) || 0;

    if (now - lastCleanup < this.CLEANUP_INTERVAL_MS) {
      return; // Skip cleanup if we cleaned up recently
    }

    this.lastCleanupTime.set(serviceId, now);

    const cutoff = now - config.monitoringWindow;
    const filteredHistory = history.filter(req => req.timestamp >= cutoff);

    // Keep only recent history to prevent memory leaks - reduced from 1000 to 500
    if (filteredHistory.length > 500) {
      filteredHistory.splice(0, filteredHistory.length - 500);
    }

    this.requestHistory.set(serviceId, filteredHistory);
  }

  /**
   * Start periodic health check to recover stuck circuits
   * This prevents circuits from staying HALF_OPEN or OPEN indefinitely
   */
  private startPeriodicHealthCheck(): void {
    // Check every 30 seconds for stuck circuits
    this.healthCheckInterval = this.createInterval(() => {
      this.performCircuitHealthCheck();
    }, 30000);
  }

  /**
   * Check all circuits and attempt to recover stuck ones
   */
  private performCircuitHealthCheck(): void {
    const now = Date.now();

    for (const [serviceId, state] of this.circuits.entries()) {
      const stats = this.stats.get(serviceId);
      const config = this.configs.get(serviceId);

      if (!stats || !config) continue;

      // Check HALF_OPEN circuits that have been stuck for too long
      if (state === CircuitBreakerState.HALF_OPEN) {
        const timeSinceLastRequest = now - (stats.lastSuccessTime || stats.lastFailureTime || stats.uptime);

        // If no requests in last 60 seconds, try to close the circuit
        if (timeSinceLastRequest > 60000) {
          this.logger.log(`Circuit ${serviceId} stuck in HALF_OPEN for ${timeSinceLastRequest}ms, attempting recovery`);

          // Reset stats and close circuit to give it a fresh start
          this.resetStats(serviceId);
          this.transitionToClosed(serviceId);
        }
      }

      // Check OPEN circuits that should have transitioned to HALF_OPEN by now
      if (state === CircuitBreakerState.OPEN) {
        const timeSinceFailure = now - (stats.lastFailureTime || 0);

        // If circuit has been open longer than recovery timeout + grace period
        if (timeSinceFailure > config.recoveryTimeout + 30000) {
          this.logger.log(`Circuit ${serviceId} stuck in OPEN for ${timeSinceFailure}ms, forcing HALF_OPEN transition`);
          this.transitionToHalfOpen(serviceId);
        }
      }
    }
  }

  /**
   * Cleanup method
   */
  override async cleanup(): Promise<void> {
    // Clear health check interval
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Clear all timers
    for (const timer of this.circuitTimers.values()) {
      clearTimeout(timer);
    }

    this.circuits.clear();
    this.configs.clear();
    this.stats.clear();
    this.circuitTimers.clear();
    this.requestHistory.clear();
    this.warningLastLogged.clear();
    this.lastCleanupTime.clear();

    this.logger.debug("CircuitBreakerService cleanup completed");
  }
}
