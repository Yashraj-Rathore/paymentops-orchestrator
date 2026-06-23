import { BadRequestException, Injectable } from "@nestjs/common";
import type {
  ProviderPayoutCallbackRequest,
  ProviderPayoutRequest,
  ProviderPayoutResponse
} from "@paymentops/contracts";
import { createLogger } from "@paymentops/logger";
import { randomBytes } from "node:crypto";

const callbackDelayMs = 1500;

@Injectable()
export class ProviderPayoutsService {
  private readonly logger = createLogger({
    service: "provider-simulator",
    environment: process.env.NODE_ENV ?? "development"
  });

  createPayout(body: ProviderPayoutRequest): ProviderPayoutResponse {
    const request = normalizeRequest(body);
    const providerPayoutId = `pp_${randomBytes(8).toString("hex")}`;
    const finalStatus = request.amountMinor >= 5_000_000 ? "failed" : "paid";
    const reason = finalStatus === "paid" ? "simulated provider settlement" : "simulated provider risk decline";

    setTimeout(() => {
      void this.sendCallback(request.callbackUrl, {
        providerPayoutId,
        payoutId: request.payoutId,
        tenantId: request.tenantId,
        status: finalStatus,
        reason
      });
    }, callbackDelayMs);

    return {
      providerPayoutId,
      status: "processing",
      callbackDelayMs
    };
  }

  private async sendCallback(callbackUrl: string, payload: ProviderPayoutCallbackRequest): Promise<void> {
    try {
      const response = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        this.logger.warn("provider callback rejected", {
          resourceType: "payout",
          resourceId: payload.payoutId,
          statusCode: response.status
        });
      }
    } catch (error) {
      this.logger.warn("provider callback failed", {
        resourceType: "payout",
        resourceId: payload.payoutId,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
  }
}

function normalizeRequest(body: ProviderPayoutRequest): ProviderPayoutRequest {
  const payoutId = requiredString(body.payoutId, "payoutId");
  const tenantId = requiredString(body.tenantId, "tenantId");
  const currency = requiredString(body.currency, "currency").toUpperCase();
  const destinationAccount = requiredString(body.destinationAccount, "destinationAccount");
  const callbackUrl = requiredString(body.callbackUrl, "callbackUrl");
  const amountMinor = Number(body.amountMinor);

  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new BadRequestException("amountMinor must be a positive integer");
  }

  try {
    new URL(callbackUrl);
  } catch {
    throw new BadRequestException("callbackUrl must be a valid URL");
  }

  return {
    payoutId,
    tenantId,
    amountMinor,
    currency,
    destinationAccount,
    callbackUrl
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}
