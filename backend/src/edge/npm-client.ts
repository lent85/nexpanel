export interface NpmClientConfig {
  baseUrl: string;
  adminEmail: string;
  adminPassword?: string;
  apiToken?: string;
}

export class NpmClient {
  private baseUrl: string;
  private adminEmail: string;
  private adminPassword?: string;
  private token?: string;
  private tokenExpiresAt?: number;

  constructor(config: NpmClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.adminEmail = config.adminEmail;
    this.adminPassword = config.adminPassword;
    this.token = config.apiToken;
  }

  public setToken(token: string, expiresInMs = 24 * 60 * 60 * 1000): void {
    this.token = token;
    this.tokenExpiresAt = Date.now() + expiresInMs;
  }

  public async getValidToken(): Promise<string> {
    if (this.token && (!this.tokenExpiresAt || Date.now() < this.tokenExpiresAt - 60000)) {
      return this.token;
    }

    if (!this.adminPassword) {
      if (this.token) return this.token;
      throw new Error('No NPM admin password or API token provided');
    }

    // Authenticate with NPM API
    const url = `${this.baseUrl}/api/tokens`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: this.adminEmail,
        secret: this.adminPassword
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`NPM Authentication failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { token: string; expires?: string };
    this.token = data.token;
    this.tokenExpiresAt = data.expires ? new Date(data.expires).getTime() : Date.now() + 24 * 60 * 60 * 1000;
    return this.token;
  }

  public async request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const isTokenRoute = endpoint.includes('/tokens');
    let token: string | undefined;

    if (!isTokenRoute) {
      token = await this.getValidToken();
    }

    const url = `${this.baseUrl}/api/${endpoint.replace(/^\/+/, '')}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {})
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (err: any) {
      // Retry once on transient socket closure during Nginx reload
      await new Promise((r) => setTimeout(r, 600));
      res = await fetch(url, { ...options, headers });
    }

    // Handle token expiration / retry on 401
    if (res.status === 401 && !isTokenRoute && this.adminPassword) {
      this.token = undefined;
      token = await this.getValidToken();
      headers['Authorization'] = `Bearer ${token}`;
      res = await fetch(url, { ...options, headers });
    }

    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const msg = typeof data === 'object' && data.error?.message ? data.error.message : `NPM API ${res.status}: ${JSON.stringify(data)}`;
      const err = new Error(msg);
      (err as any).status = res.status;
      (err as any).data = data;
      throw err;
    }

    return data as T;
  }

  public async health(): Promise<{ ok: boolean; version?: string }> {
    try {
      const data = await this.request<{ version?: any }>('/');
      let ver = '2.16.0';
      if (typeof data.version === 'string') {
        ver = data.version;
      } else if (data.version && typeof data.version === 'object') {
        ver = `${data.version.major}.${data.version.minor}.${data.version.revision}`;
      }
      return { ok: true, version: ver };
    } catch {
      // NPM 2.16 often returns 200 or 401 on /api/ if not authenticated, test token acquisition
      try {
        await this.getValidToken();
        return { ok: true, version: '2.16.0' };
      } catch (err: any) {
        return { ok: false };
      }
    }
  }

  // Proxy Hosts
  public async getHosts(): Promise<any[]> {
    return this.request<any[]>('nginx/proxy-hosts');
  }

  public async getHost(id: number): Promise<any> {
    return this.request<any>(`nginx/proxy-hosts/${id}`);
  }

  public async createHost(payload: Record<string, unknown>): Promise<any> {
    return this.request<any>('nginx/proxy-hosts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateHost(id: number, payload: Record<string, unknown>): Promise<any> {
    return this.request<any>(`nginx/proxy-hosts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
  }

  public async deleteHost(id: number): Promise<void> {
    await this.request<void>(`nginx/proxy-hosts/${id}`, {
      method: 'DELETE'
    });
  }

  public async enableHost(id: number): Promise<void> {
    await this.request<void>(`nginx/proxy-hosts/${id}/enable`, {
      method: 'POST'
    });
  }

  public async disableHost(id: number): Promise<void> {
    await this.request<void>(`nginx/proxy-hosts/${id}/disable`, {
      method: 'POST'
    });
  }

  // Certificates
  public async getCertificates(): Promise<any[]> {
    return this.request<any[]>('nginx/certificates');
  }

  public async createCertificate(payload: Record<string, unknown>): Promise<any> {
    return this.request<any>('nginx/certificates', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // Access Lists
  public async getAccessLists(): Promise<any[]> {
    return this.request<any[]>('nginx/access-lists');
  }

  public async createAccessList(payload: Record<string, unknown>): Promise<any> {
    return this.request<any>('nginx/access-lists', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
}
