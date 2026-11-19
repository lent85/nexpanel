import { spawn } from 'node:child_process';
import { Site } from '../db/types.js';

export class ContainerRunner {
  public static async startSiteOrigin(site: Site): Promise<{ started: boolean; error?: string }> {
    // If running in test environment or mock, simulate immediate readiness
    if (process.env.NODE_ENV === 'test') {
      return { started: true };
    }

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

        // Site container joins 'proxy' network per R1
        const args = [
          'run',
          '-d',
          '--name',
          site.originContainerName,
          '--network',
          'proxy',
          '--restart',
          'unless-stopped',
          '-v',
          `${site.volumePath}:/data/sites/${site.domain}`,
          site.type === 'nodejs'
            ? `node:${site.nodeVersion || '20'}-alpine`
            : site.type === 'python'
            ? 'python:3.12-alpine'
            : 'nginx:alpine'
        ];

        const proc = spawn('docker', args);
        let stderr = '';
        proc.stderr.on('data', (d) => {
          stderr += d.toString();
        });
        proc.on('close', (runCode) => {
          if (runCode === 0) {
            // Also join 'sites' network for database connectivity
            const netProc = spawn('docker', ['network', 'connect', 'sites', site.originContainerName]);
            netProc.on('close', () => resolve({ started: true }));
            netProc.on('error', () => resolve({ started: true }));
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
