/**
 * Performance Utilities
 * Consolidates duplicate performance timing and monitoring patterns
 */

export interface PerformanceTimer {
  start(): void;
  end(): number;
  elapsed(): number;
  reset(): void;
}

export interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * High-resolution performance timer
 */
export class Timer implements PerformanceTimer {
  private startTime: number = 0;
  private endTime: number = 0;

  start(): void {
    this.startTime = performance.now();
    this.endTime = 0;
  }

  end(): number {
    this.endTime = performance.now();
    return this.elapsed();
  }

  elapsed(): number {
    const endTime = this.endTime || performance.now();
    return endTime - this.startTime;
  }

  reset(): void {
    this.startTime = 0;
    this.endTime = 0;
  }
}

/**
 * Create a new performance timer
 */
export function createTimer(): PerformanceTimer {
  const timer = new Timer();
  timer.start();
  return timer;
}

/**
 * Measure execution time of a function
 */
export async function measureAsync<T>(
  operation: () => Promise<T>,
  operationName?: string
): Promise<{ result: T; duration: number; metric: PerformanceMetric }> {
  const timer = createTimer();

  try {
    const result = await operation();
    const duration = timer.end();

    const metric: PerformanceMetric = {
      operation: operationName || "async_operation",
      duration,
      timestamp: Date.now(),
    };

    return { result, duration, metric };
  } catch (error) {
    const duration = timer.end();

    const metric: PerformanceMetric = {
      operation: operationName || "async_operation",
      duration,
      timestamp: Date.now(),
      metadata: { error: (error as Error).message },
    };

    throw { error, duration, metric };
  }
}

/**
 * Measure execution time of a synchronous function
 */
export function measureSync<T>(
  operation: () => T,
  operationName?: string
): { result: T; duration: number; metric: PerformanceMetric } {
  const timer = createTimer();

  try {
    const result = operation();
    const duration = timer.end();

    const metric: PerformanceMetric = {
      operation: operationName || "sync_operation",
      duration,
      timestamp: Date.now(),
    };

    return { result, duration, metric };
  } catch (error) {
    const duration = timer.end();

    const metric: PerformanceMetric = {
      operation: operationName || "sync_operation",
      duration,
      timestamp: Date.now(),
      metadata: { error: (error as Error).message },
    };

    throw { error, duration, metric };
  }
}

/**
 * Performance threshold checker
 */
export interface PerformanceThresholds {
  warning: number;
  error: number;
}

export function checkPerformanceThreshold(
  duration: number,
  thresholds: PerformanceThresholds,
  operation: string
): {
  level: "ok" | "warning" | "error";
  message?: string;
} {
  if (duration >= thresholds.error) {
    return {
      level: "error",
      message: `${operation} took ${duration.toFixed(2)}ms (error threshold: ${thresholds.error}ms)`,
    };
  }

  if (duration >= thresholds.warning) {
    return {
      level: "warning",
      message: `${operation} took ${duration.toFixed(2)}ms (warning threshold: ${thresholds.warning}ms)`,
    };
  }

  return { level: "ok" };
}

/**
 * Performance statistics calculator
 */
export class PerformanceStats {
  private measurements: number[] = [];
  private readonly maxMeasurements: number;

  constructor(maxMeasurements = 1000) {
    this.maxMeasurements = maxMeasurements;
  }

  addMeasurement(duration: number): void {
    this.measurements.push(duration);

    if (this.measurements.length > this.maxMeasurements) {
      this.measurements.shift();
    }
  }

  getStats(): {
    count: number;
    average: number;
    min: number;
    max: number;
    p50: number;
    p95: number;
    p99: number;
  } {
    if (this.measurements.length === 0) {
      return {
        count: 0,
        average: 0,
        min: 0,
        max: 0,
        p50: 0,
        p95: 0,
        p99: 0,
      };
    }

    const sorted = [...this.measurements].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((acc, val) => acc + val, 0);

    return {
      count,
      average: sum / count,
      min: sorted[0],
      max: sorted[count - 1],
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  reset(): void {
    this.measurements = [];
  }
}

/**
 * Debounced performance logger
 */
export class PerformanceLogger {
  private buffer: PerformanceMetric[] = [];
  private flushTimer?: NodeJS.Timeout;
  private readonly flushInterval: number;
  private readonly maxBufferSize: number;

  constructor(
    private readonly onFlush: (metrics: PerformanceMetric[]) => void,
    options: {
      flushInterval?: number;
      maxBufferSize?: number;
    } = {}
  ) {
    this.flushInterval = options.flushInterval || 5000; // 5 seconds
    this.maxBufferSize = options.maxBufferSize || 100;
  }

  log(metric: PerformanceMetric): void {
    this.buffer.push(metric);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  flush(): void {
    if (this.buffer.length > 0) {
      this.onFlush([...this.buffer]);
      this.buffer = [];
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  destroy(): void {
    this.flush();
  }
}

/**
 * Utility functions for common timing patterns
 */
export const PerformanceUtils = {
  /**
   * Get current timestamp in milliseconds
   */
  now: (): number => Date.now(),

  /**
   * Get high-resolution timestamp
   */
  hrNow: (): number => performance.now(),

  /**
   * Calculate duration between two timestamps
   */
  duration: (start: number, end?: number): number => (end || Date.now()) - start,

  /**
   * Format duration for display
   */
  formatDuration: (duration: number): string => {
    if (duration < 1000) {
      return `${duration.toFixed(2)}ms`;
    }
    return `${(duration / 1000).toFixed(2)}s`;
  },

  /**
   * Check if duration exceeds threshold
   */
  exceedsThreshold: (duration: number, threshold: number): boolean => duration > threshold,

  /**
   * Create performance warning message
   */
  createWarningMessage: (operation: string, duration: number, threshold: number): string =>
    `Performance warning: ${operation} took ${PerformanceUtils.formatDuration(duration)} (threshold: ${PerformanceUtils.formatDuration(threshold)})`,
};
