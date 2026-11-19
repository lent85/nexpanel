import { v7 as uuidv7 } from 'uuid';
import { getDb } from '../db/index.js';
import { AuditLog } from '../db/types.js';
import { VaultService } from '../vault/vault.js';

export interface LogActionParams {
  actorUserId?: string;
  actorIp?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

export interface AuditQueryOptions {
  action?: string;
  entityType?: string;
  actorUserId?: string;
  from?: string;
  to?: string;
  page?: number;
  perPage?: number;
}

export class AuditService {
  public static async log(params: LogActionParams): Promise<AuditLog> {
    const db = getDb();
    const id = uuidv7();
    const now = new Date().toISOString();

    const sanitizedBefore = params.before ? (VaultService.sanitizeObject(params.before) as Record<string, unknown>) : undefined;
    const sanitizedAfter = params.after ? (VaultService.sanitizeObject(params.after) as Record<string, unknown>) : undefined;

    const auditEntry: AuditLog = {
      id,
      actorUserId: params.actorUserId,
      actorIp: params.actorIp,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeJson: sanitizedBefore,
      afterJson: sanitizedAfter,
      createdAt: now
    };

    await db.execute(
      `INSERT INTO audit_logs (id, actor_user_id, actor_ip, action, entity_type, entity_id, before_json, after_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        auditEntry.id,
        auditEntry.actorUserId,
        auditEntry.actorIp,
        auditEntry.action,
        auditEntry.entityType,
        auditEntry.entityId,
        sanitizedBefore ? JSON.stringify(sanitizedBefore) : null,
        sanitizedAfter ? JSON.stringify(sanitizedAfter) : null,
        auditEntry.createdAt
      ]
    );

    return auditEntry;
  }

  public static async list(options: AuditQueryOptions = {}): Promise<{ data: AuditLog[]; total: number }> {
    const db = getDb();
    const page = options.page || 1;
    const perPage = options.perPage || 25;

    // Use memory/pg query
    const res = await db.query<AuditLog>(
      'SELECT id, actor_user_id, actor_ip, action, entity_type, entity_id, before_json, after_json, created_at FROM audit_logs ORDER BY created_at DESC'
    );

    let rows = res.rows.map((r: any) => ({
      id: r.id,
      actorUserId: r.actor_user_id || r.actorUserId,
      actorIp: r.actor_ip || r.actorIp,
      action: r.action,
      entityType: r.entity_type || r.entityType,
      entityId: r.entity_id || r.entityId,
      beforeJson: typeof r.before_json === 'string' ? JSON.parse(r.before_json) : (r.before_json || r.beforeJson),
      afterJson: typeof r.after_json === 'string' ? JSON.parse(r.after_json) : (r.after_json || r.afterJson),
      createdAt: r.created_at || r.createdAt
    }));

    if (options.action) {
      rows = rows.filter((r) => r.action === options.action);
    }
    if (options.entityType) {
      rows = rows.filter((r) => r.entityType === options.entityType);
    }
    if (options.actorUserId) {
      rows = rows.filter((r) => r.actorUserId === options.actorUserId);
    }

    const total = rows.length;
    const start = (page - 1) * perPage;
    const paged = rows.slice(start, start + perPage);

    return { data: paged, total };
  }

  public static exportCsv(logs: AuditLog[]): string {
    const headers = ['id', 'created_at', 'actor_user_id', 'actor_ip', 'action', 'entity_type', 'entity_id'];
    const lines = [headers.join(',')];

    for (const log of logs) {
      const line = [
        `"${log.id}"`,
        `"${log.createdAt}"`,
        `"${log.actorUserId || ''}"`,
        `"${log.actorIp || ''}"`,
        `"${log.action}"`,
        `"${log.entityType}"`,
        `"${log.entityId || ''}"`
      ];
      lines.push(line.join(','));
    }

    return lines.join('\n');
  }
}
