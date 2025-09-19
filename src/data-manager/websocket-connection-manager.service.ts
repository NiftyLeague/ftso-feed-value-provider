import WebSocket from "ws";
import { Injectable } from "@nestjs/common";
import { EventDrivenService } from "@/common/base/composed.service";
import type { WSConnectionConfig, WSConnectionStats } from "@/common/types/data-manager";
import { ENV, ENV_HELPERS } from "@/config/environment.constants";

@Injectable()
export class WebSocketConnectionManager extends EventDrivenService {
  private connections = new Map<string, WebSocket>();
  private connectionConfigs = new Map<string, WSConnectionConfig>();
  private connectionStats = new Map<string, WSConnectionStats>();
  private pingTimers = new Map<string, NodeJS.Timeout>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();

  // Rate limiting for error logging
  private errorLastLogged = new Map<string, number>();
  private readonly ERROR_COOLDOWN_MS = ENV.WEBSOCKET.ERROR_COOLDOWN_MS;

  constructor() {
    super({
      pingInterval: ENV.WEBSOCKET.PING_INTERVAL_MS,
      pongTimeout: ENV.WEBSOCKET.PONG_TIMEOUT_MS,
      reconnectDelay: ENV.WEBSOCKET.RECONNECT_DELAY_MS,
      maxReconnectAttempts: ENV.WEBSOCKET.MAX_RECONNECT_ATTEMPTS,
    });
  }

  /**
   * Get the typed configuration for this service
   */
  private get wsConfig(): Partial<WSConnectionConfig> {
    return this.config as Partial<WSConnectionConfig>;
  }

  async createConnection(connectionId: string, config: WSConnectionConfig): Promise<void> {
    try {
      this.logger.log(`Creating WebSocket connection: ${connectionId}`);

      // Store configuration
      const fullConfig = { ...this.wsConfig, ...config };
      this.connectionConfigs.set(connectionId, fullConfig);

      // Initialize stats
      this.connectionStats.set(connectionId, {
        connectionId,
        reconnectAttempts: 0,
        messagesReceived: 0,
        messagesSent: 0,
        bytesReceived: 0,
        bytesSent: 0,
        totalMessages: 0,
        totalErrors: 0,
        wsState: "connecting",
      });

      // Check for existing 429 errors and apply backoff (skip in test mode)
      if (!ENV_HELPERS.isTest()) {
        const existingStats = this.connectionStats.get(connectionId);
        if (existingStats?.lastError?.message.includes("429")) {
          const timeSinceLastError = Date.now() - (existingStats.lastErrorAt || 0);
          const backoffDelay = Math.min(
            ENV.WEBSOCKET.MAX_BACKOFF_MS,
            5000 * Math.pow(3, existingStats.reconnectAttempts)
          );

          if (timeSinceLastError < backoffDelay) {
            const remainingDelay = backoffDelay - timeSinceLastError;
            this.logger.warn(`Rate limited (429) for ${connectionId}, waiting ${remainingDelay}ms before connection`);
            await new Promise(resolve => setTimeout(resolve, remainingDelay));
          }
        }
      }

      await this.connect(connectionId);
    } catch (error) {
      // Re-throw after mixin handling for caller awareness
      throw error;
    }
  }

  async closeConnection(connectionId: string, code?: number, reason?: string): Promise<void> {
    this.logger.log(`Closing WebSocket connection: ${connectionId}`, { code, reason });

    // Clear timers
    this.clearTimers(connectionId);

    // Close WebSocket
    const ws = this.connections.get(connectionId);
    if (ws) {
      ws.close(code ?? 1000, reason ?? "Normal closure");
      this.connections.delete(connectionId);
    }

    // Clean up
    this.connectionConfigs.delete(connectionId);
    this.connectionStats.delete(connectionId);

    this.emit("connectionClosed", connectionId);
  }

  isConnected(connectionId: string): boolean {
    const ws = this.connections.get(connectionId);
    return ws?.readyState === WebSocket.OPEN;
  }

  getLatency(connectionId: string): number {
    const stats = this.connectionStats.get(connectionId);
    if (!stats || !stats.lastPingAt || !stats.lastPongAt) {
      return 0;
    }

    // Only return latency if we have a valid pong that came after the ping
    return stats.lastPongAt >= stats.lastPingAt ? stats.lastPongAt - stats.lastPingAt : 0;
  }

  async sendMessage(connectionId: string, message: string | Buffer): Promise<boolean> {
    const ws = this.connections.get(connectionId);
    const stats = this.connectionStats.get(connectionId);

    if (!ws || ws.readyState !== WebSocket.OPEN || !stats) {
      return false;
    }

    const result = await this.executeWithErrorHandling(
      async () => {
        ws.send(message);
        stats.messagesSent++;
        stats.bytesSent += Buffer.isBuffer(message) ? message.length : Buffer.byteLength(message);
        return true;
      },
      `websocket_send_${connectionId}`,
      {
        retries: 1,
        shouldThrow: false,
        fallback: async () => false,
      }
    );

    return result ?? false;
  }

  getConnectionStats(connectionId: string): WSConnectionStats | undefined {
    return this.connectionStats.get(connectionId);
  }

  getAllConnectionStats(): Map<string, WSConnectionStats> {
    return new Map(this.connectionStats);
  }

  private async connect(connectionId: string): Promise<void> {
    const config = this.connectionConfigs.get(connectionId);
    const stats = this.connectionStats.get(connectionId);

    if (!config || !stats) {
      throw new Error(`Configuration not found for connection ${connectionId}`);
    }

    // Check if we should delay connection due to 429 rate limiting (skip in test mode)
    if (!ENV_HELPERS.isTest() && stats.lastError && stats.lastError.message.includes("429")) {
      const timeSinceLastError = Date.now() - (stats.lastErrorAt || 0);
      const backoffDelay = Math.min(300000, 5000 * Math.pow(3, stats.reconnectAttempts)); // Max 5 minutes

      if (timeSinceLastError < backoffDelay) {
        const remainingDelay = backoffDelay - timeSinceLastError;
        this.logger.warn(`Rate limited (429) for ${connectionId}, waiting ${remainingDelay}ms before retry`);
        await new Promise(resolve => setTimeout(resolve, remainingDelay));
      }
    }

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(config.url, config.protocols, {
          headers: config.headers,
        });

        // Set up event handlers
        ws.on("open", () => {
          this.logger.log(`WebSocket connection opened: ${connectionId}`);

          stats.connectedAt = Date.now();
          stats.reconnectAttempts = 0;
          stats.wsState = "open";

          this.connections.set(connectionId, ws);
          this.setupPingPong(connectionId);

          this.emit("connectionOpened", connectionId);
          resolve();
        });

        ws.on("message", (data: WebSocket.Data) => {
          this.handleMessage(connectionId, data);
        });

        ws.on("close", (code: number, reason: string) => {
          this.handleClose(connectionId, code, reason);
        });

        ws.on("error", (error: Error) => {
          // Rate limit error logging to prevent spam
          const now = Date.now();
          const errorKey = `${connectionId}_error`;
          const lastLogged = this.errorLastLogged.get(errorKey) || 0;

          if (now - lastLogged > this.ERROR_COOLDOWN_MS) {
            this.logger.error(`WebSocket error on ${connectionId}:`, error);
            this.errorLastLogged.set(errorKey, now);
          }

          stats.totalErrors++;
          this.emit("connectionError", connectionId, error);

          // Store the error and timestamp for potential reconnection
          stats.lastError = error;
          stats.lastErrorAt = now;

          reject(error);
        });

        ws.on("pong", () => {
          this.handlePong(connectionId);
        });

        // Set connection timeout - increased to 30 seconds for better reliability
        const timeout = setTimeout(() => {
          if (ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
            reject(new Error(`Connection timeout for ${connectionId}`));
          }
        }, ENV.WEBSOCKET.CONNECTION_TIMEOUT_MS);

        ws.on("open", () => clearTimeout(timeout));
        ws.on("error", () => clearTimeout(timeout));
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(connectionId: string, data: WebSocket.Data): void {
    const stats = this.connectionStats.get(connectionId);
    if (stats) {
      stats.messagesReceived++;
      stats.bytesReceived += Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data.toString());
      stats.totalMessages++;
    }

    // Emit message event with parsed data
    try {
      const message = data.toString();
      const parsedData = JSON.parse(message);
      this.emit("message", connectionId, parsedData);
    } catch {
      // If not JSON, emit raw data
      this.emit("message", connectionId, data);
    }
  }

  private handleClose(connectionId: string, code: number, reason: string): void {
    // Rate limit close warnings to prevent spam
    const now = Date.now();
    const closeKey = `${connectionId}_close`;
    const lastLogged = this.errorLastLogged.get(closeKey) || 0;

    if (now - lastLogged > this.ERROR_COOLDOWN_MS) {
      this.logger.warn(`WebSocket connection closed: ${connectionId}, code: ${code}, reason: ${reason}`);
      this.errorLastLogged.set(closeKey, now);
    }

    this.clearTimers(connectionId);
    this.connections.delete(connectionId);
    const stats = this.connectionStats.get(connectionId);
    if (stats) {
      stats.wsState = "closed";
    }

    this.emit("connectionClosed", connectionId, code, reason);

    // Attempt reconnection if not a clean close
    if (code !== 1000) {
      // Create error object with rate limiting info if applicable
      const error = new Error(`Connection closed with code ${code}: ${reason}`);
      const stats = this.connectionStats.get(connectionId);
      if (stats) {
        stats.lastError = error;
        stats.lastErrorAt = Date.now();
      }
      this.scheduleReconnection(connectionId, error);
    }
  }

  private handlePong(connectionId: string): void {
    const stats = this.connectionStats.get(connectionId);
    if (stats) {
      stats.lastPongAt = Date.now();
    }
  }

  private setupPingPong(connectionId: string): void {
    const config = this.connectionConfigs.get(connectionId);
    if (!config?.pingInterval) return;

    const pingTimer = setInterval(() => {
      const ws = this.connections.get(connectionId);
      const stats = this.connectionStats.get(connectionId);

      if (!ws || ws.readyState !== WebSocket.OPEN || !stats) {
        this.clearTimers(connectionId);
        return;
      }

      // Check if previous pong was received
      if (
        stats.lastPingAt &&
        stats.lastPongAt &&
        stats.lastPingAt > stats.lastPongAt &&
        Date.now() - stats.lastPingAt > (config.pongTimeout || 10000)
      ) {
        this.logger.warn(`Pong timeout for connection ${connectionId}, terminating`);
        ws.terminate();
        return;
      }

      // Send ping
      stats.lastPingAt = Date.now();
      ws.ping();
    }, config.pingInterval);

    this.pingTimers.set(connectionId, pingTimer);
  }

  private scheduleReconnection(connectionId: string, lastError?: Error): void {
    const config = this.connectionConfigs.get(connectionId);
    const stats = this.connectionStats.get(connectionId);

    if (!config || !stats) return;

    if (stats.reconnectAttempts >= (config.maxReconnectAttempts || 10)) {
      this.logger.error(`Max reconnection attempts reached for ${connectionId}`);
      this.emit("maxReconnectAttemptsReached", connectionId);
      return;
    }

    // Use stored error if no error provided
    const error = lastError || stats.lastError;

    // Special handling for 429 (rate limiting) errors
    let delay = config.reconnectDelay || 5000;
    if (error && error.message.includes("429")) {
      // For 429 errors, use exponential backoff with longer delays
      delay = Math.min(300000, delay * Math.pow(3, stats.reconnectAttempts)); // Max 5 minutes
      this.logger.warn(`Rate limited (429) for ${connectionId}, using extended backoff: ${delay}ms`);
    } else {
      // Standard exponential backoff for other errors
      delay = delay * Math.pow(2, stats.reconnectAttempts);
    }

    stats.reconnectAttempts++;

    this.logger.log(`Scheduling reconnection for ${connectionId} in ${delay}ms (attempt ${stats.reconnectAttempts})`);

    const reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(connectionId);
      } catch {
        // Don't log errors here as they'll be handled by the connect method
        // This prevents duplicate error logging
      }
      // Will trigger another reconnection attempt via the close handler if needed
    }, delay);

    this.reconnectTimers.set(connectionId, reconnectTimer);
  }

  private clearTimers(connectionId: string): void {
    const pingTimer = this.pingTimers.get(connectionId);
    if (pingTimer) {
      clearInterval(pingTimer);
      this.pingTimers.delete(connectionId);
    }

    const reconnectTimer = this.reconnectTimers.get(connectionId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.reconnectTimers.delete(connectionId);
    }
  }

  /**
   * Cleanup method to prevent memory leaks
   */
  destroy(): void {
    // Clear all timers
    for (const timer of this.pingTimers.values()) {
      clearInterval(timer);
    }
    this.pingTimers.clear();

    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Close all connections
    for (const [, ws] of this.connections.entries()) {
      try {
        ws.close(1000, "Service shutdown");
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.connections.clear();

    // Clear all maps
    this.connectionConfigs.clear();
    this.connectionStats.clear();
    this.errorLastLogged.clear();

    // Remove all event listeners
    this.removeAllListeners();
  }
}
