/**
 * Client Identification Utilities
 * Consolidates client identification and sanitization logic
 * Eliminates ~100 lines of duplication between rate-limit guard and response-time interceptor
 */

import type { ClientInfo } from "../types/http/client.types";

export class ClientIdentificationUtils {
  /**
   * Get client identifier from request headers and connection info
   */
  static getClientInfo(request: {
    headers: Record<string, string>;
    connection?: { remoteAddress?: string };
    socket?: { remoteAddress?: string };
    ip?: string;
  }): ClientInfo {
    const clientId = this.extractClientId(request);
    const type = this.getClientType(clientId);
    const sanitized = this.sanitizeClientId(clientId);

    return {
      id: clientId,
      type,
      sanitized,
    };
  }

  /**
   * Extract client ID from various sources in order of preference
   */
  private static extractClientId(request: { headers: Record<string, string> }): string {
    // 1. API Key (highest priority)
    const apiKey = request.headers["x-api-key"];
    if (apiKey && typeof apiKey === "string" && apiKey.length > 0) {
      return `api:${apiKey}`;
    }

    // 2. Authorization header (Bearer token)
    const authHeader = request.headers["authorization"];
    if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      if (token.length > 0) {
        return `bearer:${token}`;
      }
    }

    // 3. Custom client ID header
    const clientId = request.headers["x-client-id"];
    if (clientId && typeof clientId === "string" && clientId.length > 0) {
      return `client:${clientId}`;
    }

    // 4. IP address as fallback
    const ip = this.extractClientIP(request);
    return `ip:${ip}`;
  }

  /**
   * Extract client IP address from various sources
   */
  private static extractClientIP(request: {
    headers: Record<string, string>;
    connection?: { remoteAddress?: string };
    socket?: { remoteAddress?: string };
    ip?: string;
  }): string {
    // Try multiple sources for IP address
    const candidates = [
      request.ip,
      request.connection?.remoteAddress,
      request.socket?.remoteAddress,
      request.headers["x-forwarded-for"]?.split(",")[0]?.trim(),
      request.headers["x-real-ip"],
      request.headers["x-client-ip"],
      request.headers["cf-connecting-ip"], // Cloudflare
    ];

    for (const candidate of candidates) {
      if (candidate && typeof candidate === "string" && candidate.length > 0 && candidate !== "unknown") {
        return candidate;
      }
    }

    return "unknown";
  }

  /**
   * Get client type from client ID
   */
  private static getClientType(clientId: string): "api" | "bearer" | "client" | "ip" {
    if (clientId.startsWith("api:")) return "api";
    if (clientId.startsWith("bearer:")) return "bearer";
    if (clientId.startsWith("client:")) return "client";
    return "ip";
  }

  /**
   * Sanitize client ID for logging (hide sensitive parts)
   */
  static sanitizeClientId(clientId: string): string {
    if (clientId.startsWith("api:")) {
      const apiKey = clientId.substring(4);
      if (apiKey.length > 8) {
        return `api:${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`;
      }
      return `api:${apiKey.substring(0, Math.min(4, apiKey.length))}...`;
    }

    if (clientId.startsWith("bearer:")) {
      const token = clientId.substring(7);
      if (token.length > 8) {
        return `bearer:${token.substring(0, 4)}...${token.substring(token.length - 4)}`;
      }
      return `bearer:${token.substring(0, Math.min(4, token.length))}...`;
    }

    // For IP addresses and client IDs, return as-is (they're not sensitive)
    return clientId;
  }

  /**
   * Sanitize user agent string for logging
   */
  static sanitizeUserAgent(userAgent: string): string {
    if (!userAgent || typeof userAgent !== "string") {
      return "unknown";
    }
    // Truncate very long user agent strings
    return userAgent.length > 100 ? `${userAgent.substring(0, 100)}...` : userAgent;
  }
}
