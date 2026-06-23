import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";

import { AuthService } from "./auth.service.js";
import type { AuthenticatedRequest } from "./auth.types.js";

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = await this.auth.authenticateApiKey(request.headers);
    return true;
  }
}