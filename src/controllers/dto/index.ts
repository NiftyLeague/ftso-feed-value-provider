export * from "./common-error.dto";
export * from "./config.dto";
export * from "./feed.dto";
export * from "./health-metrics.dto";

// Aggregated lists for Swagger registration
import { healthMetricModels } from "./health-metrics.dto";
import { HttpErrorResponseDto } from "./common-error.dto";

export const healthApiModels = [...healthMetricModels, HttpErrorResponseDto] as const;
