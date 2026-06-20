import { describe, expect, it } from "vitest";

import { paymentOpsPalette } from "./index.js";

describe("paymentOpsPalette", () => {
  it("defines the primary action color", () => {
    expect(paymentOpsPalette.action).toBe("#2563eb");
  });
});