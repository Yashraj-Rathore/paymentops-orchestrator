import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags
} from "@nestjs/swagger";
import type { CreateReconciliationImportRequest } from "@paymentops/contracts";

import { AdminAuthGuard } from "../auth/admin-auth.guard.js";
import type { AuthenticatedRequest } from "../auth/auth.types.js";
import { RequireRoles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { ReconciliationService } from "./reconciliation.service.js";

@ApiTags("reconciliation")
@ApiBearerAuth()
@ApiHeader({ name: "x-paymentops-dev-admin-token", required: false })
@UseGuards(AdminAuthGuard, RolesGuard)
@Controller("tenants/:tenantId/reconciliation")
export class ReconciliationController {
  constructor(
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService
  ) {}

  @Post("imports")
  @RequireRoles("operations_admin", "merchant_owner")
  @ApiCreatedResponse({ description: "Import and reconcile a provider settlement CSV." })
  createImport(
    @Param("tenantId") tenantId: string,
    @Body() body: CreateReconciliationImportRequest,
    @Req() request: AuthenticatedRequest
  ) {
    return this.reconciliation.createImport(tenantId, body, request.auth);
  }

  @Get("imports")
  @RequireRoles("operations_admin", "merchant_owner", "developer")
  @ApiOkResponse({ description: "List recent settlement imports for a tenant." })
  listImports(@Param("tenantId") tenantId: string) {
    return this.reconciliation.listImports(tenantId);
  }

  @Get("imports/:importId")
  @RequireRoles("operations_admin", "merchant_owner", "developer")
  @ApiOkResponse({ description: "Get settlement rows and discrepancies for an import." })
  getImport(@Param("tenantId") tenantId: string, @Param("importId") importId: string) {
    return this.reconciliation.getImport(tenantId, importId);
  }
}
