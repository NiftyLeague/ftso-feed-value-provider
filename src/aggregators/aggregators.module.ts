import { Module, forwardRef } from "@nestjs/common";
import { ConsensusAggregator } from "./consensus-aggregator.service";
import { RealTimeAggregationService } from "./real-time-aggregation.service";
import { ConfigModule } from "@/config/config.module";
import { IntegrationModule } from "@/integration/integration.module";

@Module({
  imports: [ConfigModule, forwardRef(() => IntegrationModule)],
  providers: [ConsensusAggregator, RealTimeAggregationService],
  exports: [ConsensusAggregator, RealTimeAggregationService],
})
export class AggregatorsModule {}
