import { randomBytes } from 'node:crypto';
import { getDb } from '../db/index.js';
import { VaultService } from '../vault/vault.js';
import { DbProvisioner } from './db-provisioner.js';
import { EngineRegistry } from './engine-registry.js';
import { DbEngineType, DbUserRecord } from './types.js';

export type DbAdminTool = 'phpmyadmin' | 'adminer' | 'pgadmin';

export interface SsoSession {
  token: string;
  tool: DbAdminTool;
  databaseId: string;
  databaseName: string;
  userId: string;
  username: string;
  engineType: DbEngineType;
  host: string;
  port: number;
  expiresAt: string;
}

// Memory cache for active short-lived SSO sessions (5 min TTL)
const activeSsoSessions = new Map<string, SsoSession>();

export class SsoService {
  /**
   * Generates a one-time short-lived token for DB GUI tools SSO (FR-DB-05).
   * Strict Rule: No plaintext password in URL or response.
   */
  public static async generateSsoToken(
    dbId: string,
    userId: string,
    preferredTool?: DbAdminTool
  ): Promise<{ ssoUrl: string; tool: DbAdminTool; expiresAt: string }> {
    const db = getDb();
    const database = await DbProvisioner.getDatabaseById(dbId);
    if (!database) {
      throw new Error(`Database '${dbId}' not found`);
    }

    const engine = await EngineRegistry.getEngineById(database.engine_id);
    if (!engine) {
      throw new Error(`Engine for database '${dbId}' not found`);
    }

    const userRes = await db.query<DbUserRecord>('SELECT * FROM db_users WHERE id = $1 AND database_id = $2', [
      userId,
      dbId
    ]);
    const user = userRes.rows[0];
    if (!user) {
      throw new Error(`User '${userId}' not found in database`);
    }

    // Determine compatible tool
    let tool: DbAdminTool = preferredTool || (engine.type === 'postgres' ? 'pgadmin' : 'phpmyadmin');
    if (tool === 'phpmyadmin' && engine.type === 'postgres') {
      throw new Error('phpMyAdmin does not support PostgreSQL. Use pgAdmin or Adminer.');
    }
    if (tool === 'pgadmin' && engine.type !== 'postgres') {
      throw new Error('pgAdmin only supports PostgreSQL. Use phpMyAdmin or Adminer.');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

    const session: SsoSession = {
      token,
      tool,
      databaseId: dbId,
      databaseName: database.name,
      userId,
      username: user.username,
      engineType: engine.type,
      host: engine.host || engine.container_name || '127.0.0.1',
      port: engine.internal_port || (engine.type === 'postgres' ? 5432 : 3306),
      expiresAt
    };

    activeSsoSessions.set(token, session);

    // Clean up expired sessions periodically
    this.cleanupExpired();

    const ssoUrl = `/sso/${tool}?token=${token}`;
    return {
      ssoUrl,
      tool,
      expiresAt
    };
  }

  public static getSession(token: string): SsoSession | null {
    const session = activeSsoSessions.get(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      activeSsoSessions.delete(token);
      return null;
    }
    return session;
  }

  private static cleanupExpired(): void {
    const now = Date.now();
    for (const [token, session] of activeSsoSessions.entries()) {
      if (new Date(session.expiresAt).getTime() < now) {
        activeSsoSessions.delete(token);
      }
    }
  }
}
