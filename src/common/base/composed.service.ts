import { BaseService } from "./base.service";
import { WithConfiguration } from "./mixins/configurable.mixin";
import { WithDataProvider } from "./mixins/data-provider.mixin";
import { WithErrorHandling } from "./mixins/error-handling.mixin";
import { WithEvents } from "./mixins/events.mixin";
import { WithLifecycle } from "./mixins/lifecycle.mixin";
import { WithLogging } from "./mixins/logging.mixin";
import { WithMonitoring } from "./mixins/monitoring.mixin";
import { WithValidation } from "./mixins/validation.mixin";

/**
 * Simple composition helpers - just apply mixins in the order you want
 */
export const Mixins = {
  Configuration: WithConfiguration,
  DataProvider: WithDataProvider,
  ErrorHandling: WithErrorHandling,
  Events: WithEvents,
  Lifecycle: WithLifecycle,
  Logging: WithLogging,
  Monitoring: WithMonitoring,
  Validation: WithValidation,
};

/**
 * Pre-composed service classes for common use cases
 * These are concrete classes that can be extended directly
 */

// Service with lifecycle management
export abstract class LifecycleService extends WithLifecycle(BaseService) {}

// Service with monitoring
export abstract class MonitoringService extends WithMonitoring(BaseService) {}

// Service with error handling
export abstract class ErrorHandlingService extends WithErrorHandling(BaseService) {}

// Service with events
export abstract class EventService extends WithEvents(BaseService) {}

// Common combinations
export abstract class StandardService extends WithErrorHandling(WithMonitoring(WithLifecycle(BaseService))) {}

export abstract class EventDrivenService extends WithEvents(StandardService) {}

/**
 * Service class with data provider capabilities and validation support.
 */
export abstract class DataProviderService extends WithValidation(WithDataProvider(StandardService)) {}
