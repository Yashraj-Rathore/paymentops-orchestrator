import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type {
  CreateApiClientRequest,
  CreateApiKeyRequest,
  CreateTenantRequest,
  CreateWebhookEndpointRequest
} from "@paymentops/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { RequireRoles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { OperationsService } from "./operations.service.js";

@ApiTags("operations")
@ApiBearerAuth()
@ApiHeader({ name: "x-paymentops-dev-admin-token", required: false })
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller()
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Post("tenants")
  @RequireRoles("operations_admin")
  @ApiCreatedResponse({ description: "Create a tenant and owner membership." })
  createTenant(@Body() body: CreateTenantRequest) {
    return this.operations.createTenant(body);
  }

  @Get("tenants/:tenantId/summary")
  @RequireRoles("operations_admin", "merchant_owner", "developer")
  @ApiOkResponse({ description: "Get a tenant operations dashboard summary." })
  getTenantSummary(@Param("tenantId") tenantId: string) {
    return this.operations.getTenantDashboard(tenantId);
  }

  @Post("tenants/:tenantId/api-clients")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Create an API client for a tenant." })
  createApiClient(@Param("tenantId") tenantId: string, @Body() body: CreateApiClientRequest) {
    return this.operations.createApiClient(tenantId, body);
  }

  @Post("tenants/:tenantId/api-keys")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Mint an API key and reveal its secret once." })
  createApiKey(@Param("tenantId") tenantId: string, @Body() body: CreateApiKeyRequest) {
    return this.operations.createApiKey(tenantId, body);
  }

  @Post("tenants/:tenantId/webhook-endpoints")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Register an outbound webhook endpoint." })
  createWebhookEndpoint(
    @Param("tenantId") tenantId: string,
    @Body() body: CreateWebhookEndpointRequest
  ) {
    return this.operations.createWebhookEndpoint(tenantId, body);
  }

  @Get("demo/dashboard")
  @RequireRoles("operations_admin", "developer")
  @ApiOkResponse({ description: "Get the seeded demo tenant dashboard shell." })
  getDemoDashboard() {
    return this.operations.getDemoDashboard();
  }

  @Post("demo/seed")
  @RequireRoles("operations_admin", "developer")
  @ApiCreatedResponse({ description: "Idempotently seed the local demo tenant." })
  seedDemo() {
    return this.operations.seedDemo();
  }
}