import { Module } from "@nestjs/common";
import { ConsensusAggregator } from "./consensus-aggregator.service";
import { RealTimeAggregationService } from "./real-time-aggregation.service";
import { ConfigModule } from "@/config/config.module";

@Module({
  imports: [ConfigModule],
  providers: [ConsensusAggregator, RealTimeAggregationService],
  exports: [ConsensusAggregator, RealTimeAggregationService],
})
export class AggregatorsModule {}
