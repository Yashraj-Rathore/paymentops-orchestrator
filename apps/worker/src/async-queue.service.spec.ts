import { describe, expect, it } from "vitest";

import { createRedisConnectionOptions } from "./async-queue.service.js";

describe("createRedisConnectionOptions", () => {
  it("parses authenticated Redis URLs for BullMQ workers", () => {
    expect(createRedisConnectionOptions("rediss://user:secret@redis.example:6380/2", true)).toMatchObject({
      host: "redis.example",
      port: 6380,
      username: "user",
      password: "secret",
      db: 2,
      tls: {},
      maxRetriesPerRequest: null
    });
  });

  it("rejects unsupported connection schemes", () => {
    expect(() => createRedisConnectionOptions("http://localhost:6379", false)).toThrow(
      "redis:// or rediss://"
    );
  });
});