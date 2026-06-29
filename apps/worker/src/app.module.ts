import { Module } from "@nestjs/common";

import { AsyncQueueService } from "./async-queue.service.js";
import { OutboxRelayService } from "./outbox-relay.service.js";
import { OutboxRepository } from "./outbox.repository.js";
import { PayoutDispatchRepository } from "./payout-dispatch.repository.js";
import { PayoutDispatchService } from "./payout-dispatch.service.js";
import { QueueWorkersService } from "./queue-workers.service.js";
import { RedpandaPublisherService } from "./redpanda-publisher.service.js";
import { WebhookDeliveryRepository } from "./webhook-delivery.repository.js";
import { WebhookDeliveryService } from "./webhook-delivery.service.js";
import { WorkerDatabaseService } from "./worker-database.service.js";
import { WorkerHealthService } from "./worker-health.service.js";

@Module({
  providers: [
    WorkerDatabaseService,
    WorkerHealthService,
    AsyncQueueService,
    OutboxRepository,
    RedpandaPublisherService,
    OutboxRelayService,
    PayoutDispatchRepository,
    PayoutDispatchService,
    WebhookDeliveryRepository,
    WebhookDeliveryService,
    QueueWorkersService
  ]
})
export class AppModule {}
