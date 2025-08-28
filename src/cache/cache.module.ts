import { Module } from "@nestjs/common";
import { RealTimeCacheService } from "./real-time-cache.service";
import { CacheWarmerService } from "./cache-warmer.service";
import { CachePerformanceMonitorService } from "./cache-performance-monitor.service";

@Module({
  providers: [RealTimeCacheService, CacheWarmerService, CachePerformanceMonitorService],
  exports: [RealTimeCacheService, CacheWarmerService, CachePerformanceMonitorService],
})
export class CacheModule {}
