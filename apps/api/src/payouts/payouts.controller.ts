import { Body, Controller, Get, Headers, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { CreatePayoutRequest } from "@paymentops/contracts";

import { ApiKeyAuthGuard } from "../auth/api-key-auth.guard.js";
import { RequireApiKeyPermissions } from "../auth/api-key-permissions.decorator.js";
import { ApiKeyPermissionsGuard } from "../auth/api-key-permissions.guard.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { PayoutsService } from "./payouts.service.js";

@ApiTags("payouts")
@ApiBearerAuth()
@ApiHeader({ name: "x-api-key", required: false })
@UseGuards(ApiKeyAuthGuard, ApiKeyPermissionsGuard)
@Controller("tenants/:tenantId/payouts")
export class PayoutsController {
  constructor(@Inject(PayoutsService) private readonly payouts: PayoutsService) {}

  @Post()
  @RequireApiKeyPermissions("payouts:create")
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiCreatedResponse({ description: "Create a payout with idempotent replay protection." })
  createPayout(
    @Param("tenantId") tenantId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: CreatePayoutRequest,
    @Req() request: AuthenticatedRequest
  ) {
    return this.payouts.createPayout(tenantId, idempotencyKey, body, request.auth);
  }

  @Get()
  @RequireApiKeyPermissions("payouts:read")
  @ApiOkResponse({ description: "List recent payouts for the authenticated tenant." })
  listPayouts(@Param("tenantId") tenantId: string, @Req() request: AuthenticatedRequest) {
    return this.payouts.listPayouts(tenantId, request.auth);
  }

  @Get(":payoutId")
  @RequireApiKeyPermissions("payouts:read")
  @ApiOkResponse({ description: "Get payout details, ledger entries, status history, and outbox events." })
  getPayout(
    @Param("tenantId") tenantId: string,
    @Param("payoutId") payoutId: string,
    @Req() request: AuthenticatedRequest
  ) {
    return this.payouts.getPayout(tenantId, payoutId, request.auth);
  }
}
