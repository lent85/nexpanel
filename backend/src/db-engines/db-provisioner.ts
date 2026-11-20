import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { VaultService } from '../vault/vault.js';
import { PasswordHasher } from '../auth/passwords.js';
import { AuditService } from '../audit/audit.js';
import { CreateDatabaseInput, DatabaseRecord, DbEngine, DbPrivileges, DbUserRecord } from './types.js';
import { EngineRegistry } from './engine-registry.js';
import { getDbEngineClient } from './engine-client.js';

export interface ProvisionedDatabaseResult {
  database: DatabaseRecord;
  user: DbUserRecord & { plainPassword?: string };
  engine: DbEngine;
}

export class DbProvisioner {
  /**
   * Atomically creates a Database + User with privileges in one form (FR-DB-03).
   * Enforces Hard Rule R2 (pluggable engines) and R3 (blocks WordPress on PostgreSQL by default).
   */
  public static async createDatabaseAndUser(
    input: CreateDatabaseInput,
    actorUserId?: string,
    actorIp?: string
  ): Promise<ProvisionedDatabaseResult> {
    const db = getDb();

    // 1. Resolve Engine
    let engine: DbEngine;
    if (input.engineId) {
      const found = await EngineRegistry.getEngineById(input.engineId);
      if (!found) {
        throw new Error(`Database engine '${input.engineId}' not found`);
      }
      engine = found;
    } else if (input.siteId) {
      const siteRes = await db.query('SELECT * FROM sites WHERE id = $1', [input.siteId]);
      const site = siteRes.rows[0];
      if (site?.db_engine_id) {
        const found = await EngineRegistry.getEngineById(site.db_engine_id);
        engine = found || (await EngineRegistry.getDefaultEngine());
      } else {
        engine = await EngineRegistry.getDefaultEngine();
      }
    } else {
      engine = await EngineRegistry.getDefaultEngine();
    }

    // 2. Validate Engine status
    if (engine.status === 'disabled') {
      throw new Error(`Cannot create database: Engine '${engine.name}' is currently disabled`);
    }

    // 3. Validate Site compatibility (Hard Rule R3 / WordPress on PostgreSQL)
    if (input.siteId) {
      const siteRes = await db.query('SELECT * FROM sites WHERE id = $1', [input.siteId]);
      const site = siteRes.rows[0];
      if (site && site.type === 'wordpress' && engine.type === 'postgres' && !input.allowPostgresWordPress) {
        throw new Error(
          `Hard Rule Violation: WordPress requires MySQL or MariaDB by default. ` +
          `PostgreSQL is blocked for WordPress sites unless pg4wp plugin configuration is explicitly confirmed.`
        );
      }
    }

    // 4. Validate DB name uniqueness on this engine
    const existingDb = await db.query(
      'SELECT id FROM databases WHERE engine_id = $1 AND name = $2 AND deleted_at IS NULL',
      [engine.id, input.name]
    );
    if (existingDb.rows.length > 0) {
      throw new Error(`Database '${input.name}' already exists on engine '${engine.name}'`);
    }

    // 5. Generate Password if needed
    const plainPassword = input.user.password || PasswordHasher.generateRandomPassword(16);
    const passwordSecretRef = VaultService.encrypt(plainPassword);

    const charset = input.charset || (engine.type === 'postgres' ? 'UTF8' : 'utf8mb4');
    const collation = input.collation || (engine.type === 'postgres' ? 'en_US.utf8' : 'utf8mb4_unicode_ci');
    const host = input.user.host || '%';
    const privileges: DbPrivileges = input.user.privileges || 'read_write';

    // 6. Execute creation on target engine via protocol / client
    const rootPass = VaultService.decrypt(engine.root_password_secret_ref);
    const client = getDbEngineClient(engine, rootPass);

    await client.createDatabase(input.name, charset, collation);
    await client.createUser(input.user.username, plainPassword, host, privileges, input.name);

    // 7. Store records in panel database
    const dbId = randomUUID();
    const userId = randomUUID();
    const now = new Date().toISOString();

    const dbRecord: DatabaseRecord = {
      id: dbId,
      site_id: input.siteId,
      engine_id: engine.id,
      name: input.name,
      charset,
      collation,
      status: 'active',
      created_at: now,
      updated_at: now
    };

    const userRecord: DbUserRecord = {
      id: userId,
      database_id: dbId,
      username: input.user.username,
      host,
      privileges,
      privileges_json: input.user.privilegesList ? JSON.stringify(input.user.privilegesList) : undefined,
      password_secret_ref: passwordSecretRef,
      created_at: now,
      updated_at: now
    };

    await db.execute(
      `INSERT INTO databases (
        id, site_id, engine_id, name, charset, "collation", status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [dbId, input.siteId || null, engine.id, input.name, charset, collation, 'active', now, now]
    );

    await db.execute(
      `INSERT INTO db_users (
        id, database_id, username, host, privileges, privileges_json, password_secret_ref, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        dbId,
        input.user.username,
        host,
        privileges,
        userRecord.privileges_json || null,
        passwordSecretRef,
        now,
        now
      ]
    );

    await AuditService.log({
      action: 'database:create',
      actorUserId,
      actorIp,
      entityType: 'database',
      entityId: dbId,
      after: {
        name: input.name,
        engineId: engine.id,
        engineName: engine.name,
        engineType: engine.type,
        siteId: input.siteId,
        username: input.user.username
      }
    });

    return {
      database: dbRecord,
      user: {
        ...userRecord,
        plainPassword
      },
      engine
    };
  }

  public static async listDatabases(siteId?: string, engineId?: string): Promise<any[]> {
    const db = getDb();
    let sql = 'SELECT * FROM databases WHERE deleted_at IS NULL';
    const params: any[] = [];
    let idx = 1;

    if (siteId) {
      sql += ` AND site_id = $${idx++}`;
      params.push(siteId);
    }
    if (engineId) {
      sql += ` AND engine_id = $${idx++}`;
      params.push(engineId);
    }

    sql += ' ORDER BY created_at DESC';
    const res = await db.query<DatabaseRecord>(sql, params);

    const fullList = [];
    for (const d of res.rows) {
      const engine = await EngineRegistry.getEngineById(d.engine_id);
      const usersRes = await db.query<DbUserRecord>(
        'SELECT id, database_id, username, host, privileges, created_at FROM db_users WHERE database_id = $1 AND deleted_at IS NULL',
        [d.id]
      );
      fullList.push({
        ...d,
        engine: engine ? { id: engine.id, name: engine.name, type: engine.type, mode: engine.mode } : null,
        users: usersRes.rows
      });
    }

    return fullList;
  }

  public static async getDatabaseById(id: string): Promise<any | null> {
    const db = getDb();
    const res = await db.query<DatabaseRecord>('SELECT * FROM databases WHERE id = $1 AND deleted_at IS NULL', [id]);
    const d = res.rows[0];
    if (!d) return null;

    const engine = await EngineRegistry.getEngineById(d.engine_id);
    const usersRes = await db.query<DbUserRecord>(
      'SELECT id, database_id, username, host, privileges, created_at FROM db_users WHERE database_id = $1 AND deleted_at IS NULL',
      [d.id]
    );

    return {
      ...d,
      engine: engine ? { id: engine.id, name: engine.name, type: engine.type, mode: engine.mode } : null,
      users: usersRes.rows
    };
  }

  public static async deleteDatabase(id: string, actorUserId?: string, actorIp?: string): Promise<void> {
    const db = getDb();
    const dRes = await db.query<DatabaseRecord>('SELECT * FROM databases WHERE id = $1 AND deleted_at IS NULL', [id]);
    const database = dRes.rows[0];
    if (!database) {
      throw new Error(`Database '${id}' not found`);
    }

    const engine = await EngineRegistry.getEngineById(database.engine_id);
    if (engine && engine.status !== 'disabled') {
      try {
        const rootPass = VaultService.decrypt(engine.root_password_secret_ref);
        const client = getDbEngineClient(engine, rootPass);
        await client.dropDatabase(database.name);
      } catch (err: any) {
        console.warn(`Warning dropping DB from engine: ${err.message}`);
      }
    }

    const now = new Date().toISOString();
    await db.execute('UPDATE databases SET deleted_at = $1 WHERE id = $2', [now, id]);
    await db.execute('UPDATE db_users SET deleted_at = $1 WHERE database_id = $2', [now, id]);

    await AuditService.log({
      action: 'database:delete',
      actorUserId,
      actorIp,
      entityType: 'database',
      entityId: id,
      after: { name: database.name, engineId: database.engine_id }
    });
  }

  public static async addUser(
    dbId: string,
    username: string,
    password?: string,
    host = '%',
    privileges: DbPrivileges = 'read_write',
    actorUserId?: string,
    actorIp?: string
  ): Promise<DbUserRecord & { plainPassword: string }> {
    const db = getDb();
    const d = await this.getDatabaseById(dbId);
    if (!d) {
      throw new Error(`Database '${dbId}' not found`);
    }

    const existingUser = await db.query(
      'SELECT id FROM db_users WHERE database_id = $1 AND username = $2 AND deleted_at IS NULL',
      [dbId, username]
    );
    if (existingUser.rows.length > 0) {
      throw new Error(`User '${username}' already exists for database '${d.name}'`);
    }

    const plainPassword = password || PasswordHasher.generateRandomPassword(16);
    const passwordSecretRef = VaultService.encrypt(plainPassword);

    const engine = await EngineRegistry.getEngineById(d.engine_id);
    if (engine) {
      const rootPass = VaultService.decrypt(engine.root_password_secret_ref);
      const client = getDbEngineClient(engine, rootPass);
      await client.createUser(username, plainPassword, host, privileges, d.name);
    }

    const userId = randomUUID();
    const now = new Date().toISOString();
    const userRecord: DbUserRecord = {
      id: userId,
      database_id: dbId,
      username,
      host,
      privileges,
      password_secret_ref: passwordSecretRef,
      created_at: now,
      updated_at: now
    };

    await db.execute(
      `INSERT INTO db_users (
        id, database_id, username, host, privileges, password_secret_ref, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, dbId, username, host, privileges, passwordSecretRef, now, now]
    );

    await AuditService.log({
      action: 'db_user:create',
      actorUserId,
      actorIp,
      entityType: 'db_user',
      entityId: userId,
      after: { databaseId: dbId, username, host, privileges }
    });

    return {
      ...userRecord,
      plainPassword
    };
  }

  public static async changeUserPassword(
    dbId: string,
    userId: string,
    newPassword?: string,
    actorUserId?: string,
    actorIp?: string
  ): Promise<{ plainPassword: string }> {
    const db = getDb();
    const d = await this.getDatabaseById(dbId);
    if (!d) {
      throw new Error(`Database '${dbId}' not found`);
    }

    const userRes = await db.query<DbUserRecord>('SELECT * FROM db_users WHERE id = $1 AND database_id = $2', [
      userId,
      dbId
    ]);
    const user = userRes.rows[0];
    if (!user) {
      throw new Error(`User '${userId}' not found in database '${d.name}'`);
    }

    const plainPassword = newPassword || PasswordHasher.generateRandomPassword(16);
    const passwordSecretRef = VaultService.encrypt(plainPassword);

    const engine = await EngineRegistry.getEngineById(d.engine_id);
    if (engine) {
      const rootPass = VaultService.decrypt(engine.root_password_secret_ref);
      const client = getDbEngineClient(engine, rootPass);
      await client.updateUserPassword(user.username, user.host, plainPassword);
    }

    const now = new Date().toISOString();
    await db.execute(
      'UPDATE db_users SET password_secret_ref = $1, updated_at = $2 WHERE id = $3',
      [passwordSecretRef, now, userId]
    );

    await AuditService.log({
      action: 'db_user:password_change',
      actorUserId,
      actorIp,
      entityType: 'db_user',
      entityId: userId,
      after: { databaseId: dbId, username: user.username }
    });

    return { plainPassword };
  }

  public static async deleteUser(
    dbId: string,
    userId: string,
    actorUserId?: string,
    actorIp?: string
  ): Promise<void> {
    const db = getDb();
    const d = await this.getDatabaseById(dbId);
    if (!d) {
      throw new Error(`Database '${dbId}' not found`);
    }

    const userRes = await db.query<DbUserRecord>('SELECT * FROM db_users WHERE id = $1 AND database_id = $2', [
      userId,
      dbId
    ]);
    const user = userRes.rows[0];
    if (!user) {
      throw new Error(`User '${userId}' not found`);
    }

    const engine = await EngineRegistry.getEngineById(d.engine_id);
    if (engine) {
      try {
        const rootPass = VaultService.decrypt(engine.root_password_secret_ref);
        const client = getDbEngineClient(engine, rootPass);
        await client.dropUser(user.username, user.host);
      } catch (err: any) {
        console.warn(`Warning dropping user from engine: ${err.message}`);
      }
    }

    const now = new Date().toISOString();
    await db.execute('UPDATE db_users SET deleted_at = $1 WHERE id = $2', [now, userId]);

    await AuditService.log({
      action: 'db_user:delete',
      actorUserId,
      actorIp,
      entityType: 'db_user',
      entityId: userId,
      after: { databaseId: dbId, username: user.username }
    });
  }
}
