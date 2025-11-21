import { ApiProperty } from "@nestjs/swagger";

export class EnvironmentConfigDto {
  @ApiProperty({
    description: "Whether the configuration is valid",
    example: true,
  })
  isValid!: boolean;

  @ApiProperty({
    description: "When the configuration was loaded",
    example: "2024-01-01T00:00:00.000Z",
  })
  loadedAt!: Date;

  @ApiProperty({
    description: "Node environment",
    example: "production",
    enum: ["development", "production", "test"],
  })
  nodeEnv!: string;

  @ApiProperty({
    description: "Application port",
    example: 3101,
  })
  port!: number;
}

export class MonitoringConfigDto {
  @ApiProperty({
    description: "Whether monitoring is enabled",
    example: true,
  })
  enabled!: boolean;

  @ApiProperty({
    description: "Metrics port",
    example: 9090,
  })
  metricsPort!: number;
}

export class LoggingConfigDto {
  @ApiProperty({
    description: "Log level",
    example: "info",
    enum: ["error", "warn", "info", "debug", "verbose"],
  })
  level!: string;

  @ApiProperty({
    description: "Whether file logging is enabled",
    example: true,
  })
  fileLogging!: boolean;

  @ApiProperty({
    description: "Whether performance logging is enabled",
    example: true,
  })
  performanceLogging!: boolean;
}

export class CacheConfigDto {
  @ApiProperty({
    description: "Cache TTL in milliseconds",
    example: 3000,
  })
  ttlMs!: number;

  @ApiProperty({
    description: "Maximum cache entries",
    example: 1000,
  })
  maxEntries!: number;
}

export class SystemConfigDto {
  @ApiProperty({
    description: "Monitoring configuration",
    type: MonitoringConfigDto,
  })
  monitoring!: MonitoringConfigDto;

  @ApiProperty({
    description: "Logging configuration",
    type: LoggingConfigDto,
  })
  logging!: LoggingConfigDto;

  @ApiProperty({
    description: "Cache configuration",
    type: CacheConfigDto,
  })
  cache!: CacheConfigDto;
}

export class FeedsConfigDto {
  @ApiProperty({
    description: "Number of configured feeds",
    example: 64,
  })
  count!: number;

  @ApiProperty({
    description: "When feeds were loaded",
    example: "2024-01-01T00:00:00.000Z",
  })
  loadedAt!: Date;

  @ApiProperty({
    description: "Path to feeds configuration file",
    example: "src/config/feeds.json",
  })
  filePath!: string;
}

export class AdaptersConfigDto {
  @ApiProperty({
    description: "Number of custom adapters",
    example: 5,
  })
  customAdapterCount!: number;

  @ApiProperty({
    description: "Number of CCXT adapters",
    example: 11,
  })
  ccxtAdapterCount!: number;

  @ApiProperty({
    description: "Total number of exchanges",
    example: 16,
  })
  totalExchanges!: number;
}

export class ConfigStatusResponseDto {
  @ApiProperty({
    description: "Environment configuration",
    type: EnvironmentConfigDto,
  })
  environment!: EnvironmentConfigDto;

  @ApiProperty({
    description: "System configuration",
    type: SystemConfigDto,
  })
  system!: SystemConfigDto;

  @ApiProperty({
    description: "Feeds configuration",
    type: FeedsConfigDto,
  })
  feeds!: FeedsConfigDto;

  @ApiProperty({
    description: "Adapters configuration",
    type: AdaptersConfigDto,
  })
  adapters!: AdaptersConfigDto;
}

export class ValidationResultDto {
  @ApiProperty({
    description: "Field name",
    example: "NODE_ENV",
  })
  field!: string;

  @ApiProperty({
    description: "Whether the field is valid",
    example: true,
  })
  isValid!: boolean;

  @ApiProperty({
    description: "Validation errors",
    type: "array",
    items: { type: "string" },
    example: [],
  })
  errors!: string[];

  @ApiProperty({
    description: "Validation warnings",
    type: "array",
    items: { type: "string" },
    example: [],
  })
  warnings!: string[];
}

export class FeedValidationResultDto {
  @ApiProperty({
    description: "Feed name",
    example: "BTC/USD",
  })
  feedName!: string;

  @ApiProperty({
    description: "Whether the feed is valid",
    example: true,
  })
  isValid!: boolean;

  @ApiProperty({
    description: "Validation errors",
    type: "array",
    items: { type: "string" },
    example: [],
  })
  errors!: string[];

  @ApiProperty({
    description: "Validation warnings",
    type: "array",
    items: { type: "string" },
    example: [],
  })
  warnings!: string[];
}

export class ValidationOverallDto {
  @ApiProperty({
    description: "Whether validation passed",
    example: true,
  })
  isValid!: boolean;

  @ApiProperty({
    description: "Number of critical errors",
    example: 0,
  })
  criticalErrors!: number;

  @ApiProperty({
    description: "Number of warnings",
    example: 0,
  })
  warnings!: number;
}

export class EnvironmentValidationDto {
  @ApiProperty({
    description: "Whether environment validation passed",
    example: true,
  })
  isValid!: boolean;

  @ApiProperty({
    description: "Validation errors",
    type: "array",
    items: { type: "string" },
    example: [],
  })
  errors!: string[];

  @ApiProperty({
    description: "Validation warnings",
    type: "array",
    items: { type: "string" },
    example: [],
  })
  warnings!: string[];
}

export class FeedsValidationDto {
  @ApiProperty({
    description: "Total number of feeds",
    example: 64,
  })
  totalFeeds!: number;

  @ApiProperty({
    description: "Total number of sources",
    example: 320,
  })
  totalSources!: number;

  @ApiProperty({
    description: "Validation results for each feed",
    type: [FeedValidationResultDto],
  })
  validationResults!: FeedValidationResultDto[];
}

export class ConfigValidationResponseDto {
  @ApiProperty({
    description: "Overall validation status",
    type: ValidationOverallDto,
  })
  overall!: ValidationOverallDto;

  @ApiProperty({
    description: "Environment validation results",
    type: EnvironmentValidationDto,
  })
  environment!: EnvironmentValidationDto;

  @ApiProperty({
    description: "Feeds validation results",
    type: FeedsValidationDto,
  })
  feeds!: FeedsValidationDto;
}

export class CcxtParametersDto {
  @ApiProperty({
    description: "Lambda parameter for CCXT",
    example: 0.00005,
  })
  lambda!: number;

  @ApiProperty({
    description: "Trades limit for CCXT",
    example: 1000,
  })
  tradesLimit!: number;

  @ApiProperty({
    description: "Retry backoff in milliseconds",
    example: 10000,
  })
  retryBackoffMs!: number;
}

export class HybridSummaryDto {
  @ApiProperty({
    description: "Custom adapter exchanges",
    type: "array",
    items: { type: "string" },
    example: ["binance", "coinbase", "cryptocom", "kraken", "okx"],
  })
  customAdapterExchanges!: string[];

  @ApiProperty({
    description: "CCXT exchanges",
    type: "array",
    items: { type: "string" },
    example: ["bitfinex", "bitstamp", "gemini"],
  })
  ccxtExchanges!: string[];

  @ApiProperty({
    description: "CCXT parameters",
    type: CcxtParametersDto,
  })
  ccxtParameters!: CcxtParametersDto;
}

export class FeedSummaryResponseDto {
  @ApiProperty({
    description: "Total number of feeds",
    example: 64,
  })
  totalFeeds!: number;

  @ApiProperty({
    description: "Feeds grouped by category",
    type: "object",
    additionalProperties: { type: "number" },
    example: { "1": 50, "2": 10, "3": 3, "4": 1 },
  })
  feedsByCategory!: Record<number, number>;

  @ApiProperty({
    description: "Total number of data sources",
    example: 320,
  })
  totalSources!: number;

  @ApiProperty({
    description: "Exchange usage statistics",
    type: "object",
    additionalProperties: { type: "number" },
    example: { binance: 64, coinbase: 64, kraken: 32 },
  })
  exchangeUsage!: Record<string, number>;

  @ApiProperty({
    description: "Hybrid provider summary",
    type: HybridSummaryDto,
  })
  hybridSummary!: HybridSummaryDto;
}

export class HybridProviderConfigDto {
  @ApiProperty({
    description: "Custom adapter exchanges",
    type: "array",
    items: { type: "string" },
    example: ["binance", "coinbase", "cryptocom", "kraken", "okx"],
  })
  customAdapterExchanges!: string[];

  @ApiProperty({
    description: "CCXT exchanges",
    type: "array",
    items: { type: "string" },
    example: ["bitfinex", "bitstamp", "gemini"],
  })
  ccxtExchanges!: string[];

  @ApiProperty({
    description: "CCXT parameters",
    type: CcxtParametersDto,
  })
  ccxtParameters!: CcxtParametersDto;
}

export class AdapterConfigurationResponseDto {
  @ApiProperty({
    description: "Custom adapter exchanges",
    type: "array",
    items: { type: "string" },
    example: ["binance", "coinbase", "cryptocom", "kraken", "okx"],
  })
  customAdapterExchanges!: string[];

  @ApiProperty({
    description: "CCXT exchanges",
    type: "array",
    items: { type: "string" },
    example: ["bitfinex", "bitstamp", "gemini"],
  })
  ccxtExchanges!: string[];

  @ApiProperty({
    description: "Hybrid provider configuration",
    type: HybridProviderConfigDto,
  })
  hybridProviderConfig!: HybridProviderConfigDto;
}
