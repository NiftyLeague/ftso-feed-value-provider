import { Module } from "@nestjs/common";
import { ConfigService } from "./config.service";
import { ConfigController } from "./config.controller";
import { ConfigValidationService } from "./config-validation.service";
import { FileWatcherService } from "./file-watcher.service";
import { createMultiDependencyServiceFactory } from "@/common/factories/service.factory";

@Module({
  providers: [
    ConfigValidationService,
    FileWatcherService,
    createMultiDependencyServiceFactory(ConfigService, [ConfigValidationService.name, FileWatcherService.name]),
  ],
  controllers: [ConfigController],
  exports: [ConfigService, ConfigValidationService, FileWatcherService],
})
export class ConfigModule {}
