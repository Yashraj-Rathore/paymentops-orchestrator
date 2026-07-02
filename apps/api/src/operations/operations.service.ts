import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type {
  CreateApiClientRequest,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateMembershipRequest,
  CreateTenantRequest,
  CreateWebhookEndpointRequest,
  CreateWebhookEndpointResponse,
  RotateApiKeyRequest,
  TenantDashboardResponse,
  UpdateApiClientRequest,
  UpdateMembershipRequest,
  UpdateTenantRequest,
  UpdateWebhookEndpointRequest,
  UserMembershipRole
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

  async updateTenant(tenantId: string, body: UpdateTenantRequest) {
    const name = body.name === undefined ? undefined : requiredString(body.name, "name");
    const status =
      body.status === undefined
        ? undefined
        : enumValue(body.status, ["active", "suspended", "archived"], "status");
    requireMutation({ name, status });
    return this.repository.updateTenant(tenantId, { name, status });
  }

  async createMembership(tenantId: string, body: CreateMembershipRequest) {
    return this.repository.createMembership({
      tenantExternalId: tenantId,
      email: emailAddress(body.email),
      role: membershipRole(body.role),
      status: enumValue(body.status ?? "invited", ["active", "invited", "disabled"], "status")
    });
  }

  async updateMembership(
    tenantId: string,
    membershipId: string,
    body: UpdateMembershipRequest
  ) {
    const role = body.role === undefined ? undefined : membershipRole(body.role);
    const status =
      body.status === undefined
        ? undefined
        : enumValue(body.status, ["active", "invited", "disabled"], "status");
    requireMutation({ role, status });
    return this.repository.updateMembership(tenantId, membershipId, { role, status });
  }

  async createApiClient(tenantId: string, body: CreateApiClientRequest) {
    return this.repository.createApiClient({
      tenantExternalId: tenantId,
      externalId: externalId("cli"),
      name: requiredString(body.name, "name")
    });
  }

  async updateApiClient(
    tenantId: string,
    clientId: string,
    body: UpdateApiClientRequest
  ) {
    const status = enumValue(body.status, ["active", "disabled"], "status");
    return this.repository.updateApiClient(tenantId, clientId, status);
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

  async rotateApiKey(
    tenantId: string,
    apiKeyId: string,
    body: RotateApiKeyRequest
  ): Promise<CreateApiKeyResponse> {
    const secret = apiKeySecret();
    return this.repository.rotateApiKey({
      tenantExternalId: tenantId,
      apiKeyExternalId: apiKeyId,
      replacementExternalId: externalId("key"),
      name: body.name === undefined ? undefined : requiredString(body.name, "name"),
      keyHash: hashSecret(secret),
      keyPrefix: secret.slice(0, 18),
      permissions:
        body.permissions === undefined ? undefined : normalizePermissions(body.permissions),
      expiresAt: body.expiresAt,
      secret
    });
  }

  async revokeApiKey(tenantId: string, apiKeyId: string) {
    return this.repository.revokeApiKey(tenantId, apiKeyId);
  }

  async createWebhookEndpoint(
    tenantId: string,
    body: CreateWebhookEndpointRequest
  ): Promise<CreateWebhookEndpointResponse> {
    const url = requiredString(body.url, "url");

    validateHttpUrl(url);

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

  async updateWebhookEndpoint(
    tenantId: string,
    webhookId: string,
    body: UpdateWebhookEndpointRequest
  ) {
    const url = body.url === undefined ? undefined : requiredString(body.url, "url");
    if (url) validateHttpUrl(url);
    const description =
      body.description === undefined ? undefined : optionalString(body.description);
    const eventSubscriptions =
      body.eventSubscriptions === undefined ? undefined : normalizeEvents(body.eventSubscriptions);
    const status =
      body.status === undefined
        ? undefined
        : enumValue(body.status, ["active", "disabled"], "status");

    requireMutation({ url, description, eventSubscriptions, status }, body);
    return this.repository.updateWebhookEndpoint(tenantId, webhookId, {
      url,
      description,
      eventSubscriptions,
      status
    });
  }

  async deleteWebhookEndpoint(tenantId: string, webhookId: string) {
    return this.repository.deleteWebhookEndpoint(tenantId, webhookId);
  }
}

function apiKeySecret(): string {
  return "pops_sk_test_" + randomBytes(24).toString("base64url");
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

function emailAddress(value: unknown): string {
  const email = requiredString(value, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("email must be a valid email address");
  }
  return email;
}

function membershipRole(value: unknown): UserMembershipRole {
  return enumValue(value, ["merchant_owner", "developer"], "role");
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new BadRequestException(field + " must be one of: " + allowed.join(", "));
  }
  return value as T;
}

function requireMutation(
  values: Record<string, unknown>,
  original: object = values
): void {
  if (
    !Object.keys(original).some((key) => Object.prototype.hasOwnProperty.call(values, key)) ||
    Object.values(values).every((value) => value === undefined)
  ) {
    throw new BadRequestException("At least one update field is required");
  }
}

function validateHttpUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      throw new Error("Unsupported protocol");
    }
  } catch {
    throw new BadRequestException("url must be a valid http or https URL");
  }
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
