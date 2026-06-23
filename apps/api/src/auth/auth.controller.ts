import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { RequireApiKeyPermissions } from "./api-key-permissions.decorator.js";
import { ApiKeyAuthGuard } from "./api-key-auth.guard.js";
import { ApiKeyPermissionsGuard } from "./api-key-permissions.guard.js";
import { AdminAuthGuard } from "./admin-auth.guard.js";
import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";
import { RequireRoles } from "./roles.decorator.js";
import { RolesGuard } from "./roles.guard.js";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("admin/session")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @RequireRoles("operations_admin", "merchant_owner", "developer")
  @ApiBearerAuth()
  @ApiHeader({ name: "x-paymentops-dev-admin-token", required: false })
  @ApiOkResponse({ description: "Inspect the current admin/JWT principal." })
  getAdminSession(@Req() request: AuthenticatedRequest) {
    return this.auth.toSessionResponse(requirePrincipal(request));
  }

  @Get("api-key/session")
  @UseGuards(ApiKeyAuthGuard, ApiKeyPermissionsGuard)
  @RequireApiKeyPermissions("payouts:read")
  @ApiBearerAuth()
  @ApiHeader({ name: "x-api-key", required: false })
  @ApiOkResponse({ description: "Inspect the current API key principal." })
  getApiKeySession(@Req() request: AuthenticatedRequest) {
    return this.auth.toSessionResponse(requirePrincipal(request));
  }
}

function requirePrincipal(request: AuthenticatedRequest) {
  if (!request.auth) {
    throw new Error("Authenticated request is missing a principal");
  }

  return request.auth;
}