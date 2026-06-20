import { Module } from "@nestjs/common";

import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { OperationsModule } from "./operations/operations.module.js";

@Module({
  imports: [DatabaseModule, OperationsModule],
  controllers: [HealthController]
})
export class AppModule {}