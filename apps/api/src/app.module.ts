import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthController } from "./health.controller.js";
import { OperationsModule } from "./operations/operations.module.js";

@Module({
  imports: [DatabaseModule, AuthModule, OperationsModule],
  controllers: [HealthController]
})
export class AppModule {}