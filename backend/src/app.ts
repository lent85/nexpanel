import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ZodError } from 'zod';
import { brand } from './config/brand.js';
import { getEnv } from './config/env.js';
import { healthRoutes } from './api/v1/health.routes.js';
import { authRoutes } from './api/v1/auth.routes.js';
import { usersRoutes } from './api/v1/users.routes.js';
import { jobsRoutes } from './api/v1/jobs.routes.js';
import { adminRoutes } from './api/v1/admin.routes.js';
import { edgeRoutes } from './api/v1/edge.routes.js';
import { sitesRoutes } from './api/v1/sites.routes.js';
import { filesRoutes } from './api/v1/files.routes.js';
import { cronRoutes } from './api/v1/cron.routes.js';
import { logsRoutes } from './api/v1/logs.routes.js';
import { dbEnginesRoutes } from './api/v1/db-engines.routes.js';
import { databasesRoutes } from './api/v1/databases.routes.js';
import { securityRoutes } from './api/v1/security.routes.js';
import { backupsRoutes } from './api/v1/backups.routes.js';
import { importRoutes } from './api/v1/imports.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
    trustProxy: true
  });

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true
  });

  // OpenAPI Swagger
  await app.register(swagger, {
    openapi: {
      info: {
        title: `${brand.name} REST API`,
        description: brand.description,
        version: brand.version
      },
      servers: [
        { url: '/api/v1', description: 'API v1' }
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          }
        }
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    }
  });

  // Global error handler (conforms to docs/04 §4.3)
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request payload validation failed',
          details: error.errors.map((e) => ({
            path: e.path.join('.'),
            message: e.message
          }))
        }
      });
      return;
    }

    const statusCode = (error as any).statusCode || 500;
    const code = (error as any).code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR');

    reply.status(statusCode).send({
      error: {
        code,
        message: (error as any).message || 'An unexpected error occurred'
      }
    });
  });

  // Register routes
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(usersRoutes);
  await app.register(jobsRoutes);
  await app.register(adminRoutes);
  await app.register(edgeRoutes);
  await app.register(sitesRoutes);
  await app.register(filesRoutes);
  await app.register(cronRoutes);
  await app.register(logsRoutes);
  await app.register(dbEnginesRoutes);
  await app.register(databasesRoutes);
  await app.register(securityRoutes);
  await app.register(backupsRoutes);
  await app.register(importRoutes, { prefix: '/api/v1/imports' });

  // Register static file serving for React frontend (production UI)
  const env = getEnv();
  const frontendCandidates = [
    env.FRONTEND_DIST_DIR,
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(process.cwd(), 'dist/public')
  ].filter(Boolean) as string[];

  let frontendDist: string | null = null;
  for (const candidate of frontendCandidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      frontendDist = candidate;
      break;
    }
  }

  if (frontendDist) {
    await app.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: true
    });

    app.setNotFoundHandler((request, reply) => {
      // API or docs 404 should return standard JSON error
      if (request.url.startsWith('/api') || request.url.startsWith('/docs')) {
        reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Route ${request.method}:${request.url} not found`
          }
        });
        return;
      }
      // SPA fallback serves index.html for frontend navigation routes
      return reply.sendFile('index.html');
    });
  }

  return app;
}
