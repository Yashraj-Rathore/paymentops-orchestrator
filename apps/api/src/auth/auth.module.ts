import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { AdminAuthGuard } from "./admin-auth.guard.js";
import { ApiKeyAuthGuard } from "./api-key-auth.guard.js";
import { ApiKeyPermissionsGuard } from "./api-key-permissions.guard.js";
import { AuthController } from "./auth.controller.js";
import { AuthRepository } from "./auth.repository.js";
import { AuthService } from "./auth.service.js";
import { RolesGuard } from "./roles.guard.js";

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [AuthRepository, AuthService, AdminAuthGuard, RolesGuard, ApiKeyAuthGuard, ApiKeyPermissionsGuard],
  exports: [AuthService, AdminAuthGuard, RolesGuard, ApiKeyAuthGuard, ApiKeyPermissionsGuard]
})
export class AuthModule {}