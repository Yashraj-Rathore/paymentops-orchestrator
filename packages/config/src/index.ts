import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadWorkspaceEnv();

export type ServiceName = "api" | "worker" | "web" | "provider-simulator";

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WEB_PORT: z.coerce.number().int().positive().default(3001),
  WORKER_PORT: z.coerce.number().int().positive().default(3002),
  PROVIDER_SIMULATOR_PORT: z.coerce.number().int().positive().default(3003),
  DATABASE_URL: z
    .string()
    .default("sqlserver://sa:YourStrong!Passw0rd@localhost:1433;database=paymentops;encrypt=false;trustServerCertificate=true"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDPANDA_BROKERS: z.string().default("localhost:9092"),
  AUTH0_DOMAIN: z.string().default("paymentops-dev.us.auth0.com"),
  AUTH0_AUDIENCE: z.string().default("https://api.paymentops.local"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default("http://localhost:4318"),
  PROVIDER_SIMULATOR_URL: z.string().url().default("http://localhost:3003")
});

export interface PaymentOpsConfig {
  serviceName: ServiceName;
  nodeEnv: "development" | "test" | "production";
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  port: number;
  databaseUrl: string;
  redisUrl: string;
  redpandaBrokers: string[];
  auth0: {
    domain: string;
    audience: string;
  };
  otelExporterOtlpEndpoint: string;
  providerSimulatorUrl: string;
}

export function loadConfig(
  serviceName: ServiceName,
  env: NodeJS.ProcessEnv = process.env
): PaymentOpsConfig {
  const parsed = baseSchema.parse(env);

  return {
    serviceName,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    port: portForService(serviceName, parsed),
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    redpandaBrokers: parsed.REDPANDA_BROKERS.split(",").map((broker) => broker.trim()),
    auth0: {
      domain: parsed.AUTH0_DOMAIN,
      audience: parsed.AUTH0_AUDIENCE
    },
    otelExporterOtlpEndpoint: parsed.OTEL_EXPORTER_OTLP_ENDPOINT,
    providerSimulatorUrl: parsed.PROVIDER_SIMULATOR_URL
  };
}

function portForService(serviceName: ServiceName, env: z.infer<typeof baseSchema>): number {
  switch (serviceName) {
    case "api":
      return env.API_PORT;
    case "web":
      return env.WEB_PORT;
    case "worker":
      return env.WORKER_PORT;
    case "provider-simulator":
      return env.PROVIDER_SIMULATOR_PORT;
  }
}

function loadWorkspaceEnv(): void {
  let directory = process.cwd();

  while (true) {
    const candidate = join(directory, ".env");

    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      return;
    }

    directory = parent;
  }
}