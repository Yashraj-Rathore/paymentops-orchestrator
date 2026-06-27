import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { ReconciliationController } from "./reconciliation.controller.js";
import { ReconciliationRepository } from "./reconciliation.repository.js";
import { ReconciliationService } from "./reconciliation.service.js";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ReconciliationController],
  providers: [ReconciliationRepository, ReconciliationService]
})
export class ReconciliationModule {}
