import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import type { AuthRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";

function createService(repository: Partial<AuthRepository>) {
  return new AuthService(repository as AuthRepository);
}

describe("AuthService", () => {
  it("authenticates the local development admin header", async () => {
    const service = createService({});

    const principal = await service.authenticateAdmin({
      "x-paymentops-dev-admin-token": "dev-admin-token"
    });

    expect(principal).toMatchObject({
      type: "dev_admin",
      subject: "local-dev-admin",
      roles: ["operations_admin", "developer"]
    });
  });

  it("hashes and validates API keys from bearer auth", async () => {
    const secret = "pops_sk_test_unit_secret";
    const expectedHash = createHash("sha256").update(secret).digest("hex");
    const findActiveApiKeyByHash = vi.fn().mockResolvedValue({
      apiKeyId: "key-id",
      apiKeyExternalId: "key_test",
      tenantId: "tenant-id",
      tenantExternalId: "mer_test",
      apiClientId: "client-id",
      apiClientExternalId: "cli_test",
      permissions: ["payouts:read"]
    });
    const service = createService({ findActiveApiKeyByHash });

    const principal = await service.authenticateApiKey({
      authorization: `Bearer ${secret}`
    });

    expect(findActiveApiKeyByHash).toHaveBeenCalledWith(expectedHash);
    expect(principal).toMatchObject({
      type: "api_key",
      subject: "cli_test",
      tenantId: "mer_test",
      apiClientId: "cli_test",
      apiKeyId: "key_test",
      permissions: ["payouts:read"]
    });
  });

  it("maps principals to public session responses", () => {
    const service = createService({});

    expect(
      service.toSessionResponse({
        type: "jwt",
        subject: "auth0|user",
        email: "owner@example.com",
        roles: ["merchant_owner"],
        permissions: ["tenant:read"],
        tenantId: null,
        apiClientId: null,
        apiKeyId: null
      })
    ).toEqual({
      type: "jwt",
      subject: "auth0|user",
      email: "owner@example.com",
      roles: ["merchant_owner"],
      permissions: ["tenant:read"],
      tenantId: null,
      apiClientId: null,
      apiKeyId: null
    });
  });
});