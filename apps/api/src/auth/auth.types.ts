import type { AuthRole, AuthPrincipalType } from "@paymentops/contracts";
import type { IncomingHttpHeaders } from "node:http";

export interface AuthenticatedPrincipal {
  type: AuthPrincipalType;
  subject: string;
  email: string | null;
  roles: AuthRole[];
  permissions: string[];
  tenantId: string | null;
  apiClientId: string | null;
  apiKeyId: string | null;
}

export interface AuthenticatedRequest {
  headers: IncomingHttpHeaders;
  auth?: AuthenticatedPrincipal;
}