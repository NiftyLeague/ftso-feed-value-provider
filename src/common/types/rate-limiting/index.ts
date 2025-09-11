/**
 * Rate limiting configuration
 */
export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed in a time window
   */
  maxRequestsPerWindow: number;

  /**
   * Time window in milliseconds
   */
  windowMs: number;

  /**
   * Maximum number of concurrent requests allowed (burst limit)
   */
  burstLimit: number;
}

/**
 * Rate limit policy for a specific endpoint or operation
 */
export interface RateLimitPolicy extends RateLimitConfig {
  /**
   * Name or path of the endpoint/operation
   */
  path: string;

  /**
   * Optional custom error message
   */
  message?: string;
}

/**
 * Rate limit status
 */
export interface RateLimitStatus {
  /**
   * Whether the endpoint/operation is currently rate limited
   */
  isLimited: boolean;

  /**
   * Number of requests made in current window
   */
  currentCount: number;

  /**
   * Time remaining until rate limit resets (ms)
   */
  timeToReset: number;

  /**
   * Current rate limit configuration
   */
  config: RateLimitConfig;
}
