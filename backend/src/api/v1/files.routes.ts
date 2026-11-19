import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as path from 'node:path';
import { requirePermission } from '../plugins/auth-guard.js';
import { getDb } from '../../db/index.js';
import { Site } from '../../db/types.js';
import { FileService } from '../../files/file-service.js';
import { SiteService } from '../../sites/site-service.js';

const writeContentSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

const mkdirSchema = z.object({
  path: z.string().min(1)
});

const deleteFileSchema = z.object({
  path: z.string().min(1)
});

export async function filesRoutes(fastify: FastifyInstance): Promise<void> {
  // Helper to resolve site's htdocs directory
  async function getSiteHtdocs(siteId: string): Promise<{ htdocs: string; trash: string }> {
    const db = getDb();
    const res = await db.query<Site>('SELECT * FROM sites WHERE id = $1 AND deleted_at IS NULL', [siteId]);
    if (res.rows.length === 0) {
      const err = new Error('Site not found');
      (err as any).statusCode = 404;
      throw err;
    }
    const slug = SiteService.slugifyDomain(res.rows[0].domain);
    const paths = SiteService.getSitePaths(slug);
    return { htdocs: paths.htdocs, trash: path.resolve(paths.backups, 'trash') };
  }

  // 1. List files
  fastify.get('/api/v1/sites/:id/files', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as any;
    const { htdocs } = await getSiteHtdocs(id);
    const files = FileService.listFiles(htdocs, query.path || '');
    return { data: files };
  });

  // 2. Read file content
  fastify.get('/api/v1/sites/:id/files/content', { preHandler: [requirePermission('sites:view')] }, async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as any;
    if (!query.path) throw new Error('Missing file path');
    const { htdocs } = await getSiteHtdocs(id);
    const content = FileService.readFile(htdocs, query.path);
    return { path: query.path, content };
  });

  // 3. Write file content
  fastify.put('/api/v1/sites/:id/files/content', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = writeContentSchema.parse(request.body);
    const { htdocs } = await getSiteHtdocs(id);
    FileService.writeFile(htdocs, body.path, body.content);
    return { message: 'File saved successfully', path: body.path };
  });

  // 4. Create directory
  fastify.post('/api/v1/sites/:id/files/mkdir', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = mkdirSchema.parse(request.body);
    const { htdocs } = await getSiteHtdocs(id);
    FileService.createDirectory(htdocs, body.path);
    return { message: 'Directory created successfully', path: body.path };
  });

  // 5. Delete file / move to trash (30-day retention)
  fastify.delete('/api/v1/sites/:id/files', { preHandler: [requirePermission('sites:edit')] }, async (request) => {
    const { id } = request.params as { id: string };
    const body = deleteFileSchema.parse(request.body);
    const { htdocs, trash } = await getSiteHtdocs(id);
    FileService.moveToTrash(htdocs, trash, body.path);
    return { message: 'File moved to trash', path: body.path };
  });
}
