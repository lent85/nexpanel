/**
 * Typed API Client for NexPanel Dashboard
 */

export interface ApiResponse<T = any> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  message?: string;
}

export class ApiClient {
  private static token: string | null = null;

  public static setToken(token: string | null): void {
    ApiClient.token = token;
    if (token) {
      localStorage.setItem('nexpanel_token', token);
    } else {
      localStorage.removeItem('nexpanel_token');
    }
  }

  public static getToken(): string | null {
    if (!ApiClient.token) {
      ApiClient.token = localStorage.getItem('nexpanel_token');
    }
    return ApiClient.token;
  }

  public static async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = ApiClient.getToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {})
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(endpoint, {
      ...options,
      headers
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg =
        data.message || data.error?.message || `Request failed with status ${res.status}`;
      const err = new Error(errorMsg);
      (err as any).status = res.status;
      (err as any).data = data;
      throw err;
    }

    return data as T;
  }

  // Auth Endpoints
  public static auth = {
    getSetupStatus: () =>
      ApiClient.request<{ setupRequired: boolean; webSetupAllowed: boolean }>(
        '/api/v1/auth/setup-status'
      ),
    setup: (payload: { email: string; username: string; password: string }) =>
      ApiClient.request('/api/v1/auth/setup', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    login: (payload: {
      identifier?: string;
      password?: string;
      challengeToken?: string;
      totpToken?: string;
      recoveryCode?: string;
    }) =>
      ApiClient.request('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    me: () => ApiClient.request('/api/v1/auth/me'),
    setupTotp: () =>
      ApiClient.request('/api/v1/auth/totp/setup', { method: 'POST' }),
    verifyTotp: (payload: { secret: string; token: string; recoveryCodes?: string[] }) =>
      ApiClient.request('/api/v1/auth/totp/verify', {
        method: 'POST',
        body: JSON.stringify(payload)
      })
  };

  // Sites Endpoints
  public static sites = {
    list: (search?: string) =>
      ApiClient.request<{ data: any[]; total: number }>(
        `/api/v1/sites${search ? `?search=${encodeURIComponent(search)}` : ''}`
      ),
    create: (payload: any) =>
      ApiClient.request('/api/v1/sites', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    delete: (siteId: string, confirmDomain: string) =>
      ApiClient.request(`/api/v1/sites/${siteId}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirmDomain })
      }),
    switchPhp: (siteId: string, phpVersion: string) =>
      ApiClient.request(`/api/v1/sites/${siteId}/php-switch`, {
        method: 'POST',
        body: JSON.stringify({ phpVersion })
      })
  };

  // Database Engines Endpoints
  public static databases = {
    list: (siteId?: string, engineId?: string) => {
      const params = new URLSearchParams();
      if (siteId) params.set('siteId', siteId);
      if (engineId) params.set('engineId', engineId);
      const qs = params.toString();
      return ApiClient.request<{ data: any[]; total: number }>(
        `/api/v1/databases${qs ? `?${qs}` : ''}`
      );
    },
    create: (payload: any) =>
      ApiClient.request('/api/v1/databases', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    delete: (id: string) =>
      ApiClient.request(`/api/v1/databases/${id}`, { method: 'DELETE' }),
    listEngines: () =>
      ApiClient.request<{ data: any[] }>('/api/v1/db-engines'),
    registerEngine: (payload: any) =>
      ApiClient.request('/api/v1/db-engines', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    testEngine: (id: string) =>
      ApiClient.request(`/api/v1/db-engines/${id}/test`, { method: 'POST' })
  };

  // Edge / Proxy Hosts Endpoints
  public static edge = {
    listProxyHosts: () =>
      ApiClient.request<{ data: any[] }>('/api/v1/edge/proxy-hosts'),
    createProxyHost: (payload: any) =>
      ApiClient.request('/api/v1/edge/proxy-hosts', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    syncDrift: () =>
      ApiClient.request('/api/v1/edge/reconcile', { method: 'POST' })
  };

  // CloudPanel Import Endpoints
  public static imports = {
    detect: (payload: {
      sourceType: 'backup_tar' | 'local_tar_gz' | 'local_pair' | 'live_ssh' | 'ssh';
      filePath?: string;
      archivePath?: string;
      localFilesTarGz?: string;
      localDbSqlGz?: string;
      ssh?: any;
    }) => {
      const normalizedPath = payload.filePath || payload.archivePath;
      const body = {
        sourceType: payload.sourceType,
        filePath: normalizedPath,
        archivePath: normalizedPath,
        localFilesTarGz: payload.localFilesTarGz,
        localDbSqlGz: payload.localDbSqlGz,
        ssh: payload.ssh
      };
      return ApiClient.request<{ job: any; manifest: any }>('/api/v1/imports/detect', {
        method: 'POST',
        body: JSON.stringify(body)
      });
    },
    saveMapping: (jobId: string, mapping: any) =>
      ApiClient.request(`/api/v1/imports/${jobId}/mapping`, {
        method: 'POST',
        body: JSON.stringify(mapping)
      }),
    runDryRun: (jobId: string) =>
      ApiClient.request<{ job?: any; dryRunDiff?: any; result?: any }>(
        `/api/v1/imports/${jobId}/dry-run`,
        { method: 'POST' }
      ),
    execute: (jobId: string) =>
      ApiClient.request<{ job?: any; report?: any; success?: boolean }>(
        `/api/v1/imports/${jobId}/run`,
        { method: 'POST' }
      ),
    rollback: (jobId: string) =>
      ApiClient.request<{ rollback: any }>(
        `/api/v1/imports/${jobId}/rollback`,
        { method: 'POST' }
      )
  };

  // Security & Firewall Endpoints
  public static security = {
    listFirewallRules: () =>
      ApiClient.request<{ data: any[] }>('/api/v1/security/firewall/rules'),
    addFirewallRule: (payload: any) =>
      ApiClient.request('/api/v1/security/firewall/rules', {
        method: 'POST',
        body: JSON.stringify(payload)
      }),
    deleteFirewallRule: (ruleId: string) =>
      ApiClient.request(`/api/v1/security/firewall/rules/${ruleId}`, {
        method: 'DELETE'
      })
  };
}
