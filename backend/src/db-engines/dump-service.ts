import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { getDb } from '../db/index.js';
import { VaultService } from '../vault/vault.js';
import { JobService } from '../jobs/job-service.js';
import { AuditService } from '../audit/audit.js';
import { SiteService } from '../sites/site-service.js';
import { DbProvisioner } from './db-provisioner.js';
import { EngineRegistry } from './engine-registry.js';
import { getDbEngineClient } from './engine-client.js';
import { DumpOptions } from './types.js';

export interface ExportResult {
  filePath: string;
  filename: string;
  sizeBytes: number;
}

export class DumpService {
  /**
   * Exports a database to .sql or .sql.gz (FR-DB-06).
   */
  public static async exportDatabase(
    dbId: string,
    options: DumpOptions = { includeStructure: true, includeData: true, gzip: true },
    destDir?: string,
    actorUserId?: string,
    actorIp?: string
  ): Promise<ExportResult> {
    const database = await DbProvisioner.getDatabaseById(dbId);
    if (!database) {
      throw new Error(`Database '${dbId}' not found`);
    }

    const engine = await EngineRegistry.getEngineById(database.engine_id);
    if (!engine) {
      throw new Error(`Engine for database '${dbId}' not found`);
    }

    const rootPass = VaultService.decrypt(engine.root_password_secret_ref);
    const client = getDbEngineClient(engine, rootPass);

    const dumpContent = await client.exportDatabase(database.name, options);

    // Determine target directory
    let targetDir = destDir;
    if (!targetDir) {
      if (database.site_id) {
        const site = await SiteService.getSiteById(database.site_id);
        if (site) {
          targetDir = path.resolve(site.volumePath, 'backups');
        }
      }
      if (!targetDir) {
        targetDir = path.resolve(process.cwd(), 'data/backups');
      }
    }

    fs.mkdirSync(targetDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const isGzip = options.gzip !== false;
    const filename = `${database.name}-${timestamp}.sql${isGzip ? '.gz' : ''}`;
    const filePath = path.resolve(targetDir, filename);

    let finalBuffer: Buffer;
    if (isGzip) {
      finalBuffer = zlib.gzipSync(Buffer.from(dumpContent, 'utf8'));
    } else {
      finalBuffer = Buffer.from(dumpContent, 'utf8');
    }

    fs.writeFileSync(filePath, finalBuffer);

    await AuditService.log({
      action: 'database:export',
      actorUserId,
      actorIp,
      entityType: 'database',
      entityId: dbId,
      after: {
        name: database.name,
        filePath,
        sizeBytes: finalBuffer.length,
        gzip: isGzip
      }
    });

    return {
      filePath,
      filename,
      sizeBytes: finalBuffer.length
    };
  }

  /**
   * Imports a .sql or .sql.gz into a database via background job (FR-DB-06).
   */
  public static async importDatabase(
    dbId: string,
    contentOrBuffer: Buffer | string,
    isGzip = false,
    actorUserId?: string,
    actorIp?: string
  ): Promise<string> {
    const database = await DbProvisioner.getDatabaseById(dbId);
    if (!database) {
      throw new Error(`Database '${dbId}' not found`);
    }

    const engine = await EngineRegistry.getEngineById(database.engine_id);
    if (!engine) {
      throw new Error(`Engine for database '${dbId}' not found`);
    }

    let rawSql: string;
    if (Buffer.isBuffer(contentOrBuffer)) {
      if (isGzip) {
        rawSql = zlib.gunzipSync(contentOrBuffer).toString('utf8');
      } else {
        rawSql = contentOrBuffer.toString('utf8');
      }
    } else {
      rawSql = contentOrBuffer;
    }

    // Register handler if not already registered
    JobService.registerHandler('db:import', async (job, updateProgress, log) => {
      const p = job.payloadJson as any;
      await updateProgress(10, 'Connecting to engine...');
      const targetEngine = await EngineRegistry.getEngineById(p.engineId);
      if (!targetEngine) throw new Error(`Engine '${p.engineId}' not found`);

      const rootPass = VaultService.decrypt(targetEngine.root_password_secret_ref);
      const client = getDbEngineClient(targetEngine, rootPass);

      await updateProgress(50, 'Executing SQL statements...');
      const res = await client.importDatabase(p.databaseName, p.rawSql);
      log(`Successfully executed ${res.statementsExecuted} SQL statements into database '${p.databaseName}'`);
      await updateProgress(100, `Import complete: ${res.statementsExecuted} statements executed`);
    });

    // Enqueue as background job
    const job = await JobService.enqueue({
      type: 'db:import',
      payload: {
        dbId,
        databaseName: database.name,
        engineId: engine.id,
        rawSql
      },
      siteId: database.site_id,
      createdByUserId: actorUserId
    });

    await AuditService.log({
      action: 'database:import',
      actorUserId,
      actorIp,
      entityType: 'database',
      entityId: dbId,
      after: { name: database.name }
    });

    return job.id;
  }

  /**
   * Nightly database backup runner with retention pruning (FR-DB-07).
   */
  public static async runNightlyDumps(retentionDays = 7): Promise<{ dumpsCreated: number; dumpsPruned: number }> {
    const db = getDb();
    const dbsRes = await db.query('SELECT id, name, site_id FROM databases WHERE deleted_at IS NULL');
    let dumpsCreated = 0;
    let dumpsPruned = 0;

    for (const d of dbsRes.rows) {
      try {
        const res = await this.exportDatabase(d.id, { includeStructure: true, includeData: true, gzip: true });
        dumpsCreated++;

        // Pruning old dumps in destination folder
        const dir = path.dirname(res.filePath);
        const files = fs.readdirSync(dir);
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

        for (const file of files) {
          if (file.startsWith(d.name) && (file.endsWith('.sql.gz') || file.endsWith('.sql'))) {
            const filePath = path.resolve(dir, file);
            const stats = fs.statSync(filePath);
            if (stats.mtimeMs < cutoffMs) {
              fs.unlinkSync(filePath);
              dumpsPruned++;
            }
          }
        }
      } catch (err: any) {
        console.error(`Nightly dump failed for database '${d.name}': ${err.message}`);
      }
    }

    return { dumpsCreated, dumpsPruned };
  }
}
