import { describe, expect, it, vi } from "vitest";

import { createLogger } from "./index.js";

describe("createLogger", () => {
  it("writes structured log lines", () => {
    const sink = vi.fn();
    const logger = createLogger({ service: "api", environment: "test", sink });

    logger.info("hello", { tenantId: "mer_test" });

    expect(sink).toHaveBeenCalledOnce();
    expect(JSON.parse(sink.mock.calls[0][0] as string)).toMatchObject({
      level: "info",
      service: "api",
      tenantId: "mer_test",
      message: "hello"
    });
  });
});