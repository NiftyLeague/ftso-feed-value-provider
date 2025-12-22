export interface ErrorCategory {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  retryable: boolean;
  backoffMultiplier?: number;
  minDelay?: number;
}
