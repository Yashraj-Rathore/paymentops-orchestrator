import { NestFactory } from "@nestjs/core";
import type { PaymentOpsConfig } from "@paymentops/config";
import { createLogger } from "@paymentops/logger";

import { AppModule } from "./app.module.js";

export async function bootstrapWorker(config: PaymentOpsConfig): Promise<void> {
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
    redpandaBrokers: config.redpandaBrokers,
    otlpEndpoint: config.otelExporterOtlpEndpoint
  });
}
