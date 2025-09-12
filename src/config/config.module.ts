import { Module } from "@nestjs/common";
import { ConfigService } from "./config.service";
import { ConfigController } from "./config.controller";
import { ConfigValidationService } from "./config-validation.service";
import { FileWatcherService } from "./file-watcher.service";

@Module({
  providers: [
    ConfigValidationService,
    FileWatcherService,
    {
      provide: ConfigService,
      useFactory: (configValidationService: ConfigValidationService, fileWatcherService: FileWatcherService) => {
        return new ConfigService(configValidationService, fileWatcherService);
      },
      inject: [ConfigValidationService, FileWatcherService],
    },
  ],
  controllers: [ConfigController],
  exports: [ConfigService, ConfigValidationService, FileWatcherService],
})
export class ConfigModule {}
