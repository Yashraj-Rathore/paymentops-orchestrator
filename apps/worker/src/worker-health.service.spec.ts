import { describe, expect, it } from "vitest";

import { asyncQueueNames } from "./async.constants.js";
import { WorkerHealthService } from "./worker-health.service.js";

describe("WorkerHealthService", () => {
  it("reports durable queue readiness", () => {
    expect(new WorkerHealthService().getStatus()).toEqual({
      status: "ready",
      queues: [
        asyncQueueNames.payoutDispatch,
        asyncQueueNames.webhookDelivery,
        asyncQueueNames.deadLetter
      ]
    });
  });
});