/**
 * Error handling configuration types
 */

import type { CircuitBreakerConfig } from "@/common/types/error-handling";
import type { FallbackConfig } from "./component.types";

/**
 * Error handling configuration
 */
export interface ErrorHandlingConfiguration {
  /** Whether error handling is enabled */
  enabled: boolean;
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Delay between retries in milliseconds */
  retryDelay: number;
  /** Circuit breaker configuration */
  circuitBreaker: CircuitBreakerConfig;
  /** Fallback strategy configuration */
  fallback: FallbackConfig;
}
