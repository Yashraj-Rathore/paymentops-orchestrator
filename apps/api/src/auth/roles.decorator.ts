import { SetMetadata } from "@nestjs/common";
import type { AuthRole } from "@paymentops/contracts";

export const requiredRolesMetadataKey = "paymentops:required-roles";

export function RequireRoles(...roles: AuthRole[]) {
  return SetMetadata(requiredRolesMetadataKey, roles);
}