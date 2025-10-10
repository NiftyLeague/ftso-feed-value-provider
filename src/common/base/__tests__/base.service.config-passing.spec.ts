import type { BaseServiceConfig } from "../../types/services/base.types";
import { BaseService } from "../base.service";

// Test service that passes config to super()
class TestServiceWithConfig extends BaseService {
  constructor(config?: Partial<BaseServiceConfig>) {
    super(config);
  }

  public getEnhancedLogger() {
    return this.enhancedLogger;
  }
}

describe("BaseService Config Passing", () => {
  describe("passing config to constructor", () => {
    it("should accept config in constructor and enable enhanced logging", () => {
      const service = new TestServiceWithConfig({ useEnhancedLogging: true });

      const config = service.getConfig();
      expect(config.useEnhancedLogging).toBe(true);
      expect(service.getEnhancedLogger()).toBeDefined();
    });

    it("should use default config when no config passed", () => {
      const service = new TestServiceWithConfig();

      const config = service.getConfig();
      expect(config.useEnhancedLogging).toBe(false);
      expect(service.getEnhancedLogger()).toBeUndefined();
    });

    it("should allow partial config overrides", () => {
      const service = new TestServiceWithConfig({ useEnhancedLogging: true });

      const config = service.getConfig();
      expect(config.useEnhancedLogging).toBe(true);
      expect(service.getEnhancedLogger()).toBeDefined();
    });

    it("should still allow runtime config updates", () => {
      const service = new TestServiceWithConfig({ useEnhancedLogging: false });

      expect(service.getEnhancedLogger()).toBeUndefined();

      service.updateConfig({ useEnhancedLogging: true });
      expect(service.getEnhancedLogger()).toBeDefined();
    });
  });
});
