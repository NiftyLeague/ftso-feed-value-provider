import { WithConfiguration } from "./mixins/configurable.mixin";
import { WithLogging } from "./mixins/logging.mixin";
import type { BaseServiceConfig, IBaseService } from "../types/services/base.types";

const defaultConfig: BaseServiceConfig = {
  useEnhancedLogging: false,
};

abstract class ConfigurableBaseService extends WithConfiguration<BaseServiceConfig>(defaultConfig)(class {}) {}

/**
 * Base service class that provides common logging functionality with configurable enhanced logging
 * All logging methods are inherited from WithLogging mixin
 */
export abstract class BaseService extends WithLogging(ConfigurableBaseService) implements IBaseService {
  constructor(config?: Partial<BaseServiceConfig>) {
    super();
    // Update config with any provided overrides
    if (config) this.updateConfig(config);
  }

  /**
   * Handle config updates to reinitialize enhanced logging when needed
   */
  override onConfigUpdated?(oldConfig: BaseServiceConfig, newConfig: BaseServiceConfig): void {
    if (oldConfig.useEnhancedLogging !== newConfig.useEnhancedLogging && newConfig.useEnhancedLogging !== undefined) {
      this.initializeEnhancedLogging(newConfig.useEnhancedLogging);
    }
  }
}
