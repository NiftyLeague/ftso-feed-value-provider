/**
 * Client identification type definitions
 */

export interface ClientInfo {
  id: string;
  type: "api" | "bearer" | "client" | "ip";
  sanitized: string;
}
