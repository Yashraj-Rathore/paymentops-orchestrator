import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from "@nestjs/common";
import { loadConfig } from "@paymentops/config";
import type { ProviderPayoutResponse } from "@paymentops/contracts";
import { createLogger } from "@paymentops/logger";

import { PayoutDispatchRepository, type PendingPayoutDispatch } from "./payout-dispatch.repository.js";

const pollIntervalMs = 3000;
const maxDispatchAttempts = 5;

@Injectable()
export class PayoutDispatchService implements OnModuleInit, OnApplicationShutdown {
  private readonly config = loadConfig("worker");
  private readonly logger = createLogger({
    service: "worker",
    environment: this.config.nodeEnv
  });
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@Inject(PayoutDispatchRepository) private readonly repository: PayoutDispatchRepository) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.processOnce();
    }, pollIntervalMs);

    void this.processOnce();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async processOnce(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const dispatches = await this.repository.findPendingPayoutDispatches();

      for (const dispatch of dispatches) {
        await this.dispatchPayout(dispatch);
      }
    } finally {
      this.running = false;
    }
  }

  private async dispatchPayout(dispatch: PendingPayoutDispatch): Promise<void> {
    if (dispatch.status !== "queued") {
      await this.repository.markDispatchSucceeded({
        outboxEventId: dispatch.outboxEventId,
        payoutId: dispatch.payoutId,
        payoutExternalId: dispatch.payoutExternalId,
        tenantId: dispatch.tenantId,
        tenantExternalId: dispatch.tenantExternalId,
        previousStatus: dispatch.status,
        providerPayoutId: dispatch.providerPayoutId ?? "already-dispatched"
      });
      return;
    }

    try {
      const providerResponse = await this.submitToProvider(dispatch);
      await this.repository.markDispatchSucceeded({
        outboxEventId: dispatch.outboxEventId,
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
        providerPayoutId: providerResponse.providerPayoutId
      });
    } catch (error) {
      await this.repository.markDispatchFailed(dispatch.outboxEventId, maxDispatchAttempts);
      this.logger.warn("payout dispatch failed", {
        resourceType: "payout",
        resourceId: dispatch.payoutExternalId,
        attempts: dispatch.attempts + 1,
        error: error instanceof Error ? error.message : "unknown error"
      });
    }
  }

  private async submitToProvider(dispatch: PendingPayoutDispatch): Promise<ProviderPayoutResponse> {
    const response = await fetch(new URL("/v1/provider/payouts", this.config.providerSimulatorUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        payoutId: dispatch.payoutExternalId,
        tenantId: dispatch.tenantExternalId,
        amountMinor: dispatch.amountMinor,
        currency: dispatch.currency,
        destinationAccount: dispatch.destinationAccount,
        callbackUrl: new URL("/v1/provider-callbacks/payouts", this.config.apiInternalUrl).toString()
      })
    });

    if (!response.ok) {
      throw new Error(`Provider simulator rejected payout with HTTP ${response.status}`);
    }

    return (await response.json()) as ProviderPayoutResponse;
  }
}
