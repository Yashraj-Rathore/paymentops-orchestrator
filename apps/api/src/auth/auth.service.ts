import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { loadConfig } from "@paymentops/config";
import type { AuthRole, AuthSessionResponse } from "@paymentops/contracts";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { AuthRepository } from "./auth.repository.js";
import type { AuthenticatedPrincipal } from "./auth.types.js";

const bearerPrefix = "Bearer ";

@Injectable()
export class AuthService {
  private readonly config = loadConfig("api");
  private readonly issuer = normalizeIssuer(this.config.auth0.domain);
  private readonly jwks = createRemoteJWKSet(new URL(`${this.issuer}.well-known/jwks.json`));

  constructor(@Inject(AuthRepository) private readonly repository: AuthRepository) {}

  async authenticateAdmin(headers: IncomingHttpHeaders): Promise<AuthenticatedPrincipal> {
    const devPrincipal = this.authenticateDevAdmin(headers);

    if (devPrincipal) {
      return devPrincipal;
    }

    const token = bearerToken(headers.authorization);

    if (!token || token.startsWith("pops_")) {
      throw new UnauthorizedException("A valid Auth0 bearer token is required");
    }

    try {
      return await this.authenticateJwt(token);
    } catch {
      throw new UnauthorizedException("Auth0 bearer token is invalid");
    }
  }

  async authenticateApiKey(headers: IncomingHttpHeaders): Promise<AuthenticatedPrincipal> {
    const secret = apiKeyFromHeaders(headers);

    if (!secret) {
      throw new UnauthorizedException("An API key is required");
    }

    const keyHash = hashSecret(secret);
    const record = await this.repository.findActiveApiKeyByHash(keyHash);

    if (!record) {
      throw new UnauthorizedException("API key is invalid, expired, revoked, or disabled");
    }

    return {
      type: "api_key",
      subject: record.apiClientExternalId,
      email: null,
      roles: [],
      permissions: record.permissions,
      tenantId: record.tenantExternalId,
      apiClientId: record.apiClientExternalId,
      apiKeyId: record.apiKeyExternalId
    };
  }

  toSessionResponse(principal: AuthenticatedPrincipal): AuthSessionResponse {
    return {
      type: principal.type,
      subject: principal.subject,
      email: principal.email,
      roles: principal.roles,
      permissions: principal.permissions,
      tenantId: principal.tenantId,
      apiClientId: principal.apiClientId,
      apiKeyId: principal.apiKeyId
    };
  }

  private authenticateDevAdmin(headers: IncomingHttpHeaders): AuthenticatedPrincipal | null {
    if (this.config.auth.mode !== "development" || this.config.nodeEnv === "production") {
      return null;
    }

    const token = headerValue(headers["x-paymentops-dev-admin-token"]);

    if (!token || !safeEquals(token, this.config.auth.devAdminToken)) {
      return null;
    }

    return {
      type: "dev_admin",
      subject: "local-dev-admin",
      email: "dev-admin@paymentops.local",
      roles: ["operations_admin", "developer"],
      permissions: ["admin:*"],
      tenantId: null,
      apiClientId: null,
      apiKeyId: null
    };
  }

  private async authenticateJwt(token: string): Promise<AuthenticatedPrincipal> {
    const result = await jwtVerify(token, this.jwks, {
      issuer: this.issuer,
      audience: this.config.auth0.audience
    });

    const payload = result.payload;

    return {
      type: "jwt",
      subject: payload.sub ?? "unknown-subject",
      email: stringClaim(payload.email),
      roles: rolesFromPayload(payload, this.config.auth.roleClaim),
      permissions: stringArrayClaim(payload.permissions),
      tenantId: null,
      apiClientId: null,
      apiKeyId: null
    };
  }
}

function apiKeyFromHeaders(headers: IncomingHttpHeaders): string | null {
  const explicit = headerValue(headers["x-api-key"]);

  if (explicit) {
    return explicit;
  }

  const bearer = bearerToken(headers.authorization);

  if (bearer?.startsWith("pops_")) {
    return bearer;
  }

  return null;
}

function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith(bearerPrefix)) {
    return null;
  }

  return value.slice(bearerPrefix.length).trim();
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function normalizeIssuer(domain: string): string {
  const withProtocol = domain.startsWith("https://") ? domain : `https://${domain}`;
  return withProtocol.endsWith("/") ? withProtocol : `${withProtocol}/`;
}

function rolesFromPayload(payload: JWTPayload, roleClaim: string): AuthRole[] {
  const values = [
    ...stringArrayClaim(payload[roleClaim]),
    ...stringArrayClaim(payload.roles),
    ...rolesFromPermissions(stringArrayClaim(payload.permissions))
  ];

  return [...new Set(values.filter(isAuthRole))];
}

function rolesFromPermissions(permissions: string[]): string[] {
  if (permissions.includes("admin:*") || permissions.includes("operations:admin")) {
    return ["operations_admin"];
  }

  return [];
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArrayClaim(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function isAuthRole(value: string): value is AuthRole {
  return value === "operations_admin" || value === "merchant_owner" || value === "developer";
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}