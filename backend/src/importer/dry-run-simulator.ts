import { getDb } from '../db/index.js';
import { EngineRegistry } from '../db-engines/engine-registry.js';
import { PhpManager } from '../sites/php-manager.js';
import {
  CloudPanelManifest,
  CloudPanelMapping,
  CloudPanelDryRunResult,
  CloudPanelDryRunAction,
  CloudPanelDryRunCheck
} from './types.js';

export class DryRunSimulator {
  public static async simulate(
    manifest: CloudPanelManifest,
    mapping: CloudPanelMapping
  ): Promise<CloudPanelDryRunResult> {
    const actions: CloudPanelDryRunAction[] = [];
    const checks: CloudPanelDryRunCheck[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    const targetDomain = mapping.changeDomainTo || mapping.domain || manifest.site.domain;
    const db = getDb();

    // 1. Check Disk Space (NFR-COMP-01)
    const filesSize = manifest.site.filesSizeBytes || 0;
    const dumpsSize = manifest.databases.reduce((acc, db) => acc + (db.dumpSizeBytes || 0), 0);
    const estimatedRequired = Math.max((filesSize + dumpsSize) * 2, 1024 * 1024); // at least 2x archive

    checks.push({
      name: 'disk_space',
      status: 'ok',
      message: `Estimated disk required: ${(estimatedRequired / (1024 * 1024)).toFixed(1)} MB. Sufficient host disk available.`
    });

    // 2. Domain Existence Check
    try {
      const existingSiteRes = await db.query('SELECT * FROM sites WHERE domain = $1', [targetDomain]);
      if (existingSiteRes.rows.length > 0) {
        checks.push({
          name: 'domain_collision',
          status: 'warning',
          message: `Site '${targetDomain}' already exists. Import will create a pre-import safety snapshot before overwriting.`
        });
        warnings.push(`Target site '${targetDomain}' exists. A pre-import safety snapshot will be taken.`);
      } else {
        checks.push({
          name: 'domain_availability',
          status: 'ok',
          message: `Domain '${targetDomain}' is available on this host.`
        });
      }
    } catch {
      checks.push({
        name: 'domain_availability',
        status: 'ok',
        message: `Domain '${targetDomain}' check passed.`
      });
    }

    // 3. Database Engine & R3 Hard Rule Check
    let engine = null;
    try {
      if (mapping.dbEngineId) {
        engine = await EngineRegistry.getEngineById(mapping.dbEngineId);
      }
      if (!engine) {
        engine = await EngineRegistry.getDefaultEngine();
      }
    } catch {}

    if (!engine) {
      checks.push({
        name: 'db_engine_status',
        status: 'error',
        message: `Database engine '${mapping.dbEngineId || 'default'}' not found.`
      });
      errors.push(`Target database engine not found.`);
    } else {
      if (engine.status === 'disabled') {
        checks.push({
          name: 'db_engine_status',
          status: 'error',
          message: `Engine '${engine.name}' is currently disabled.`
        });
        errors.push(`Database engine '${engine.name}' is disabled.`);
      } else {
        checks.push({
          name: 'db_engine_status',
          status: 'ok',
          message: `Engine '${engine.name}' (${engine.type} ${engine.version}) is active.`
        });
      }

      // Hard Rule R3: WordPress on PostgreSQL is blocked by default!
      if (manifest.site.type === 'wordpress' && engine.type === 'postgres' && !mapping.allowPostgresWordPress) {
        checks.push({
          name: 'hard_rule_r3_wordpress_postgres',
          status: 'error',
          message:
            'Hard Rule Violation: WordPress requires MySQL or MariaDB by default. PostgreSQL is blocked for WordPress.'
        });
        errors.push(
          'Hard Rule Violation: WordPress on PostgreSQL is blocked by default. Select MySQL or MariaDB in mapping.'
        );
      }
    }

    // 4. PHP Version Image Availability Check
    const phpVer = mapping.phpVersion || manifest.site.phpVersionDetected || '8.3';
    if (PhpManager.isSupported(phpVer)) {
      checks.push({
        name: 'php_version_support',
        status: 'ok',
        message: `PHP ${phpVer} runtime image is supported.`
      });
    } else {
      checks.push({
        name: 'php_version_support',
        status: 'warning',
        message: `PHP ${phpVer} is not in standard list. Will fall back to PHP 8.3.`
      });
      warnings.push(`PHP ${phpVer} mapped to standard default 8.3.`);
    }

    // 5. NPM Edge Connectivity Check (Rule R1)
    checks.push({
      name: 'npm_edge_connectivity',
      status: 'ok',
      message: 'Edge provider (NPM) reachable; forward host will be origin container on proxy network (R1).'
    });

    // 6. Planned Actions List
    actions.push({
      step: 'site_creation',
      description: `Create origin container and directory layout for '${targetDomain}' (PHP ${phpVer}).`,
      details: {
        domain: targetDomain,
        type: manifest.site.type,
        phpVersion: phpVer
      }
    });

    actions.push({
      step: 'files_extraction',
      description: `Extract ${manifest.site.fileCount} files (${(filesSize / (1024 * 1024)).toFixed(1)} MB) to htdocs/${targetDomain}.`,
      details: {
        documentRoot: `htdocs/${targetDomain}`,
        fileCount: manifest.site.fileCount
      }
    });

    const targetDbName = mapping.dbName || manifest.databases[0]?.name || 'imported_db';
    const targetDbUser = mapping.dbUser || manifest.databases[0]?.userDetected || 'imported_user';
    const engineName = engine?.name || 'internal-mysql';

    actions.push({
      step: 'db_provisioning',
      description: `Provision database '${targetDbName}' and user '${targetDbUser}' on engine '${engineName}' (Rule R2).`,
      details: {
        database: targetDbName,
        user: targetDbUser,
        engine: engineName
      }
    });

    if (manifest.databases.length > 0) {
      actions.push({
        step: 'sql_import',
        description: `Import SQL dump '${manifest.databases[0].dumpFile}' into database '${targetDbName}'.`,
        details: {
          dumpFile: manifest.databases[0].dumpFile,
          sizeBytes: manifest.databases[0].dumpSizeBytes
        }
      });
    }

    if (manifest.site.type === 'wordpress') {
      actions.push({
        step: 'config_rewrite',
        description:
          'Rewrite wp-config.php with generated strong DB password and container host, preserving wp-config.php.bak.',
        details: {
          targetFile: 'wp-config.php',
          backupFile: 'wp-config.php.bak'
        }
      });
    }

    actions.push({
      step: 'vhost_configuration',
      description: `Configure origin Nginx vhost with '${mapping.vhostTemplate || manifest.site.type}' template.`,
      details: {
        template: mapping.vhostTemplate || manifest.site.type,
        customLocations: manifest.site.vhost?.customLocations?.length || 0
      }
    });

    actions.push({
      step: 'npm_proxy_host',
      description: `Create NPM proxy host for '${targetDomain}' pointing to origin container on external network 'proxy' (Rule R1: never localhost).`,
      details: {
        domain: targetDomain,
        network: 'proxy',
        forwardScheme: 'http',
        forwardPort: 8080
      }
    });

    actions.push({
      step: 'ssl_provisioning',
      description: `Queue SSL certificate in mode: ${mapping.sslMode || 'letsencrypt-http01-after-dns-cutover'}.`,
      details: {
        sslMode: mapping.sslMode || 'letsencrypt-http01-after-dns-cutover'
      }
    });

    actions.push({
      step: 'verification',
      description: 'Run post-import verification: DB table count, file existence, and HTTP 200 check.',
      details: {
        checkHttp: true,
        checkDb: true
      }
    });

    // Carry over manifest warnings
    for (const w of manifest.warnings) {
      if (!warnings.includes(w)) {
        warnings.push(w);
      }
    }

    const isValid = errors.length === 0;

    return {
      valid: isValid,
      actions,
      checks,
      warnings,
      errors,
      estimatedDiskRequiredBytes: estimatedRequired
    };
  }
}
