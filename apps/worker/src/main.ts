import "reflect-metadata";

import { loadConfig } from "@paymentops/config";
import { startObservability } from "@paymentops/observability";

async function main(): Promise<void> {
  const config = loadConfig("worker");
  startObservability({
    serviceName: config.serviceName,
    serviceVersion: "0.1.0",
    environment: config.nodeEnv,
    otlpEndpoint: config.otelExporterOtlpEndpoint
  });

  const { bootstrapWorker } = await import("./bootstrap.js");
  await bootstrapWorker(config);
}

void main();
