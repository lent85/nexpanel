import {
  EdgeProvider,
  ProxyHostInput,
  CertInput,
  CustomCertInput,
  AccessListInput,
  EdgeHost,
  EdgeCertificate
} from './types.js';
import { isIP } from 'node:net';
import { NpmClient } from './npm-client.js';
import { getDb } from '../db/index.js';
import { getEnv } from '../config/env.js';
import { VaultService } from '../vault/vault.js';
import { EdgeProvider as DbEdgeProvider } from '../db/types.js';

export class NpmEdgeProvider implements EdgeProvider {
  readonly kind = 'npm' as const;
  private client: NpmClient;

  constructor(client: NpmClient) {
    this.client = client;
  }

  public static async getDefault(): Promise<NpmEdgeProvider> {
    return (await this.resolve()).provider;
  }

  public static async resolve(providerId?: string): Promise<{ provider: NpmEdgeProvider; record?: DbEdgeProvider }> {
    const db = getDb();
    let query = 'SELECT * FROM edge_providers WHERE kind = $1 ORDER BY created_at ASC';
    let params: any[] = ['npm'];

    if (providerId) {
      query = 'SELECT * FROM edge_providers WHERE id = $1';
      params = [providerId];
    }

    const res = await db.query<DbEdgeProvider & { base_url?: string; admin_email?: string; credentials_secret_ref?: string }>(query, params);
    if (res.rows.length === 0) {
      if (providerId) throw Object.assign(new Error('Edge provider not found'), { statusCode: 404 });
      // Return default instance from environment variables
      const env = getEnv();
      const client = new NpmClient({
        baseUrl: env.NPM_BASE_URL,
        adminEmail: env.NPM_ADMIN_EMAIL,
        adminPassword: env.NPM_ADMIN_PASSWORD
      });
      return { provider: new NpmEdgeProvider(client) };
    }

    const record = res.rows[0];
    const env = getEnv();
    const vault = new VaultService(env.VAULT_KEY_PATH);
    let decryptedCreds: { password?: string; token?: string } = {};

    const secretRef = record.credentials_secret_ref ?? record.credentialsSecretRef;
    if (secretRef) {
      try {
        const raw = vault.decrypt(secretRef);
        decryptedCreds = JSON.parse(raw);
      } catch {
        // fallback
      }
    }

    const baseUrl = record.base_url || record.baseUrl || env.NPM_BASE_URL;
    const adminEmail = record.admin_email || record.adminEmail || env.NPM_ADMIN_EMAIL;

    const client = new NpmClient({
      baseUrl,
      adminEmail,
      adminPassword: decryptedCreds.password,
      apiToken: decryptedCreds.token
    });

    return { provider: new NpmEdgeProvider(client), record };
  }

  public static validateForwardHost(host: string): void {
    const trimmed = host.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(trimmed) || isIP(trimmed) || trimmed === 'localhost') {
      throw Object.assign(new Error(
        "Invalid forward_host: use a Docker container or service name on the shared proxy network to avoid a 502 Bad Gateway. Do not use localhost, 127.0.0.1, IP addresses, or external hostnames."
      ), { statusCode: 400 });
    }
  }

  async verifyConnection(): Promise<{ ok: boolean; version?: string; error?: string }> {
    try {
      const check = await this.client.health();
      return { ok: check.ok, version: check.version };
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
      allow_websocket_upgrade: Boolean(input.websocketSupport),
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
    if (input.websocketSupport !== undefined) payload.allow_websocket_upgrade = input.websocketSupport;
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
    const { id } = await this.client.createCertificate({ provider: 'other', nice_name: input.name });
    try {
      await this.client.uploadCertificateFiles(id, {
        certificate: input.certificate,
        certificate_key: input.key,
        ...(input.intermediate ? { intermediate_certificate: input.intermediate } : {})
      });
      return { edgeCertId: id };
    } catch (error) {
      await this.client.deleteCertificate(id).catch(() => {});
      throw error;
    }
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
      websocketSupport: Boolean(h.allow_websocket_upgrade || h.websocket_support),
      accessListId: h.access_list_id,
      enabled: Boolean(h.enabled)
    }));
  }
}
