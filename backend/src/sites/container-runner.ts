import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { getEnv } from '../config/env.js';
import { Site } from '../db/types.js';

export class ContainerRunner {
  public static async startSiteOrigin(site: Site): Promise<{ started: boolean; error?: string }> {
    // Reverse proxy sites forward to upstream directly; origin container is not needed
    if (site.type === 'reverse_proxy') {
      return { started: true };
    }

    // If running in test environment or mock, simulate immediate readiness
    if (process.env.NODE_ENV === 'test') {
      return { started: true };
    }

    const env = getEnv();
    const volumePath = env.SITES_HOST_DATA_DIR
      ? path.join(env.SITES_HOST_DATA_DIR, path.relative(env.SITES_DATA_DIR, site.volumePath))
      : site.volumePath;

    return new Promise((resolve) => {
      // Check docker availability
      const check = spawn('docker', ['info']);
      check.on('error', () => {
        resolve({ started: false, error: 'Docker daemon is not available on host system' });
      });
      check.on('close', (code) => {
        if (code !== 0) {
          return resolve({ started: false, error: 'Docker daemon not running' });
        }

        // Build container run arguments based on site type
        const args = [
          'run',
          '-d',
          '--name',
          site.originContainerName,
          '--network',
          env.NPM_NETWORK,
          '--restart',
          'unless-stopped'
        ];

        if (site.type === 'nodejs') {
          args.push(
            '-v',
            `${volumePath}/htdocs:/app:rw`,
            '-w',
            '/app',
            `node:${site.nodeVersion || '20'}-alpine`,
            'sh',
            '-c',
            'node server.js'
          );
        } else if (site.type === 'python') {
          args.push(
            '-v',
            `${volumePath}/htdocs:/app:rw`,
            '-w',
            '/app',
            'python:3.12-alpine',
            'sh',
            '-c',
            'python wsgi.py || python app.py || python -m http.server 8080'
          );
        } else if (site.type === 'static') {
          args.push(
            '-v',
            `${volumePath}/conf/${site.domain}.conf:/etc/nginx/conf.d/default.conf:ro`,
            '-v',
            `${volumePath}/htdocs:/data/sites/${site.domain}/htdocs:ro`,
            'nginx:alpine'
          );
        } else {
          // php / wordpress
          args.push(
            '-v',
            `${volumePath}/conf/${site.domain}.conf:/etc/nginx/conf.d/default.conf:ro`,
            '-v',
            `${volumePath}/htdocs:/data/sites/${site.domain}/htdocs:rw`,
            '-v',
            `${volumePath}/logs:/data/sites/${site.domain}/logs:rw`,
            `php:${site.phpVersion || '8.3'}-alpine`,
            'sh',
            '-c',
            `php -S 0.0.0.0:8080 -t /data/sites/${site.domain}/htdocs`
          );
        }

        const proc = spawn('docker', args);
        let stderr = '';
        proc.stderr.on('data', (d) => {
          stderr += d.toString();
        });
        proc.on('close', (runCode) => {
          if (runCode === 0) {
            // Also join 'sites' network for database connectivity
            const netProc = spawn('docker', ['network', 'connect', env.SITES_NETWORK, site.originContainerName]);
            let netStderr = '';
            netProc.stderr.on('data', (d) => {
              netStderr += d.toString();
            });
            netProc.on('close', (netCode) => {
              if (netCode === 0 || netStderr.includes('already exists in network') || netStderr.includes('already connected')) {
                resolve({ started: true });
              } else {
                resolve({ started: false, error: `Failed to attach container to '${env.SITES_NETWORK}' network: ${netStderr.trim()}` });
              }
            });
            netProc.on('error', (err) => {
              resolve({ started: false, error: `Docker network connect error: ${err.message}` });
            });
          } else {
            resolve({ started: false, error: stderr.trim() });
          }
        });
      });
    });
  }

  public static async stopSiteOrigin(containerName: string): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;

    return new Promise((resolve) => {
      const proc = spawn('docker', ['rm', '-f', containerName]);
      proc.on('close', () => resolve());
      proc.on('error', () => resolve());
    });
  }
}
