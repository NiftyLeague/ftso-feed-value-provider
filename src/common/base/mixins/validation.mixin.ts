import { BadRequestException } from "@nestjs/common";
import type { Constructor, AbstractConstructor, IBaseService } from "../../types/services";

/**
 * Validation rule interface
 */
export interface ValidationRule<T = unknown> {
  /**
   * Name of the validation rule
   */
  name: string;

  /**
   * Function to validate the value
   */
  validate: (value: T) => boolean;

  /**
   * Optional error message template
   */
  message?: string;
}

/**
 * Validation capabilities interface
 */
export interface ValidationCapabilities {
  /**
   * Add a validation rule
   */
  addValidationRule<T>(rule: ValidationRule<T>): void;

  /**
   * Remove a validation rule by name
   */
  removeValidationRule(name: string): void;

  /**
   * Get all validation rules
   */
  getValidationRules(): ReadonlyArray<ValidationRule>;

  /**
   * Validate a value against all rules
   */
  validate<T>(value: T): boolean;
}

/**
 * Mixin that adds validation capabilities to a service
 */
export function WithValidation<TBase extends Constructor | AbstractConstructor>(Base: TBase) {
  return class ValidationMixin extends Base implements ValidationCapabilities {
    public _validationRules: ValidationRule[] = [];
    public _failedRules: Set<string> = new Set();

    /**
     * Add a validation rule
     * @param rule The validation rule to add
     * @param silent If true, skip the duplicate check and don't log
     */
    public addValidationRule<T>(rule: ValidationRule<T>, silent = false): void {
      // Check if rule with same name already exists
      const existingRuleIndex = this._validationRules.findIndex(r => r.name === rule.name);
      if (existingRuleIndex >= 0) {
        if (!silent) {
          // In non-silent mode, update the existing rule
          this._validationRules[existingRuleIndex] = rule as ValidationRule<unknown>;
          (this as unknown as IBaseService).logDebug(`Updated validation rule: ${rule.name}`);
        }
      } else {
        // Add new rule
        this._validationRules.push(rule as ValidationRule<unknown>);
        if (!silent) {
          (this as unknown as IBaseService).logDebug(`Added validation rule: ${rule.name}`);
        }
      }
    }

    /**
     * Remove a validation rule by name
     */
    public removeValidationRule(name: string): void {
      this._validationRules = this._validationRules.filter(rule => rule.name !== name);
      (this as unknown as IBaseService).logDebug(`Removed validation rule: ${name}`);
    }

    /**
     * Get all validation rules
     */
    public getValidationRules(): ReadonlyArray<ValidationRule> {
      return [...this._validationRules];
    }

    /**
     * Validate a value against all rules
     */
    public validate<T>(value: T): boolean {
      this._failedRules.clear();
      const validationErrors: string[] = [];

      // Run all validation rules
      for (const rule of this._validationRules) {
        try {
          if (!rule.validate(value)) {
            this._failedRules.add(rule.name);
            validationErrors.push(rule.message || `Validation failed: ${rule.name}`);
          }
        } catch (error) {
          this._failedRules.add(rule.name);
          validationErrors.push(`Validation error in rule '${rule.name}': ${(error as Error).message}`);
        }
      }

      // Log validation results
      if (validationErrors.length > 0) {
        (this as unknown as IBaseService).logWarning(
          `Validation failed with ${validationErrors.length} errors`,
          undefined,
          { errors: validationErrors }
        );
        throw new BadRequestException(validationErrors);
      }

      return true;
    }

    /**
     * Get the list of failed validation rules from the last validation attempt
     */
    public getFailedRules(): ReadonlySet<string> {
      return new Set(this._failedRules);
    }

    /**
     * Clear all validation rules
     */
    public clearValidationRules(): void {
      this._validationRules = [];
      (this as unknown as IBaseService).logDebug("Cleared all validation rules");
    }
  };
}
