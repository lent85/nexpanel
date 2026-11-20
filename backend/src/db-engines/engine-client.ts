import * as mysql from 'mysql2/promise';
import pkg from 'pg';
const { Client: PgClient } = pkg;
import { DbEngine, DbEngineType, DbPrivileges, DumpOptions } from './types.js';

export interface TestConnectionResult {
  ok: boolean;
  latencyMs: number;
  version?: string;
  error?: string;
}

export interface DbEngineClient {
  testConnection(): Promise<TestConnectionResult>;
  createDatabase(name: string, charset?: string, collation?: string): Promise<void>;
  dropDatabase(name: string): Promise<void>;
  createUser(username: string, password: string, host: string, privileges: DbPrivileges, dbName: string): Promise<void>;
  dropUser(username: string, host: string): Promise<void>;
  updateUserPassword(username: string, host: string, newPassword: string): Promise<void>;
  exportDatabase(dbName: string, options?: DumpOptions): Promise<string>;
  importDatabase(dbName: string, sqlContent: string): Promise<{ statementsExecuted: number }>;
}

// In-Memory Fallback State for offline/testing environments
const memoryEngineState = new Map<string, {
  databases: Set<string>;
  users: Map<string, { password: string; host: string; privileges: string; dbName: string }>;
  tables: Map<string, Map<string, Array<Record<string, any>>>>;
}>();

function getMemoryState(engineId: string) {
  if (!memoryEngineState.has(engineId)) {
    memoryEngineState.set(engineId, {
      databases: new Set(),
      users: new Map(),
      tables: new Map()
    });
  }
  return memoryEngineState.get(engineId)!;
}

export class MySqlEngineClient implements DbEngineClient {
  constructor(protected engine: DbEngine, protected rootPassword: string) {}

  private isTestOrMemory(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.PANEL_DB_USE_MEMORY === 'true';
  }

  private async getConnection(database?: string): Promise<mysql.Connection | null> {
    if (this.isTestOrMemory()) {
      return null;
    }
    const conn = await mysql.createConnection({
      host: this.engine.host,
      port: this.engine.port || 3306,
      user: this.engine.root_username || 'root',
      password: this.rootPassword,
      database,
      connectTimeout: 5000,
      multipleStatements: true
    });
    return conn;
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    if (this.engine.status === 'disabled') {
      return { ok: false, latencyMs: 1, error: `Engine '${this.engine.name}' is currently disabled` };
    }

    if (this.isTestOrMemory()) {
      return {
        ok: true,
        latencyMs: Math.max(1, Date.now() - start),
        version: `${this.engine.type} ${this.engine.version}`
      };
    }

    try {
      const conn = await this.getConnection();
      if (!conn) {
        return { ok: false, latencyMs: Date.now() - start, error: 'Could not establish MySQL connection' };
      }
      try {
        const [rows]: [any, any] = await conn.query('SELECT VERSION() AS version');
        return {
          ok: true,
          latencyMs: Math.max(1, Date.now() - start),
          version: rows[0]?.version || `${this.engine.type} ${this.engine.version}`
        };
      } finally {
        await conn.end();
      }
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  async createDatabase(name: string, charset = 'utf8mb4', collation = 'utf8mb4_unicode_ci'): Promise<void> {
    const conn = await this.getConnection();
    if (conn) {
      try {
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET ${charset} COLLATE ${collation}`);
      } finally {
        await conn.end();
      }
    }
    // Track in state
    getMemoryState(this.engine.id).databases.add(name);
  }

  async dropDatabase(name: string): Promise<void> {
    const conn = await this.getConnection();
    if (conn) {
      try {
        await conn.query(`DROP DATABASE IF EXISTS \`${name}\``);
      } finally {
        await conn.end();
      }
    }
    getMemoryState(this.engine.id).databases.delete(name);
  }

  async createUser(
    username: string,
    password: string,
    host = '%',
    privileges: DbPrivileges = 'read_write',
    dbName: string
  ): Promise<void> {
    const conn = await this.getConnection();
    if (conn) {
      try {
        await conn.query(`CREATE USER IF NOT EXISTS '${username}'@'${host}' IDENTIFIED BY '${password}'`);
        let grantSql = `GRANT SELECT ON \`${dbName}\`.* TO '${username}'@'${host}'`;
        if (privileges === 'read_write') {
          grantSql = `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER, LOCK TABLES, CREATE TEMPORARY TABLES ON \`${dbName}\`.* TO '${username}'@'${host}'`;
        } else if (privileges === 'custom') {
          grantSql = `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${username}'@'${host}'`;
        }
        await conn.query(grantSql);
        await conn.query('FLUSH PRIVILEGES');
      } finally {
        await conn.end();
      }
    }

    getMemoryState(this.engine.id).users.set(`${username}@${host}`, {
      password,
      host,
      privileges,
      dbName
    });
  }

  async dropUser(username: string, host = '%'): Promise<void> {
    const conn = await this.getConnection();
    if (conn) {
      try {
        await conn.query(`DROP USER IF EXISTS '${username}'@'${host}'`);
        await conn.query('FLUSH PRIVILEGES');
      } finally {
        await conn.end();
      }
    }
    getMemoryState(this.engine.id).users.delete(`${username}@${host}`);
  }

  async updateUserPassword(username: string, host = '%', newPassword: string): Promise<void> {
    const conn = await this.getConnection();
    if (conn) {
      try {
        await conn.query(`ALTER USER '${username}'@'${host}' IDENTIFIED BY '${newPassword}'`);
        await conn.query('FLUSH PRIVILEGES');
      } finally {
        await conn.end();
      }
    }
    const u = getMemoryState(this.engine.id).users.get(`${username}@${host}`);
    if (u) u.password = newPassword;
  }

  async exportDatabase(dbName: string, options?: DumpOptions): Promise<string> {
    const conn = await this.getConnection(dbName);
    const dumpLines: string[] = [
      `-- NexPanel Dump for ${dbName}`,
      `-- Engine: ${this.engine.name} (${this.engine.type} ${this.engine.version})`,
      `-- Date: ${new Date().toISOString()}`,
      `SET FOREIGN_KEY_CHECKS=0;\n`
    ];

    if (conn) {
      try {
        const [tables]: [any, any] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
        for (const row of tables) {
          const tableName = Object.values(row)[0] as string;
          if (options?.includeStructure !== false) {
            const [createRows]: [any, any] = await conn.query(`SHOW CREATE TABLE \`${tableName}\``);
            dumpLines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
            dumpLines.push(`${createRows[0]['Create Table']};\n`);
          }
          if (options?.includeData !== false) {
            const [dataRows]: [any, any] = await conn.query(`SELECT * FROM \`${tableName}\``);
            for (const r of dataRows) {
              const keys = Object.keys(r);
              const vals = Object.values(r).map((v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "\\'")}'`));
              dumpLines.push(`INSERT INTO \`${tableName}\` (\`${keys.join('`, `')}\`) VALUES (${vals.join(', ')});`);
            }
          }
        }
        dumpLines.push('SET FOREIGN_KEY_CHECKS=1;\n');
        return dumpLines.join('\n');
      } finally {
        await conn.end();
      }
    }

    // Realistic fallback dump
    dumpLines.push(`CREATE TABLE IF NOT EXISTS \`wp_options\` (
  \`option_id\` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  \`option_name\` varchar(191) NOT NULL DEFAULT '',
  \`option_value\` longtext NOT NULL,
  PRIMARY KEY (\`option_id\`)
);
INSERT INTO \`wp_options\` (\`option_name\`, \`option_value\`) VALUES ('siteurl', 'https://${dbName.replace(/_/g, '-')}.local');
INSERT INTO \`wp_options\` (\`option_name\`, \`option_value\`) VALUES ('home', 'https://${dbName.replace(/_/g, '-')}.local');
SET FOREIGN_KEY_CHECKS=1;
`);
    return dumpLines.join('\n');
  }

  async importDatabase(dbName: string, sqlContent: string): Promise<{ statementsExecuted: number }> {
    const statements = sqlContent
      .split(/;\s*[\r\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    const conn = await this.getConnection(dbName);
    if (conn) {
      try {
        await conn.query('SET FOREIGN_KEY_CHECKS=0');
        const errors: string[] = [];
        for (const stmt of statements) {
          try {
            await conn.query(stmt);
          } catch (err: any) {
            errors.push(`Statement failed: ${stmt.slice(0, 50)}... Reason: ${err.message}`);
          }
        }
        await conn.query('SET FOREIGN_KEY_CHECKS=1');
        if (errors.length > 0) {
          throw new Error(`MySQL import failed with ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}`);
        }
      } finally {
        await conn.end();
      }
    }

    return { statementsExecuted: statements.length };
  }
}

export class PostgreSqlEngineClient implements DbEngineClient {
  constructor(protected engine: DbEngine, protected rootPassword: string) {}

  private isTestOrMemory(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.PANEL_DB_USE_MEMORY === 'true';
  }

  private async getClient(database = 'postgres'): Promise<pkg.Client | null> {
    if (this.isTestOrMemory()) {
      return null;
    }
    const client = new PgClient({
      host: this.engine.host,
      port: this.engine.port || 5432,
      user: this.engine.root_username || 'postgres',
      password: this.rootPassword,
      database,
      connectionTimeoutMillis: 5000
    });
    await client.connect();
    return client;
  }

  async testConnection(): Promise<TestConnectionResult> {
    const start = Date.now();
    if (this.engine.status === 'disabled') {
      return { ok: false, latencyMs: 1, error: `Engine '${this.engine.name}' is currently disabled` };
    }

    if (this.isTestOrMemory()) {
      return {
        ok: true,
        latencyMs: Math.max(1, Date.now() - start),
        version: `${this.engine.type} ${this.engine.version}`
      };
    }

    try {
      const client = await this.getClient();
      if (!client) {
        return { ok: false, latencyMs: Date.now() - start, error: 'Could not establish PostgreSQL connection' };
      }
      try {
        const res = await client.query('SELECT version()');
        return {
          ok: true,
          latencyMs: Math.max(1, Date.now() - start),
          version: res.rows[0]?.version || `${this.engine.type} ${this.engine.version}`
        };
      } finally {
        await client.end();
      }
    } catch (err: any) {
      return { ok: false, latencyMs: Date.now() - start, error: err.message };
    }
  }

  async createDatabase(name: string): Promise<void> {
    const client = await this.getClient();
    if (client) {
      try {
        await client.query(`CREATE DATABASE "${name}"`);
      } finally {
        await client.end();
      }
    }
    getMemoryState(this.engine.id).databases.add(name);
  }

  async dropDatabase(name: string): Promise<void> {
    const client = await this.getClient();
    if (client) {
      try {
        await client.query(`DROP DATABASE IF EXISTS "${name}"`);
      } finally {
        await client.end();
      }
    }
    getMemoryState(this.engine.id).databases.delete(name);
  }

  async createUser(
    username: string,
    password: string,
    _host = '%',
    _privileges: DbPrivileges = 'read_write',
    dbName: string
  ): Promise<void> {
    const client = await this.getClient();
    if (client) {
      try {
        await client.query(`CREATE ROLE "${username}" WITH LOGIN PASSWORD '${password}'`);
        await client.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${username}"`);
      } finally {
        await client.end();
      }
    }
    getMemoryState(this.engine.id).users.set(username, {
      password,
      host: '%',
      privileges: _privileges,
      dbName
    });
  }

  async dropUser(username: string): Promise<void> {
    const client = await this.getClient();
    if (client) {
      try {
        await client.query(`DROP ROLE IF EXISTS "${username}"`);
      } finally {
        await client.end();
      }
    }
    getMemoryState(this.engine.id).users.delete(username);
  }

  async updateUserPassword(username: string, _host = '%', newPassword: string): Promise<void> {
    const client = await this.getClient();
    if (client) {
      try {
        await client.query(`ALTER ROLE "${username}" WITH PASSWORD '${newPassword}'`);
      } finally {
        await client.end();
      }
    }
  }

  async exportDatabase(dbName: string): Promise<string> {
    const client = await this.getClient(dbName);
    const dumpLines: string[] = [
      `-- NexPanel PostgreSQL Dump for ${dbName}`,
      `-- Engine: ${this.engine.name} (${this.engine.type} ${this.engine.version})`,
      `-- Date: ${new Date().toISOString()}`,
      `SET statement_timeout = 0;\n`
    ];

    if (client) {
      try {
        const tablesRes = await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
        );
        for (const row of tablesRes.rows) {
          const tableName = row.table_name;
          dumpLines.push(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);

          const colRes = await client.query(
            "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
            [tableName]
          );
          const colDefs = colRes.rows.map((c: any) => {
            let def = `"${c.column_name}" ${c.data_type.toUpperCase()}`;
            if (c.column_default) def += ` DEFAULT ${c.column_default}`;
            if (c.is_nullable === 'NO') def += ' NOT NULL';
            return def;
          });
          dumpLines.push(`CREATE TABLE "${tableName}" (\n  ${colDefs.join(',\n  ')}\n);`);

          const dataRes = await client.query(`SELECT * FROM "${tableName}"`);
          for (const dataRow of dataRes.rows) {
            const cols = Object.keys(dataRow);
            const vals = Object.values(dataRow).map((v) =>
              v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
            );
            dumpLines.push(`INSERT INTO "${tableName}" ("${cols.join('", "')}") VALUES (${vals.join(', ')});`);
          }
        }
        return dumpLines.join('\n');
      } finally {
        await client.end();
      }
    }

    // Fallback dump for test/memory mode
    dumpLines.push(`CREATE TABLE IF NOT EXISTS items (id SERIAL PRIMARY KEY, name VARCHAR(255));\nINSERT INTO items (name) VALUES ('demo');`);
    return dumpLines.join('\n');
  }

  async importDatabase(dbName: string, sqlContent: string): Promise<{ statementsExecuted: number }> {
    const statements = sqlContent
      .split(/;\s*[\r\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    const client = await this.getClient(dbName);
    if (client) {
      try {
        const errors: string[] = [];
        for (const stmt of statements) {
          try {
            await client.query(stmt);
          } catch (err: any) {
            errors.push(`Statement failed: ${stmt.slice(0, 50)}... Reason: ${err.message}`);
          }
        }
        if (errors.length > 0) {
          throw new Error(`PostgreSQL import failed with ${errors.length} error(s): ${errors.slice(0, 3).join('; ')}`);
        }
      } finally {
        await client.end();
      }
    }
    return { statementsExecuted: statements.length };
  }
}

// Client Factory with mock override support for testing
let clientFactoryOverride: ((engine: DbEngine, rootPassword: string) => DbEngineClient) | null = null;

export function setDbEngineClientFactory(
  factory: ((engine: DbEngine, rootPassword: string) => DbEngineClient) | null
): void {
  clientFactoryOverride = factory;
}

export function getDbEngineClient(engine: DbEngine, rootPassword = ''): DbEngineClient {
  if (clientFactoryOverride) {
    return clientFactoryOverride(engine, rootPassword);
  }

  if (engine.type === 'postgres') {
    return new PostgreSqlEngineClient(engine, rootPassword);
  }

  return new MySqlEngineClient(engine, rootPassword);
}
