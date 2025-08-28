export enum ErrorSeverity {
  LOW = "low", // Single source failure
  MEDIUM = "medium", // Multiple source failures
  HIGH = "high", // Accuracy threshold breach
  CRITICAL = "critical", // System-wide failure
}

export interface ValidationError extends Error {
  feedId: string;
  value: number;
  reason: string;
}

export interface AggregationError extends Error {
  feedId: string;
  sources: string[];
  reason: string;
}

export interface ApiError extends Error {
  statusCode: number;
  requestId: string;
  timestamp: number;
}

export interface ErrorHandler {
  handleDataSourceError(source: string, error: Error): void;
  handleValidationError(data: any, error: ValidationError): void;
  handleAggregationError(symbol: string, error: AggregationError): void;
  handleApiError(request: any, error: ApiError): any;
}

export interface RecoveryStrategy {
  canRecover(error: Error): boolean;
  recover(error: Error): Promise<boolean>;
  getRecoveryTime(): number;
}
