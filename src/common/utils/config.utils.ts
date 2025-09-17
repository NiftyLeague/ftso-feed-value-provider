import type { ExchangeApiKeyConfig } from "../types/services/configuration.types";

/**
 * Configuration utilities to eliminate environment parsing duplication
 * Extracts common configuration parsing patterns from ConfigService and other modules
 */
export class ConfigUtils {
  /**
   * Parse integer with default value and validation
   */
  static parseIntWithDefault(
    value: string | undefined,
    defaultValue: number,
    options?: {
      min?: number;
      max?: number;
      fieldName?: string;
    }
  ): number {
    if (!value) return defaultValue;

    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      console.warn(
        `Invalid integer value "${value}" for ${options?.fieldName || "field"}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    if (options?.min !== undefined && parsed < options.min) {
      console.warn(
        `Value ${parsed} for ${options?.fieldName || "field"} is below minimum ${options.min}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    if (options?.max !== undefined && parsed > options.max) {
      console.warn(
        `Value ${parsed} for ${options?.fieldName || "field"} is above maximum ${options.max}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    return parsed;
  }

  /**
   * Parse float with default value and validation
   */
  static parseFloatWithDefault(
    value: string | undefined,
    defaultValue: number,
    options?: {
      min?: number;
      max?: number;
      fieldName?: string;
    }
  ): number {
    if (!value) return defaultValue;

    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      console.warn(
        `Invalid float value "${value}" for ${options?.fieldName || "field"}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    if (options?.min !== undefined && parsed < options.min) {
      console.warn(
        `Value ${parsed} for ${options?.fieldName || "field"} is below minimum ${options.min}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    if (options?.max !== undefined && parsed > options.max) {
      console.warn(
        `Value ${parsed} for ${options?.fieldName || "field"} is above maximum ${options.max}, using default ${defaultValue}`
      );
      return defaultValue;
    }

    return parsed;
  }

  /**
   * Parse JSON with default value and validation
   */
  static parseJsonWithDefault<T>(
    value: string | undefined,
    defaultValue: T,
    options?: {
      fieldName?: string;
    }
  ): T {
    if (!value) return defaultValue;

    try {
      return JSON.parse(value);
    } catch (error) {
      console.warn(`Invalid JSON value "${value}" for ${options?.fieldName || "field"}, using default`, error);
      return defaultValue;
    }
  }

  /**
   * Parse boolean with default value
   */
  static parseBooleanWithDefault(
    value: string | undefined,
    defaultValue: boolean,
    options?: {
      fieldName?: string;
    }
  ): boolean {
    if (!value) return defaultValue;

    const lowerValue = value.toLowerCase();
    if (lowerValue === "true" || lowerValue === "1" || lowerValue === "yes") {
      return true;
    }
    if (lowerValue === "false" || lowerValue === "0" || lowerValue === "no") {
      return false;
    }

    console.warn(
      `Invalid boolean value "${value}" for ${options?.fieldName || "field"}, using default ${defaultValue}`
    );
    return defaultValue;
  }

  /**
   * Parse comma-separated list with default value
   */
  static parseListWithDefault(
    value: string | undefined,
    defaultValue: string[],
    options?: {
      fieldName?: string;
      separator?: string;
      filterEmpty?: boolean;
    }
  ): string[] {
    if (!value) return defaultValue;

    const separator = options?.separator || ",";
    const filterEmpty = options?.filterEmpty !== false; // Default to true

    const list = value.split(separator).map(item => item.trim());
    return filterEmpty ? list.filter(Boolean) : list;
  }

  /**
   * Parse port number with validation
   */
  static parsePort(value: string | undefined, defaultValue: number, fieldName?: string): number {
    return this.parseIntWithDefault(value, defaultValue, {
      min: 1,
      max: 65535,
      fieldName: fieldName || "port",
    });
  }

  /**
   * Parse timeout value in milliseconds
   */
  static parseTimeoutMs(value: string | undefined, defaultValue: number, fieldName?: string): number {
    return this.parseIntWithDefault(value, defaultValue, {
      min: 0,
      max: 300000, // 5 minutes max
      fieldName: fieldName || "timeout",
    });
  }

  /**
   * Parse percentage value (0-100)
   */
  static parsePercentage(value: string | undefined, defaultValue: number, fieldName?: string): number {
    return this.parseFloatWithDefault(value, defaultValue, {
      min: 0,
      max: 100,
      fieldName: fieldName || "percentage",
    });
  }

  /**
   * Parse file size string (e.g., "10MB", "1GB") to bytes
   */
  static parseFileSize(value: string | undefined, defaultValue: number, fieldName?: string): number {
    if (!value) return defaultValue;

    const sizeRegex = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i;
    const match = value.match(sizeRegex);

    if (!match) {
      console.warn(`Invalid file size format "${value}" for ${fieldName || "field"}, using default ${defaultValue}`);
      return defaultValue;
    }

    const size = parseFloat(match[1]);
    const unit = (match[2] || "B").toUpperCase();

    const multipliers: Record<string, number> = {
      B: 1,
      KB: 1024,
      MB: 1024 * 1024,
      GB: 1024 * 1024 * 1024,
      TB: 1024 * 1024 * 1024 * 1024,
    };

    return Math.floor(size * multipliers[unit]);
  }

  /**
   * Parse duration string (e.g., "30s", "5m", "1h") to milliseconds
   */
  static parseDurationMs(value: string | undefined, defaultValue: number, fieldName?: string): number {
    if (!value) return defaultValue;

    const durationRegex = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i;
    const match = value.match(durationRegex);

    if (!match) {
      console.warn(`Invalid duration format "${value}" for ${fieldName || "field"}, using default ${defaultValue}`);
      return defaultValue;
    }

    const duration = parseFloat(match[1]);
    const unit = (match[2] || "ms").toLowerCase();

    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return Math.floor(duration * multipliers[unit]);
  }

  /**
   * Validate required environment variable
   */
  static requireEnvVar(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Required environment variable ${name} is not set`);
    }
    return value;
  }

  /**
   * Get environment variable with validation
   */
  static getEnvVar(
    name: string,
    defaultValue?: string,
    options?: {
      required?: boolean;
      allowedValues?: string[];
      pattern?: RegExp;
    }
  ): string {
    const value = process.env[name];

    if (!value) {
      if (options?.required) {
        throw new Error(`Required environment variable ${name} is not set`);
      }
      return defaultValue || "";
    }

    if (options?.allowedValues && !options.allowedValues.includes(value)) {
      throw new Error(`Environment variable ${name} must be one of: ${options.allowedValues.join(", ")}`);
    }

    if (options?.pattern && !options.pattern.test(value)) {
      throw new Error(`Environment variable ${name} does not match required pattern`);
    }

    return value;
  }

  /**
   * Load exchange API keys from environment variables
   */
  static loadExchangeApiKeys(exchanges: string[]): Record<string, ExchangeApiKeyConfig> {
    const apiKeys: Record<string, ExchangeApiKeyConfig> = {};

    for (const exchange of exchanges) {
      const upperExchange = exchange.toUpperCase();
      const apiKey = process.env[`${upperExchange}_API_KEY`];
      const secret = process.env[`${upperExchange}_SECRET`];
      const passphrase = process.env[`${upperExchange}_PASSPHRASE`];

      if (apiKey || secret || passphrase) {
        apiKeys[exchange] = {
          apiKey,
          secret,
          passphrase,
        };
      }
    }

    return apiKeys;
  }

  /**
   * Create configuration validation result
   */
  static createValidationResult(
    errors: string[] = [],
    warnings: string[] = [],
    missingRequired: string[] = [],
    invalidValues: string[] = []
  ): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    missingRequired: string[];
    invalidValues: string[];
  } {
    return {
      isValid: errors.length === 0 && missingRequired.length === 0,
      errors,
      warnings,
      missingRequired,
      invalidValues,
    };
  }

  /**
   * Merge validation results
   */
  static mergeValidationResults(
    ...results: Array<{
      isValid: boolean;
      errors: string[];
      warnings: string[];
      missingRequired: string[];
      invalidValues: string[];
    }>
  ): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    missingRequired: string[];
    invalidValues: string[];
  } {
    const merged = this.createValidationResult();

    for (const result of results) {
      merged.errors.push(...result.errors);
      merged.warnings.push(...result.warnings);
      merged.missingRequired.push(...result.missingRequired);
      merged.invalidValues.push(...result.invalidValues);
    }

    merged.isValid = merged.errors.length === 0 && merged.missingRequired.length === 0;
    return merged;
  }
}
