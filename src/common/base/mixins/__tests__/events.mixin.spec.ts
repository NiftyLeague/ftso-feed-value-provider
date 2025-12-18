import { WithEvents } from "../events.mixin";

class TestBase {
  public logDebug = jest.fn();
  public logWarning = jest.fn();
  public logError = jest.fn();
}

class EventedService extends WithEvents(TestBase) {}

describe("WithEvents mixin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("tracks listeners for string events and untracks on off", () => {
    const svc = new EventedService();

    const handler = jest.fn();
    svc.on("evt", handler);

    expect(svc.getEventStats()).toEqual({ evt: 1 });

    svc.off("evt", handler);
    expect(svc.getEventStats()).toEqual({});
  });

  it("logs and emits when max listeners exceeded", () => {
    const svc = new EventedService();

    // make it easy to exceed
    svc.setMaxListeners(1);

    const exceededHandler = jest.fn();
    svc.on("maxListenersExceeded", exceededHandler);

    // add multiple listeners for same string event; after second listener, we should exceed max
    svc.on("evt", () => undefined);
    svc.on("evt", () => undefined);

    expect(svc.logWarning).toHaveBeenCalledWith("Max listeners exceeded for event: evt", "EventEmitter");
    expect(exceededHandler).toHaveBeenCalledWith("evt");
  });

  it("emitWithLogging logs debug and emits event", () => {
    const svc = new EventedService();

    const handler = jest.fn();
    svc.on("evt", handler);

    const emitted = svc.emitWithLogging("evt", 1, "a");

    expect(emitted).toBe(true);
    expect(svc.logDebug).toHaveBeenCalledWith("Emitting event: evt", undefined, { args: [1, "a"] });
    expect(handler).toHaveBeenCalledWith(1, "a");
  });

  it("registers an error handler on the internal emitter", () => {
    const svc = new EventedService();

    const err = new Error("boom");
    svc.eventEmitter.emit("error", err);

    expect(svc.logError).toHaveBeenCalledWith(err, "EventEmitter");
  });
});
