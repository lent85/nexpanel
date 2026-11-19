import { DatabaseAdapter } from './db.js';
import { PgAdapter } from './pg-adapter.js';
import { MemoryAdapter } from './memory-adapter.js';
import { getEnv } from '../config/env.js';

let dbInstance: DatabaseAdapter | null = null;

export function getDb(): DatabaseAdapter {
  if (!dbInstance) {
    const env = getEnv();
    if (env.PANEL_DB_USE_MEMORY || env.NODE_ENV === 'test') {
      dbInstance = new MemoryAdapter();
    } else {
      dbInstance = new PgAdapter(env);
    }
  }
  return dbInstance;
}

export function setDb(adapter: DatabaseAdapter): void {
  dbInstance = adapter;
}
