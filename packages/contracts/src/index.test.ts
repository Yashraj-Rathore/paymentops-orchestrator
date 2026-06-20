import { describe, expect, it } from "vitest";

import { foundationHealthContract } from "./index.js";

describe("foundationHealthContract", () => {
  it("names the health route", () => {
    expect(foundationHealthContract.path).toBe("/health");
  });
});