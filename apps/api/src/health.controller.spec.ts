import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";

import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("returns an ok response", async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController]
    }).compile();

    const controller = moduleRef.get(HealthController);

    expect(controller.getHealth()).toMatchObject({
      status: "ok",
      service: "api"
    });
  });
});