import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import { ProviderPayoutsController } from "./provider-payouts.controller.js";
import { ProviderPayoutsService } from "./provider-payouts.service.js";

@Module({
  controllers: [HealthController, ProviderPayoutsController],
  providers: [ProviderPayoutsService]
})
export class AppModule {}
