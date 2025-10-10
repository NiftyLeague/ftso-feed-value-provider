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
