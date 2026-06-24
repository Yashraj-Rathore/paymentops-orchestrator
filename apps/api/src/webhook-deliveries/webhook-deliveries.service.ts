import { Inject, Injectable } from "@nestjs/common";
import type { ReplayWebhookDeliveryResponse, WebhookDeliverySummary } from "@paymentops/contracts";

import { WebhookDeliveriesRepository } from "./webhook-deliveries.repository.js";

@Injectable()
export class WebhookDeliveriesService {
  constructor(@Inject(WebhookDeliveriesRepository) private readonly repository: WebhookDeliveriesRepository) {}

  async listDeliveries(tenantId: string): Promise<WebhookDeliverySummary[]> {
    return this.repository.listTenantDeliveries(tenantId);
  }

  async replayDelivery(tenantId: string, deliveryId: string): Promise<ReplayWebhookDeliveryResponse> {
    const delivery = await this.repository.replayDelivery(tenantId, deliveryId);
    return {
      ...delivery,
      replayed: true
    };
  }
}
