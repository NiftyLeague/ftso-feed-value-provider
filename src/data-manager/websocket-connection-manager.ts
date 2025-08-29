import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter } from "events";
import WebSocket from "ws";

export interface WebSocketConnectionConfig {
  url: string;
  protocols?: string[];
  headers?: Record<string, string>;
  pingInterval?: number;
  pongTimeout?: number;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export interface ConnectionStats {
  connectedAt?: number;
  lastPingAt?: number;
  lastPongAt?: number;
  reconnectAttempts: number;
  messagesReceived: number;
  messagesSent: number;
  bytesReceived: number;
  bytesSent: number;
}

@Injectable()
export class WebSocketConnectionManager extends EventEmitter {
  private readonly logger = new Logger(WebSocketConnectionManager.name);

  private connections = new Map<string, WebSocket>();
  private connectionConfigs = new Map<string, WebSocketConnectionConfig>();
  private connectionStats = new Map<string, ConnectionStats>();
  private pingTimers = new Map<string, NodeJS.Timeout>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();

  private readonly defaultConfig: Partial<WebSocketConnectionConfig> = {
    pingInterval: 30000, // 30 seconds
    pongTimeout: 10000, // 10 seconds
    reconnectDelay: 5000, // 5 seconds
    maxReconnectAttempts: 10,
  };

  async createConnection(connectionId: string, config: WebSocketConnectionConfig): Promise<void> {
    try {
      this.logger.log(`Creating WebSocket connection: ${connectionId}`);

      // Store configuration
      const fullConfig = { ...this.defaultConfig, ...config };
      this.connectionConfigs.set(connectionId, fullConfig);

      // Initialize stats
      this.connectionStats.set(connectionId, {
        reconnectAttempts: 0,
        messagesReceived: 0,
        messagesSent: 0,
        bytesReceived: 0,
        bytesSent: 0,
      });

      await this.connect(connectionId);
    } catch (error) {
      this.logger.error(`Failed to create connection ${connectionId}:`, error);
      throw error;
    }
  }

  async closeConnection(connectionId: string): Promise<void> {
    this.logger.log(`Closing WebSocket connection: ${connectionId}`);

    // Clear timers
    this.clearTimers(connectionId);

    // Close WebSocket
    const ws = this.connections.get(connectionId);
    if (ws) {
      ws.close(1000, "Connection closed by client");
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

    return stats.lastPongAt - stats.lastPingAt;
  }

  sendMessage(connectionId: string, message: string | Buffer): boolean {
    const ws = this.connections.get(connectionId);
    const stats = this.connectionStats.get(connectionId);

    if (!ws || ws.readyState !== WebSocket.OPEN || !stats) {
      return false;
    }

    try {
      ws.send(message);
      stats.messagesSent++;
      stats.bytesSent += Buffer.isBuffer(message) ? message.length : Buffer.byteLength(message);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send message on ${connectionId}:`, error);
      return false;
    }
  }

  getConnectionStats(connectionId: string): ConnectionStats | undefined {
    return this.connectionStats.get(connectionId);
  }

  getAllConnectionStats(): Map<string, ConnectionStats> {
    return new Map(this.connectionStats);
  }

  private async connect(connectionId: string): Promise<void> {
    const config = this.connectionConfigs.get(connectionId);
    const stats = this.connectionStats.get(connectionId);

    if (!config || !stats) {
      throw new Error(`Configuration not found for connection ${connectionId}`);
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
          this.logger.error(`WebSocket error on ${connectionId}:`, error);
          this.emit("connectionError", connectionId, error);
          reject(error);
        });

        ws.on("pong", () => {
          this.handlePong(connectionId);
        });

        // Set connection timeout
        const timeout = setTimeout(() => {
          if (ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
            reject(new Error(`Connection timeout for ${connectionId}`));
          }
        }, 10000); // 10 second timeout

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
    this.logger.warn(`WebSocket connection closed: ${connectionId}, code: ${code}, reason: ${reason}`);

    this.clearTimers(connectionId);
    this.connections.delete(connectionId);

    this.emit("connectionClosed", connectionId, code, reason);

    // Attempt reconnection if not a clean close
    if (code !== 1000) {
      this.scheduleReconnection(connectionId);
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

  private scheduleReconnection(connectionId: string): void {
    const config = this.connectionConfigs.get(connectionId);
    const stats = this.connectionStats.get(connectionId);

    if (!config || !stats) return;

    if (stats.reconnectAttempts >= (config.maxReconnectAttempts || 10)) {
      this.logger.error(`Max reconnection attempts reached for ${connectionId}`);
      this.emit("maxReconnectAttemptsReached", connectionId);
      return;
    }

    const delay = (config.reconnectDelay || 5000) * Math.pow(2, stats.reconnectAttempts);
    stats.reconnectAttempts++;

    this.logger.log(`Scheduling reconnection for ${connectionId} in ${delay}ms (attempt ${stats.reconnectAttempts})`);

    const reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(connectionId);
      } catch (error) {
        this.logger.error(`Reconnection failed for ${connectionId}:`, error);
        // Will trigger another reconnection attempt via the close handler
      }
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
}
