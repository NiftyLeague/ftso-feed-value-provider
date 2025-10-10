/**
 * Environment Utilities - Aggressive Deduplication
 * Consolidates all environment variable parsing patterns
 * Eliminates 25+ instances of duplicated parsing logic
 */

export class EnvironmentUtils {
  /**
   * Parse integer from environment variable with validation
   */
  static parseInt(
    key: string,
    defaultValue: number,
    options: {
      min?: number;
      max?: number;
      fieldName?: string;
    } = {}
  ): number {
    const value = process.env[key];
    if (!value) return defaultValue;

    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      console.warn(`Invalid integer value "${value}" for ${options.fieldName || key}, using default ${defaultValue}`);
      return defaultValue;
    }

    if (options.min !== undefined && parsed < options.min) {
      console.warn(
        `Value ${parsed} for ${options.fieldName || key} is below minimum ${options.min}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    if (options.max !== undefined && parsed > options.max) {
      console.warn(
        `Value ${parsed} for ${options.fieldName || key} is above maximum ${options.max}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    return parsed;
  }

  /**
   * Parse float from environment variable with validation
   */
  static parseFloat(
    key: string,
    defaultValue: number,
    options: {
      min?: number;
      max?: number;
      fieldName?: string;
    } = {}
  ): number {
    const value = process.env[key];
    if (!value) return defaultValue;

    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      console.warn(`Invalid float value "${value}" for ${options.fieldName || key}, using default ${defaultValue}`);
      return defaultValue;
    }

    if (options.min !== undefined && parsed < options.min) {
      console.warn(
        `Value ${parsed} for ${options.fieldName || key} is below minimum ${options.min}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    if (options.max !== undefined && parsed > options.max) {
      console.warn(
        `Value ${parsed} for ${options.fieldName || key} is above maximum ${options.max}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    return parsed;
  }

  /**
   * Parse boolean from environment variable
   */
  static parseBoolean(key: string, defaultValue: boolean, options: { fieldName?: string } = {}): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;

    const lowerValue = value.toLowerCase();
    if (lowerValue === "true" || lowerValue === "1" || lowerValue === "yes") {
      return true;
    }
    if (lowerValue === "false" || lowerValue === "0" || lowerValue === "no") {
      return false;
    }

    console.warn(`Invalid boolean value "${value}" for ${options.fieldName || key}, using default ${defaultValue}`);
    return defaultValue;
  }

  /**
   * Parse string from environment variable with validation
   */
  static parseString(
    key: string,
    defaultValue: string,
    options: {
      minLength?: number;
      maxLength?: number;
      pattern?: RegExp;
      fieldName?: string;
    } = {}
  ): string {
    const value = process.env[key];
    if (!value) return defaultValue;

    if (options.minLength !== undefined && value.length < options.minLength) {
      console.warn(
        `Value for ${options.fieldName || key} is too short (${value.length} < ${options.minLength}), using default`
      );
      return defaultValue;
    }

    if (options.maxLength !== undefined && value.length > options.maxLength) {
      console.warn(
        `Value for ${options.fieldName || key} is too long (${value.length} > ${options.maxLength}), using default`
      );
      return defaultValue;
    }

    if (options.pattern && !options.pattern.test(value)) {
      console.warn(`Value for ${options.fieldName || key} doesn't match pattern, using default`);
      return defaultValue;
    }

    return value;
  }

  /**
   * Parse comma-separated list from environment variable
   */
  static parseList(key: string, defaultValue: string[] = []): string[] {
    const value = process.env[key];
    if (!value) return defaultValue;

    return value
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);
  }

  /**
   * Parse JSON from environment variable
   */
  static parseJSON<T>(key: string, defaultValue: T): T {
    const value = process.env[key];
    if (!value) return defaultValue;

    try {
      return JSON.parse(value) as T;
    } catch {
      console.warn(`Invalid JSON value "${value}" for ${key}, using default`);
      return defaultValue;
    }
  }
}
