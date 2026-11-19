import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as path from 'node:path';
import { requirePermission } from '../plugins/auth-guard.js';
import { ImportJobManager } from '../../importer/import-job-manager.js';
import { TarInspector } from '../../importer/tar-inspector.js';
import { DryRunSimulator } from '../../importer/dry-run-simulator.js';
import { ImportExecutor } from '../../importer/import-executor.js';
import { RollbackService } from '../../importer/rollback-service.js';
import { LiveSshService } from '../../importer/live-ssh-service.js';
import { JobService } from '../../jobs/job-service.js';
import { CloudPanelMapping } from '../../importer/types.js';

const initiateImportSchema = z.object({
  sourceType: z.enum(['backup_tar', 'local_tar_gz', 'live_ssh']),
  filePath: z.string().optional(),
  dbDumpFilePath: z.string().optional(),
  ssh: z
    .object({
      host: z.string().min(1),
      port: z.number().int().default(22),
      username: z.string().min(1),
      privateKey: z.string().optional(),
      password: z.string().optional(),
      domain: z.string().optional()
    })
    .optional()
});

const mappingSchema = z.object({
  domain: z.string().min(1),
  changeDomainTo: z.string().optional(),
  searchReplaceDomain: z.boolean().optional(),
  phpVersion: z.string().default('8.3'),
  dbEngineId: z.string().uuid(),
  dbName: z.string().min(1),
  dbUser: z.string().min(1),
  dbPassword: z.string().optional(),
  sslMode: z
    .enum(['letsencrypt-http01-after-dns-cutover', 'letsencrypt-dns01', 'custom', 'none'])
    .default('letsencrypt-http01-after-dns-cutover'),
  vhostTemplate: z.string().optional(),
  cronAction: z.enum(['keep', 'edit', 'skip']).optional(),
  cronJobs: z.array(z.object({ schedule: z.string(), command: z.string() })).optional(),
  allowPostgresWordPress: z.boolean().optional()
});

export async function importRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/v1/imports/cloudpanel
  fastify.post(
    '/cloudpanel',
    { preHandler: [requirePermission('import:cloudpanel')] },
    async (request, reply) => {
      const body = initiateImportSchema.parse(request.body);
      const user = (request as any).user;

      let sourceRef = body.filePath || '';

      if (body.sourceType === 'live_ssh') {
        if (!body.ssh) {
          return reply.status(400).send({ error: 'SSH connection parameters are required for live_ssh source' });
        }
        const stagingDir = path.resolve(process.cwd(), 'data/imports/live-ssh-' + Date.now());
        const pullResult = await LiveSshService.pullLiveSite(body.ssh, stagingDir);
        sourceRef = pullResult.filesTarPath;

        const job = await ImportJobManager.createJob({
          sourceType: 'live_ssh',
          sourceRef,
          createdByUserId: user?.id
        });

        // Run inspection on pulled files
        const manifest = await TarInspector.inspect({
          sourceType: 'live_ssh',
          filePath: pullResult.filesTarPath,
          dbDumpFilePath: pullResult.sqlDumpPath
        });

        // Add real live-SSH detected cron jobs
        if (pullResult.detectedCronJobs.length > 0) {
          manifest.cron = {
            found: true,
            jobs: pullResult.detectedCronJobs
          };
        }

        await ImportJobManager.updateJob(job.id, {
          manifestJson: manifest,
          status: 'detected'
        });

        const updated = await ImportJobManager.getJobById(job.id);
        return reply.status(201).send({ job: updated, manifest });
      }

      // Source A or B: tar or local pair
      if (!sourceRef) {
        return reply.status(400).send({ error: 'filePath is required for backup_tar or local_tar_gz' });
      }

      const job = await ImportJobManager.createJob({
        sourceType: body.sourceType,
        sourceRef,
        createdByUserId: user?.id
      });

      // Auto-run initial detection
      try {
        const manifest = await TarInspector.inspect({
          sourceType: body.sourceType,
          filePath: sourceRef,
          dbDumpFilePath: body.dbDumpFilePath
        });

        await ImportJobManager.updateJob(job.id, {
          manifestJson: manifest,
          status: 'detected'
        });

        const updated = await ImportJobManager.getJobById(job.id);
        return reply.status(201).send({ job: updated, manifest });
      } catch (err: any) {
        await ImportJobManager.updateJob(job.id, {
          status: 'failed'
        });
        return reply.status(400).send({ error: `Detection failed: ${err.message}` });
      }
    }
  );

  // GET /api/v1/imports
  fastify.get(
    '/',
    { preHandler: [requirePermission('sites:view')] },
    async (_request, reply) => {
      const jobs = await ImportJobManager.listJobs();
      return reply.send({ jobs });
    }
  );

  // GET /api/v1/imports/:id
  fastify.get(
    '/:id',
    { preHandler: [requirePermission('sites:view')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const job = await ImportJobManager.getJobById(id);
      if (!job) {
        return reply.status(404).send({ error: `Import job '${id}' not found` });
      }
      return reply.send({ job });
    }
  );

  // GET /api/v1/imports/:id/detect
  fastify.get(
    '/:id/detect',
    { preHandler: [requirePermission('sites:view')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const job = await ImportJobManager.getJobById(id);
      if (!job) {
        return reply.status(404).send({ error: `Import job '${id}' not found` });
      }

      if (job.manifestJson) {
        return reply.send({ manifest: job.manifestJson });
      }

      const manifest = await TarInspector.inspect({
        sourceType: job.sourceType,
        filePath: job.sourceRef
      });

      await ImportJobManager.updateJob(id, {
        manifestJson: manifest,
        status: 'detected'
      });

      return reply.send({ manifest });
    }
  );

  // POST /api/v1/imports/:id/mapping
  fastify.post(
    '/:id/mapping',
    { preHandler: [requirePermission('import:cloudpanel')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const mapping = mappingSchema.parse(request.body) as CloudPanelMapping;

      const job = await ImportJobManager.getJobById(id);
      if (!job) {
        return reply.status(404).send({ error: `Import job '${id}' not found` });
      }

      const updated = await ImportJobManager.updateJob(id, {
        mappingJson: mapping,
        status: 'mapped'
      });

      return reply.send({ job: updated });
    }
  );

  // POST /api/v1/imports/:id/dry-run
  fastify.post(
    '/:id/dry-run',
    { preHandler: [requirePermission('import:cloudpanel')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const job = await ImportJobManager.getJobById(id);
      if (!job) {
        return reply.status(404).send({ error: `Import job '${id}' not found` });
      }

      if (!job.manifestJson) {
        return reply.status(400).send({ error: 'Source has not been detected yet. Run /detect first.' });
      }

      const mapping = job.mappingJson || {
        domain: job.manifestJson.site.domain,
        phpVersion: job.manifestJson.site.phpVersionDetected || '8.3',
        dbEngineId: job.manifestJson.mappingDefaults.dbEngine,
        dbName: job.manifestJson.databases[0]?.name || 'imported_db',
        dbUser: job.manifestJson.databases[0]?.userDetected || 'imported_user',
        sslMode: 'letsencrypt-http01-after-dns-cutover' as const
      };

      const result = await DryRunSimulator.simulate(job.manifestJson, mapping);

      await ImportJobManager.updateJob(id, {
        dryRunResultJson: result,
        status: 'dry_run'
      });

      return reply.send({ result });
    }
  );

  // POST /api/v1/imports/:id/run
  fastify.post(
    '/:id/run',
    { preHandler: [requirePermission('import:cloudpanel')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = (request as any).user;
      const job = await ImportJobManager.getJobById(id);

      if (!job) {
        return reply.status(404).send({ error: `Import job '${id}' not found` });
      }

      if (!job.manifestJson) {
        return reply.status(400).send({ error: 'Manifest missing. Run detection first.' });
      }

      // Enforce dry-run must be executed and valid before import can run (FR-IMP-02, docs/05)
      if (!job.dryRunResultJson) {
        return reply.status(400).send({
          error: 'Dry-run simulation must be executed before running the import. Please call POST /dry-run first.'
        });
      }

      if (!job.dryRunResultJson.valid) {
        return reply.status(400).send({
          error: 'Cannot execute import: Dry-run found blocking errors',
          errors: job.dryRunResultJson.errors
        });
      }

      // Run import
      const report = await ImportExecutor.execute({
        jobId: id,
        actorUserId: user?.id,
        actorIp: request.ip
      });

      return reply.send({ success: true, report });
    }
  );

  // POST /api/v1/imports/:id/rollback
  fastify.post(
    '/:id/rollback',
    { preHandler: [requirePermission('sites:delete')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const user = (request as any).user;

      try {
        const result = await RollbackService.rollback(id, user?.id, request.ip);
        return reply.send(result);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );
}
