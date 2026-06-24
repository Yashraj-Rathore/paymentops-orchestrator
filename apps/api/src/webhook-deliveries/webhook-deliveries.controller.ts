import { Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import { RequireRoles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { WebhookDeliveriesService } from "./webhook-deliveries.service.js";

@ApiTags("webhook-deliveries")
@ApiBearerAuth()
@ApiHeader({ name: "x-paymentops-dev-admin-token", required: false })
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller("tenants/:tenantId/webhook-deliveries")
export class WebhookDeliveriesController {
  constructor(@Inject(WebhookDeliveriesService) private readonly deliveries: WebhookDeliveriesService) {}

  @Get()
  @RequireRoles("operations_admin", "merchant_owner", "developer")
  @ApiOkResponse({ description: "List recent webhook deliveries for a tenant." })
  listDeliveries(@Param("tenantId") tenantId: string) {
    return this.deliveries.listDeliveries(tenantId);
  }

  @Post(":deliveryId/replay")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Replay a webhook delivery by returning it to the worker queue." })
  replayDelivery(@Param("tenantId") tenantId: string, @Param("deliveryId") deliveryId: string) {
    return this.deliveries.replayDelivery(tenantId, deliveryId);
  }
}
