import type { BaseServiceConfig } from "../services/base.types";

/**
 * Rate limiting type definitions
 */

export interface RateLimitConfig extends BaseServiceConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitState {
  requests: number;
  resetTime: number;
  remaining: number;
  windowStart: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
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

export interface IRateLimiter {
  checkLimit(key: string): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
  getState(key: string): Promise<RateLimitState | null>;
}

export interface RateLimitStore {
  get(key: string): Promise<RateLimitState | null>;
  set(key: string, state: RateLimitState): Promise<void>;
  delete(key: string): Promise<void>;
  cleanup(): Promise<void>;
}

export interface RateLimitMetrics {
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  hitRate: number;
  averageResponseTime: number;
}
