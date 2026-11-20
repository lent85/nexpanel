import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { getDb } from './db/index.js';
import { brand } from './config/brand.js';
import { ProxyQueue } from './edge/proxy-queue.js';
import { Seeder } from './db/seeder.js';

async function start() {
  const env = getEnv();
  const db = getDb();

  console.log(`Starting ${brand.name} v${brand.version}...`);
  try {
    await db.migrate();
    console.log('Database schema migrations applied.');
  } catch (err: any) {
    console.warn('Database migration warning:', err.message);
  }

  // Seed initial data if requested via env (PANEL_SEED_DATA=true) or flag (--seed)
  if (env.PANEL_SEED_DATA || process.argv.includes('--seed')) {
    try {
      await Seeder.seed();
    } catch (err: any) {
      console.warn('Database seeding warning:', err.message);
    }
  }

  // Start background proxy queue auto-drain reconciler (FR-PROXY-07)
  ProxyQueue.startAutoDrain(30000);

  const app = await buildApp();

  try {
    await app.listen({ port: env.PANEL_PORT, host: env.PANEL_HOST });
    console.log(`${brand.name} server listening on http://${env.PANEL_HOST}:${env.PANEL_PORT}`);
    console.log(`API documentation available at http://${env.PANEL_HOST}:${env.PANEL_PORT}/docs`);
  } catch (err) {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
