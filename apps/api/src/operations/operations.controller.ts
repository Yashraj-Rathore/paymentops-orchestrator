import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type {
  CreateApiClientRequest,
  CreateApiKeyRequest,
  CreateTenantRequest,
  CreateWebhookEndpointRequest
} from "@paymentops/contracts";

import { OperationsService } from "./operations.service.js";

@ApiTags("operations")
@Controller()
export class OperationsController {
  constructor(@Inject(OperationsService) private readonly operations: OperationsService) {}

  @Post("tenants")
  @ApiCreatedResponse({ description: "Create a tenant and owner membership." })
  createTenant(@Body() body: CreateTenantRequest) {
    return this.operations.createTenant(body);
  }

  @Get("tenants/:tenantId/summary")
  @ApiOkResponse({ description: "Get a tenant operations dashboard summary." })
  getTenantSummary(@Param("tenantId") tenantId: string) {
    return this.operations.getTenantDashboard(tenantId);
  }

  @Post("tenants/:tenantId/api-clients")
  @ApiCreatedResponse({ description: "Create an API client for a tenant." })
  createApiClient(@Param("tenantId") tenantId: string, @Body() body: CreateApiClientRequest) {
    return this.operations.createApiClient(tenantId, body);
  }

  @Post("tenants/:tenantId/api-keys")
  @ApiCreatedResponse({ description: "Mint an API key and reveal its secret once." })
  createApiKey(@Param("tenantId") tenantId: string, @Body() body: CreateApiKeyRequest) {
    return this.operations.createApiKey(tenantId, body);
  }

  @Post("tenants/:tenantId/webhook-endpoints")
  @ApiCreatedResponse({ description: "Register an outbound webhook endpoint." })
  createWebhookEndpoint(
    @Param("tenantId") tenantId: string,
    @Body() body: CreateWebhookEndpointRequest
  ) {
    return this.operations.createWebhookEndpoint(tenantId, body);
  }

  @Get("demo/dashboard")
  @ApiOkResponse({ description: "Get the seeded demo tenant dashboard shell." })
  getDemoDashboard() {
    return this.operations.getDemoDashboard();
  }

  @Post("demo/seed")
  @ApiCreatedResponse({ description: "Idempotently seed the local demo tenant." })
  seedDemo() {
    return this.operations.seedDemo();
  }
}