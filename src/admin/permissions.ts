export type AdminRole = 'admin' | 'moderator';
export type AdminAction = 'read' | 'create' | 'update' | 'delete' | 'approve' | 'export';

export interface RolePermissions {
  readonly canDelete: boolean;
  readonly forbiddenEntities: ReadonlySet<string>;
}

export const ROLE_RULES: Record<AdminRole, RolePermissions> = {
  admin: {
    canDelete: true,
    forbiddenEntities: new Set<string>(),
  },
  moderator: {
    canDelete: false,
    forbiddenEntities: new Set<string>(['users', 'audit']),
  },
};

export function hasPermission(roles: string[] | undefined, entity: string, action: AdminAction): boolean {
  if (!roles || !roles.length) return false;
  // Super Admin has unrestricted permissions
  if (roles.includes('admin')) return true;
  // Moderator role enforcement
  if (roles.includes('moderator')) {
    if (ROLE_RULES.moderator.forbiddenEntities.has(entity)) return false;
    if (action === 'delete') return false;
    return true;
  }
  return false;
}

export function isAllowedEntity(roles: string[] | undefined, entity: string): boolean {
  return hasPermission(roles, entity, 'read');
}
