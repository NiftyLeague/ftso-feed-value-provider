import { Module } from "@nestjs/common";
import { ProductionDataManagerService } from "./production-data-manager.service";
import { ValidationService } from "./validation/validation.service";
import { DataValidator } from "./validation/data-validator";

// Error handling services
import { UniversalRetryService } from "@/error-handling/universal-retry.service";

@Module({
  providers: [
    ProductionDataManagerService,
    UniversalRetryService,
    {
      provide: DataValidator,
      useFactory: (universalRetryService: UniversalRetryService) => {
        return new DataValidator(universalRetryService);
      },
      inject: [UniversalRetryService],
    },
    {
      provide: ValidationService,
      useFactory: (dataValidator: DataValidator, universalRetryService: UniversalRetryService) => {
        return new ValidationService(dataValidator, universalRetryService);
      },
      inject: [DataValidator, UniversalRetryService],
    },
  ],
  exports: [ProductionDataManagerService, ValidationService, DataValidator],
})
export class DataManagerModule {}
