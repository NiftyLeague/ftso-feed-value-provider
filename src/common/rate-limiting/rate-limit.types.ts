/**
 * Rate Limiting Types and Interfaces
 * Shared types for rate limiting functionality
 */

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitInfo {
  totalHits: number;
  totalHitsInWindow: number;
  remainingPoints: number;
  msBeforeNext: number;
  isBlocked: boolean;
}

export interface ClientRecord {
  requests: number[];
  totalRequests: number;
  firstRequest: number;
}

export interface RateLimitStats {
  totalClients: number;
  activeClients: number;
  totalRequests: number;
  blockedRequests: number;
}

export interface RateLimitErrorResponse {
  error: string;
  code: number;
  message: string;
  timestamp: number;
  requestId: string;
  rateLimitInfo: {
    limit: number;
    windowMs: number;
    totalHits: number;
    totalHitsInWindow: number;
    retryAfterSeconds: number;
    resetTime: string;
  };
  clientInfo: {
    clientId: string;
    method: string;
    url: string;
  };
}
