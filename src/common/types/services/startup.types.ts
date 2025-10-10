/**
 * Startup service type definitions
 */

export interface StartupValidationResult {
  success: boolean;
  errors: string[];
  warnings: string[];
  validatedServices: string[];
  timestamp: number;
  validationTime: number;
}
