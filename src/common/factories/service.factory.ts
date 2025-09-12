/**
 * Service Factory Utilities - Aggressive Deduplication
 * Consolidates repeated useFactory patterns across modules
 * Eliminates 10+ instances of duplicated factory logic
 */

import { FactoryProvider } from "@nestjs/common";

/**
 * Create a simple service factory provider
 */
export function createServiceFactory<T>(
  serviceClass: new (...args: unknown[]) => T,
  dependencies: string[] = []
): FactoryProvider<T> {
  return {
    provide: serviceClass,
    useFactory: (...args: unknown[]) => new serviceClass(...args),
    inject: dependencies,
  };
}

/**
 * Create a service factory with configuration injection
 */
export function createConfigurableServiceFactory<T, C>(
  serviceClass: new (config: C) => T,
  configKey: string,
  configMapper?: (config: unknown) => C
): FactoryProvider<T> {
  return {
    provide: serviceClass,
    useFactory: (config: unknown) => {
      const mappedConfig = configMapper ? configMapper(config) : (config as C);
      return new serviceClass(mappedConfig);
    },
    inject: [configKey],
  };
}

/**
 * Create a service factory with multiple dependencies
 */
export function createMultiDependencyServiceFactory<T>(
  serviceClass: new (...args: unknown[]) => T,
  dependencies: string[]
): FactoryProvider<T> {
  return {
    provide: serviceClass,
    useFactory: (...args: unknown[]) => new serviceClass(...args),
    inject: dependencies,
  };
}

/**
 * Create a conditional service factory
 */
export function createConditionalServiceFactory<T>(
  serviceClass: new (...args: unknown[]) => T,
  condition: (config: unknown) => boolean,
  dependencies: string[] = []
): FactoryProvider<T | null> {
  return {
    provide: serviceClass,
    useFactory: (...args: unknown[]) => {
      const config = args[0];
      if (condition(config)) {
        return new serviceClass(...args);
      }
      return null;
    },
    inject: dependencies,
  };
}

/**
 * Create a singleton service factory
 */
export function createSingletonServiceFactory<T>(
  serviceClass: new (...args: unknown[]) => T,
  dependencies: string[] = []
): FactoryProvider<T> {
  let instance: T | null = null;

  return {
    provide: serviceClass,
    useFactory: (...args: unknown[]) => {
      if (!instance) {
        instance = new serviceClass(...args);
      }
      return instance;
    },
    inject: dependencies,
  };
}
