import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiTags } from "@nestjs/swagger";
import type { ProviderPayoutRequest } from "@paymentops/contracts";

import { ProviderPayoutsService } from "./provider-payouts.service.js";

@ApiTags("provider-payouts")
@Controller("provider/payouts")
export class ProviderPayoutsController {
  constructor(@Inject(ProviderPayoutsService) private readonly payouts: ProviderPayoutsService) {}

  @Post()
  @ApiCreatedResponse({ description: "Accept a simulated provider payout request." })
  createProviderPayout(@Body() body: ProviderPayoutRequest) {
    return this.payouts.createPayout(body);
  }
}
