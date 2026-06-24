import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type {
  CreatePayoutRequest,
  CreatePayoutResponse,
  PayoutDetailsResponse,
  PayoutSummary
} from "@paymentops/contracts";
import { createHash, randomBytes } from "node:crypto";

import type { AuthenticatedPrincipal } from "../auth/auth.types.js";
import { PayoutsRepository } from "./payouts.repository.js";

const idempotencyKeyMaxLength = 128;

@Injectable()
export class PayoutsService {
  constructor(@Inject(PayoutsRepository) private readonly repository: PayoutsRepository) {}

  async createPayout(
    tenantId: string,
    idempotencyKey: string | undefined,
    body: CreatePayoutRequest,
    principal?: AuthenticatedPrincipal
  ): Promise<CreatePayoutResponse> {
    assertTenantAccess(tenantId, principal);
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    const normalized = normalizeCreatePayoutRequest(body);

    return this.repository.createPayout({
      tenantExternalId: tenantId,
      externalId: externalId("po"),
      idempotencyKey: normalizedIdempotencyKey,
      requestHash: hashJson(normalized),
      amountMinor: normalized.amountMinor,
      currency: normalized.currency,
      destinationAccount: normalized.destinationAccount,
      reference: normalized.reference,
      description: normalized.description,
      apiClientExternalId: principal?.apiClientId ?? null,
      apiKeyExternalId: principal?.apiKeyId ?? null
    });
  }

  async listPayouts(
    tenantId: string,
    principal?: AuthenticatedPrincipal
  ): Promise<PayoutSummary[]> {
    assertTenantAccess(tenantId, principal);
    return this.repository.listPayouts(tenantId);
  }

  async getPayout(
    tenantId: string,
    payoutId: string,
    principal?: AuthenticatedPrincipal
  ): Promise<PayoutDetailsResponse> {
    assertTenantAccess(tenantId, principal);
    return this.repository.getPayout(tenantId, payoutId);
  }
}

function assertTenantAccess(tenantId: string, principal?: AuthenticatedPrincipal): void {
  if (!principal) {
    throw new ForbiddenException("Authenticated principal is required");
  }

  if (principal.tenantId !== tenantId) {
    throw new ForbiddenException("API key cannot access this tenant");
  }
}

function normalizeIdempotencyKey(value: string | undefined): string {
  const key = value?.trim();

  if (!key) {
    throw new BadRequestException("Idempotency-Key header is required");
  }

  if (key.length > idempotencyKeyMaxLength) {
    throw new BadRequestException(
      `Idempotency-Key must be ${idempotencyKeyMaxLength} characters or less`
    );
  }

  return key;
}

function normalizeCreatePayoutRequest(body: CreatePayoutRequest): Required<CreatePayoutRequest> {
  const amountMinor = Number(body.amountMinor);
  const currency = requiredString(body.currency, "currency").toUpperCase();
  const destinationAccount = requiredString(body.destinationAccount, "destinationAccount");

  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new BadRequestException("amountMinor must be a positive integer");
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new BadRequestException("currency must be a three-letter ISO currency code");
  }

  return {
    amountMinor,
    currency,
    destinationAccount,
    reference: optionalString(body.reference),
    description: optionalString(body.description)
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hashJson(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function externalId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}
