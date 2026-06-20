import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { loadConfig } from "@paymentops/config";
import { createLogger } from "@paymentops/logger";

import { AppModule } from "./app.module.js";

async function bootstrap() {
  const config = loadConfig("worker");
  const logger = createLogger({
    service: config.serviceName,
    environment: config.nodeEnv
  });

  await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true
  });

  logger.info("worker started", {
    resourceType: "service",
    resourceId: config.serviceName,
    redpandaBrokers: config.redpandaBrokers
  });
}

void bootstrap();