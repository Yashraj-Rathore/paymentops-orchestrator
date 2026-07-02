import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { TenantAccessGuard } from "./tenant-access.guard.js";

function contextFor(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as ExecutionContext;
}

describe("TenantAccessGuard", () => {
  it("allows operations administrators across tenants", async () => {
    const findActiveMembership = vi.fn();
    const guard = new TenantAccessGuard({ findActiveMembership } as unknown as AuthService);
    const request: AuthenticatedRequest = {
      headers: {},
      params: { tenantId: "mer_test" },
      auth: {
        type: "jwt",
        subject: "auth0|admin",
        email: "admin@example.com",
        roles: ["operations_admin"],
        permissions: [],
        tenantId: null,
        apiClientId: null,
        apiKeyId: null
      }
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(findActiveMembership).not.toHaveBeenCalled();
  });

  it("uses the active tenant membership as the authoritative role", async () => {
    const findActiveMembership = vi.fn().mockResolvedValue({
      tenantExternalId: "mer_test",
      role: "merchant_owner"
    });
    const guard = new TenantAccessGuard({ findActiveMembership } as unknown as AuthService);
    const request: AuthenticatedRequest = {
      headers: {},
      params: { tenantId: "mer_test" },
      auth: {
        type: "jwt",
        subject: "auth0|owner",
        email: "owner@example.com",
        roles: ["merchant_owner"],
        permissions: [],
        tenantId: null,
        apiClientId: null,
        apiKeyId: null
      }
    };

    await guard.canActivate(contextFor(request));
    expect(request.auth?.tenantId).toBe("mer_test");
    expect(request.auth?.roles).toEqual(["merchant_owner"]);
  });

  it("rejects users without an active membership", async () => {
    const guard = new TenantAccessGuard({
      findActiveMembership: vi.fn().mockResolvedValue(null)
    } as unknown as AuthService);
    const request: AuthenticatedRequest = {
      headers: {},
      params: { tenantId: "mer_other" },
      auth: {
        type: "jwt",
        subject: "auth0|owner",
        email: "owner@example.com",
        roles: ["merchant_owner"],
        permissions: [],
        tenantId: null,
        apiClientId: null,
        apiKeyId: null
      }
    };

    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
