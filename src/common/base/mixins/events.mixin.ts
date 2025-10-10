import { EventEmitter } from "events";
import type { Constructor, AbstractConstructor, IBaseService } from "../../types/services";

/**
 * Event handling capabilities
 */
export interface EventCapabilities {
  emit(event: string | symbol, ...args: unknown[]): boolean;
  on<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this;
  once<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this;
  off<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this;
  removeAllListeners(event?: string | symbol): this;
  listenerCount(event: string | symbol): number;
  listeners(event: string | symbol): Function[];
  setMaxListeners(n: number): this;
  getMaxListeners(): number;
  emitWithLogging(event: string, ...args: unknown[]): boolean;
  getEventStats(): Record<string, number>;
  logEventStats(): void;
}

/**
 * Mixin that adds event handling to a service
 */
export function WithEvents<TBase extends Constructor | AbstractConstructor>(Base: TBase) {
  return class EventsMixin extends Base implements EventCapabilities {
    public readonly eventListeners = new Map<string, number>();
    public eventEmitter: EventEmitter;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      this.eventEmitter = new EventEmitter();
      this.setupEventTracking();
    }

    // EventEmitter delegation methods
    emit(event: string | symbol, ...args: unknown[]): boolean {
      return this.eventEmitter.emit(event, ...args);
    }

    on<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this {
      this.eventEmitter.on(event, listener as (...args: unknown[]) => void);
      if (typeof event === "string") {
        this.trackListener(event);

        const currentCount = this.listenerCount(event);
        if (currentCount > this.getMaxListeners()) {
          (this as unknown as IBaseService).logWarning(`Max listeners exceeded for event: ${event}`, "EventEmitter");
          this.eventEmitter.emit("maxListenersExceeded", event);
        }
      }
      return this;
    }

    once<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this {
      this.eventEmitter.once(event, listener as (...args: unknown[]) => void);
      return this;
    }

    off<T extends unknown[]>(event: string | symbol, listener: (...args: T) => void): this {
      this.eventEmitter.off(event, listener as (...args: unknown[]) => void);
      if (typeof event === "string") {
        this.untrackListener(event);
      }
      return this;
    }

    removeAllListeners(event?: string | symbol): this {
      this.eventEmitter.removeAllListeners(event);
      return this;
    }

    listenerCount(event: string | symbol): number {
      return this.eventEmitter.listenerCount(event);
    }

    listeners(event: string | symbol): Function[] {
      return this.eventEmitter.listeners(event);
    }

    setMaxListeners(n: number): this {
      this.eventEmitter.setMaxListeners(n);
      return this;
    }

    getMaxListeners(): number {
      return this.eventEmitter.getMaxListeners();
    }

    emitWithLogging(event: string, ...args: unknown[]): boolean {
      (this as unknown as IBaseService).logDebug(`Emitting event: ${event}`, undefined, { args });
      return this.emit(event, ...args);
    }

    getEventStats(): Record<string, number> {
      return Object.fromEntries(this.eventListeners);
    }

    logEventStats(): void {
      const stats = this.getEventStats();
      (this as unknown as IBaseService).logDebug("Event listener statistics:", undefined, stats);
    }

    public setupEventTracking(): void {
      this.eventEmitter.on("error", (error: Error) => {
        (this as unknown as IBaseService).logError(error, "EventEmitter");
      });

      this.setMaxListeners(20); // Reasonable default
    }

    public trackListener(event: string): void {
      const current = this.eventListeners.get(event) || 0;
      this.eventListeners.set(event, current + 1);
    }

    public untrackListener(event: string): void {
      const current = this.eventListeners.get(event) || 0;
      if (current > 1) {
        this.eventListeners.set(event, current - 1);
      } else {
        this.eventListeners.delete(event);
      }
    }
  };
}
