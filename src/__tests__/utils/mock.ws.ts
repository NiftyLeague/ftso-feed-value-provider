type WsEventName = "open" | "close" | "error" | "message" | "pong";

type WsHandler = (...args: unknown[]) => void;

class MockWs {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  CONNECTING = MockWs.CONNECTING;
  OPEN = MockWs.OPEN;
  CLOSING = MockWs.CLOSING;
  CLOSED = MockWs.CLOSED;

  readyState = MockWs.OPEN;
  url = "ws://test.example.com";
  protocol = "";
  extensions = "";
  bufferedAmount = 0;

  private handlers = new Map<WsEventName, Set<WsHandler>>();

  constructor(_url?: string, _protocols?: unknown, _options?: unknown) {
    // Default to open immediately.
    queueMicrotask(() => this.emit("open"));
  }

  on(event: WsEventName, handler: WsHandler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return this;
  }

  off(event: WsEventName, handler?: WsHandler) {
    if (!handler) {
      this.handlers.delete(event);
      return this;
    }
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  emit(event: WsEventName, ...args: unknown[]) {
    this.handlers.get(event)?.forEach(h => {
      try {
        h(...args);
      } catch {
        // ignore
      }
    });
  }

  send = jest.fn((_data?: unknown) => {
    // noop
  });

  ping = jest.fn(() => {
    // noop
  });

  terminate = jest.fn(() => {
    this.readyState = MockWs.CLOSED;
    this.emit("close", 1000, "terminated");
  });

  close = jest.fn((_code?: number, _reason?: string) => {
    this.readyState = MockWs.CLOSED;
    this.emit("close", _code ?? 1000, _reason ?? "");
  });
}

export default MockWs;
export { MockWs };
