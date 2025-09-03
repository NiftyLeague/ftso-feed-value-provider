/**
 * API error types
 */

export interface ApiErrorResponse {
  error: string;
  code: number;
  message: string;
  timestamp: number;
  requestId: string;
  details?: Record<string, unknown>;
}

export enum ApiErrorCodes {
  // Client errors (4xxx)
  INVALID_FEED_REQUEST = 4000,
  INVALID_FEED_CATEGORY = 4001,
  INVALID_FEED_NAME = 4002,
  INVALID_VOTING_ROUND = 4003,
  INVALID_TIME_WINDOW = 4004,
  FEED_NOT_FOUND = 4041,
  RATE_LIMIT_EXCEEDED = 4291,

  // Server errors (5xxx)
  INTERNAL_ERROR = 5001,
  DATA_SOURCE_UNAVAILABLE = 5021,
  SERVICE_UNAVAILABLE = 5031,
  AGGREGATION_FAILED = 5041,
  CACHE_ERROR = 5051,
}
