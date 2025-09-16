// Basic test for api-monitor.service.ts
describe("ApiMonitorService Basic Tests", () => {
  it("should be able to import ApiMonitorService", () => {
    expect(() => {
      require("../api-monitor.service");
    }).not.toThrow();
  });

  it("should have ApiMonitorService defined", () => {
    const { ApiMonitorService } = require("../api-monitor.service");
    expect(ApiMonitorService).toBeDefined();
  });

  it("should be a function (NestJS service)", () => {
    const { ApiMonitorService } = require("../api-monitor.service");
    expect(typeof ApiMonitorService).toBe("function");
  });
});
