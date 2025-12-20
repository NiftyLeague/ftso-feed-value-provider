import type { FeedValuesRequest, VolumesRequest } from "@/common/types/http";

/**
 * Validation utility type definitions
 */

export type UnknownInput = Record<string, unknown>;

export interface ArrayValidationOptions<T = unknown> {
  minLength?: number;
  maxLength?: number;
  itemValidator?: (item: unknown, index: number) => T;
}

export type ValidatedFeedValuesRequest = FeedValuesRequest;

export type ValidatedVolumesRequest = VolumesRequest;

export interface ValidatedPagination {
  page: number;
  limit: number;
  offset: number;
}

export type ValidatedTimeRange = Pick<VolumesRequest, "startTime" | "endTime">;

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidationOptions {
  strict?: boolean;
  allowUnknownFields?: boolean;
  stripUnknownFields?: boolean;
}

export interface Validator<T> {
  validate(data: unknown, options?: ValidationOptions): ValidationResult;
  sanitize(data: unknown): T;
  isValid(data: unknown): data is T;
}

export interface SchemaValidationRule {
  field: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  pattern?: RegExp;
  enum?: unknown[];
  schema?: SchemaValidationRule[];
  items?: SchemaValidationRule;
  customValidator?: (value: unknown) => boolean;
  errorMessage?: string;
}

export interface ValidationSchema {
  [key: string]: SchemaValidationRule;
}

export interface ValidationReport {
  isValid: boolean;
  errors: ValidationRuleError[];
  warnings: ValidationRuleError[];
  validatedData: unknown;
}

import { IErrorDetails } from "../error-handling/error.types";

export interface ValidationRuleError extends IErrorDetails {
  path: string;
}

export interface IValidationService {
  validate(schema: ValidationSchema, data: unknown): ValidationReport;
  validateWithRules(rules: SchemaValidationRule[], data: unknown): ValidationReport;
  sanitize(schema: ValidationSchema, data: unknown): unknown;
}
