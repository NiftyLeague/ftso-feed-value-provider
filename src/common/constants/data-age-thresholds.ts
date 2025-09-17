import { EnvironmentUtils } from "@/common/utils/environment.utils";

export const DATA_AGE_THRESHOLDS = {
  // Maximum age for considering data "fresh" - higher values allow for more network latency/jitter
  FRESH_DATA_MS: EnvironmentUtils.parseInt("FRESH_DATA_MS", 2000, { min: 500, max: 10000 }),

  // Maximum age for accepting data at all - after this age, data is completely ignored
  MAX_DATA_AGE_MS: EnvironmentUtils.parseInt("MAX_DATA_AGE_MS", 20000, { min: 5000, max: 60000 }),

  // Age threshold for triggering staleness warnings - helps identify latency issues early
  STALE_WARNING_MS: EnvironmentUtils.parseInt("STALE_WARNING_MS", 2000, { min: 500, max: 5000 }),

  // Cache TTL for price data
  CACHE_TTL_MS: EnvironmentUtils.parseInt("CACHE_TTL_MS", 500, { min: 100, max: 2000 }),
} as const;
