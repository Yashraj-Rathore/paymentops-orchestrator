import { Inject, Injectable } from "@nestjs/common";
import { loadConfig } from "@paymentops/config";
import type { ProviderPayoutResponse } from "@paymentops/contracts";
import { createLogger } from "@paymentops/logger";
import { recordPaymentOperation, withActiveSpan } from "@paymentops/observability";

import {
  PayoutDispatchRepository,
  type PendingPayoutDispatch
} from "./payout-dispatch.repository.js";

@Injectable()
export class PayoutDispatchService {
  private readonly config = loadConfig("worker");
  private readonly logger = createLogger({
    service: "worker",
    environment: this.config.nodeEnv
  });

  constructor(
    @Inject(PayoutDispatchRepository) private readonly repository: PayoutDispatchRepository
  ) {}

  async processJob(
    outboxEventId: string,
    attemptNumber: number,
    maxAttempts: number
  ): Promise<void> {
    const dispatch = await this.repository.findDispatchByOutboxEventId(outboxEventId);

    if (!dispatch || dispatch.status !== "queued") {
      return;
    }

    await withActiveSpan(
      "paymentops.payout.dispatch",
      {
        "paymentops.payout.id": dispatch.payoutExternalId,
        "paymentops.job.attempt": attemptNumber
      },
      () => this.dispatchPayout(dispatch, attemptNumber, maxAttempts)
    );
  }

  private async dispatchPayout(
    dispatch: PendingPayoutDispatch,
    attemptNumber: number,
    maxAttempts: number
  ): Promise<void> {
    try {
      const providerResponse = await this.submitToProvider(dispatch);
      await this.repository.markDispatchSucceeded({
        payoutId: dispatch.payoutId,
        payoutExternalId: dispatch.payoutExternalId,
        tenantId: dispatch.tenantId,
        tenantExternalId: dispatch.tenantExternalId,
        previousStatus: dispatch.status,
        providerPayoutId: providerResponse.providerPayoutId
      });

      this.logger.info("payout dispatched to provider", {
        resourceType: "payout",
        resourceId: dispatch.payoutExternalId,
        providerPayoutId: providerResponse.providerPayoutId,
        attempt: attemptNumber
      });
      recordPaymentOperation("payout.dispatched");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider dispatch failed";
      const deadLetter = attemptNumber >= maxAttempts;

      await this.repository.recordDispatchFailure({
        payoutId: dispatch.payoutId,
        payoutExternalId: dispatch.payoutExternalId,
        tenantId: dispatch.tenantId,
        tenantExternalId: dispatch.tenantExternalId,
        attemptNumber,
        error: truncate(message, 1000),
        deadLetter
      });

      this.logger.warn("payout dispatch failed", {
        resourceType: "payout",
        resourceId: dispatch.payoutExternalId,
        attempt: attemptNumber,
        deadLetter,
        error: message
      });
      recordPaymentOperation(
        deadLetter ? "payout.dispatch_dead_lettered" : "payout.dispatch_failed"
      );
      throw error;
    }
  }

  private async submitToProvider(dispatch: PendingPayoutDispatch): Promise<ProviderPayoutResponse> {
    const response = await fetch(
      new URL("/v1/provider/payouts", this.config.providerSimulatorUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": dispatch.payoutExternalId
        },
        body: JSON.stringify({
          payoutId: dispatch.payoutExternalId,
          tenantId: dispatch.tenantExternalId,
          amountMinor: dispatch.amountMinor,
          currency: dispatch.currency,
          destinationAccount: dispatch.destinationAccount,
          callbackUrl: new URL(
            "/v1/provider-callbacks/payouts",
            this.config.apiInternalUrl
          ).toString()
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Provider simulator rejected payout with HTTP ${response.status}`);
    }

    return (await response.json()) as ProviderPayoutResponse;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
