import { BaseService } from "./base.service";
import { WithConfiguration } from "./mixins/configurable.mixin";
import { WithErrorHandling } from "./mixins/error-handling.mixin";
import { WithEvents } from "./mixins/events.mixin";
import { WithLifecycle } from "./mixins/lifecycle.mixin";
import { WithLogging } from "./mixins/logging.mixin";
import { WithMonitoring } from "./mixins/monitoring.mixin";

/**
 * Simple composition helpers - just apply mixins in the order you want
 */
export const Mixins = {
  Configuration: WithConfiguration,
  ErrorHandling: WithErrorHandling,
  Events: WithEvents,
  Lifecycle: WithLifecycle,
  Logging: WithLogging,
  Monitoring: WithMonitoring,
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
