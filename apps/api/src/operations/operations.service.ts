import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type {
  CreateApiClientRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateTenantRequest,
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  TenantDashboardResponse
} from "@paymentops/contracts";
import { createHash, randomBytes } from "node:crypto";

import { OperationsRepository } from "./operations.repository.js";

const defaultPermissions = ["payouts:create", "payouts:read"];

@Injectable()
export class OperationsService {
  constructor(@Inject(OperationsRepository) private readonly repository: OperationsRepository) {}

  async seedDemo(): Promise<TenantDashboardResponse> {
    return this.repository.ensureDemoTenant();
  }

  async getDemoDashboard(): Promise<TenantDashboardResponse> {
    return this.repository.ensureDemoTenant();
  }

  async getTenantDashboard(tenantId: string): Promise<TenantDashboardResponse> {
    return this.repository.getTenantDashboard(tenantId);
  }

  async createTenant(body: CreateTenantRequest) {
    const name = requiredString(body.name, "name");
    const ownerEmail = optionalString(body.ownerEmail) ?? "owner@example.com";

    if (!ownerEmail.includes("@")) {
      throw new BadRequestException("ownerEmail must be a valid email-like value");
    }

    return this.repository.createTenant({
      externalId: externalId("mer"),
      name,
      ownerEmail
    });
  }

  async createApiClient(tenantId: string, body: CreateApiClientRequest) {
    return this.repository.createApiClient({
      tenantExternalId: tenantId,
      externalId: externalId("cli"),
      name: requiredString(body.name, "name")
    });
  }

  async createApiKey(tenantId: string, body: CreateApiKeyRequest): Promise<CreateApiKeyResponse> {
    const name = requiredString(body.name, "name");
    const apiClientId = requiredString(body.apiClientId, "apiClientId");
    const permissions = normalizePermissions(body.permissions);
    const secret = `pops_sk_test_${randomBytes(24).toString("base64url")}`;

    return this.repository.createApiKey({
      tenantExternalId: tenantId,
      apiClientExternalId: apiClientId,
      externalId: externalId("key"),
      name,
      keyHash: hashSecret(secret),
      keyPrefix: secret.slice(0, 18),
      permissions,
      expiresAt: body.expiresAt ?? null,
      secret
    });
  }

  async createWebhookEndpoint(
    tenantId: string,
    body: CreateWebhookEndpointRequest
  ): Promise<CreateWebhookEndpointResponse> {
    const url = requiredString(body.url, "url");

    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) {
        throw new Error("Unsupported protocol");
      }
    } catch {
      throw new BadRequestException("url must be a valid http or https URL");
    }

    const secret = `whsec_${randomBytes(24).toString("base64url")}`;

    return this.repository.createWebhookEndpoint({
      tenantExternalId: tenantId,
      externalId: externalId("whk"),
      url,
      description: optionalString(body.description) ?? null,
      secretHash: hashSecret(secret),
      signingSecret: secret,
      eventSubscriptions: normalizeEvents(body.eventSubscriptions)
    });
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}

function normalizePermissions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return defaultPermissions;
  }

  const permissions = value.filter((permission): permission is string => typeof permission === "string");

  if (permissions.length === 0) {
    throw new BadRequestException("permissions must contain at least one string value");
  }

  return [...new Set(permissions.map((permission) => permission.trim()).filter(Boolean))];
}

function normalizeEvents(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return ["payout.created.v1", "payout.processing.v1", "payout.paid.v1", "payout.failed.v1"];
  }

  const events = value.filter((event): event is string => typeof event === "string");

  if (events.length === 0) {
    throw new BadRequestException("eventSubscriptions must contain at least one string value");
  }

  return [...new Set(events.map((event) => event.trim()).filter(Boolean))];
}

function externalId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
