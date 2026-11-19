import { Pool, PoolClient } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseAdapter, QueryResult } from './db.js';
import { Env } from '../config/env.js';

export class PgAdapter implements DatabaseAdapter {
  private pool: Pool;

  constructor(env: Env) {
    this.pool = new Pool({
      host: env.PANEL_DB_HOST,
      port: env.PANEL_DB_PORT,
      user: env.PANEL_DB_USER,
      password: env.PANEL_DB_PASSWORD,
      database: env.PANEL_DB_NAME,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const res = await this.pool.query(sql, params);
    return {
      rows: res.rows as T[],
      rowCount: res.rowCount ?? 0
    };
  }

  async execute(sql: string, params: unknown[] = []): Promise<number> {
    const res = await this.pool.query(sql, params);
    return res.rowCount ?? 0;
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const txAdapter: DatabaseAdapter = {
        query: async <R = any>(sql: string, params: unknown[] = []): Promise<QueryResult<R>> => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
        },
        execute: async (sql: string, params: unknown[] = []): Promise<number> => {
          const res = await client.query(sql, params);
          return res.rowCount ?? 0;
        },
        transaction: () => {
          throw new Error('Nested transactions not supported');
        },
        migrate: async () => {},
        close: async () => {}
      };

      const result = await fn(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async migrate(): Promise<void> {
    // 1. Ensure migrations tracking table exists
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Discover migrations directory
    const candidates = [
      path.resolve(import.meta.dirname, 'migrations'),
      path.resolve(process.cwd(), 'src/db/migrations'),
      path.resolve(process.cwd(), 'dist/db/migrations'),
      path.resolve(process.cwd(), 'backend/src/db/migrations')
    ];

    let migrationsDir: string | null = null;
    for (const cand of candidates) {
      if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
        migrationsDir = cand;
        break;
      }
    }

    if (!migrationsDir) {
      console.warn('Warning: No migrations directory found. Skipping schema migrations.');
      return;
    }

    // 3. Read and sort all .sql files
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    // 4. Query applied migrations
    const appliedRes = await this.pool.query<{ name: string }>('SELECT name FROM schema_migrations');
    const appliedSet = new Set(appliedRes.rows.map((r) => r.name));

    // 5. Apply unapplied migrations in order
    for (const file of files) {
      if (!appliedSet.has(file)) {
        const fullPath = path.resolve(migrationsDir, file);
        const sql = fs.readFileSync(fullPath, 'utf8');
        
        await this.transaction(async (tx) => {
          await tx.execute(sql);
          await tx.execute('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        });
      }
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
