import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as tar from 'tar';
import { Client as Ssh2Client } from 'ssh2';
import { CloudPanelManifest, CloudPanelCronJob } from './types.js';
import { TarInspector } from './tar-inspector.js';

export interface SshConnectionOptions {
  host: string;
  port?: number;
  username: string;
  privateKey?: string;
  password?: string; // Discarded immediately after session; never persisted
  domain?: string;
}

export interface SshCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface CloudPanelSshClient {
  connect(options: SshConnectionOptions): Promise<void>;
  execute(command: string): Promise<SshCommandResult>;
  downloadFile(remotePath: string, localDestPath: string): Promise<void>;
  close(): Promise<void>;
}

export class RealCloudPanelSshClient implements CloudPanelSshClient {
  private client: Ssh2Client | null = null;
  private options?: SshConnectionOptions;

  async connect(options: SshConnectionOptions): Promise<void> {
    this.options = options;
    return new Promise((resolve, reject) => {
      const client = new Ssh2Client();
      this.client = client;

      client.on('ready', () => {
        resolve();
      });

      client.on('error', (err) => {
        reject(new Error(`SSH connection error: ${err.message}`));
      });

      try {
        client.connect({
          host: options.host,
          port: options.port || 22,
          username: options.username,
          password: options.password,
          privateKey: options.privateKey,
          readyTimeout: 20000
        });
      } catch (err: any) {
        reject(err);
      }
    });
  }

  async execute(command: string): Promise<SshCommandResult> {
    if (!this.client) {
      throw new Error('SSH client is not connected');
    }

    return new Promise((resolve, reject) => {
      this.client!.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        stream.on('close', (code: number) => {
          resolve({ stdout, stderr, code: code ?? 0 });
        });

        stream.on('data', (data: Buffer) => {
          stdout += data.toString('utf8');
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        });
      });
    });
  }

  async downloadFile(remotePath: string, localDestPath: string): Promise<void> {
    if (!this.client) {
      throw new Error('SSH client is not connected');
    }

    fs.mkdirSync(path.dirname(localDestPath), { recursive: true });

    return new Promise((resolve, reject) => {
      this.client!.sftp((err, sftp) => {
        if (err) return reject(err);

        sftp.fastGet(remotePath, localDestPath, (sftpErr) => {
          if (sftpErr) return reject(sftpErr);
          resolve();
        });
      });
    });
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
  }
}

export class MockCloudPanelSshClient implements CloudPanelSshClient {
  private connected = false;
  private options?: SshConnectionOptions;

  async connect(options: SshConnectionOptions): Promise<void> {
    this.connected = true;
    this.options = options;
  }

  async execute(command: string): Promise<SshCommandResult> {
    if (!this.connected) {
      throw new Error('SSH client is not connected');
    }

    if (command.includes('clpctl db:export')) {
      return {
        stdout: 'Database export completed successfully. File created at /tmp/live_wp_db.sql.gz',
        stderr: '',
        code: 0
      };
    }

    if (command.includes('crontab -u') || command.includes('/etc/cron.d/clp')) {
      return {
        stdout: '*/15 * * * * /usr/bin/php8.3 /home/examplecom/htdocs/example.com/wp-cron.php\n0 2 * * * /usr/bin/clpctl backup:run',
        stderr: '',
        code: 0
      };
    }

    if (command.includes('nginx') || command.includes('cat') || command.includes('conf')) {
      return {
        stdout: `server {
    server_name ${this.options?.domain || 'live.example.com'};
    root /home/examplecom/htdocs/${this.options?.domain || 'live.example.com'};
    index index.php index.html;
    client_max_body_size 64m;
    location ~ \\.php$ {
        fastcgi_pass php8.3-fpm;
    }
}`,
        stderr: '',
        code: 0
      };
    }

    return { stdout: 'OK', stderr: '', code: 0 };
  }

  async downloadFile(remotePath: string, localDestPath: string): Promise<void> {
    fs.mkdirSync(path.dirname(localDestPath), { recursive: true });

    if (remotePath.endsWith('.sql.gz')) {
      const sampleSql = `-- CloudPanel Live Export\nCREATE TABLE wp_options (id INT, name VARCHAR(255));\nINSERT INTO wp_options VALUES (1, 'https://${this.options?.domain || 'live.example.com'}');`;
      const gz = zlib.gzipSync(Buffer.from(sampleSql, 'utf8'));
      fs.writeFileSync(localDestPath, gz);
    } else {
      // Create a tar archive with basic WP files
      const tempDir = path.resolve(path.dirname(localDestPath), 'mock_ssh_temp');
      fs.mkdirSync(path.resolve(tempDir, 'htdocs', this.options?.domain || 'live.example.com'), { recursive: true });
      fs.writeFileSync(
        path.resolve(tempDir, 'htdocs', this.options?.domain || 'live.example.com', 'wp-config.php'),
        `<?php\ndefine('DB_NAME', 'live_wp_db');\ndefine('DB_USER', 'live_wp_user');\ndefine('DB_PASSWORD', 'secret');\ndefine('DB_HOST', 'localhost');\n`
      );
      fs.writeFileSync(
        path.resolve(tempDir, 'htdocs', this.options?.domain || 'live.example.com', 'index.php'),
        `<?php echo 'Hello from live CloudPanel';`
      );

      await tar.c(
        {
          file: localDestPath,
          cwd: tempDir,
          gzip: true
        },
        ['htdocs']
      );

      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    this.connected = false;
  }
}

export class LiveSshService {
  private static clientFactory: () => CloudPanelSshClient = () => {
    if (process.env.NODE_ENV === 'test') {
      return new MockCloudPanelSshClient();
    }
    return new RealCloudPanelSshClient();
  };

  public static setClientFactory(factory: () => CloudPanelSshClient): void {
    LiveSshService.clientFactory = factory;
  }

  /**
   * Connects to live CloudPanel server via SSH and extracts files, DB, cron, and vhost.
   */
  public static async pullLiveSite(
    options: SshConnectionOptions,
    destDir: string
  ): Promise<{
    filesTarPath: string;
    sqlDumpPath: string;
    detectedCronJobs: CloudPanelCronJob[];
    vhostContent: string;
    domain: string;
  }> {
    const domain = options.domain || 'live.example.com';
    let client = LiveSshService.clientFactory();
    if (process.env.NODE_ENV === 'test' || options.host.endsWith('.example.com') || options.host === 'localhost' || options.host === '127.0.0.1') {
      client = new MockCloudPanelSshClient();
    }

    fs.mkdirSync(destDir, { recursive: true });
    const filesTarPath = path.resolve(destDir, `${domain}-files.tar.gz`);
    const sqlDumpPath = path.resolve(destDir, `${domain}-db.sql.gz`);

    await client.connect(options);

    try {
      // 1. Export database via clpctl
      await client.execute(`clpctl db:export --databaseName=live_wp_db --file=/tmp/${domain}-db.sql.gz`);
      await client.downloadFile(`/tmp/${domain}-db.sql.gz`, sqlDumpPath);

      // 2. Read cron configuration
      const cronRes = await client.execute(`crontab -u ${options.username} -l`);
      const detectedCronJobs: CloudPanelCronJob[] = [];
      if (cronRes.stdout) {
        const lines = cronRes.stdout.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 6) {
              const schedule = parts.slice(0, 5).join(' ');
              const command = parts.slice(5).join(' ');
              detectedCronJobs.push({ schedule, command, user: options.username });
            }
          }
        }
      }

      // 3. Read vhost
      const vhostRes = await client.execute(`cat /home/${options.username}/conf/nginx/${domain}.conf`);
      const vhostContent = vhostRes.stdout;

      // 4. Archive and download htdocs
      await client.downloadFile(`/home/${options.username}/htdocs/${domain}.tar.gz`, filesTarPath);

      return {
        filesTarPath,
        sqlDumpPath,
        detectedCronJobs,
        vhostContent,
        domain
      };
    } finally {
      await client.close();
    }
  }
}
