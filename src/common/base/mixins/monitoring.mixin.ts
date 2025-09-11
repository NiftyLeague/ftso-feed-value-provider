import type { Constructor, AbstractConstructor, IBaseService } from "../../types/services";

/**
 * Monitoring and metrics capabilities
 */
export interface MonitoringCapabilities {
  recordMetric(name: string, value: number): void;
  incrementCounter(name: string, increment?: number): void;
  startTimer(operationName: string): void;
  endTimer(operationName: string): number;
  setHealthStatus(status: "healthy" | "unhealthy" | "degraded"): void;
  getHealthStatus(): {
    status: "healthy" | "unhealthy" | "degraded";
    lastCheck: number;
    uptime: number;
  };
  getMetrics(): Record<string, number>;
  getCounters(): Record<string, number>;
}

/**
 * Mixin that adds monitoring and metrics to a service
 */
export function WithMonitoring<TBase extends Constructor | AbstractConstructor>(Base: TBase) {
  return class MonitoringMixin extends Base implements MonitoringCapabilities {
    public serviceMetrics = new Map<string, number>();
    public serviceCounters = new Map<string, number>();
    public serviceOperationTimers = new Map<string, number>();
    public serviceHealthStatus: "healthy" | "unhealthy" | "degraded" = "healthy";
    public lastHealthCheck = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
    }

    recordMetric(name: string, value: number): void {
      this.serviceMetrics.set(name, value);
      (this as unknown as IBaseService).logDebug(`Metric recorded: ${name} = ${value}`);
    }

    incrementCounter(name: string, increment = 1): void {
      const current = this.serviceCounters.get(name) || 0;
      this.serviceCounters.set(name, current + increment);
    }

    startTimer(operationName: string): void {
      this.serviceOperationTimers.set(operationName, Date.now());
    }

    endTimer(operationName: string): number {
      const startTime = this.serviceOperationTimers.get(operationName);
      if (!startTime) {
        (this as unknown as IBaseService).logWarning(`Timer not found for operation: ${operationName}`);
        return 0;
      }

      const duration = Date.now() - startTime;
      this.serviceOperationTimers.delete(operationName);
      this.recordMetric(`${operationName}_duration_ms`, duration);
      return duration;
    }

    setHealthStatus(status: "healthy" | "unhealthy" | "degraded"): void {
      if (this.serviceHealthStatus !== status) {
        (this as unknown as IBaseService).logger.log(`Health status changed: ${this.serviceHealthStatus} -> ${status}`);
        this.serviceHealthStatus = status;
      }
      this.lastHealthCheck = Date.now();
    }

    getHealthStatus(): {
      status: "healthy" | "unhealthy" | "degraded";
      lastCheck: number;
      uptime: number;
    } {
      return {
        status: this.serviceHealthStatus,
        lastCheck: this.lastHealthCheck,
        uptime: Date.now() - this.lastHealthCheck,
      };
    }

    getMetrics(): Record<string, number> {
      return Object.fromEntries(this.serviceMetrics);
    }

    getCounters(): Record<string, number> {
      return Object.fromEntries(this.serviceCounters);
    }
  };
}
