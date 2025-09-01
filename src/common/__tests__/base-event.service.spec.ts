import { BaseEventService } from "../base/base-event.service";
import { Logger } from "@nestjs/common";

// Test implementation of BaseEventService
class TestEventService extends BaseEventService {
  constructor(useEnhancedLogger = false) {
    super("TestEventService", useEnhancedLogger);
  }

  public testEmitWithLogging(event: string, ...args: any[]) {
    return this.emitWithLogging(event, ...args);
  }

  public testAddListenerWithTracking(event: string, listener: (...args: any[]) => void) {
    return this.addListenerWithTracking(event, listener);
  }

  public testRemoveListenerWithTracking(event: string, listener: (...args: any[]) => void) {
    return this.removeListenerWithTracking(event, listener);
  }

  public testRemoveAllListenersWithLogging(event?: string) {
    return this.removeAllListenersWithLogging(event);
  }

  public testGetEventStats() {
    return this.getEventStats();
  }

  public testLogEventStats() {
    return this.logEventStats();
  }

  public testCleanup() {
    return this.cleanup();
  }
}

describe("BaseEventService", () => {
  let service: TestEventService;
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    service = new TestEventService();
    loggerSpy = jest.spyOn(Logger.prototype, "log").mockImplementation();
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    jest.spyOn(Logger.prototype, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should create logger with service name", () => {
      expect(service["logger"]).toBeInstanceOf(Logger);
    });

    it("should create enhanced logger when requested", () => {
      const serviceWithEnhanced = new TestEventService(true);
      expect(serviceWithEnhanced["enhancedLogger"]).toBeDefined();
    });

    it("should not create enhanced logger by default", () => {
      expect(service["enhancedLogger"]).toBeUndefined();
    });

    it("should set max listeners to 20", () => {
      expect(service.getMaxListeners()).toBe(20);
    });
  });

  describe("emitWithLogging", () => {
    it("should emit event with logging", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      const listener = jest.fn();

      service.on("test-event", listener);
      const result = service.testEmitWithLogging("test-event", "arg1", "arg2");

      expect(result).toBe(true);
      expect(listener).toHaveBeenCalledWith("arg1", "arg2");
      expect(debugSpy).toHaveBeenCalledWith("Emitting event: test-event", { args: ["arg1", "arg2"] });
    });

    it("should return false when no listeners", () => {
      const result = service.testEmitWithLogging("no-listeners");
      expect(result).toBe(false);
    });
  });

  describe("addListenerWithTracking", () => {
    it("should add listener with tracking and logging", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      const listener = jest.fn();

      service.testAddListenerWithTracking("test-event", listener);

      expect(debugSpy).toHaveBeenCalledWith("Adding listener for event: test-event");
      expect(service.listenerCount("test-event")).toBe(1);

      // Test that the listener works
      service.emit("test-event", "test-data");
      expect(listener).toHaveBeenCalledWith("test-data");
    });

    it("should track multiple listeners for same event", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      service.testAddListenerWithTracking("test-event", listener1);
      service.testAddListenerWithTracking("test-event", listener2);

      expect(service.listenerCount("test-event")).toBe(2);

      const stats = service.testGetEventStats();
      expect(stats["test-event"]).toBe(2);
    });
  });

  describe("removeListenerWithTracking", () => {
    it("should remove listener with tracking and logging", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      const listener = jest.fn();

      service.testAddListenerWithTracking("test-event", listener);
      service.testRemoveListenerWithTracking("test-event", listener);

      expect(debugSpy).toHaveBeenCalledWith("Removing listener for event: test-event");
      expect(service.listenerCount("test-event")).toBe(0);
    });

    it("should update tracking when removing listeners", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      service.testAddListenerWithTracking("test-event", listener1);
      service.testAddListenerWithTracking("test-event", listener2);
      service.testRemoveListenerWithTracking("test-event", listener1);

      const stats = service.testGetEventStats();
      expect(stats["test-event"]).toBe(1);
    });
  });

  describe("removeAllListenersWithLogging", () => {
    it("should remove all listeners for specific event", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      service.testAddListenerWithTracking("test-event", listener1);
      service.testAddListenerWithTracking("test-event", listener2);
      service.testAddListenerWithTracking("other-event", listener1);

      service.testRemoveAllListenersWithLogging("test-event");

      expect(debugSpy).toHaveBeenCalledWith("Removing all listeners for event: test-event");
      expect(service.listenerCount("test-event")).toBe(0);
      expect(service.listenerCount("other-event")).toBe(1);

      const stats = service.testGetEventStats();
      expect(stats["test-event"]).toBeUndefined();
      expect(stats["other-event"]).toBe(1);
    });

    it("should remove all listeners for all events", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      const listener = jest.fn();

      service.testAddListenerWithTracking("event1", listener);
      service.testAddListenerWithTracking("event2", listener);

      service.testRemoveAllListenersWithLogging();

      expect(debugSpy).toHaveBeenCalledWith("Removing all listeners for all events");
      expect(service.listenerCount("event1")).toBe(0);
      expect(service.listenerCount("event2")).toBe(0);

      const stats = service.testGetEventStats();
      expect(Object.keys(stats)).toHaveLength(0);
    });
  });

  describe("getEventStats", () => {
    it("should return event listener statistics", () => {
      const listener = jest.fn();

      service.testAddListenerWithTracking("event1", listener);
      service.testAddListenerWithTracking("event1", listener);
      service.testAddListenerWithTracking("event2", listener);

      const stats = service.testGetEventStats();

      expect(stats).toEqual({
        event1: 2,
        event2: 1,
      });
    });

    it("should return empty object when no listeners", () => {
      const stats = service.testGetEventStats();
      expect(stats).toEqual({});
    });
  });

  describe("logEventStats", () => {
    it("should log event statistics", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      const listener = jest.fn();

      service.testAddListenerWithTracking("test-event", listener);
      service.testLogEventStats();

      expect(debugSpy).toHaveBeenCalledWith("Event listener statistics:", { "test-event": 1 });
    });
  });

  describe("error handling", () => {
    it("should handle EventEmitter errors", () => {
      const errorSpy = jest.spyOn(Logger.prototype, "error");
      const testError = new Error("Test error");

      service.emit("error", testError);

      expect(errorSpy).toHaveBeenCalledWith("[EventEmitter] Test error", testError.stack, undefined);
    });

    it("should warn about max listeners exceeded", () => {
      const warnSpy = jest.spyOn(Logger.prototype, "warn");

      // Add more than max listeners
      for (let i = 0; i < 25; i++) {
        service.on("test-event", () => {});
      }

      // This should trigger the warning
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Max listeners exceeded for event: test-event"),
        "EventEmitter"
      );
    });
  });

  describe("cleanup", () => {
    it("should cleanup all listeners and log", () => {
      const debugSpy = jest.spyOn(Logger.prototype, "debug");
      const listener = jest.fn();

      service.testAddListenerWithTracking("event1", listener);
      service.testAddListenerWithTracking("event2", listener);

      service.testCleanup();

      expect(debugSpy).toHaveBeenCalledWith("Cleaning up event listeners");
      expect(service.listenerCount("event1")).toBe(0);
      expect(service.listenerCount("event2")).toBe(0);

      const stats = service.testGetEventStats();
      expect(Object.keys(stats)).toHaveLength(0);
    });
  });

  describe("event tracking", () => {
    it("should track listeners added via standard on() method", () => {
      const listener = jest.fn();

      service.on("test-event", listener);

      const stats = service.testGetEventStats();
      expect(stats["test-event"]).toBe(1);
    });

    it("should track listeners removed via standard off() method", () => {
      const listener = jest.fn();

      service.on("test-event", listener);
      service.off("test-event", listener);

      const stats = service.testGetEventStats();
      expect(stats["test-event"]).toBeUndefined();
    });
  });

  describe("enhanced logging integration", () => {
    it("should use enhanced logger when enabled", () => {
      const serviceWithEnhanced = new TestEventService(true);
      const enhancedLoggerSpy = jest.spyOn(serviceWithEnhanced["enhancedLogger"]!, "error").mockImplementation();

      const testError = new Error("Test error");
      serviceWithEnhanced["logError"](testError, "test-context");

      expect(enhancedLoggerSpy).toHaveBeenCalledWith("[test-context] Test error", undefined);
    });
  });
});
