import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../plugins/auth-guard.js';
import { DestinationManager } from '../../backups/destination-manager.js';
import { BackupService } from '../../backups/backup-service.js';
import { RestoreService } from '../../backups/restore-service.js';
import { SelfBackupService } from '../../backups/self-backup-service.js';

const createDestinationSchema = z.object({
  name: z.string().min(2),
  provider: z.enum(['s3', 'wasabi', 'do_spaces', 'dropbox', 'gdrive', 'sftp', 'local']),
  config: z.record(z.any())
});

const createSiteBackupSchema = z.object({
  destinationId: z.string().uuid().optional(),
  includeFiles: z.boolean().default(true),
  includeDb: z.boolean().default(true)
});

const restoreSiteSchema = z.object({
  siteId: z.string().uuid(),
  snapshotPathOrId: z.string().min(1),
  restoreFiles: z.boolean().default(true),
  restoreDb: z.boolean().default(true),
  preRestoreBackup: z.boolean().default(true)
});

const selfRestoreSchema = z.object({
  archivePath: z.string().min(1)
});

export async function backupsRoutes(fastify: FastifyInstance): Promise<void> {
  // 1. List remote backup destinations (FR-BKP-01)
  fastify.get('/api/v1/backup-destinations', { preHandler: [requirePermission('admin:access')] }, async () => {
    const list = await DestinationManager.listDestinations();
    return { data: list, total: list.length };
  });

  // 2. Create remote destination
  fastify.post('/api/v1/backup-destinations', { preHandler: [requirePermission('admin:access')] }, async (request, reply) => {
    const body = createDestinationSchema.parse(request.body);
    const result = await DestinationManager.createDestination(body as any, request.user!.sub, request.ip);
    reply.status(201).send({
      destination: {
        id: result.id,
        name: result.name,
        provider: result.provider,
        enabled: result.enabled,
        created_at: result.created_at,
        updated_at: result.updated_at
      },
      warning: result.warning,
      message: 'Backup destination registered successfully'
    });
  });

  // 3. Test destination connectivity
  fastify.post('/api/v1/backup-destinations/:id/test', { preHandler: [requirePermission('admin:access')] }, async (request) => {
    const { id } = request.params as { id: string };
    const result = await DestinationManager.testDestination(id);
    return { result };
  });

  // 4. Delete destination
  fastify.delete('/api/v1/backup-destinations/:id', { preHandler: [requirePermission('admin:access')] }, async (request) => {
    const { id } = request.params as { id: string };
    await DestinationManager.deleteDestination(id, request.user!.sub, request.ip);
    return { message: 'Backup destination removed successfully' };
  });

  // 5. List backups for a site
  fastify.get('/api/v1/sites/:siteId/backups', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const { siteId } = request.params as { siteId: string };
    const list = await BackupService.listBackupsForSite(siteId);
    return { data: list, total: list.length };
  });

  // 6. Create on-demand site backup (FR-BKP-03)
  fastify.post('/api/v1/sites/:siteId/backups', { preHandler: [requirePermission('backup:create')] }, async (request, reply) => {
    const { siteId } = request.params as { siteId: string };
    const body = createSiteBackupSchema.parse(request.body || {});
    const backup = await BackupService.createSiteBackup(siteId, body, request.user!.sub, request.ip);
    reply.status(201).send({ backup, message: 'Site backup created successfully' });
  });

  // 7. 1-Click Site Restore (FR-BKP-02)
  fastify.post('/api/v1/backups/restore', { preHandler: [requirePermission('backup:restore')] }, async (request) => {
    const body = restoreSiteSchema.parse(request.body);
    const result = await RestoreService.restoreSite(body, request.user!.sub, request.ip);
    return { result };
  });

  // 8. Panel Self-Backup (FR-BKP-05, NFR-REL-05)
  fastify.post('/api/v1/admin/self-backup', { preHandler: [requirePermission('admin:access')] }, async () => {
    const backup = await SelfBackupService.createSelfBackup();
    return { backup, message: 'Panel self-backup generated successfully' };
  });

  // 9. Panel Self-Restore Drill (Drill acceptance test)
  fastify.post('/api/v1/admin/self-backup/restore', { preHandler: [requirePermission('admin:access')] }, async (request) => {
    const body = selfRestoreSchema.parse(request.body);
    const res = await SelfBackupService.restoreSelfBackup(body.archivePath);
    return res;
  });
}
