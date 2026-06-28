import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { PaymentOpsConfig } from "@paymentops/config";
import { createLogger } from "@paymentops/logger";
import { createHttpObservabilityMiddleware } from "@paymentops/observability";

import { AppModule } from "./app.module.js";

export async function bootstrapProviderSimulator(config: PaymentOpsConfig): Promise<void> {
  const logger = createLogger({
    service: config.serviceName,
    environment: config.nodeEnv
  });
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true
  });

  app.use(createHttpObservabilityMiddleware(config.serviceName));
  app.enableCors({ exposedHeaders: ["x-correlation-id"] });
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
    port: config.port,
    otlpEndpoint: config.otelExporterOtlpEndpoint
  });
}
