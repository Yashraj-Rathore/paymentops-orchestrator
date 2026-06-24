import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { WebhookDeliveriesController } from "./webhook-deliveries.controller.js";
import { WebhookDeliveriesRepository } from "./webhook-deliveries.repository.js";
import { WebhookDeliveriesService } from "./webhook-deliveries.service.js";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [WebhookDeliveriesController],
  providers: [WebhookDeliveriesRepository, WebhookDeliveriesService]
})
export class WebhookDeliveriesModule {}
