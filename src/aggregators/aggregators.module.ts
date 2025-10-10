import { Module } from "@nestjs/common";
import { ConsensusAggregator } from "./consensus-aggregator.service";
import { RealTimeAggregationService } from "./real-time-aggregation.service";

import { ConfigModule } from "@/config/config.module";
import { DataManagerModule } from "@/data-manager/data-manager.module";

@Module({
  imports: [ConfigModule, DataManagerModule],
  providers: [ConsensusAggregator, RealTimeAggregationService],
  exports: [ConsensusAggregator, RealTimeAggregationService],
})
export class AggregatorsModule {}
