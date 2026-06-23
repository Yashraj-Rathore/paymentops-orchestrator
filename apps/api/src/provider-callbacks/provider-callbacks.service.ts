import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { ProviderPayoutCallbackRequest, ProviderPayoutCallbackResponse } from "@paymentops/contracts";

import { ProviderCallbacksRepository } from "./provider-callbacks.repository.js";

@Injectable()
export class ProviderCallbacksService {
  constructor(@Inject(ProviderCallbacksRepository) private readonly repository: ProviderCallbacksRepository) {}

  async handlePayoutCallback(body: ProviderPayoutCallbackRequest): Promise<ProviderPayoutCallbackResponse> {
    const payoutId = requiredString(body.payoutId, "payoutId");
    const tenantId = requiredString(body.tenantId, "tenantId");
    const providerPayoutId = requiredString(body.providerPayoutId, "providerPayoutId");
    const status = body.status;

    if (status !== "paid" && status !== "failed") {
      throw new BadRequestException("status must be paid or failed");
    }

    return this.repository.applyPayoutCallback({
      payoutId,
      tenantId,
      providerPayoutId,
      status,
      reason: requiredString(body.reason, "reason")
    });
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}
