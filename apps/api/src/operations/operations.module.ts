import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { OperationsController } from "./operations.controller.js";
import { OperationsRepository } from "./operations.repository.js";
import { OperationsService } from "./operations.service.js";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [OperationsController],
  providers: [OperationsRepository, OperationsService],
  exports: [OperationsService]
})
export class OperationsModule {}