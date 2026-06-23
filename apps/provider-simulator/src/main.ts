import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadConfig } from "@paymentops/config";
import { createLogger } from "@paymentops/logger";

import { AppModule } from "./app.module.js";

async function bootstrap() {
  const config = loadConfig("provider-simulator");
  const logger = createLogger({
    service: config.serviceName,
    environment: config.nodeEnv
  });

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  app.enableCors();
  app.setGlobalPrefix("v1", {
    exclude: ["health", "docs", "docs-json"]
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle("PaymentOps Provider Simulator")
    .setDescription("Foundation simulator for external payment rail behavior.")
    .setVersion("0.1.0")
    .build();

  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup("docs", app, document);

  await app.listen(config.port);

  logger.info("provider simulator started", {
    resourceType: "service",
    resourceId: config.serviceName,
    port: config.port
  });
}

void bootstrap();
