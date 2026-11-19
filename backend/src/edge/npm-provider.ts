import {
  EdgeProvider,
  ProxyHostInput,
  CertInput,
  CustomCertInput,
  AccessListInput,
  EdgeHost,
  EdgeCertificate
} from './types.js';
import { NpmClient } from './npm-client.js';

export class NpmEdgeProvider implements EdgeProvider {
  readonly kind = 'npm' as const;
  private client: NpmClient;

  constructor(client: NpmClient) {
    this.client = client;
  }

  public static async getDefault(): Promise<NpmEdgeProvider> {
    const { getEnv } = await import('../config/env.js');
    const env = getEnv();
    const client = new NpmClient({
      baseUrl: env.NPM_BASE_URL,
      adminEmail: env.NPM_ADMIN_EMAIL,
      adminPassword: env.NPM_ADMIN_PASSWORD
    });
    return new NpmEdgeProvider(client);
  }

  public static validateForwardHost(host: string): void {
    const trimmed = host.trim().toLowerCase();
    if (trimmed === 'localhost' || trimmed === '127.0.0.1' || trimmed === '::1' || trimmed.startsWith('127.')) {
      const err = new Error(
        "Invalid forward_host: 'localhost' or '127.0.0.1' resolves to NPM container itself and causes a 502 Bad Gateway. Use the origin container name on the 'proxy' Docker network instead."
      );
      (err as any).statusCode = 400;
      throw err;
    }
  }

  async verifyConnection(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const check = await this.client.health();
      return { ok: check.ok, version: check.version || '2.16.0' };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async createHost(input: ProxyHostInput): Promise<{ edgeId: number }> {
    NpmEdgeProvider.validateForwardHost(input.forwardHost);

    const payload: Record<string, unknown> = {
      domain_names: input.domainNames,
      forward_scheme: input.forwardScheme,
      forward_host: input.forwardHost,
      forward_port: input.forwardPort,
      access_list_id: input.accessListId || 0,
      certificate_id: input.certificateId || 0,
      ssl_forced: Boolean(input.sslForced),
      hsts_enabled: Boolean(input.hstsEnabled),
      http2_support: input.http2Support !== false,
      websocket_support: Boolean(input.websocketSupport),
      advanced_config: input.advancedConfig || '',
      enabled: input.enabled !== false
    };

    const res = await this.client.createHost(payload);
    return { edgeId: res.id };
  }

  async updateHost(edgeId: number, input: Partial<ProxyHostInput>): Promise<void> {
    if (input.forwardHost) {
      NpmEdgeProvider.validateForwardHost(input.forwardHost);
    }

    const payload: Record<string, unknown> = {};
    if (input.domainNames) payload.domain_names = input.domainNames;
    if (input.forwardScheme) payload.forward_scheme = input.forwardScheme;
    if (input.forwardHost) payload.forward_host = input.forwardHost;
    if (input.forwardPort !== undefined) payload.forward_port = input.forwardPort;
    if (input.certificateId !== undefined) payload.certificate_id = input.certificateId;
    if (input.sslForced !== undefined) payload.ssl_forced = input.sslForced;
    if (input.hstsEnabled !== undefined) payload.hsts_enabled = input.hstsEnabled;
    if (input.http2Support !== undefined) payload.http2_support = input.http2Support;
    if (input.websocketSupport !== undefined) payload.websocket_support = input.websocketSupport;
    if (input.accessListId !== undefined) payload.access_list_id = input.accessListId;
    if (input.advancedConfig !== undefined) payload.advanced_config = input.advancedConfig;

    await this.client.updateHost(edgeId, payload);
  }

  async deleteHost(edgeId: number): Promise<void> {
    await this.client.deleteHost(edgeId);
  }

  async setHostEnabled(edgeId: number, enabled: boolean): Promise<void> {
    if (enabled) {
      await this.client.enableHost(edgeId);
    } else {
      await this.client.disableHost(edgeId);
    }
  }

  async requestCertificate(input: CertInput): Promise<{ edgeCertId: number; expiresAt?: string }> {
    const payload: Record<string, unknown> = {
      provider: 'letsencrypt',
      domain_names: input.domainNames,
      meta: {
        letsencrypt_email: input.email,
        letsencrypt_agree: input.agreeTerms,
        dns_challenge: Boolean(input.dnsChallenge),
        dns_provider: input.dnsProvider,
        dns_provider_credentials: input.dnsCredentials
      }
    };

    const res = await this.client.createCertificate(payload);
    return {
      edgeCertId: res.id,
      expiresAt: res.expires_on
    };
  }

  async uploadCertificate(input: CustomCertInput): Promise<{ edgeCertId: number }> {
    const payload: Record<string, unknown> = {
      provider: 'other',
      nice_name: input.name,
      certificate: input.certificate,
      certificate_key: input.key,
      intermediate_certificate: input.intermediate || ''
    };

    const res = await this.client.createCertificate(payload);
    return { edgeCertId: res.id };
  }

  async listCertificates(): Promise<EdgeCertificate[]> {
    const certs = await this.client.getCertificates();
    return certs.map((c: any) => ({
      id: c.id,
      niceName: c.nice_name,
      domainNames: c.domain_names || [],
      expiresOn: c.expires_on,
      provider: c.provider
    }));
  }

  async createAccessList(input: AccessListInput): Promise<{ edgeId: number }> {
    const payload: Record<string, unknown> = {
      name: input.name,
      satisfy_any: Boolean(input.satisfyAny),
      pass_auth: Boolean(input.passAuth),
      items: input.items || [],
      clients: input.clients || []
    };

    const res = await this.client.createAccessList(payload);
    return { edgeId: res.id };
  }

  async listHosts(): Promise<EdgeHost[]> {
    const raw = await this.client.getHosts();
    return raw.map((h: any) => ({
      id: h.id,
      domainNames: h.domain_names || [],
      forwardScheme: h.forward_scheme,
      forwardHost: h.forward_host,
      forwardPort: h.forward_port,
      certificateId: h.certificate_id,
      sslForced: Boolean(h.ssl_forced),
      hstsEnabled: Boolean(h.hsts_enabled),
      http2Support: Boolean(h.http2_support),
      websocketSupport: Boolean(h.websocket_support),
      accessListId: h.access_list_id,
      enabled: Boolean(h.enabled)
    }));
  }
}
