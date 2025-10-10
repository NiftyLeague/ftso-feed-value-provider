/**
 * Generic API response structure.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  timestamp: number;
  requestId?: string;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface ErrorResponse {
  status: "error";
  timestamp: number;
  error: string;
  message: string;
  responseTime?: number;
  requestId?: string;
  details?: Record<string, unknown>;
  path?: string;
  stack?: string;
}

/**
 * Configuration for an HTTP request.
 */
export interface HttpRequestConfig {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  headers?: Record<string, string>;
  params?: Record<string, string | number>;
  body?: unknown;
  timeout?: number;
}

/**
 * Represents an HTTP response.
 */
export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

/**
 * Configuration for an HTTP client.
 */
export interface HttpClientConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
  retries?: number;
  retryDelay?: number;
}

export function isApiResponse(obj: unknown): obj is ApiResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "success" in obj &&
    typeof (obj as { success: unknown }).success === "boolean"
  );
}
