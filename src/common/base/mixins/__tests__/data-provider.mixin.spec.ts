import { WithDataProvider } from "../data-provider.mixin";
import { ServiceStatus } from "@/common/types/services";

class TestBase {
  public logDebug = jest.fn();
  public createTimeout = jest.fn((_cb: () => void, _delay: number) => ({}) as unknown as NodeJS.Timeout);
  public clearTimer = jest.fn();
}

class ProviderService extends WithDataProvider(TestBase) {}

describe("WithDataProvider mixin", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("initializes and schedules a reset without creating real timers", () => {
    const svc = new ProviderService();

    // constructor calls _scheduleRateLimitReset -> createTimeout(windowMs)
    expect(svc.createTimeout).toHaveBeenCalledTimes(1);
    expect(svc.getConnectionStatus()).toBe(ServiceStatus.Unknown);

    const config = svc.getRateLimitConfig();
    expect(config.maxRequestsPerWindow).toBe(100);
    expect(config.windowMs).toBe(60000);
    expect(config.burstLimit).toBe(10);
  });

  it("updates rate limit config, clears existing interval, and reschedules", () => {
    const svc = new ProviderService();

    const firstTimer = (svc as unknown as { _resetInterval: NodeJS.Timeout })._resetInterval;
    expect(firstTimer).toBeDefined();

    svc.updateRateLimitConfig({ windowMs: 1234, maxRequestsPerWindow: 2 });

    expect(svc.clearTimer).toHaveBeenCalledWith(firstTimer);
    expect(svc.createTimeout).toHaveBeenCalledTimes(2);

    const updated = svc.getRateLimitConfig();
    expect(updated.windowMs).toBe(1234);
    expect(updated.maxRequestsPerWindow).toBe(2);
  });

  it("reports rate limiting and transitions status when limit exceeded", () => {
    const svc = new ProviderService();

    svc.updateRateLimitConfig({ maxRequestsPerWindow: 2 });

    // 2 requests hits the limit
    (svc as unknown as { recordSuccessfulRequest: () => void }).recordSuccessfulRequest();
    (svc as unknown as { recordSuccessfulRequest: () => void }).recordSuccessfulRequest();

    expect(svc.isRateLimited()).toBe(true);
    expect(svc.getConnectionStatus()).toBe(ServiceStatus.RateLimited);
  });

  it("computes error/success rates and handles empty totals", () => {
    const svc = new ProviderService();

    expect(svc.getErrorRate()).toBe(0);
    expect(svc.getSuccessRate()).toBe(0);

    (svc as unknown as { recordSuccessfulRequest: () => void }).recordSuccessfulRequest();
    (svc as unknown as { recordFailedRequest: () => void }).recordFailedRequest();
    (svc as unknown as { recordFailedRequest: () => void }).recordFailedRequest();

    expect(svc.getCurrentRequestCount()).toBe(3);
    expect(svc.getSuccessRate()).toBeCloseTo(1 / 3);
    expect(svc.getErrorRate()).toBeCloseTo(2 / 3);
  });

  it("resets counters and auto-restores status from RateLimited", () => {
    const svc = new ProviderService();

    (svc as unknown as { _connectionStatus: ServiceStatus })._connectionStatus = ServiceStatus.RateLimited;
    (svc as unknown as { _requestCount: number })._requestCount = 10;

    svc.resetRateLimitCounters();

    expect(svc.getCurrentRequestCount()).toBe(0);
    expect(svc.getConnectionStatus()).toBe(ServiceStatus.Connected);
  });
});
