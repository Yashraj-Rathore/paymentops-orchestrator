import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthRole } from "@paymentops/contracts";

import type { AuthenticatedRequest } from "./auth.types.js";
import { requiredRolesMetadataKey } from "./roles.decorator.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AuthRole[]>(requiredRolesMetadataKey, [
      context.getHandler(),
      context.getClass()
    ]) ?? [];

    if (requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const roles = request.auth?.roles ?? [];
    const allowed = requiredRoles.some((role) => roles.includes(role));

    if (!allowed) {
      throw new ForbiddenException("Authenticated principal does not have the required role");
    }

    return true;
  }
}