import { describe, expect, it } from "vitest";

import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("loads foundation defaults for a service", () => {
    const config = loadConfig("api", {
      API_PORT: "3100",
      NODE_ENV: "test"
    });

    expect(config.serviceName).toBe("api");
    expect(config.port).toBe(3100);
    expect(config.nodeEnv).toBe("test");
  });
});