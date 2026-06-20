import { describe, expect, it } from "vitest";

import { fixedIsoDate } from "./index.js";

describe("fixedIsoDate", () => {
  it("returns a stable timestamp for assertions", () => {
    expect(fixedIsoDate()).toBe("2026-06-20T00:00:00.000Z");
  });
});