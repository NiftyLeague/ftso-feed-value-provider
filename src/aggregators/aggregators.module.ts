import { Module } from "@nestjs/common";
import { ConsensusAggregator } from "./consensus-aggregator";
import { RealTimeAggregationService } from "./real-time-aggregation.service";

@Module({
  providers: [ConsensusAggregator, RealTimeAggregationService],
  exports: [ConsensusAggregator, RealTimeAggregationService],
})
export class AggregatorsModule {}
