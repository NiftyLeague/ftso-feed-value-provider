import { Module } from "@nestjs/common";
import { RealTimeCacheService } from "./real-time-cache.service";

@Module({
  providers: [RealTimeCacheService],
  exports: [RealTimeCacheService],
})
export class CacheModule {}
