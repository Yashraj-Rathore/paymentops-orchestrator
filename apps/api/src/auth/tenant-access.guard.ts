import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable
} from "@nestjs/common";

import { AuthRepository } from "./auth.repository.js";
import type { AuthenticatedRequest } from "./auth.types.js";

@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(@Inject(AuthRepository) private readonly repository: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenantId = request.params?.tenantId;
    const principal = request.auth;

    if (!principal) {
      throw new ForbiddenException("An authenticated principal is required");
    }

    if (!tenantId || principal.roles.includes("operations_admin")) {
      return true;
    }

    const email = principal.email;
    if (!email) {
      throw new ForbiddenException("A tenant membership is required for this operation");
    }

    const membership = await this.repository.findActiveMembership(tenantId, email);
    if (!membership) {
      throw new ForbiddenException("The authenticated user is not an active member of this tenant");
    }

    request.auth = {
      ...principal,
      tenantId,
      roles: [membership.role]
    };
    return true;
  }
}
