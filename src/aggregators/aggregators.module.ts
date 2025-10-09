import { Module, forwardRef } from "@nestjs/common";
import { ConsensusAggregator } from "./consensus-aggregator.service";
import { RealTimeAggregationService } from "./real-time-aggregation.service";

import { IntegrationModule } from "@/integration/integration.module";
import { ConfigModule } from "@/config/config.module";

@Module({
  imports: [forwardRef(() => IntegrationModule), ConfigModule],
  providers: [ConsensusAggregator, RealTimeAggregationService],
  exports: [ConsensusAggregator, RealTimeAggregationService],
})
export class AggregatorsModule {}
