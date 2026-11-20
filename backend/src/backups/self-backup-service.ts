import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tar from 'tar';
import { getDb } from '../db/index.js';
import { brand } from '../config/brand.js';
import { AuditService } from '../audit/audit.js';
import { VaultService } from '../vault/vault.js';

export interface SelfBackupResult {
  snapshotId: string;
  archivePath: string;
  sizeBytes: number;
}

export class SelfBackupService {
  /**
   * Generates a panel self-backup snapshot (FR-BKP-05, NFR-REL-05).
   * Includes panel metadata DB, config, edge proxy state, and encrypted vault key.
   */
  public static async createSelfBackup(destDir?: string): Promise<SelfBackupResult> {
    const db = getDb();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotId = `nexpanel-self-backup-${timestamp}`;

    const baseDir = destDir || path.resolve(process.cwd(), 'data/backups');
    const stagingDir = path.resolve(baseDir, snapshotId);
    fs.mkdirSync(stagingDir, { recursive: true });

    // 1. Dump Panel DB tables
    const tableNames = [
      'users',
      'db_engines',
      'edge_providers',
      'sites',
      'databases',
      'db_users',
      'proxy_hosts',
      'certificates',
      'cron_jobs',
      'backup_destinations',
      'backups',
      'vhost_templates',
      'firewall_rules',
      'site_security_rules'
    ];

    const dbDump: Record<string, any[]> = {};
    for (const t of tableNames) {
      try {
        const res = await db.query(`SELECT * FROM ${t}`);
        dbDump[t] = res.rows;
      } catch {
        dbDump[t] = [];
      }
    }
    fs.writeFileSync(path.resolve(stagingDir, 'panel_metadata.json'), JSON.stringify(dbDump, null, 2));

    // 2. Backup Vault Key if exists
    const vaultKeyPath = process.env.VAULT_KEY_PATH || path.resolve(process.cwd(), 'data/vault.key');
    if (fs.existsSync(vaultKeyPath)) {
      fs.copyFileSync(vaultKeyPath, path.resolve(stagingDir, 'vault.key'));
    }

    // 3. System Configuration Manifest
    const manifest = {
      brand: brand.name,
      version: brand.version,
      snapshotId,
      createdAt: new Date().toISOString(),
      hostId: 'host-1',
      tablesIncluded: Object.keys(dbDump)
    };
    fs.writeFileSync(path.resolve(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // 4. Archive into tar.gz
    const finalArchive = path.resolve(baseDir, `${snapshotId}.tar.gz`);
    await tar.c(
      {
        gzip: true,
        file: finalArchive,
        cwd: baseDir
      },
      [snapshotId]
    );

    // Clean up temporary staging
    fs.rmSync(stagingDir, { recursive: true, force: true });

    const stats = fs.statSync(finalArchive);

    await AuditService.log({
      action: 'panel:self_backup',
      entityType: 'system',
      entityId: 'panel',
      after: { snapshotId, sizeBytes: stats.size, archivePath: finalArchive }
    });

    return {
      snapshotId,
      archivePath: finalArchive,
      sizeBytes: stats.size
    };
  }

  /**
   * Restores panel state from a self-backup archive (Drill test).
   */
  public static async restoreSelfBackup(archivePath: string): Promise<{ success: boolean; message: string }> {
    if (!fs.existsSync(archivePath)) {
      throw new Error(`Self-backup archive not found at '${archivePath}'`);
    }

    const tempDir = path.resolve(process.cwd(), 'data/backups', `self_restore_tmp_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    await tar.x({
      file: archivePath,
      cwd: tempDir
    });

    const entries = fs.readdirSync(tempDir);
    let workingDir = tempDir;
    if (entries.length === 1 && fs.statSync(path.resolve(tempDir, entries[0])).isDirectory()) {
      workingDir = path.resolve(tempDir, entries[0]);
    }

    const manifestPath = path.resolve(workingDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      throw new Error('Invalid self-backup archive: manifest.json is missing');
    }

    // 1. Restore metadata tables first inside a transaction
    const metadataPath = path.resolve(workingDir, 'panel_metadata.json');
    if (fs.existsSync(metadataPath)) {
      const dump = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      const db = getDb();

      await db.transaction(async (tx) => {
        for (const [tableName, rows] of Object.entries(dump)) {
          if (!Array.isArray(rows) || rows.length === 0) continue;
          for (const row of rows) {
            const cols = Object.keys(row);
            if (cols.length === 0) continue;
            const vals = Object.values(row);
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

            // Use ON CONFLICT for primary keys, but do not swallow unexpected execution errors
            const conflictClause = cols.includes('id')
              ? `ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
              : 'ON CONFLICT DO NOTHING';

            await tx.execute(
              `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders}) ${conflictClause}`,
              vals
            );
          }
        }
      });
    }

    // 2. ONLY after metadata restores without error, update and reload the Vault key
    const archivedVaultKey = path.resolve(workingDir, 'vault.key');
    const targetVaultKey = process.env.VAULT_KEY_PATH || path.resolve(process.cwd(), 'data/vault.key');
    if (fs.existsSync(archivedVaultKey)) {
      const targetDir = path.dirname(targetVaultKey);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Back up existing key in case copy fails
      let existingKeyBackup: string | null = null;
      if (fs.existsSync(targetVaultKey)) {
        existingKeyBackup = `${targetVaultKey}.bak_${Date.now()}`;
        fs.copyFileSync(targetVaultKey, existingKeyBackup);
      }

      try {
        fs.copyFileSync(archivedVaultKey, targetVaultKey);
        try {
          fs.chmodSync(targetVaultKey, 0o600);
        } catch {}
        VaultService.reload(targetVaultKey);
        if (existingKeyBackup && fs.existsSync(existingKeyBackup)) {
          fs.rmSync(existingKeyBackup, { force: true });
        }
      } catch (err) {
        if (existingKeyBackup && fs.existsSync(existingKeyBackup)) {
          fs.copyFileSync(existingKeyBackup, targetVaultKey);
          fs.rmSync(existingKeyBackup, { force: true });
        }
        throw new Error(`Failed to restore vault key: ${(err as any).message}`);
      }
    }

    fs.rmSync(tempDir, { recursive: true, force: true });

    await AuditService.log({
      action: 'panel:self_restore',
      entityType: 'system',
      entityId: 'panel',
      after: { archivePath }
    });

    return {
      success: true,
      message: 'Panel metadata and state restored successfully from self-backup'
    };
  }
}
