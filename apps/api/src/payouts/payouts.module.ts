import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { PayoutsController } from "./payouts.controller.js";
import { PayoutsRepository } from "./payouts.repository.js";
import { PayoutsService } from "./payouts.service.js";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [PayoutsController],
  providers: [PayoutsRepository, PayoutsService]
})
export class PayoutsModule {}
