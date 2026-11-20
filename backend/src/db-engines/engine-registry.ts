import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { VaultService } from '../vault/vault.js';
import { AuditService } from '../audit/audit.js';
import { CreateEngineInput, DbEngine } from './types.js';
import { getDbEngineClient, TestConnectionResult } from './engine-client.js';

export class EngineRegistry {
  /**
   * Initializes the default DB engine on fresh install (D-05: internal MySQL 8.4 Docker).
   */
  public static async initDefaultEngines(): Promise<void> {
    const db = getDb();
    const existing = await db.query<DbEngine>('SELECT * FROM db_engines WHERE is_default = TRUE LIMIT 1');
    if (existing.rows.length > 0) {
      return;
    }

    const engineId = randomUUID();
    const defaultRootPass = 'NexPanelMysqlRoot!2026';
    const secretRef = VaultService.encrypt(defaultRootPass);
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO db_engines (
        id, name, type, version, mode, container_name, image, volume,
        internal_port, root_username, root_password_secret_ref, is_default,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        engineId,
        'Internal MySQL 8.4',
        'mysql',
        '8.4',
        'internal-docker',
        'nexpanel-mysql-8.4',
        'mysql:8.4',
        '/data/mysql',
        3306,
        'root',
        secretRef,
        true,
        'active',
        now,
        now
      ]
    );
  }

  public static async listEngines(): Promise<DbEngine[]> {
    const db = getDb();
    const res = await db.query<DbEngine>('SELECT * FROM db_engines ORDER BY created_at ASC');
    return res.rows;
  }

  public static async getEngineById(id: string): Promise<DbEngine | null> {
    const db = getDb();
    const res = await db.query<DbEngine>('SELECT * FROM db_engines WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  public static async getDefaultEngine(): Promise<DbEngine> {
    const db = getDb();
    const res = await db.query<DbEngine>('SELECT * FROM db_engines WHERE is_default = TRUE LIMIT 1');
    if (res.rows.length > 0) {
      return res.rows[0];
    }
    const anyEngine = await db.query<DbEngine>('SELECT * FROM db_engines LIMIT 1');
    if (anyEngine.rows.length > 0) {
      return anyEngine.rows[0];
    }
    // Auto-initialize default engine if table is empty
    await this.initDefaultEngines();
    const fallback = await db.query<DbEngine>('SELECT * FROM db_engines WHERE is_default = TRUE LIMIT 1');
    if (fallback.rows.length > 0) {
      return fallback.rows[0];
    }
    throw new Error('No database engine registered');
  }

  /**
   * Registers a new Database Engine (internal-docker, external-docker, or external-remote).
   */
  public static async registerEngine(
    input: CreateEngineInput,
    actorUserId?: string,
    actorIp?: string
  ): Promise<DbEngine> {
    // Hard Rule R2 Guard: Panel metadata DB ('nexpanel-db') can NEVER be registered as a site engine
    const isPanelDbContainer = input.containerName === 'nexpanel-db' || input.externalContainerName === 'nexpanel-db';
    const isPanelDbHost = input.host && (input.host === 'nexpanel-db' || (input.type === 'postgres' && input.host.includes('nexpanel-db')));
    if (isPanelDbContainer || isPanelDbHost) {
      const err = new Error("Cannot register panel metadata database ('nexpanel-db') as a site engine (Violates Hard Rule R2)");
      (err as any).statusCode = 400;
      throw err;
    }

    const db = getDb();
    const id = randomUUID();
    const secretRef = VaultService.encrypt(input.rootPassword);
    const now = new Date().toISOString();

    // If setting as default, clear existing default
    if (input.isDefault) {
      await db.execute('UPDATE db_engines SET is_default = FALSE WHERE is_default = TRUE');
    }

    const engineRecord: DbEngine = {
      id,
      name: input.name,
      type: input.type,
      version: input.version,
      mode: input.mode,
      container_name: input.containerName,
      image: input.image,
      volume: input.volume,
      internal_port: input.internalPort,
      external_container_name: input.externalContainerName,
      network: input.network,
      host: input.host,
      port: input.port,
      tls: input.tls ?? false,
      tls_ca: input.tlsCa,
      root_username: input.rootUsername,
      root_password_secret_ref: secretRef,
      is_default: input.isDefault ?? false,
      status: 'active',
      created_at: now,
      updated_at: now
    };

    // Pre-flight test connection
    const client = getDbEngineClient(engineRecord, input.rootPassword);
    const testRes = await client.testConnection();
    if (!testRes.ok) {
      throw new Error(`Failed to connect to engine '${input.name}': ${testRes.error || 'Connection failed'}`);
    }

    await db.execute(
      `INSERT INTO db_engines (
        id, name, type, version, mode, container_name, image, volume,
        internal_port, external_container_name, network, host, port, tls,
        tls_ca, root_username, root_password_secret_ref, is_default,
        status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        id,
        input.name,
        input.type,
        input.version,
        input.mode,
        input.containerName || null,
        input.image || null,
        input.volume || null,
        input.internalPort || null,
        input.externalContainerName || null,
        input.network || null,
        input.host || null,
        input.port || null,
        input.tls ?? false,
        input.tlsCa || null,
        input.rootUsername,
        secretRef,
        input.isDefault ?? false,
        'active',
        now,
        now
      ]
    );

    await AuditService.log({
      action: 'db_engine:register',
      actorUserId,
      actorIp,
      entityType: 'db_engine',
      entityId: id,
      after: {
        name: input.name,
        type: input.type,
        version: input.version,
        mode: input.mode,
        host: input.host,
        container: input.containerName || input.externalContainerName
      }
    });

    return engineRecord;
  }

  /**
   * Tests connectivity to an engine.
   */
  public static async testEngine(id: string): Promise<TestConnectionResult> {
    const engine = await this.getEngineById(id);
    if (!engine) {
      throw new Error(`Engine '${id}' not found`);
    }

    const rootPass = VaultService.decrypt(engine.root_password_secret_ref);
    const client = getDbEngineClient(engine, rootPass);
    const result = await client.testConnection();

    const db = getDb();
    const newStatus = result.ok ? (engine.status === 'disabled' ? 'disabled' : 'active') : 'error';
    const now = new Date().toISOString();

    await db.execute(
      'UPDATE db_engines SET status = $1, last_checked_at = $2, updated_at = $3 WHERE id = $4',
      [newStatus, now, now, id]
    );

    return result;
  }

  /**
   * Enables or disables an internal Docker engine.
   * HARD RULE R2: External engines (external-docker, external-remote) cannot be toggled/stopped!
   */
  public static async toggleEngine(
    id: string,
    enable: boolean,
    actorUserId?: string,
    actorIp?: string
  ): Promise<DbEngine> {
    const engine = await this.getEngineById(id);
    if (!engine) {
      throw new Error(`Engine '${id}' not found`);
    }

    this.assertContainerLifecycleAllowed(engine, enable ? 'enable' : 'disable');

    const db = getDb();
    const newStatus = enable ? 'active' : 'disabled';
    const now = new Date().toISOString();

    await db.execute('UPDATE db_engines SET status = $1, updated_at = $2 WHERE id = $3', [newStatus, now, id]);

    await AuditService.log({
      action: enable ? 'db_engine:enable' : 'db_engine:disable',
      actorUserId,
      actorIp,
      entityType: 'db_engine',
      entityId: id,
      after: { name: engine.name, mode: engine.mode, newStatus }
    });

    engine.status = newStatus;
    engine.updated_at = now;
    return engine;
  }

  /**
   * Removes an engine from registry.
   */
  public static async deleteEngine(id: string, actorUserId?: string, actorIp?: string): Promise<void> {
    const engine = await this.getEngineById(id);
    if (!engine) {
      throw new Error(`Engine '${id}' not found`);
    }

    if (engine.is_default) {
      throw new Error(`Cannot delete engine '${engine.name}' because it is currently set as the default engine`);
    }

    const db = getDb();
    const databases = await db.query('SELECT id FROM databases WHERE engine_id = $1 AND deleted_at IS NULL', [id]);
    if (databases.rows.length > 0) {
      throw new Error(
        `Cannot delete engine '${engine.name}' because it still hosts ${databases.rows.length} active database(s)`
      );
    }

    await db.execute('DELETE FROM db_engines WHERE id = $1', [id]);

    await AuditService.log({
      action: 'db_engine:delete',
      actorUserId,
      actorIp,
      entityType: 'db_engine',
      entityId: id,
      after: { name: engine.name, type: engine.type, mode: engine.mode }
    });
  }

  /**
   * HARD RULE R2 ENFORCEMENT:
   * "External engines must never be restarted, stopped, deleted or upgraded by the panel."
   */
  public static assertContainerLifecycleAllowed(engine: DbEngine, action: string): void {
    if (engine.mode !== 'internal-docker') {
      throw new Error(
        `Hard Rule R2 Violation: Action '${action}' is forbidden. ` +
        `Engine '${engine.name}' is an ${engine.mode} engine. ` +
        `External engines must never be restarted, stopped, deleted, or upgraded by NexPanel.`
      );
    }
  }
}
