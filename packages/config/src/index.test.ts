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

  it("rejects development authentication in production", () => {
    expect(() =>
      loadConfig("api", {
        NODE_ENV: "production",
        AUTH_MODE: "development"
      })
    ).toThrow("AUTH_MODE must be auth0");
  });

  it("rejects insecure SQL Server connections in production", () => {
    expect(() =>
      loadConfig("worker", {
        NODE_ENV: "production",
        DATABASE_URL:
          "sqlserver://user:password@example:1433;database=paymentops;encrypt=false;trustServerCertificate=true"
      })
    ).toThrow("DATABASE_URL must enable encryption and certificate verification");
  });

  it("loads explicit production API settings", () => {
    const config = loadConfig("api", {
      NODE_ENV: "production",
      AUTH_MODE: "auth0",
      AUTH0_DOMAIN: "tenant.us.auth0.com",
      AUTH0_AUDIENCE: "https://api.paymentops.example",
      CORS_ORIGINS: "https://paymentops.example.com",
      DATABASE_URL:
        "sqlserver://user:password@example:1433;database=paymentops;encrypt=true;trustServerCertificate=false"
    });

    expect(config.auth.mode).toBe("auth0");
    expect(config.corsOrigins).toEqual(["https://paymentops.example.com"]);
  });
});
