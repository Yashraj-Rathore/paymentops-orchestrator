import { SetMetadata } from "@nestjs/common";

export const requiredApiKeyPermissionsMetadataKey = "paymentops:required-api-key-permissions";

export function RequireApiKeyPermissions(...permissions: string[]) {
  return SetMetadata(requiredApiKeyPermissionsMetadataKey, permissions);
}