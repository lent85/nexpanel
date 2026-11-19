import { UserRole } from '../db/types.js';

export type PermissionAction =
  | 'admin:access'
  | 'users:manage'
  | 'settings:manage'
  | 'edge:manage'
  | 'engines:manage'
  | 'sites:create'
  | 'sites:delete'
  | 'sites:edit'
  | 'sites:view'
  | 'db:create'
  | 'db:delete'
  | 'db:edit'
  | 'db:view'
  | 'secrets:reveal'
  | 'import:cloudpanel'
  | 'backup:restore'
  | 'backup:create'
  | 'tokens:manage';

export interface AuthContext {
  userId: string;
  role: UserRole;
  assignedSiteIds?: string[];
}

const rolePermissions: Record<UserRole, Set<PermissionAction>> = {
  admin: new Set<PermissionAction>([
    'admin:access',
    'users:manage',
    'settings:manage',
    'edge:manage',
    'engines:manage',
    'sites:create',
    'sites:delete',
    'sites:edit',
    'sites:view',
    'db:create',
    'db:delete',
    'db:edit',
    'db:view',
    'secrets:reveal',
    'import:cloudpanel',
    'backup:restore',
    'backup:create',
    'tokens:manage'
  ]),
  site_manager: new Set<PermissionAction>([
    'sites:create',
    'sites:delete',
    'sites:edit',
    'sites:view',
    'db:create',
    'db:delete',
    'db:edit',
    'db:view',
    'secrets:reveal',
    'import:cloudpanel',
    'backup:restore',
    'backup:create',
    'tokens:manage'
  ]),
  user: new Set<PermissionAction>([
    'sites:edit',
    'sites:view',
    'db:create',
    'db:delete',
    'db:edit',
    'db:view',
    'secrets:reveal',
    'backup:restore',
    'backup:create',
    'tokens:manage'
  ]),
  client: new Set<PermissionAction>([
    'sites:view',
    'db:view',
    'tokens:manage'
  ])
};

export class RbacService {
  public static can(ctx: AuthContext, action: PermissionAction, siteId?: string): boolean {
    const rolePerms = rolePermissions[ctx.role];
    if (!rolePerms || !rolePerms.has(action)) {
      return false;
    }

    // Role-specific constraints
    if (ctx.role === 'admin' || ctx.role === 'site_manager') {
      return true;
    }

    // For 'user' and 'client', check site assignment if a siteId is specified
    if (siteId) {
      if (!ctx.assignedSiteIds || !ctx.assignedSiteIds.includes(siteId)) {
        return false;
      }
    }

    return true;
  }

  public static requirePermission(ctx: AuthContext, action: PermissionAction, siteId?: string): void {
    if (!RbacService.can(ctx, action, siteId)) {
      const err = new Error(`Forbidden: Role '${ctx.role}' does not have permission '${action}'`);
      (err as any).statusCode = 403;
      throw err;
    }
  }
}
