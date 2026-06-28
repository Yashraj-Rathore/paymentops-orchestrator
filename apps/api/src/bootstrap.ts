import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { PaymentOpsConfig } from "@paymentops/config";
import { createLogger } from "@paymentops/logger";
import { createHttpObservabilityMiddleware } from "@paymentops/observability";

import { AppModule } from "./app.module.js";
import { DatabaseInitializer } from "./database/database.initializer.js";
import { OperationsService } from "./operations/operations.service.js";

export async function bootstrapApi(config: PaymentOpsConfig): Promise<void> {
  const logger = createLogger({
    service: config.serviceName,
    environment: config.nodeEnv
  });
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  app.use(createHttpObservabilityMiddleware(config.serviceName));
  await app.get(DatabaseInitializer).initialize();
  await app.get(OperationsService).seedDemo();

  app.enableCors({ exposedHeaders: ["x-correlation-id"] });
  app.setGlobalPrefix("v1", {
    exclude: ["health", "docs", "docs-json"]
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle("PaymentOps Orchestrator API")
    .setDescription("Foundation API for the payment operations simulator.")
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup("docs", app, document);

  await app.listen(config.port);
  logger.info("api started", {
    resourceType: "service",
    resourceId: config.serviceName,
    port: config.port,
    otlpEndpoint: config.otelExporterOtlpEndpoint
  });
}
