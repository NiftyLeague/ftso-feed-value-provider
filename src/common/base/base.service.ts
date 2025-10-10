import { WithConfiguration } from "./mixins/configurable.mixin";
import { WithLogging } from "./mixins/logging.mixin";
import type { BaseServiceConfig, IBaseService } from "../types/services/base.types";

const defaultConfig: BaseServiceConfig = {
  useEnhancedLogging: false,
};

// Create a simple base class
class SimpleBase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(..._args: any[]) {
    // Empty constructor
  }
}

// Apply mixins step by step
const ConfigurableBase = WithConfiguration<BaseServiceConfig>(defaultConfig)(SimpleBase);
const LoggingBase = WithLogging(ConfigurableBase);

/**
 * Base service class that provides common logging functionality with configurable enhanced logging
 * All logging methods are inherited from WithLogging mixin
 */
export abstract class BaseService extends LoggingBase implements IBaseService {
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
