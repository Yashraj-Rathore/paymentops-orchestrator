import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags
} from "@nestjs/swagger";
import type { ApprovalDecisionRequest } from "@paymentops/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RequireRoles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { TenantAccessGuard } from "../auth/tenant-access.guard.js";
import { ApprovalsService } from "./approvals.service.js";

@ApiTags("approvals")
@ApiBearerAuth()
@ApiHeader({ name: "x-paymentops-dev-admin-token", required: false })
@UseGuards(AdminAuthGuard, TenantAccessGuard, RolesGuard)
@Controller("tenants/:tenantId/approvals")
export class ApprovalsController {
  constructor(@Inject(ApprovalsService) private readonly approvals: ApprovalsService) {}

  @Get()
  @RequireRoles("operations_admin", "merchant_owner", "developer")
  @ApiOkResponse({ description: "List payout approvals for a tenant." })
  listApprovals(@Param("tenantId") tenantId: string) {
    return this.approvals.listApprovals(tenantId);
  }

  @Post(":payoutId/approve")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Approve a payout and release it to the dispatch queue." })
  approvePayout(
    @Param("tenantId") tenantId: string,
    @Param("payoutId") payoutId: string,
    @Body() body: ApprovalDecisionRequest,
    @Req() request: AuthenticatedRequest
  ) {
    return this.approvals.approvePayout(tenantId, payoutId, body, request.auth);
  }

  @Post(":payoutId/reject")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Reject a payout approval request." })
  rejectPayout(
    @Param("tenantId") tenantId: string,
    @Param("payoutId") payoutId: string,
    @Body() body: ApprovalDecisionRequest,
    @Req() request: AuthenticatedRequest
  ) {
    return this.approvals.rejectPayout(tenantId, payoutId, body, request.auth);
  }
}
