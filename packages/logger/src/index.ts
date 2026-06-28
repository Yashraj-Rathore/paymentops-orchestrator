import { context, isSpanContextValid, propagation, trace } from "@opentelemetry/api";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogContext {
  traceId?: string;
  correlationId?: string;
  tenantId?: string;
  resourceType?: string;
  resourceId?: string;
  eventType?: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  service: string;
  environment: string;
  sink?: (line: string) => void;
}

export interface PaymentOpsLogger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
}

export function createLogger(options: LoggerOptions): PaymentOpsLogger {
  const sink = options.sink ?? console.log;

  const write = (level: LogLevel, message: string, context: LogContext = {}) => {
    sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: options.service,
        environment: options.environment,
        message,
        ...activeTelemetryContext(),
        ...context
      })
    );
  };

  return {
    trace: (message, context) => write("trace", message, context),
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
    fatal: (message, context) => write("fatal", message, context)
  };
}
function activeTelemetryContext(): Pick<LogContext, "traceId" | "correlationId"> {
  const activeContext = context.active();
  const spanContext = trace.getSpanContext(activeContext);
  const correlationId = propagation
    .getBaggage(activeContext)
    ?.getEntry("paymentops.correlation_id")?.value;

  return {
    ...(spanContext && isSpanContextValid(spanContext) ? { traceId: spanContext.traceId } : {}),
    ...(correlationId ? { correlationId } : {})
  };
}
