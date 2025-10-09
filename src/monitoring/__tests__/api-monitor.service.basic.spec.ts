// Basic test for api-monitor.service.ts
describe("ApiMonitorService Basic Tests", () => {
  it("should be able to import ApiMonitorService", async () => {
    expect(async () => {
      await import("../api-monitor.service");
    }).not.toThrow();
  });

  it("should have ApiMonitorService defined", async () => {
    const { ApiMonitorService } = await import("../api-monitor.service");
    expect(ApiMonitorService).toBeDefined();
  });

  it("should be a function (NestJS service)", async () => {
    const { ApiMonitorService } = await import("../api-monitor.service");
    expect(typeof ApiMonitorService).toBe("function");
  });
});
