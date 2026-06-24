import { Module } from "@nestjs/common";

import { ApprovalsModule } from "./approvals/approvals.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { OperationsModule } from "./operations/operations.module.js";
import { PayoutsModule } from "./payouts/payouts.module.js";
import { ProviderCallbacksModule } from "./provider-callbacks/provider-callbacks.module.js";
import { WebhookDeliveriesModule } from "./webhook-deliveries/webhook-deliveries.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    ApprovalsModule,
    OperationsModule,
    PayoutsModule,
    ProviderCallbacksModule,
    WebhookDeliveriesModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
