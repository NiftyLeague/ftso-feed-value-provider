import { BaseService } from "../base.service";

// Test service to verify config functionality
class TestConfigService extends BaseService {
  constructor() {
    super();
  }

  public getEnhancedLogger() {
    return this.enhancedLogger;
  }

  public enableEnhancedLogging() {
    this.updateConfig({ useEnhancedLogging: true });
  }

  public disableEnhancedLogging() {
    this.updateConfig({ useEnhancedLogging: false });
  }
}

describe("BaseService Configuration", () => {
  let service: TestConfigService;

  beforeEach(() => {
    service = new TestConfigService();
  });

  describe("default configuration", () => {
    it("should have enhanced logging disabled by default", () => {
      const config = service.getConfig();
      expect(config.useEnhancedLogging).toBe(false);
      expect(service.getEnhancedLogger()).toBeUndefined();
    });
  });

  describe("configuration updates", () => {
    it("should enable enhanced logging when config is updated", () => {
      expect(service.getEnhancedLogger()).toBeUndefined();

      service.enableEnhancedLogging();

      const config = service.getConfig();
      expect(config.useEnhancedLogging).toBe(true);
      expect(service.getEnhancedLogger()).toBeDefined();
    });

    it("should disable enhanced logging when config is updated", () => {
      service.enableEnhancedLogging();
      expect(service.getEnhancedLogger()).toBeDefined();

      service.disableEnhancedLogging();

      const config = service.getConfig();
      expect(config.useEnhancedLogging).toBe(false);
      expect(service.getEnhancedLogger()).toBeUndefined();
    });

    it("should have access to all config methods from mixin", () => {
      expect(typeof service.updateConfig).toBe("function");
      expect(typeof service.getConfig).toBe("function");
      expect(typeof service.resetConfig).toBe("function");
    });
  });
});
