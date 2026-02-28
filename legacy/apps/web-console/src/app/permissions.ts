import type { GatewayPrincipal, UserRole } from "../lib/gateway-client";

export type ConsolePermissions = {
  canAccessChat: boolean;
  canAccessAdmin: boolean;
  canReadUsers: boolean;
  canCreateUsers: boolean;
  canUpdateUserStatus: boolean;
  canResetUserPassword: boolean;
  canUpdateMemberships: boolean;
  canReadSecrets: boolean;
  canWriteSecrets: boolean;
  canReadInfra: boolean;
  canWriteInfra: boolean;
  canWritePolicy: boolean;
  canWriteGovernance: boolean;
  canReadCrossUserContext: boolean;
  canReadSkillSync: boolean;
  canWriteTenantSkillSync: boolean;
  canWriteWorkspaceSkillSync: boolean;
  canWriteUserSkillSync: boolean;
  canManageSkillBundles: boolean;
};

export function resolveConsolePermissions(principal?: GatewayPrincipal): ConsolePermissions {
  const roles = principal?.roles ?? [];
  const isTenantAdmin = hasRole(roles, "tenant_admin");
  const isWorkspaceAdmin = hasRole(roles, "workspace_admin");
  const canAccessAdmin = isTenantAdmin || isWorkspaceAdmin;

  return {
    canAccessChat: Boolean(principal),
    canAccessAdmin,
    canReadUsers: canAccessAdmin,
    canCreateUsers: isTenantAdmin,
    canUpdateUserStatus: isTenantAdmin,
    canResetUserPassword: isTenantAdmin,
    canUpdateMemberships: canAccessAdmin,
    canReadSecrets: isTenantAdmin,
    canWriteSecrets: isTenantAdmin,
    canReadInfra: isTenantAdmin,
    canWriteInfra: isTenantAdmin,
    canWritePolicy: canAccessAdmin,
    canWriteGovernance: canAccessAdmin,
    canReadCrossUserContext: canAccessAdmin,
    canReadSkillSync: canAccessAdmin,
    canWriteTenantSkillSync: isTenantAdmin,
    canWriteWorkspaceSkillSync: canAccessAdmin,
    canWriteUserSkillSync: canAccessAdmin,
    canManageSkillBundles: isTenantAdmin
  };
}

function hasRole(roles: UserRole[], role: UserRole): boolean {
  return roles.includes(role);
}
