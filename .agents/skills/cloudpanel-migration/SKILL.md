---
name: cloudpanel-migration
description: Procedures and runbooks for CloudPanel backup inspection, dry-run simulation, import execution, and rollback testing. Use when working on import services, archive tar validation, WordPress wp-config rewriting, or migration edge cases.
---

# CloudPanel Import & Migration Skill

NexPanel provides a first-class, automated migration path from CloudPanel (tested against CloudPanel 2.5.4 backups).

## 1. Supported Backup Formats

1. **Source A (Remote Backup)**: Single `backup.tar` containing:
   - `htdocs/<domain>/`: Site files and WordPress core.
   - `backups/<db_name>-<date>.sql.gz`: Nightly gzipped MySQL dump.
   - `home/<siteuser>/conf/nginx/<domain>.conf`: Original Nginx vhost config.
2. **Source B (Local Backup Pair)**:
   - `<site>-files.tar.gz`: Gzipped site file tree.
   - `<db_name>.sql.gz`: Gzipped SQL dump.
3. **Source C (Live Server)**: SSH access with automated inspection of `/home/<siteuser>/`, Nginx vhosts, and crontabs.

## 2. Testing Import with Synthetic Fixtures

Synthetic test fixtures live in `fixtures/cloudpanel/`:
- `backup.tar`: Valid CloudPanel backup containing WordPress and MySQL dump.
- `local-files.tar.gz` + `local-db.sql.gz`: Valid local archive pair.
- `broken.tar`: Truncated/corrupted archive for error handling tests (`NFR-COMP-04`).
- `checksums.json`: SHA-256 hashes of all fixtures.

To regenerate fixtures after updating the generator:
```bash
npm run fixtures:generate
```

To run Milestone 7 import integration tests:
```bash
node --import tsx --test backend/test/m7-cloudpanel-import.test.ts
```

## 3. The 4-Stage Import Lifecycle

1. **Inspect (`tar-inspector.ts`)**:
   - Streams tar entries to extract domain name, PHP version, database dump filename, and vhost snippets.
   - Computes SHA-256 checksums.
2. **Simulate (`dry-run-simulator.ts`)**:
   - Produces a plan diff: new domain, site user, PHP version, database engine target.
   - **Gate**: If site type is WordPress and target database engine is PostgreSQL, immediately fail the dry-run with a corrective suggestion.
3. **Execute (`import-executor.ts`)**:
   - Provisions site directory structure (`data/sites/<domain>/htdocs`).
   - Creates database and user in the targeted DB engine.
   - Decompresses and streams the SQL dump into the engine.
   - If WordPress: rewrites `wp-config.php` with new DB credentials, host, and port.
   - Syncs proxy route with NPM (Docker container forward host per R1).
4. **Rollback (`rollback-service.ts`)**:
   - Purges created site files, drops created database, removes NPM proxy host, restoring clean pre-import state.
