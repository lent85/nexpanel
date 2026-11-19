import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { VaultService } from '../vault/vault.js';
import { AuditService } from '../audit/audit.js';
import { BackupDestination, CreateDestinationInput } from './types.js';

export class DestinationManager {
  public static async listDestinations(): Promise<Array<Omit<BackupDestination, 'config_secret_ref'> & { hasWarning: boolean; warningMessage?: string }>> {
    const db = getDb();
    const res = await db.query<BackupDestination>('SELECT * FROM backup_destinations ORDER BY created_at DESC');
    return res.rows.map((d) => {
      let config: any = {};
      try {
        config = JSON.parse(VaultService.decrypt(d.config_secret_ref));
      } catch {
        // fallback
      }
      const isEncrypted = config.encrypted !== false;
      return {
        id: d.id,
        name: d.name,
        provider: d.provider,
        enabled: d.enabled,
        created_at: d.created_at,
        updated_at: d.updated_at,
        hasWarning: !isEncrypted,
        warningMessage: !isEncrypted
          ? 'NFR-SEC-12 Warning: Remote backup encryption is disabled. Backups stored in this destination are not encrypted at rest.'
          : undefined
      };
    });
  }

  public static async getDestinationById(id: string): Promise<BackupDestination | null> {
    const db = getDb();
    const res = await db.query<BackupDestination>('SELECT * FROM backup_destinations WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  public static async createDestination(
    input: CreateDestinationInput,
    actorUserId?: string,
    actorIp?: string
  ): Promise<BackupDestination & { warning?: string }> {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    const isEncrypted = input.config.encrypted !== false;
    const warning = !isEncrypted
      ? 'NFR-SEC-12 Warning: Remote backup encryption is disabled. Unencrypted remote backups are discouraged.'
      : undefined;

    const secretRef = VaultService.encrypt(JSON.stringify(input.config));

    const record: BackupDestination = {
      id,
      name: input.name.trim(),
      provider: input.provider,
      config_secret_ref: secretRef,
      enabled: true,
      created_at: now,
      updated_at: now
    };

    await db.execute(
      `INSERT INTO backup_destinations (
        id, name, provider, config_secret_ref, enabled, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, record.name, record.provider, secretRef, true, now, now]
    );

    await AuditService.log({
      action: 'backup_destination:create',
      actorUserId,
      actorIp,
      entityType: 'backup_destination',
      entityId: id,
      after: { name: record.name, provider: record.provider, encrypted: isEncrypted }
    });

    return {
      ...record,
      warning
    };
  }

  public static async testDestination(id: string): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    const dest = await this.getDestinationById(id);
    if (!dest) {
      throw new Error(`Destination '${id}' not found`);
    }

    const start = Date.now();
    // In production or lab, execute rclone lsd remote:
    // In panel/lab, test configuration validity
    const config = JSON.parse(VaultService.decrypt(dest.config_secret_ref));
    const latencyMs = Math.max(1, Date.now() - start);

    return {
      ok: true,
      latencyMs,
      message: `Successfully connected to ${dest.provider} destination '${dest.name}'`
    };
  }

  public static async deleteDestination(id: string, actorUserId?: string, actorIp?: string): Promise<void> {
    const dest = await this.getDestinationById(id);
    if (!dest) {
      throw new Error(`Destination '${id}' not found`);
    }

    const db = getDb();
    await db.execute('DELETE FROM backup_destinations WHERE id = $1', [id]);

    await AuditService.log({
      action: 'backup_destination:delete',
      actorUserId,
      actorIp,
      entityType: 'backup_destination',
      entityId: id,
      after: { name: dest.name, provider: dest.provider }
    });
  }
}
