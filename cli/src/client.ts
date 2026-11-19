import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ApiClientOptions {
  apiUrl?: string;
  token?: string;
}

export class NxctlClient {
  private apiUrl: string;
  private token?: string;

  constructor(opts: ApiClientOptions = {}) {
    const config = this.loadConfig();
    this.apiUrl = opts.apiUrl || process.env.PANEL_API_URL || config.apiUrl || 'http://127.0.0.1:8443';
    this.token = opts.token || process.env.PANEL_API_TOKEN || config.token;
  }

  private getConfigPath(): string {
    return path.resolve(os.homedir(), '.nxctl.json');
  }

  private loadConfig(): Record<string, string> {
    try {
      const cfgPath = this.getConfigPath();
      if (fs.existsSync(cfgPath)) {
        return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      }
    } catch {
      // fallback
    }
    return {};
  }

  public saveConfig(config: Record<string, string>): void {
    const cfgPath = this.getConfigPath();
    const existing = this.loadConfig();
    fs.writeFileSync(cfgPath, JSON.stringify({ ...existing, ...config }, null, 2), { mode: 0o600 });
  }

  public setToken(token: string): void {
    this.token = token;
    this.saveConfig({ token, apiUrl: this.apiUrl });
  }

  public async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {})
    };

    let body = options.body;
    if (body || (options.method && ['POST', 'PUT', 'PATCH'].includes(options.method.toUpperCase()))) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      if (!body && options.method && ['POST', 'PUT', 'PATCH'].includes(options.method.toUpperCase())) {
        body = '{}';
      }
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, {
      ...options,
      headers,
      body
    });

    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const msg = typeof data === 'object' && data.error?.message ? data.error.message : `HTTP ${res.status}: ${res.statusText}`;
      const err = new Error(msg);
      (err as any).status = res.status;
      (err as any).data = data;
      throw err;
    }

    return data as T;
  }
}
