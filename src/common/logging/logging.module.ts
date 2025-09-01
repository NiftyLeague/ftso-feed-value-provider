import { Module, Global } from "@nestjs/common";
import { EnhancedLoggerService } from "./enhanced-logger.service";

@Global()
@Module({
  providers: [
    {
      provide: "EnhancedLogger",
      useFactory: () => {
        return new EnhancedLoggerService("Global");
      },
    },
  ],
  exports: ["EnhancedLogger"],
})
export class LoggingModule {}
