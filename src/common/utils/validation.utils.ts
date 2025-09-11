import { BadRequestException } from "@nestjs/common";
import type { FeedId } from "@/common/types/http";
import type {
  UnknownInput,
  ArrayValidationOptions,
  ValidatedFeedValuesRequest,
  ValidatedVolumesRequest,
  ValidatedPagination,
  ValidatedTimeRange,
} from "../types/utils/validation.types";

/**
 * Enhanced BadRequestException that includes timestamp and error field for test compliance
 */
class TimestampedBadRequestException extends BadRequestException {
  constructor(message: string) {
    const errorResponse = {
      error: "VALIDATION_ERROR",
      message,
      timestamp: Date.now(),
    };
    super(errorResponse);
  }
}

/**
 * Validation utilities to eliminate request validation duplication
 * Reduces validation boilerplate by 150+ lines across controllers
 * Enhanced with FTSO API compliance validation
 */
export class ValidationUtils {
  /**
   * Valid feed categories as per FTSO specification
   */
  private static readonly VALID_CATEGORIES = [1, 2, 3, 4] as const;

  /**
   * Category descriptions for error messages
   */
  private static readonly CATEGORY_DESCRIPTIONS = {
    1: "Crypto",
    2: "Forex",
    3: "Commodity",
    4: "Stock",
  } as const;

  /**
   * Valid feed name pattern (BASE/QUOTE format)
   */
  private static readonly FEED_NAME_PATTERN = /^[A-Z0-9]{1,10}\/[A-Z]{3,4}$/;

  /**
   * Supported base currencies for FTSO feeds
   */
  private static readonly VALID_BASE_CURRENCIES = new Set([
    // Crypto
    "BTC",
    "ETH",
    "XRP",
    "LTC",
    "ADA",
    "DOT",
    "LINK",
    "UNI",
    "AVAX",
    "SOL",
    "MATIC",
    "POL",
    "ATOM",
    "ALGO",
    "FIL",
    "ICP",
    "NEAR",
    "SHIB",
    "DOGE",
    "BCH",
    "TRX",
    "ETC",
    "XLM",
    "BNB",
    "USDC",
    "USDT",
    "USDS",
    "FLR",
    "SGB",
    "XDC",
    "ARB",
    "INJ",
    "TON",
    "LEO",
    "WIF",
    "BONK",
    "JUP",
    "ETHFI",
    "ENA",
    "PYTH",
    "HNT",
    "SUI",
    "PEPE",
    "QNT",
    "AAVE",
    "ONDO",
    "TAO",
    "FET",
    "RENDER",
    "NOT",
    // Forex
    "EUR",
    "GBP",
    "JPY",
    "CHF",
    "CAD",
    "AUD",
    "NZD",
    "USD",
    // Commodities
    "XAU",
    "XAG",
    "XPT",
    "XPD",
    "OIL",
    "GAS",
    // Stocks (examples)
    "AAPL",
    "GOOGL",
    "MSFT",
    "TSLA",
    "AMZN",
    "META",
    "NVDA",
  ]);

  /**
   * Valid quote currencies
   */
  private static readonly VALID_QUOTE_CURRENCIES = new Set(["USD", "USDT", "USDC", "EUR", "BTC", "ETH"]);
  /**
   * Validate feed ID structure and content with FTSO compliance
   */
  static validateFeedId(feed: unknown, fieldName = "feed"): FeedId {
    if (!feed || typeof feed !== "object") {
      throw new TimestampedBadRequestException(`${fieldName} must be an object with category and name properties`);
    }

    const feedObj = feed as Record<string, unknown>;

    // Validate category with FTSO-specific validation
    const category = this.validateFeedCategory(feedObj.category, `${fieldName}.category`);

    // Validate name with enhanced format checking
    const name = this.validateFeedName(feedObj.name, `${fieldName}.name`);

    return { category, name };
  }

  /**
   * Validate feed category according to FTSO specification
   */
  static validateFeedCategory(category: unknown, fieldName: string): number {
    if (typeof category !== "number") {
      throw new TimestampedBadRequestException(
        `${fieldName} must be a number. Valid categories: ${this.VALID_CATEGORIES.map(
          c => `${c} (${this.CATEGORY_DESCRIPTIONS[c]})`
        ).join(", ")}`
      );
    }

    if (!Number.isInteger(category)) {
      throw new TimestampedBadRequestException(`${fieldName} must be an integer`);
    }

    if (!this.VALID_CATEGORIES.includes(category as 1 | 2 | 3 | 4)) {
      throw new TimestampedBadRequestException(
        `${fieldName} must be one of: ${this.VALID_CATEGORIES.map(c => `${c} (${this.CATEGORY_DESCRIPTIONS[c]})`).join(
          ", "
        )}`
      );
    }

    return category;
  }

  /**
   * Validate feed name format with enhanced FTSO compliance
   * Automatically converts to uppercase for consistent processing
   */
  static validateFeedName(name: unknown, fieldName: string): string {
    if (typeof name !== "string") {
      throw new TimestampedBadRequestException(`${fieldName} must be a string`);
    }

    if (!name.trim()) {
      throw new TimestampedBadRequestException(`${fieldName} cannot be empty`);
    }

    // Normalize to uppercase for consistent processing
    const upperCaseName = name.trim().toUpperCase();

    if (!this.FEED_NAME_PATTERN.test(upperCaseName)) {
      throw new TimestampedBadRequestException(
        `${fieldName} must be in format "BASE/QUOTE" (e.g., "BTC/USD"). ` +
          `Base currency: 1-10 alphanumeric characters, Quote currency: 3-4 letters`
      );
    }

    const [base, quote] = upperCaseName.split("/");

    // Validate base currency
    if (!this.VALID_BASE_CURRENCIES.has(base)) {
      throw new TimestampedBadRequestException(
        `${fieldName} contains unsupported base currency "${base}". ` +
          `Supported currencies include: ${Array.from(this.VALID_BASE_CURRENCIES).slice(0, 10).join(", ")}...`
      );
    }

    // Validate quote currency
    if (!this.VALID_QUOTE_CURRENCIES.has(quote)) {
      throw new TimestampedBadRequestException(
        `${fieldName} contains unsupported quote currency "${quote}". ` +
          `Supported quote currencies: ${Array.from(this.VALID_QUOTE_CURRENCIES).join(", ")}`
      );
    }

    return upperCaseName;
  }

  /**
   * Validate array of feed IDs with duplicate detection
   */
  static validateFeedIds(feeds: unknown, fieldName = "feeds"): FeedId[] {
    if (!Array.isArray(feeds)) {
      throw new TimestampedBadRequestException(`${fieldName} must be an array`);
    }

    if (feeds.length === 0) {
      throw new TimestampedBadRequestException(`${fieldName} array cannot be empty`);
    }

    if (feeds.length > 100) {
      throw new TimestampedBadRequestException(`${fieldName} array cannot contain more than 100 items (FTSO limit)`);
    }

    const validatedFeeds: FeedId[] = [];
    const seenFeeds = new Set<string>();

    for (let i = 0; i < feeds.length; i++) {
      const feed = this.validateFeedId(feeds[i], `${fieldName}[${i}]`);

      // Check for duplicates
      const feedKey = `${feed.category}:${feed.name}`;
      if (seenFeeds.has(feedKey)) {
        throw new TimestampedBadRequestException(
          `${fieldName}[${i}]: Duplicate feed detected (category: ${feed.category}, name: "${feed.name}")`
        );
      }

      seenFeeds.add(feedKey);
      validatedFeeds.push(feed);
    }

    return validatedFeeds;
  }

  /**
   * Validate voting round ID according to FTSO specification
   */
  static validateVotingRoundId(votingRoundId: unknown): number {
    if (typeof votingRoundId !== "number") {
      throw new TimestampedBadRequestException("Invalid votingRoundId parameter: must be a number");
    }

    if (!Number.isInteger(votingRoundId)) {
      throw new TimestampedBadRequestException("Invalid votingRoundId parameter: must be an integer");
    }

    if (votingRoundId < 0) {
      throw new TimestampedBadRequestException("Invalid votingRoundId parameter: must be non-negative");
    }

    if (votingRoundId > Number.MAX_SAFE_INTEGER) {
      throw new TimestampedBadRequestException("Invalid votingRoundId parameter: exceeds maximum safe integer");
    }

    return votingRoundId;
  }

  /**
   * Validate time window for volume requests with FTSO limits
   */
  static validateTimeWindow(windowSec: unknown): number {
    if (typeof windowSec !== "number") {
      throw new TimestampedBadRequestException("window parameter must be a number (seconds)");
    }

    if (!Number.isInteger(windowSec)) {
      throw new TimestampedBadRequestException("window parameter must be an integer");
    }

    if (windowSec <= 0) {
      throw new TimestampedBadRequestException("window parameter must be positive");
    }

    if (windowSec > 86400) {
      throw new TimestampedBadRequestException("window parameter cannot exceed 86400 seconds (24 hours)");
    }

    return windowSec;
  }

  /**
   * Validate timestamp for FTSO API
   */
  static validateTimestamp(timestamp: unknown, fieldName: string): number {
    if (typeof timestamp !== "number") {
      throw new TimestampedBadRequestException(`${fieldName} must be a number (Unix timestamp in milliseconds)`);
    }

    if (!Number.isInteger(timestamp)) {
      throw new TimestampedBadRequestException(`${fieldName} must be an integer`);
    }

    if (timestamp < 0) {
      throw new TimestampedBadRequestException(`${fieldName} must be non-negative`);
    }

    // Check if timestamp is reasonable (not too far in past or future)
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const oneYearFromNow = now + 365 * 24 * 60 * 60 * 1000;

    if (timestamp < oneYearAgo) {
      throw new TimestampedBadRequestException(`${fieldName} is too far in the past (more than 1 year ago)`);
    }

    if (timestamp > oneYearFromNow) {
      throw new TimestampedBadRequestException(`${fieldName} is too far in the future (more than 1 year from now)`);
    }

    return timestamp;
  }

  /**
   * Validate time range for volume requests
   */
  static validateTimeRange(startTime?: unknown, endTime?: unknown): ValidatedTimeRange {
    const result: { startTime?: number; endTime?: number } = {};

    if (startTime !== undefined) {
      result.startTime = this.validateTimestamp(startTime, "startTime");
    }

    if (endTime !== undefined) {
      result.endTime = this.validateTimestamp(endTime, "endTime");
    }

    if (result.startTime && result.endTime && result.startTime >= result.endTime) {
      throw new TimestampedBadRequestException("startTime must be before endTime");
    }

    return result;
  }

  /**
   * Validate request body structure
   */
  static validateRequestBody(body: unknown): UnknownInput {
    if (!body || typeof body !== "object") {
      throw new TimestampedBadRequestException("Request body must be a valid JSON object");
    }

    if (Array.isArray(body)) {
      throw new TimestampedBadRequestException("Request body must be an object, not an array");
    }

    return body as UnknownInput;
  }

  /**
   * Validate feed values request
   */
  static validateFeedValuesRequest(body: unknown): ValidatedFeedValuesRequest {
    const validatedBody = this.validateRequestBody(body);

    if (!validatedBody.feeds) {
      throw new TimestampedBadRequestException("feeds field is required");
    }

    return {
      feeds: this.validateFeedIds(validatedBody.feeds),
    };
  }

  /**
   * Validate volumes request
   */
  static validateVolumesRequest(body: unknown): ValidatedVolumesRequest {
    const validatedBody = this.validateRequestBody(body);

    if (!validatedBody.feeds) {
      throw new TimestampedBadRequestException("feeds field is required");
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
  static sanitizeString(input: unknown, fieldName: string, maxLength = 100): string {
    if (typeof input !== "string") {
      throw new TimestampedBadRequestException(`${fieldName} must be a string`);
    }

    const trimmed = input.trim();

    if (trimmed.length === 0) {
      throw new TimestampedBadRequestException(`${fieldName} cannot be empty`);
    }

    if (trimmed.length > maxLength) {
      throw new TimestampedBadRequestException(`${fieldName} cannot exceed ${maxLength} characters`);
    }

    // Basic sanitization - remove potentially dangerous characters
    const sanitized = trimmed.replace(/[<>\"'&]/g, "");

    if (sanitized !== trimmed) {
      throw new TimestampedBadRequestException(`${fieldName} contains invalid characters`);
    }

    return sanitized;
  }

  /**
   * Validate numeric value with range
   */
  static validateNumericRange(
    value: unknown,
    fieldName: string,
    min?: number,
    max?: number,
    allowFloat = true
  ): number {
    if (typeof value !== "number") {
      throw new TimestampedBadRequestException(`${fieldName} must be a number`);
    }

    if (!allowFloat && !Number.isInteger(value)) {
      throw new TimestampedBadRequestException(`${fieldName} must be an integer`);
    }

    if (isNaN(value) || !isFinite(value)) {
      throw new TimestampedBadRequestException(`${fieldName} must be a valid number`);
    }

    if (min !== undefined && value < min) {
      throw new TimestampedBadRequestException(`${fieldName} must be at least ${min}`);
    }

    if (max !== undefined && value > max) {
      throw new TimestampedBadRequestException(`${fieldName} must be at most ${max}`);
    }

    return value;
  }

  /**
   * Validate pagination parameters
   */
  static validatePagination(page?: unknown, limit?: unknown): ValidatedPagination {
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
      throw new TimestampedBadRequestException(`${fieldName} is required`);
    }
    return value;
  }

  /**
   * Validate array with constraints
   */
  static validateArray<T>(value: unknown, fieldName: string, options: ArrayValidationOptions<T> = {}): T[] {
    if (!Array.isArray(value)) {
      throw new TimestampedBadRequestException(`${fieldName} must be an array`);
    }

    const { minLength = 0, maxLength = 1000, itemValidator } = options;

    if (value.length < minLength) {
      throw new TimestampedBadRequestException(`${fieldName} must have at least ${minLength} items`);
    }

    if (value.length > maxLength) {
      throw new TimestampedBadRequestException(`${fieldName} cannot have more than ${maxLength} items`);
    }

    if (itemValidator) {
      return value.map((item, index) => {
        try {
          return itemValidator(item, index);
        } catch (_error) {
          throw new TimestampedBadRequestException(`${fieldName}[${index}]: ${(_error as Error).message}`);
        }
      });
    }

    return value;
  }

  /**
   * Validate email format
   */
  static validateEmail(email: unknown, fieldName = "email"): string {
    const emailStr = this.sanitizeString(email, fieldName, 254);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(emailStr)) {
      throw new TimestampedBadRequestException(`${fieldName} must be a valid email address`);
    }

    return emailStr.toLowerCase();
  }

  /**
   * Validate URL format
   */
  static validateUrl(url: unknown, fieldName = "url", allowedProtocols = ["http", "https"]): string {
    const urlStr = this.sanitizeString(url, fieldName, 2048);

    try {
      const parsedUrl = new URL(urlStr);

      if (!allowedProtocols.includes(parsedUrl.protocol.slice(0, -1))) {
        throw new TimestampedBadRequestException(
          `${fieldName} must use one of these protocols: ${allowedProtocols.join(", ")}`
        );
      }

      return urlStr;
    } catch {
      throw new TimestampedBadRequestException(`${fieldName} must be a valid URL`);
    }
  }

  /**
   * Validate enum value
   */
  static validateEnum<T>(value: unknown, enumObject: Record<string, T>, fieldName: string): T {
    const enumValues = Object.values(enumObject);

    if (!enumValues.includes(value as T)) {
      throw new TimestampedBadRequestException(`${fieldName} must be one of: ${enumValues.join(", ")}`);
    }

    return value as T;
  }

  /**
   * Validate date string or timestamp
   */
  static validateDate(date: unknown, fieldName: string): Date {
    let dateObj: Date;

    if (typeof date === "number") {
      dateObj = new Date(date);
    } else if (typeof date === "string") {
      dateObj = new Date(date);
    } else if (date instanceof Date) {
      dateObj = date;
    } else {
      throw new TimestampedBadRequestException(`${fieldName} must be a valid date, timestamp, or date string`);
    }

    if (isNaN(dateObj.getTime())) {
      throw new TimestampedBadRequestException(`${fieldName} must be a valid date`);
    }

    return dateObj;
  }

  /**
   * Validate object structure
   */
  static validateObject<T>(value: unknown, fieldName: string, validator: (obj: unknown) => T): T {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TimestampedBadRequestException(`${fieldName} must be an object`);
    }

    try {
      return validator(value);
    } catch (error) {
      throw new TimestampedBadRequestException(`${fieldName}: ${(error as Error).message}`);
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

    throw new TimestampedBadRequestException(`${fieldName} must be a boolean value (true/false)`);
  }

  // FTSO-specific utility methods

  /**
   * Validate that feed exists in configuration
   */
  static validateFeedExists(feed: FeedId, availableFeeds: FeedId[]): void {
    const feedExists = availableFeeds.some(
      availableFeed => availableFeed.category === feed.category && availableFeed.name === feed.name
    );

    if (!feedExists) {
      throw new TimestampedBadRequestException(
        `Feed not found: category ${feed.category}, name "${feed.name}". ` +
          `This feed is not configured in the system.`
      );
    }
  }

  /**
   * Validate multiple feeds exist in configuration
   */
  static validateFeedsExist(feeds: FeedId[], availableFeeds: FeedId[]): void {
    for (const feed of feeds) {
      this.validateFeedExists(feed, availableFeeds);
    }
  }

  /**
   * Get category description for error messages
   */
  static getCategoryDescription(category: number): string {
    return this.CATEGORY_DESCRIPTIONS[category as keyof typeof this.CATEGORY_DESCRIPTIONS] || "Unknown";
  }

  /**
   * Check if feed name format is valid (without throwing)
   */
  static isValidFeedNameFormat(name: string): boolean {
    try {
      this.validateFeedName(name, "name");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if category is valid (without throwing)
   */
  static isValidCategory(category: number): boolean {
    return this.VALID_CATEGORIES.includes(category as 1 | 2 | 3 | 4);
  }
}
