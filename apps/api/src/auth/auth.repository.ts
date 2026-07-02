import { Inject, Injectable } from "@nestjs/common";
import type { UserMembershipRole } from "@paymentops/contracts";
import sql from "mssql";

import { DatabaseService } from "../database/database.service.js";

interface ApiKeyAuthRow {
  api_key_id: string;
  api_key_external_id: string;
  permissions_json: string;
  tenant_id: string;
  tenant_external_id: string;
  api_client_id: string;
  api_client_external_id: string;
}

interface MembershipAuthRow {
  tenant_external_id: string;
  role: UserMembershipRole;
}

export interface ActiveApiKeyRecord {
  apiKeyId: string;
  apiKeyExternalId: string;
  tenantId: string;
  tenantExternalId: string;
  apiClientId: string;
  apiClientExternalId: string;
  permissions: string[];
}

export interface AuthMembershipRecord {
  tenantExternalId: string;
  role: UserMembershipRole;
}

@Injectable()
export class AuthRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async findActiveApiKeyByHash(keyHash: string): Promise<ActiveApiKeyRecord | null> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("keyHash", sql.NVarChar(128), keyHash)
      .query<ApiKeyAuthRow>(`
SELECT TOP 1
  api_keys.id AS api_key_id,
  api_keys.external_id AS api_key_external_id,
  api_keys.permissions_json,
  tenants.id AS tenant_id,
  tenants.external_id AS tenant_external_id,
  api_clients.id AS api_client_id,
  api_clients.external_id AS api_client_external_id
FROM dbo.api_keys
INNER JOIN dbo.api_clients ON api_clients.id = api_keys.api_client_id
INNER JOIN dbo.tenants ON tenants.id = api_keys.tenant_id
WHERE api_keys.key_hash = @keyHash
  AND api_keys.revoked_at IS NULL
  AND (api_keys.expires_at IS NULL OR api_keys.expires_at > SYSUTCDATETIME())
  AND api_clients.status = N'active'
  AND tenants.status = N'active';
`);

    const row = result.recordset[0];

    if (!row) {
      return null;
    }

    await pool
      .request()
      .input("apiKeyId", sql.UniqueIdentifier, row.api_key_id)
      .query("UPDATE dbo.api_keys SET last_used_at = SYSUTCDATETIME() WHERE id = @apiKeyId;");

    return {
      apiKeyId: row.api_key_id,
      apiKeyExternalId: row.api_key_external_id,
      tenantId: row.tenant_id,
      tenantExternalId: row.tenant_external_id,
      apiClientId: row.api_client_id,
      apiClientExternalId: row.api_client_external_id,
      permissions: JSON.parse(row.permissions_json) as string[]
    };
  }

  async findActiveMembershipsByEmail(email: string): Promise<AuthMembershipRecord[]> {
    const pool = await this.database.connect();
    const result = await pool
      .request()
      .input("email", sql.NVarChar(256), email.toLowerCase())
      .query<MembershipAuthRow>(`
SELECT tenants.external_id AS tenant_external_id, user_memberships.role
FROM dbo.user_memberships
INNER JOIN dbo.tenants ON tenants.id = user_memberships.tenant_id
WHERE LOWER(user_memberships.user_email) = @email
  AND user_memberships.status = N'active'
  AND tenants.status = N'active'
ORDER BY user_memberships.created_at ASC;
`);

    return result.recordset.map((row) => ({
      tenantExternalId: row.tenant_external_id,
      role: row.role
    }));
  }

  async findActiveMembership(
    tenantExternalId: string,
    email: string
  ): Promise<AuthMembershipRecord | null> {
    const memberships = await this.findActiveMembershipsByEmail(email);
    return memberships.find((membership) => membership.tenantExternalId === tenantExternalId) ?? null;
  }
}
