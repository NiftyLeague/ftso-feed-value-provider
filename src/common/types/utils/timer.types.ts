/**
 * Timer utility type definitions
 */

export interface TimerConfig {
  interval: number; // milliseconds
  immediate?: boolean;
  maxExecutions?: number;
  errorHandler?: (error: Error) => void;
}

export interface TimerMetrics {
  executionCount: number;
  averageExecutionTime: number;
  lastExecutionTime: number;
  errorCount: number;
  isRunning: boolean;
  startTime: number;
  totalRuntime: number;
}

export interface ITimer {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  reset(): void;
  isRunning(): boolean;
  getMetrics(): TimerMetrics;
}

export interface ScheduledTask {
  id: string;
  name: string;
  schedule: string; // cron expression
  handler: () => Promise<void> | void;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  errorCount: number;
}

export interface TaskScheduler {
  schedule(task: ScheduledTask): void;
  unschedule(taskId: string): void;
  start(): void;
  stop(): void;
  getTasks(): ScheduledTask[];
  getTask(taskId: string): ScheduledTask | undefined;
}
