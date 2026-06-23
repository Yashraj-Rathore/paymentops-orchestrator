import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ApiCreatedResponse, ApiTags } from "@nestjs/swagger";
import type { ProviderPayoutCallbackRequest } from "@paymentops/contracts";

import { ProviderCallbacksService } from "./provider-callbacks.service.js";

@ApiTags("provider-callbacks")
@Controller("provider-callbacks/payouts")
export class ProviderCallbacksController {
  constructor(@Inject(ProviderCallbacksService) private readonly callbacks: ProviderCallbacksService) {}

  @Post()
  @ApiCreatedResponse({ description: "Accept a provider simulator payout callback." })
  payoutCallback(@Body() body: ProviderPayoutCallbackRequest) {
    return this.callbacks.handlePayoutCallback(body);
  }
}
