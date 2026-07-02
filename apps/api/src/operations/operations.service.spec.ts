import { describe, expect, it, vi } from "vitest";

import type { OperationsRepository } from "./operations.repository.js";
import { OperationsService } from "./operations.service.js";

function createService(repository: Partial<OperationsRepository>) {
  return new OperationsService(repository as OperationsRepository);
}

describe("OperationsService lifecycle", () => {
  it("normalizes invited tenant memberships", async () => {
    const createMembership = vi.fn().mockResolvedValue({ id: "member-id" });
    const service = createService({ createMembership });

    await service.createMembership("mer_test", {
      email: " Owner@Example.com ",
      role: "merchant_owner"
    });

    expect(createMembership).toHaveBeenCalledWith({
      tenantExternalId: "mer_test",
      email: "owner@example.com",
      role: "merchant_owner",
      status: "invited"
    });
  });

  it("rejects tenant updates without mutable fields", async () => {
    const service = createService({});
    await expect(service.updateTenant("mer_test", {})).rejects.toThrow(
      "At least one update field is required"
    );
  });

  it("rotates API keys with a new one-time secret", async () => {
    const rotateApiKey = vi.fn().mockImplementation((input) => ({
      id: input.replacementExternalId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      permissions: input.permissions,
      createdAt: new Date().toISOString(),
      expiresAt: null,
      secret: input.secret
    }));
    const service = createService({ rotateApiKey });

    const result = await service.rotateApiKey("mer_test", "key_old", {
      name: "Checkout rotated",
      permissions: ["payouts:read"]
    });

    expect(result.secret).toMatch(/^pops_sk_test_/);
    expect(rotateApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantExternalId: "mer_test",
        apiKeyExternalId: "key_old",
        name: "Checkout rotated",
        permissions: ["payouts:read"]
      })
    );
  });

  it("validates webhook updates", async () => {
    const service = createService({});
    await expect(
      service.updateWebhookEndpoint("mer_test", "whk_test", {
        url: "ftp://example.com/events"
      })
    ).rejects.toThrow("url must be a valid http or https URL");
  });
});
