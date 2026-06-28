import { describe, expect, it, vi } from "vitest";

import { createHttpObservabilityMiddleware, otlpSignalUrl, withActiveSpan } from "./index.js";

describe("otlpSignalUrl", () => {
  it("normalizes collector base and signal URLs", () => {
    expect(otlpSignalUrl("http://collector:4318/", "traces")).toBe(
      "http://collector:4318/v1/traces"
    );
    expect(otlpSignalUrl("http://collector:4318/v1/traces", "metrics")).toBe(
      "http://collector:4318/v1/metrics"
    );
  });
});

describe("createHttpObservabilityMiddleware", () => {
  it("preserves correlation ids and continues the request", () => {
    const setHeader = vi.fn();
    const once = vi.fn();
    const next = vi.fn();
    const middleware = createHttpObservabilityMiddleware("api");

    middleware(
      {
        method: "GET",
        headers: { "x-correlation-id": "corr_test" }
      },
      {
        statusCode: 200,
        setHeader,
        once
      },
      next
    );

    expect(setHeader).toHaveBeenCalledWith("x-correlation-id", "corr_test");
    expect(once).toHaveBeenCalledWith("finish", expect.any(Function));
    expect(next).toHaveBeenCalledOnce();
  });
});
describe("withActiveSpan", () => {
  it("returns the operation result without an installed SDK", async () => {
    await expect(withActiveSpan("test.operation", {}, async () => "done")).resolves.toBe("done");
  });
});
