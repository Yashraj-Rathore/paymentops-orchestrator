import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards
} from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type {
  CreateApiClientRequest,
  CreateApiKeyRequest,
  CreateMembershipRequest,
  CreateTenantRequest,
  CreateWebhookEndpointRequest,
  RotateApiKeyRequest,
  UpdateApiClientRequest,
  UpdateMembershipRequest,
  UpdateTenantRequest,
  UpdateWebhookEndpointRequest
} from "@paymentops/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { RequireRoles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { TenantAccessGuard } from "../auth/tenant-access.guard.js";
import { OperationsService } from "./operations.service.js";

@ApiTags("operations")
@ApiBearerAuth()
@ApiHeader({ name: "x-paymentops-dev-admin-token", required: false })
@UseGuards(AdminAuthGuard, TenantAccessGuard, RolesGuard)
@Controller()
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Post("tenants")
  @RequireRoles("operations_admin")
  @ApiCreatedResponse({ description: "Create a tenant and owner membership." })
  createTenant(@Body() body: CreateTenantRequest) {
    return this.operations.createTenant(body);
  }

  @Patch("tenants/:tenantId")
  @RequireRoles("operations_admin")
  @ApiOkResponse({ description: "Update a tenant name or lifecycle status." })
  updateTenant(@Param("tenantId") tenantId: string, @Body() body: UpdateTenantRequest) {
    return this.operations.updateTenant(tenantId, body);
  }

  @Get("tenants/:tenantId/summary")
  @RequireRoles("operations_admin", "merchant_owner", "developer")
  @ApiOkResponse({ description: "Get a tenant operations dashboard summary." })
  getTenantSummary(@Param("tenantId") tenantId: string) {
    return this.operations.getTenantDashboard(tenantId);
  }

  @Post("tenants/:tenantId/memberships")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Invite or add a tenant member." })
  createMembership(
    @Param("tenantId") tenantId: string,
    @Body() body: CreateMembershipRequest
  ) {
    return this.operations.createMembership(tenantId, body);
  }

  @Patch("tenants/:tenantId/memberships/:membershipId")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiOkResponse({ description: "Update a tenant member role or status." })
  updateMembership(
    @Param("tenantId") tenantId: string,
    @Param("membershipId") membershipId: string,
    @Body() body: UpdateMembershipRequest
  ) {
    return this.operations.updateMembership(tenantId, membershipId, body);
  }

  @Post("tenants/:tenantId/api-clients")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Create an API client for a tenant." })
  createApiClient(@Param("tenantId") tenantId: string, @Body() body: CreateApiClientRequest) {
    return this.operations.createApiClient(tenantId, body);
  }

  @Patch("tenants/:tenantId/api-clients/:clientId")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiOkResponse({ description: "Enable or disable an API client." })
  updateApiClient(
    @Param("tenantId") tenantId: string,
    @Param("clientId") clientId: string,
    @Body() body: UpdateApiClientRequest
  ) {
    return this.operations.updateApiClient(tenantId, clientId, body);
  }

  @Post("tenants/:tenantId/api-keys")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Mint an API key and reveal its secret once." })
  createApiKey(@Param("tenantId") tenantId: string, @Body() body: CreateApiKeyRequest) {
    return this.operations.createApiKey(tenantId, body);
  }

  @Post("tenants/:tenantId/api-keys/:apiKeyId/rotate")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Revoke an API key and reveal its replacement once." })
  rotateApiKey(
    @Param("tenantId") tenantId: string,
    @Param("apiKeyId") apiKeyId: string,
    @Body() body: RotateApiKeyRequest
  ) {
    return this.operations.rotateApiKey(tenantId, apiKeyId, body);
  }

  @Post("tenants/:tenantId/api-keys/:apiKeyId/revoke")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiOkResponse({ description: "Revoke an API key immediately." })
  revokeApiKey(@Param("tenantId") tenantId: string, @Param("apiKeyId") apiKeyId: string) {
    return this.operations.revokeApiKey(tenantId, apiKeyId);
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

  @Patch("tenants/:tenantId/webhook-endpoints/:webhookId")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiOkResponse({ description: "Update or disable a webhook endpoint." })
  updateWebhookEndpoint(
    @Param("tenantId") tenantId: string,
    @Param("webhookId") webhookId: string,
    @Body() body: UpdateWebhookEndpointRequest
  ) {
    return this.operations.updateWebhookEndpoint(tenantId, webhookId, body);
  }

  @Delete("tenants/:tenantId/webhook-endpoints/:webhookId")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiOkResponse({ description: "Soft-delete a webhook endpoint." })
  deleteWebhookEndpoint(
    @Param("tenantId") tenantId: string,
    @Param("webhookId") webhookId: string
  ) {
    return this.operations.deleteWebhookEndpoint(tenantId, webhookId);
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
