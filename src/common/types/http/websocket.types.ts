export interface WebSocketEventData {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface WebSocketErrorEvent {
  type: "error";
  error: Error;
  timestamp: number;
  connectionId: string;
}

export interface WebSocketMessageEvent {
  type: "message";
  data: string | Buffer | ArrayBuffer;
  timestamp: number;
  connectionId: string;
}

export interface WebSocketConnectionEvent {
  type: "connection" | "disconnection";
  connectionId: string;
  timestamp: number;
  reason?: string;
}

export interface WebSocketConfig {
  url: string;
  protocols?: string[];
  headers?: Record<string, string>;
  timeout?: number;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export interface WebSocketConnectionOptions {
  autoReconnect: boolean;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  pingInterval: number;
  pongTimeout: number;
  compression: boolean;
}

export interface WebSocketOutgoingMessage {
  type: string;
  payload: Record<string, unknown>;
  id?: string;
  timestamp?: number;
}

export interface WebSocketIncomingMessage {
  type: string;
  payload: Record<string, unknown>;
  id?: string;
  timestamp: number;
  connectionId: string;
}

export interface WebSocketSubscription {
  id: string;
  channel: string;
  params?: Record<string, unknown>;
  callback: (message: WebSocketIncomingMessage) => void;
  active: boolean;
}

export interface WebSocketSubscriptionRequest {
  method: "subscribe" | "unsubscribe";
  params: {
    channels: string[];
  };
  id?: number;
}

export interface WebSocketConnectionState {
  status: "connecting" | "connected" | "disconnecting" | "disconnected" | "error";
  connectedAt?: number;
  disconnectedAt?: number;
  reconnectAttempts: number;
  lastError?: Error;
}

export interface WebSocketMetrics {
  totalConnections: number;
  activeConnections: number;
  totalMessages: number;
  messagesPerSecond: number;
  averageLatency: number;
  errorCount: number;
  reconnectCount: number;
}

export interface WebSocketManagerConfig {
  maxConnections: number;
  connectionTimeout: number;
  messageTimeout: number;
  heartbeatInterval: number;
  enableCompression: boolean;
  enableLogging: boolean;
}

export interface WebSocketConnection {
  id: string;
  url: string;
  state: WebSocketConnectionState;
  subscriptions: Map<string, WebSocketSubscription>;
  metrics: WebSocketConnectionMetrics;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: WebSocketOutgoingMessage): Promise<void>;
  subscribe(subscription: WebSocketSubscription): void;
  unsubscribe(subscriptionId: string): void;
  ping(): Promise<number>; // returns latency
}

export interface WebSocketConnectionMetrics {
  connectionId: string;
  connectedAt?: number;
  lastPingAt?: number;
  lastPongAt?: number;
  latency?: number;
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
  errorCount: number;
}

export interface MockWebSocketConfig {
  autoConnect: boolean;
  simulateLatency: boolean;
  latencyRange: [number, number];
  errorRate: number;
  messageDelay: number;
}

export interface MockWebSocketMessage {
  type: string;
  data: Record<string, unknown>;
  delay?: number;
  shouldError?: boolean;
}

export function isWebSocketMessageEvent(obj: unknown): obj is WebSocketMessageEvent {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    obj.type === "message" &&
    "data" in obj &&
    "timestamp" in obj &&
    "connectionId" in obj
  );
}

export function isWebSocketErrorEvent(obj: unknown): obj is WebSocketErrorEvent {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    obj.type === "error" &&
    "error" in obj &&
    "timestamp" in obj &&
    "connectionId" in obj
  );
}

export function isWebSocketConnectionEvent(obj: unknown): obj is WebSocketConnectionEvent {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    (obj.type === "connection" || obj.type === "disconnection") &&
    "connectionId" in obj &&
    "timestamp" in obj
  );
}

export function isWebSocketSubscription(obj: unknown): obj is WebSocketSubscription {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "id" in obj &&
    "channel" in obj &&
    "callback" in obj &&
    "active" in obj &&
    typeof obj.callback === "function"
  );
}
