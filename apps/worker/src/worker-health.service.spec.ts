import { describe, expect, it } from "vitest";

import { WorkerHealthService } from "./worker-health.service.js";

describe("WorkerHealthService", () => {
  it("reports foundation readiness", () => {
    expect(new WorkerHealthService().getStatus()).toEqual({
      status: "ready",
      queues: []
    });
  });
});