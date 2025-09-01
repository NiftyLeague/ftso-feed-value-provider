import { BadRequestException } from "@nestjs/common";
import { FeedId } from "../dto/provider-requests.dto";

/**
 * Validation utilities to eliminate request validation duplication
 * Reduces validation boilerplate by 150+ lines across controllers
 */
export class ValidationUtils {
  /**
   * Validate feed ID structure and content
   */
  static validateFeedId(feed: any, fieldName = "feed"): FeedId {
    if (!feed || typeof feed !== "object") {
      throw new BadRequestException(`${fieldName} must be an object`);
    }

    if (typeof feed.category !== "number") {
      throw new BadRequestException(`${fieldName}.category must be a number`);
    }

    if (feed.category < 1 || feed.category > 4) {
      throw new BadRequestException(
        `${fieldName}.category must be between 1 and 4 (1=Crypto, 2=Forex, 3=Commodity, 4=Stock)`
      );
    }

    if (!feed.name || typeof feed.name !== "string") {
      throw new BadRequestException(`${fieldName}.name must be a non-empty string`);
    }

    if (!feed.name.includes("/")) {
      throw new BadRequestException(`${fieldName}.name must be in format "BASE/QUOTE" (e.g., "BTC/USD")`);
    }

    const parts = feed.name.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException(
        `${fieldName}.name must be in format "BASE/QUOTE" with valid base and quote currencies`
      );
    }

    return {
      category: feed.category,
      name: feed.name,
    };
  }

  /**
   * Validate array of feed IDs
   */
  static validateFeedIds(feeds: any, fieldName = "feeds"): FeedId[] {
    if (!Array.isArray(feeds)) {
      throw new BadRequestException(`${fieldName} must be an array`);
    }

    if (feeds.length === 0) {
      throw new BadRequestException(`${fieldName} array cannot be empty`);
    }

    if (feeds.length > 100) {
      throw new BadRequestException(`${fieldName} array cannot contain more than 100 items`);
    }

    return feeds.map((feed, index) => this.validateFeedId(feed, `${fieldName}[${index}]`));
  }

  /**
   * Validate voting round ID
   */
  static validateVotingRoundId(votingRoundId: any): number {
    if (typeof votingRoundId !== "number") {
      throw new BadRequestException("votingRoundId must be a number");
    }

    if (!Number.isInteger(votingRoundId)) {
      throw new BadRequestException("votingRoundId must be an integer");
    }

    if (votingRoundId < 0) {
      throw new BadRequestException("votingRoundId must be non-negative");
    }

    if (votingRoundId > Number.MAX_SAFE_INTEGER) {
      throw new BadRequestException("votingRoundId is too large");
    }

    return votingRoundId;
  }

  /**
   * Validate time window for volume requests
   */
  static validateTimeWindow(windowSec: any): number {
    if (typeof windowSec !== "number") {
      throw new BadRequestException("windowSec must be a number");
    }

    if (!Number.isInteger(windowSec)) {
      throw new BadRequestException("windowSec must be an integer");
    }

    if (windowSec <= 0) {
      throw new BadRequestException("windowSec must be positive");
    }

    if (windowSec > 86400) {
      // 24 hours
      throw new BadRequestException("windowSec cannot exceed 86400 seconds (24 hours)");
    }

    return windowSec;
  }

  /**
   * Validate timestamp
   */
  static validateTimestamp(timestamp: any, fieldName: string): number {
    if (typeof timestamp !== "number") {
      throw new BadRequestException(`${fieldName} must be a number`);
    }

    if (!Number.isInteger(timestamp)) {
      throw new BadRequestException(`${fieldName} must be an integer`);
    }

    if (timestamp < 0) {
      throw new BadRequestException(`${fieldName} must be non-negative`);
    }

    // Check if timestamp is reasonable (not too far in past or future)
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const oneYearFromNow = now + 365 * 24 * 60 * 60 * 1000;

    if (timestamp < oneYearAgo || timestamp > oneYearFromNow) {
      throw new BadRequestException(`${fieldName} must be within reasonable time range`);
    }

    return timestamp;
  }

  /**
   * Validate time range for volume requests
   */
  static validateTimeRange(startTime?: any, endTime?: any): { startTime?: number; endTime?: number } {
    const result: { startTime?: number; endTime?: number } = {};

    if (startTime !== undefined) {
      result.startTime = this.validateTimestamp(startTime, "startTime");
    }

    if (endTime !== undefined) {
      result.endTime = this.validateTimestamp(endTime, "endTime");
    }

    if (result.startTime && result.endTime && result.startTime >= result.endTime) {
      throw new BadRequestException("startTime must be before endTime");
    }

    return result;
  }

  /**
   * Validate request body structure
   */
  static validateRequestBody(body: any): any {
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Request body must be a valid JSON object");
    }

    if (Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object, not an array");
    }

    return body;
  }

  /**
   * Validate feed values request
   */
  static validateFeedValuesRequest(body: any): { feeds: FeedId[] } {
    const validatedBody = this.validateRequestBody(body);

    if (!validatedBody.feeds) {
      throw new BadRequestException("feeds field is required");
    }

    return {
      feeds: this.validateFeedIds(validatedBody.feeds),
    };
  }

  /**
   * Validate volumes request
   */
  static validateVolumesRequest(body: any): {
    feeds: FeedId[];
    startTime?: number;
    endTime?: number;
  } {
    const validatedBody = this.validateRequestBody(body);

    if (!validatedBody.feeds) {
      throw new BadRequestException("feeds field is required");
    }

    const feeds = this.validateFeedIds(validatedBody.feeds);
    const timeRange = this.validateTimeRange(validatedBody.startTime, validatedBody.endTime);

    return {
      feeds,
      ...timeRange,
    };
  }

  /**
   * Sanitize string input
   */
  static sanitizeString(input: any, fieldName: string, maxLength = 100): string {
    if (typeof input !== "string") {
      throw new BadRequestException(`${fieldName} must be a string`);
    }

    const trimmed = input.trim();

    if (trimmed.length === 0) {
      throw new BadRequestException(`${fieldName} cannot be empty`);
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException(`${fieldName} cannot exceed ${maxLength} characters`);
    }

    // Basic sanitization - remove potentially dangerous characters
    const sanitized = trimmed.replace(/[<>\"'&]/g, "");

    if (sanitized !== trimmed) {
      throw new BadRequestException(`${fieldName} contains invalid characters`);
    }

    return sanitized;
  }

  /**
   * Validate numeric value with range
   */
  static validateNumericRange(value: any, fieldName: string, min?: number, max?: number, allowFloat = true): number {
    if (typeof value !== "number") {
      throw new BadRequestException(`${fieldName} must be a number`);
    }

    if (!allowFloat && !Number.isInteger(value)) {
      throw new BadRequestException(`${fieldName} must be an integer`);
    }

    if (isNaN(value) || !isFinite(value)) {
      throw new BadRequestException(`${fieldName} must be a valid number`);
    }

    if (min !== undefined && value < min) {
      throw new BadRequestException(`${fieldName} must be at least ${min}`);
    }

    if (max !== undefined && value > max) {
      throw new BadRequestException(`${fieldName} must be at most ${max}`);
    }

    return value;
  }

  /**
   * Validate pagination parameters
   */
  static validatePagination(page?: any, limit?: any): { page: number; limit: number; offset: number } {
    const validatedPage = page !== undefined ? this.validateNumericRange(page, "page", 1, undefined, false) : 1;
    const validatedLimit = limit !== undefined ? this.validateNumericRange(limit, "limit", 1, 100, false) : 10;

    return {
      page: validatedPage,
      limit: validatedLimit,
      offset: (validatedPage - 1) * validatedLimit,
    };
  }

  /**
   * Validate required field
   */
  static validateRequired<T>(value: T, fieldName: string): T {
    if (value === null || value === undefined || value === "") {
      throw new BadRequestException(`${fieldName} is required`);
    }
    return value;
  }

  /**
   * Validate array with constraints
   */
  static validateArray<T>(
    value: any,
    fieldName: string,
    options: {
      minLength?: number;
      maxLength?: number;
      itemValidator?: (item: any, index: number) => T;
    } = {}
  ): T[] {
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an array`);
    }

    const { minLength = 0, maxLength = 1000, itemValidator } = options;

    if (value.length < minLength) {
      throw new BadRequestException(`${fieldName} must have at least ${minLength} items`);
    }

    if (value.length > maxLength) {
      throw new BadRequestException(`${fieldName} cannot have more than ${maxLength} items`);
    }

    if (itemValidator) {
      return value.map((item, index) => {
        try {
          return itemValidator(item, index);
        } catch (error) {
          throw new BadRequestException(`${fieldName}[${index}]: ${(error as Error).message}`);
        }
      });
    }

    return value;
  }

  /**
   * Validate email format
   */
  static validateEmail(email: any, fieldName = "email"): string {
    const emailStr = this.sanitizeString(email, fieldName, 254);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(emailStr)) {
      throw new BadRequestException(`${fieldName} must be a valid email address`);
    }

    return emailStr.toLowerCase();
  }

  /**
   * Validate URL format
   */
  static validateUrl(url: any, fieldName = "url", allowedProtocols = ["http", "https"]): string {
    const urlStr = this.sanitizeString(url, fieldName, 2048);

    try {
      const parsedUrl = new URL(urlStr);

      if (!allowedProtocols.includes(parsedUrl.protocol.slice(0, -1))) {
        throw new BadRequestException(`${fieldName} must use one of these protocols: ${allowedProtocols.join(", ")}`);
      }

      return urlStr;
    } catch (error) {
      throw new BadRequestException(`${fieldName} must be a valid URL`);
    }
  }

  /**
   * Validate enum value
   */
  static validateEnum<T>(value: any, enumObject: Record<string, T>, fieldName: string): T {
    const enumValues = Object.values(enumObject);

    if (!enumValues.includes(value)) {
      throw new BadRequestException(`${fieldName} must be one of: ${enumValues.join(", ")}`);
    }

    return value;
  }

  /**
   * Validate date string or timestamp
   */
  static validateDate(date: any, fieldName: string): Date {
    let dateObj: Date;

    if (typeof date === "number") {
      dateObj = new Date(date);
    } else if (typeof date === "string") {
      dateObj = new Date(date);
    } else if (date instanceof Date) {
      dateObj = date;
    } else {
      throw new BadRequestException(`${fieldName} must be a valid date, timestamp, or date string`);
    }

    if (isNaN(dateObj.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid date`);
    }

    return dateObj;
  }

  /**
   * Validate object structure
   */
  static validateObject<T>(value: any, fieldName: string, validator: (obj: any) => T): T {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an object`);
    }

    try {
      return validator(value);
    } catch (error) {
      throw new BadRequestException(`${fieldName}: ${(error as Error).message}`);
    }
  }

  /**
   * Validate boolean value
   */
  static validateBoolean(value: unknown, fieldName: string): boolean {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const lowerValue = value.toLowerCase();
      if (lowerValue === "true") return true;
      if (lowerValue === "false") return false;
    }

    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }

    throw new BadRequestException(`${fieldName} must be a boolean value (true/false)`);
  }
}
