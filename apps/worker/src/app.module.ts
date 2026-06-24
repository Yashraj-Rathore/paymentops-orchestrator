import { Module } from "@nestjs/common";

import { PayoutDispatchRepository } from "./payout-dispatch.repository.js";
import { PayoutDispatchService } from "./payout-dispatch.service.js";
import { WebhookDeliveryRepository } from "./webhook-delivery.repository.js";
import { WebhookDeliveryService } from "./webhook-delivery.service.js";
import { WorkerDatabaseService } from "./worker-database.service.js";
import { WorkerHealthService } from "./worker-health.service.js";

@Module({
  providers: [
    WorkerDatabaseService,
    WorkerHealthService,
    PayoutDispatchRepository,
    PayoutDispatchService,
    WebhookDeliveryRepository,
    WebhookDeliveryService
  ]
})
export class AppModule {}
