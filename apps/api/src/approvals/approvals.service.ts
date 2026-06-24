import { Inject, Injectable } from "@nestjs/common";
import type {
  ApprovalDecisionRequest,
  ApprovalDecisionResponse,
  PayoutApprovalSummary
} from "@paymentops/contracts";

import type { AuthenticatedPrincipal } from "../auth/auth.types.js";
import { ApprovalsRepository } from "./approvals.repository.js";

@Injectable()
export class ApprovalsService {
  constructor(@Inject(ApprovalsRepository) private readonly repository: ApprovalsRepository) {}

  async listApprovals(tenantId: string): Promise<PayoutApprovalSummary[]> {
    return this.repository.listApprovals(tenantId);
  }

  async approvePayout(
    tenantId: string,
    payoutId: string,
    body: ApprovalDecisionRequest,
    principal?: AuthenticatedPrincipal
  ): Promise<ApprovalDecisionResponse> {
    return this.repository.decideApproval({
      tenantExternalId: tenantId,
      payoutExternalId: payoutId,
      decision: "approved",
      decisionReason: optionalString(body.reason),
      actorType: principal?.type ?? "dev_admin",
      actorId: principal?.email ?? principal?.subject ?? "paymentops-api"
    });
  }

  async rejectPayout(
    tenantId: string,
    payoutId: string,
    body: ApprovalDecisionRequest,
    principal?: AuthenticatedPrincipal
  ): Promise<ApprovalDecisionResponse> {
    return this.repository.decideApproval({
      tenantExternalId: tenantId,
      payoutExternalId: payoutId,
      decision: "rejected",
      decisionReason: optionalString(body.reason),
      actorType: principal?.type ?? "dev_admin",
      actorId: principal?.email ?? principal?.subject ?? "paymentops-api"
    });
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
