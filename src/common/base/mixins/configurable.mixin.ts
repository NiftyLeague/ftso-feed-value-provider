import type { AnyConstructor, ConstructorArgs, ConstructorInstance, IBaseService } from "../../types/services";
import type { ConfigurableCapabilities } from "../../types/services/mixin-capabilities.types";

/**
 * Mixin that adds configuration management to a service
 */
export function WithConfiguration<TConfig extends Record<string, unknown>>(defaultConfig: TConfig) {
  return function <TBase extends AnyConstructor>(
    Base: TBase
  ): AnyConstructor<
    ConstructorArgs<TBase>,
    ConstructorInstance<TBase> &
      ConfigurableCapabilities<TConfig> & {
        config: TConfig;
        readonly defaultConfig: TConfig;
      }
  > {
    return class ConfigurableMixin extends Base implements ConfigurableCapabilities<TConfig> {
      public readonly defaultConfig: TConfig = { ...defaultConfig };
      public config: TConfig = { ...defaultConfig };

      updateConfig(newConfig: Partial<TConfig>): void {
        const oldConfig = { ...this.config };
        this.config = { ...this.config, ...newConfig };

        try {
          this.validateConfig();
          this.onConfigUpdated?.(oldConfig, this.config);
          (this as unknown as IBaseService).logger.log("Configuration updated successfully", {
            service: this.constructor.name,
            changes: this.getConfigChanges(oldConfig, this.config),
          });
        } catch (error) {
          // Rollback on validation failure
          this.config = oldConfig;
          (this as unknown as IBaseService).logError(error as Error, "Configuration update failed, rolled back");
          throw error;
        }
      }

      getConfig(): Readonly<TConfig> {
        return { ...this.config };
      }

      resetConfig(): void {
        const oldConfig = { ...this.config };
        this.config = { ...this.defaultConfig };
        this.onConfigUpdated?.(oldConfig, this.config);
        (this as unknown as IBaseService).logger.log("Configuration reset to defaults");
      }

      validateConfig(): void {
        // Override in subclasses for specific validation
      }

      onConfigUpdated?(_oldConfig: TConfig, _newConfig: TConfig): void {
        // Override in subclasses for specific handling
      }

      public getConfigChanges(oldConfig: TConfig, newConfig: TConfig): Record<string, { old: unknown; new: unknown }> {
        const changes: Record<string, { old: unknown; new: unknown }> = {};

        for (const key in newConfig) {
          if (oldConfig[key] !== newConfig[key]) {
            changes[key] = { old: oldConfig[key], new: newConfig[key] };
          }
        }

        return changes;
      }
    } as unknown as AnyConstructor<
      ConstructorArgs<TBase>,
      ConstructorInstance<TBase> &
        ConfigurableCapabilities<TConfig> & {
          config: TConfig;
          readonly defaultConfig: TConfig;
        }
    >;
  };
}
