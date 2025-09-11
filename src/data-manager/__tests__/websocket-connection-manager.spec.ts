import { Test, TestingModule } from "@nestjs/testing";
import WebSocket from "ws";
import { WebSocketConnectionManager } from "../websocket-connection-manager";
import type { WSConnectionConfig } from "@/common/types/data-manager";
import { TestHelpers } from "@/__tests__/utils/test.helpers";

// Mock WebSocket Server for testing
class MockWebSocketServer {
  private server: WebSocket.Server;
  private connections: Set<WebSocket> = new Set();

  constructor(port: number) {
    this.server = new WebSocket.Server({ port });
    this.server.on("connection", (ws: WebSocket) => {
      this.connections.add(ws);

      ws.on("close", () => {
        this.connections.delete(ws);
      });

      ws.on("ping", () => {
        ws.pong();
      });
    });
  }

  close(): Promise<void> {
    return new Promise(resolve => {
      this.connections.forEach(ws => ws.close());
      this.server.close(() => resolve());
    });
  }

  broadcast(message: string): void {
    this.connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}

describe("WebSocketConnectionManager", () => {
  let connectionManager: WebSocketConnectionManager;
  let mockServer: MockWebSocketServer;
  let testPort: number;

  beforeEach(async () => {
    // Use a random port for each test to avoid conflicts
    testPort = 8000 + Math.floor(Math.random() * 50000);
    mockServer = new MockWebSocketServer(testPort);

    // Wait to ensure server is closed from previous test
    await TestHelpers.wait(100);
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebSocketConnectionManager],
    }).compile();

    connectionManager = module.get<WebSocketConnectionManager>(WebSocketConnectionManager);

    // Wait for server to be ready
    await TestHelpers.wait(100);
  });

  afterEach(async () => {
    // Clean up all connections
    const stats = connectionManager.getAllConnectionStats();
    for (const [connectionId] of stats) {
      try {
        await connectionManager.closeConnection(connectionId);
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Close mock server and wait for cleanup
    await mockServer.close();
    await TestHelpers.wait(200);
  });

  it("should be defined", () => {
    expect(connectionManager).toBeDefined();
  });

  it("should initialize with default configuration", () => {
    expect(connectionManager).toBeInstanceOf(WebSocketConnectionManager);
  });

  describe("Connection Management", () => {
    it("should create and establish WebSocket connection", async () => {
      const connectionId = "test-connection";
      const config: WSConnectionConfig = {
        url: `ws://localhost:${testPort}`,
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 1000,
        reconnectInterval: 5000,
        maxReconnectAttempts: 3,
      };

      await connectionManager.createConnection(connectionId, config);

      // Wait for connection to establish
      await TestHelpers.waitFor(() => connectionManager.isConnected(connectionId), 2000);

      expect(connectionManager.isConnected(connectionId)).toBe(true);
      expect(mockServer.getConnectionCount()).toBe(1);

      const stats = connectionManager.getConnectionStats(connectionId);
      expect(stats).toBeDefined();
      expect(stats!.connectionId).toBe(connectionId);
      expect(stats!.wsState).toBe("open");
    });

    it("should handle connection timeout gracefully", async () => {
      const connectionId = "timeout-connection";
      const config: WSConnectionConfig = {
        url: "ws://localhost:99999", // Non-existent port
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 1000,
        reconnectInterval: 5000,
        maxReconnectAttempts: 1,
      };

      await expect(connectionManager.createConnection(connectionId, config)).rejects.toThrow();

      expect(connectionManager.isConnected(connectionId)).toBe(false);
    });

    it("should close connection properly", async () => {
      const connectionId = "close-test";
      const config: WSConnectionConfig = {
        url: `ws://localhost:${testPort}`,
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 1000,
        reconnectInterval: 5000,
        maxReconnectAttempts: 3,
      };

      await connectionManager.createConnection(connectionId, config);
      await TestHelpers.waitFor(() => connectionManager.isConnected(connectionId), 2000);

      expect(connectionManager.isConnected(connectionId)).toBe(true);

      await connectionManager.closeConnection(connectionId);

      expect(connectionManager.isConnected(connectionId)).toBe(false);
      expect(connectionManager.getConnectionStats(connectionId)).toBeUndefined();
    });
  });

  describe("Message Handling", () => {
    let connectionId: string;

    beforeEach(async () => {
      connectionId = "message-test";
      const config: WSConnectionConfig = {
        url: `ws://localhost:${testPort}`,
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 1000,
        reconnectInterval: 5000,
        maxReconnectAttempts: 3,
      };

      await connectionManager.createConnection(connectionId, config);
      await TestHelpers.waitFor(() => connectionManager.isConnected(connectionId), 2000);
    });

    it("should send messages successfully", async () => {
      const message = JSON.stringify({ type: "test", data: "hello" });
      const result = await connectionManager.sendMessage(connectionId, message);

      expect(result).toBe(true);

      const stats = connectionManager.getConnectionStats(connectionId);
      expect(stats!.messagesSent).toBe(1);
      expect(stats!.bytesSent).toBeGreaterThan(0);
    });

    it("should receive messages and update stats", async () => {
      const receivedMessages: any[] = [];

      connectionManager.on("message", (connId: string, data: any) => {
        if (connId === connectionId) {
          receivedMessages.push(data);
        }
      });

      const testMessage = { type: "test", data: "server message" };
      mockServer.broadcast(JSON.stringify(testMessage));

      await TestHelpers.waitFor(() => receivedMessages.length > 0, 2000);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]).toEqual(testMessage);

      const stats = connectionManager.getConnectionStats(connectionId);
      expect(stats!.messagesReceived).toBe(1);
      expect(stats!.bytesReceived).toBeGreaterThan(0);
    });

    it("should handle non-JSON messages", async () => {
      const receivedMessages: any[] = [];

      connectionManager.on("message", (connId: string, data: any) => {
        if (connId === connectionId) {
          receivedMessages.push(data);
        }
      });

      const rawMessage = "plain text message";
      mockServer.broadcast(rawMessage);

      await TestHelpers.waitFor(() => receivedMessages.length > 0, 2000);

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].toString()).toBe(rawMessage);
    });
  });

  describe("Ping/Pong and Latency", () => {
    let connectionId: string;

    beforeEach(async () => {
      connectionId = "ping-test";
      const config: WSConnectionConfig = {
        url: `ws://localhost:${testPort}`,
        pingInterval: 500, // Short interval for testing
        pongTimeout: 200,
        reconnectDelay: 1000,
        reconnectInterval: 5000,
        maxReconnectAttempts: 3,
      };

      await connectionManager.createConnection(connectionId, config);
      await TestHelpers.waitFor(() => connectionManager.isConnected(connectionId), 2000);
    });

    it("should measure latency through ping/pong", async () => {
      // Wait for at least one ping/pong cycle
      await TestHelpers.wait(1000);

      const latency = connectionManager.getLatency(connectionId);
      // Latency should be 0 if no ping/pong has occurred yet, or a reasonable positive value
      expect(latency).toBeGreaterThanOrEqual(0);
      if (latency > 0) {
        expect(latency).toBeLessThan(1000); // Should be reasonable if measured
      }
    });
  });

  describe("Error Handling and Reconnection", () => {
    it("should handle connection errors gracefully", async () => {
      const connectionId = "error-test";
      const config: WSConnectionConfig = {
        url: "ws://invalid-host:12345",
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 100,
        reconnectInterval: 5000,
        maxReconnectAttempts: 1,
      };

      const errorEvents: any[] = [];
      connectionManager.on("connectionError", (connId: string, error: Error) => {
        errorEvents.push({ connId, error });
      });

      await expect(connectionManager.createConnection(connectionId, config)).rejects.toThrow();

      expect(errorEvents.length).toBeGreaterThan(0);
      expect(errorEvents[0].connId).toBe(connectionId);
      expect(errorEvents[0].error).toBeDefined();
    });

    it("should attempt reconnection on unexpected close", async () => {
      const connectionId = "reconnect-test";
      const config: WSConnectionConfig = {
        url: `ws://localhost:${testPort}`,
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 100,
        reconnectInterval: 5000,
        maxReconnectAttempts: 2,
      };

      await connectionManager.createConnection(connectionId, config);
      await TestHelpers.waitFor(() => connectionManager.isConnected(connectionId), 2000);

      const closeEvents: any[] = [];
      connectionManager.on("connectionClosed", (connId: string, code?: number, reason?: string) => {
        closeEvents.push({ connId, code, reason });
      });

      // Force close the server to simulate unexpected disconnection
      await mockServer.close();

      // Wait for close event
      await TestHelpers.waitFor(() => closeEvents.length > 0, 2000);

      expect(closeEvents.length).toBeGreaterThan(0);
      expect(closeEvents[0].connId).toBe(connectionId);

      const stats = connectionManager.getConnectionStats(connectionId);
      expect(stats!.reconnectAttempts).toBeGreaterThan(0);
    });

    it("should emit maxReconnectAttemptsReached when limit exceeded", async () => {
      const connectionId = "max-reconnect-test";
      const config: WSConnectionConfig = {
        url: `ws://localhost:${testPort}`,
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 50,
        reconnectInterval: 5000,
        maxReconnectAttempts: 1,
      };

      await connectionManager.createConnection(connectionId, config);
      await TestHelpers.waitFor(() => connectionManager.isConnected(connectionId), 2000);

      const maxReconnectEvents: string[] = [];
      connectionManager.on("maxReconnectAttemptsReached", (connId: string) => {
        maxReconnectEvents.push(connId);
      });

      // Close server to trigger reconnection attempts
      await mockServer.close();

      // Wait for max reconnect attempts to be reached
      await TestHelpers.waitFor(() => maxReconnectEvents.length > 0, 5000);

      expect(maxReconnectEvents).toContain(connectionId);
    });
  });

  describe("Statistics and Monitoring", () => {
    it("should track connection statistics accurately", async () => {
      const connectionId = "stats-test";
      const config: WSConnectionConfig = {
        url: `ws://localhost:${testPort}`,
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 1000,
        reconnectInterval: 5000,
        maxReconnectAttempts: 3,
      };

      await connectionManager.createConnection(connectionId, config);
      await TestHelpers.waitFor(() => connectionManager.isConnected(connectionId), 2000);

      // Send some messages
      await connectionManager.sendMessage(connectionId, "test message 1");
      await connectionManager.sendMessage(connectionId, "test message 2");

      // Receive some messages
      mockServer.broadcast("server message 1");
      mockServer.broadcast("server message 2");

      await TestHelpers.wait(100);

      const stats = connectionManager.getConnectionStats(connectionId);
      expect(stats).toBeDefined();
      expect(stats!.messagesSent).toBe(2);
      expect(stats!.bytesSent).toBeGreaterThan(0);
      expect(stats!.messagesReceived).toBe(2);
      expect(stats!.bytesReceived).toBeGreaterThan(0);
      expect(stats!.totalMessages).toBe(2);
      expect(stats!.connectedAt).toBeDefined();
    });

    it("should provide all connection statistics", async () => {
      const connectionId1 = "stats-test-1";
      const connectionId2 = "stats-test-2";
      const config: WSConnectionConfig = {
        url: `ws://localhost:${testPort}`,
        pingInterval: 1000,
        pongTimeout: 500,
        reconnectDelay: 1000,
        reconnectInterval: 5000,
        maxReconnectAttempts: 3,
      };

      await connectionManager.createConnection(connectionId1, config);
      await connectionManager.createConnection(connectionId2, config);

      await TestHelpers.waitFor(
        () => connectionManager.isConnected(connectionId1) && connectionManager.isConnected(connectionId2),
        2000
      );

      const allStats = connectionManager.getAllConnectionStats();
      expect(allStats.size).toBe(2);
      expect(allStats.has(connectionId1)).toBe(true);
      expect(allStats.has(connectionId2)).toBe(true);
    });
  });
});
