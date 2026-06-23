import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { requiredApiKeyPermissionsMetadataKey } from "./api-key-permissions.decorator.js";
import type { AuthenticatedRequest } from "./auth.types.js";

@Injectable()
export class ApiKeyPermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      requiredApiKeyPermissionsMetadataKey,
      [context.getHandler(), context.getClass()]
    ) ?? [];

    if (requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const permissions = request.auth?.permissions ?? [];
    const allowed = requiredPermissions.every(
      (permission) => permissions.includes(permission) || permissions.includes("admin:*")
    );

    if (!allowed) {
      throw new ForbiddenException("API key does not have the required permission");
    }

    return true;
  }
}