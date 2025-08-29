import * as dotenv from "dotenv";
dotenv.config();

import helmet from "helmet";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerDocumentOptions, SwaggerModule } from "@nestjs/swagger";
import { LogLevel } from "@nestjs/common";
import { AppModule } from "@/app.module";

async function bootstrap() {
  let logLevels: LogLevel[] = ["log"];
  if (process.env.LOG_LEVEL == "debug") {
    logLevels = ["verbose"];
  }
  if (process.env.LOG_LEVEL == "warn") {
    logLevels = ["warn"];
  }

  const app = await NestFactory.create(AppModule, { logger: logLevels });
  app.use(helmet());
  const basePath = process.env.VALUE_PROVIDER_CLIENT_BASE_PATH ?? "";

  const config = new DocumentBuilder()
    .setTitle("Production FTSO Feed Value Provider API")
    .setDescription(
      "Production-grade FTSO protocol data provider with real-time caching, rate limiting, and comprehensive error handling."
    )
    .setVersion("1.0")
    .build();
  const options: SwaggerDocumentOptions = {
    operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
  };
  const document = SwaggerModule.createDocument(app, config, options);
  SwaggerModule.setup(`${basePath}/api-doc`, app, document);

  app.setGlobalPrefix(basePath);

  const PORT = process.env.VALUE_PROVIDER_CLIENT_PORT ? parseInt(process.env.VALUE_PROVIDER_CLIENT_PORT) : 3101;
  console.log(`Production FTSO Feed Value Provider is available on PORT: ${PORT}`);
  console.log(`Open link: http://localhost:${PORT}/api-doc`);
  await app.listen(PORT, "0.0.0.0");
}

void bootstrap();
