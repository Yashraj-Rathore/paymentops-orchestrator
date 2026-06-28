import {
  context,
  metrics,
  propagation,
  SpanStatusCode,
  trace,
  type Attributes,
  type BaggageEntry
} from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

const instrumentationName = "@paymentops/observability";
const correlationBaggageKey = "paymentops.correlation_id";
const operationCounter = metrics
  .getMeter(instrumentationName)
  .createCounter("paymentops.operation.count", {
    description: "Number of completed PaymentOps business operations",
    unit: "{operation}"
  });

export interface ObservabilityOptions {
  serviceName: string;
  serviceVersion: string;
  environment: string;
  otlpEndpoint: string;
  metricExportIntervalMs?: number;
}

export interface ObservabilityRuntime {
  shutdown(): Promise<void>;
}

export interface HttpRequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface HttpResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  once(event: "finish", listener: () => void): void;
}

export type HttpMiddleware = (
  request: HttpRequestLike,
  response: HttpResponseLike,
  next: () => void
) => void;

let runtime: ObservabilityRuntime | null = null;

export function startObservability(options: ObservabilityOptions): ObservabilityRuntime {
  if (runtime) {
    return runtime;
  }

  if (process.env.OTEL_SDK_DISABLED === "true") {
    runtime = { shutdown: async () => undefined };
    return runtime;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": options.serviceName,
      "service.version": options.serviceVersion,
      "deployment.environment.name": options.environment
    }),
    traceExporter: new OTLPTraceExporter({
      url: otlpSignalUrl(options.otlpEndpoint, "traces")
    }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: otlpSignalUrl(options.otlpEndpoint, "metrics")
      }),
      exportIntervalMillis: options.metricExportIntervalMs ?? 10_000
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false }
      })
    ]
  });

  sdk.start();
  runtime = { shutdown: () => sdk.shutdown() };
  process.once("SIGTERM", () => void runtime?.shutdown());
  process.once("SIGINT", () => void runtime?.shutdown());
  return runtime;
}

export function createHttpObservabilityMiddleware(serviceName: string): HttpMiddleware {
  const meter = metrics.getMeter(instrumentationName);
  const requestCount = meter.createCounter("paymentops.http.server.request.count", {
    description: "Number of inbound HTTP requests",
    unit: "{request}"
  });
  const requestDuration = meter.createHistogram("paymentops.http.server.request.duration", {
    description: "Inbound HTTP request duration",
    unit: "s"
  });

  return (request, response, next) => {
    const startedAt = performance.now();
    const correlationId = requestHeader(request, "x-correlation-id") ?? randomUUID();
    response.setHeader("x-correlation-id", correlationId);

    response.once("finish", () => {
      const attributes: Attributes = {
        "service.name": serviceName,
        "http.request.method": request.method ?? "UNKNOWN",
        "http.response.status_code": response.statusCode
      };
      requestCount.add(1, attributes);
      requestDuration.record((performance.now() - startedAt) / 1000, attributes);
    });

    const baggageEntry: BaggageEntry = { value: correlationId };
    const baggage = propagation.createBaggage({
      [correlationBaggageKey]: baggageEntry
    });
    context.with(propagation.setBaggage(context.active(), baggage), next);
  };
}

export async function withActiveSpan<T>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>
): Promise<T> {
  return trace
    .getTracer(instrumentationName)
    .startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await operation();
      } catch (error) {
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      } finally {
        span.end();
      }
    });
}

export function recordPaymentOperation(operation: string, attributes: Attributes = {}): void {
  operationCounter.add(1, {
    "paymentops.operation": operation,
    ...attributes
  });
}

export function otlpSignalUrl(endpoint: string, signal: "traces" | "metrics"): string {
  const baseUrl = endpoint
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v1\/(traces|metrics)$/, "");
  return `${baseUrl}/v1/${signal}`;
}

function requestHeader(request: HttpRequestLike, name: string): string | null {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }

  return value?.trim() || null;
}
