import { StandardErrorClassification } from "@/common/types/error-handling";
import { StandardErrorClassification as ErrorClass } from "@/common/types/error-handling";

/**
 * Centralized error classification and categorization utilities
 */

export interface ErrorCategory {
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  retryable: boolean;
  backoffMultiplier?: number;
  minDelay?: number;
}

/**
 * Extract HTTP status code from error message
 */
export function extractStatusCode(message: string): number | null {
  // Match patterns like "503", "Unexpected server response: 503", etc.
  const patterns = [
    /unexpected server response: (\d+)/i,
    /server response: (\d+)/i,
    /status code: (\d+)/i,
    /http (\d+)/i,
    /(\d{3})\s/, // 3-digit number followed by space
    /^(\d{3})$/, // Just the 3-digit number
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const code = parseInt(match[1]);
      if (code >= 100 && code < 600) {
        return code;
      }
    }
  }

  return null;
}

/**
 * Categorize error for connection recovery and backoff strategies
 */
export function categorizeConnectionError(error: Error): ErrorCategory {
  const message = error.message.toLowerCase();
  const statusCode = extractStatusCode(message);

  // HTTP Status Code specific categorization
  if (statusCode) {
    if (statusCode === 503) {
      return {
        type: "service_unavailable",
        severity: "high",
        retryable: true,
        backoffMultiplier: 2.5,
        minDelay: 30000, // 30 seconds minimum for 503
      };
    }
    if (statusCode === 502) {
      return {
        type: "bad_gateway",
        severity: "high",
        retryable: true,
        backoffMultiplier: 2.0,
        minDelay: 15000,
      };
    }
    if (statusCode >= 500) {
      return {
        type: "server_error",
        severity: "high",
        retryable: true,
        backoffMultiplier: 2.5,
        minDelay: 20000,
      };
    }
    if (statusCode === 429) {
      return {
        type: "rate_limit",
        severity: "medium",
        retryable: true,
        backoffMultiplier: 3.0,
        minDelay: 60000, // 1 minute minimum for rate limits
      };
    }
    if (statusCode === 404) {
      return {
        type: "not_found",
        severity: "low",
        retryable: false,
      };
    }
    if (statusCode === 401) {
      return {
        type: "authentication",
        severity: "critical",
        retryable: false,
      };
    }
    if (statusCode === 403) {
      return {
        type: "authorization",
        severity: "high",
        retryable: false,
      };
    }
    if (statusCode >= 400) {
      return {
        type: "client_error",
        severity: "medium",
        retryable: false,
      };
    }
  }

  // Text-based error categorization
  if (message.includes("service unavailable") || message.includes("temporarily unavailable")) {
    return {
      type: "service_unavailable",
      severity: "high",
      retryable: true,
      backoffMultiplier: 2.5,
      minDelay: 30000,
    };
  }

  if (message.includes("bad gateway")) {
    return {
      type: "bad_gateway",
      severity: "high",
      retryable: true,
      backoffMultiplier: 2.0,
      minDelay: 15000,
    };
  }

  if (message.includes("rate limit") || message.includes("too many")) {
    return {
      type: "rate_limit",
      severity: "medium",
      retryable: true,
      backoffMultiplier: 3.0,
      minDelay: 60000,
    };
  }

  if (message.includes("timeout") || message.includes("timed out")) {
    return {
      type: "timeout",
      severity: "medium",
      retryable: true,
      backoffMultiplier: 2.0,
      minDelay: 5000,
    };
  }

  if (message.includes("network") || message.includes("connection") || message.includes("econnrefused")) {
    return {
      type: "network",
      severity: "medium",
      retryable: true,
      backoffMultiplier: 2.0,
      minDelay: 5000,
    };
  }

  if (message.includes("auth") || message.includes("unauthorized")) {
    return {
      type: "authentication",
      severity: "critical",
      retryable: false,
    };
  }

  if (message.includes("forbidden") || message.includes("access denied")) {
    return {
      type: "authorization",
      severity: "high",
      retryable: false,
    };
  }

  if (message.includes("not found")) {
    return {
      type: "not_found",
      severity: "low",
      retryable: false,
    };
  }

  if (message.includes("unexpected server response")) {
    return {
      type: "unexpected_response",
      severity: "medium",
      retryable: true,
      backoffMultiplier: 2.0,
      minDelay: 10000,
    };
  }

  // Default category for unknown errors
  return {
    type: "unknown",
    severity: "medium",
    retryable: true,
    backoffMultiplier: 2.0,
    minDelay: 5000,
  };
}

/**
 * Classify error for standardized error handling
 */
export function classifyError(error: Error): StandardErrorClassification {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  const statusCode = extractStatusCode(message);

  // HTTP Status Code specific classification
  if (statusCode) {
    if (statusCode === 503) return ErrorClass.SERVICE_UNAVAILABLE_ERROR;
    if (statusCode === 502) return ErrorClass.EXTERNAL_SERVICE_ERROR;
    if (statusCode >= 500) return ErrorClass.EXTERNAL_SERVICE_ERROR;
    if (statusCode === 429) return ErrorClass.RATE_LIMIT_ERROR;
    if (statusCode === 404) return ErrorClass.NOT_FOUND_ERROR;
    if (statusCode === 401) return ErrorClass.AUTHENTICATION_ERROR;
    if (statusCode === 403) return ErrorClass.AUTHORIZATION_ERROR;
    if (statusCode === 400) return ErrorClass.VALIDATION_ERROR;
  }

  // WebSocket specific errors
  if (message.includes("unexpected server response")) {
    const category = categorizeConnectionError(error);
    switch (category.type) {
      case "service_unavailable":
        return ErrorClass.SERVICE_UNAVAILABLE_ERROR;
      case "bad_gateway":
      case "server_error":
        return ErrorClass.EXTERNAL_SERVICE_ERROR;
      case "rate_limit":
        return ErrorClass.RATE_LIMIT_ERROR;
      case "authentication":
        return ErrorClass.AUTHENTICATION_ERROR;
      case "authorization":
        return ErrorClass.AUTHORIZATION_ERROR;
      default:
        return ErrorClass.EXTERNAL_SERVICE_ERROR;
    }
  }

  // Text-based classification
  if (message.includes("service unavailable") || message.includes("temporarily unavailable")) {
    return ErrorClass.SERVICE_UNAVAILABLE_ERROR;
  }
  if (message.includes("bad gateway")) {
    return ErrorClass.EXTERNAL_SERVICE_ERROR;
  }
  if (message.includes("authentication") || message.includes("unauthorized") || name.includes("auth")) {
    return ErrorClass.AUTHENTICATION_ERROR;
  }
  if (message.includes("forbidden") || message.includes("access denied")) {
    return ErrorClass.AUTHORIZATION_ERROR;
  }
  if (message.includes("timeout") || message.includes("timed out") || name.includes("timeout")) {
    return ErrorClass.TIMEOUT_ERROR;
  }
  if (message.includes("connection") || message.includes("network") || message.includes("econnrefused")) {
    return ErrorClass.CONNECTION_ERROR;
  }
  if (message.includes("rate limit")) {
    return ErrorClass.RATE_LIMIT_ERROR;
  }
  if (message.includes("validation") || message.includes("invalid") || name.includes("validation")) {
    return ErrorClass.VALIDATION_ERROR;
  }
  if (message.includes("not found") || name.includes("notfound")) {
    return ErrorClass.NOT_FOUND_ERROR;
  }
  if (message.includes("data") && (message.includes("corrupt") || message.includes("invalid"))) {
    return ErrorClass.DATA_ERROR;
  }
  if (message.includes("config") || message.includes("configuration")) {
    return ErrorClass.CONFIGURATION_ERROR;
  }
  if (message.includes("circuit") && message.includes("open")) {
    return ErrorClass.CIRCUIT_BREAKER_ERROR;
  }
  if (message.includes("processing") || message.includes("calculation") || message.includes("aggregation")) {
    return ErrorClass.PROCESSING_ERROR;
  }
  if (message.includes("external") || message.includes("upstream") || message.includes("adapter")) {
    return ErrorClass.EXTERNAL_SERVICE_ERROR;
  }

  return ErrorClass.UNKNOWN_ERROR;
}

/**
 * Get simple error category string for logging and monitoring
 */
export function getErrorCategoryString(error: Error): string {
  const category = categorizeConnectionError(error);
  return category.type;
}

/**
 * Check if error is retryable based on classification
 */
export function isErrorRetryable(error: Error): boolean {
  const category = categorizeConnectionError(error);
  return category.retryable;
}

/**
 * Get recommended backoff parameters for error
 */
export function getBackoffParameters(error: Error): {
  multiplier: number;
  minDelay: number;
} {
  const category = categorizeConnectionError(error);
  return {
    multiplier: category.backoffMultiplier || 2.0,
    minDelay: category.minDelay || 5000,
  };
}
