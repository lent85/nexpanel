import { EdgeProvider, DriftReport, HostDriftItem, EdgeHost } from './types.js';
import { getDb } from '../db/index.js';
import { ProxyHost } from '../db/types.js';

export class DriftReconciler {
  private provider: EdgeProvider;

  constructor(provider: EdgeProvider) {
    this.provider = provider;
  }

  public async analyzeDrift(): Promise<DriftReport> {
    const db = getDb();
    const panelHostsRes = await db.query<ProxyHost>('SELECT * FROM proxy_hosts');
    const panelHosts = panelHostsRes.rows;

    let edgeHosts: EdgeHost[] = [];
    try {
      edgeHosts = await this.provider.listHosts();
    } catch (err: any) {
      throw new Error(`Failed to fetch edge hosts from NPM: ${err.message}`);
    }

    const items: HostDriftItem[] = [];
    const matchedEdgeIds = new Set<number>();

    for (const raw of panelHosts) {
      const pHost = {
        id: raw.id,
        domainNames: raw.domainNames || (raw as any).domain_names || [],
        edgeHostId: raw.edgeHostId ?? (raw as any).edge_host_id,
        forwardHost: raw.forwardHost || (raw as any).forward_host,
        forwardPort: raw.forwardPort ?? (raw as any).forward_port,
        enabled: raw.enabled !== undefined ? raw.enabled : (raw as any).enabled
      };

      const primaryDomain = pHost.domainNames?.[0] || 'unknown';
      // Find matching edge host by edgeHostId or primary domain
      const match = edgeHosts.find((e) => (pHost.edgeHostId && e.id === pHost.edgeHostId) || e.domainNames.includes(primaryDomain));

      if (!match) {
        items.push({
          domain: primaryDomain,
          panelHostId: pHost.id,
          status: 'missing_on_edge'
        });
        continue;
      }

      matchedEdgeIds.add(match.id);

      // Check fields for drift
      const diffs: Record<string, { panel: unknown; edge: unknown }> = {};
      if (pHost.forwardHost !== match.forwardHost) {
        diffs.forwardHost = { panel: pHost.forwardHost, edge: match.forwardHost };
      }
      if (pHost.forwardPort !== match.forwardPort) {
        diffs.forwardPort = { panel: pHost.forwardPort, edge: match.forwardPort };
      }
      if (Boolean(pHost.enabled) !== Boolean(match.enabled)) {
        diffs.enabled = { panel: pHost.enabled, edge: match.enabled };
      }

      if (Object.keys(diffs).length > 0) {
        items.push({
          domain: primaryDomain,
          panelHostId: pHost.id,
          edgeHostId: match.id,
          status: 'drifted',
          differences: diffs
        });
      } else {
        items.push({
          domain: primaryDomain,
          panelHostId: pHost.id,
          edgeHostId: match.id,
          status: 'in_sync'
        });
      }
    }

    // Identify orphan hosts on edge that panel doesn't manage
    for (const eHost of edgeHosts) {
      if (!matchedEdgeIds.has(eHost.id)) {
        items.push({
          domain: eHost.domainNames?.[0] || `edge-host-${eHost.id}`,
          edgeHostId: eHost.id,
          status: 'orphan_on_edge'
        });
      }
    }

    const inSync = items.filter((i) => i.status === 'in_sync').length;
    const drifted = items.filter((i) => i.status === 'drifted').length;
    const missingOnEdge = items.filter((i) => i.status === 'missing_on_edge').length;
    const orphanOnEdge = items.filter((i) => i.status === 'orphan_on_edge').length;

    return {
      totalExpected: panelHosts.length,
      totalActual: edgeHosts.length,
      inSync,
      drifted,
      missingOnEdge,
      orphanOnEdge,
      items
    };
  }

  public async reconcile(report?: DriftReport): Promise<{ reconciled: number; errors: string[] }> {
    const driftReport = report || (await this.analyzeDrift());
    const db = getDb();
    let reconciled = 0;
    const errors: string[] = [];

    for (const item of driftReport.items) {
      try {
        if (item.status === 'missing_on_edge' && item.panelHostId) {
          const res = await db.query<ProxyHost>('SELECT * FROM proxy_hosts WHERE id = $1', [item.panelHostId]);
          if (res.rows.length > 0) {
            const raw = res.rows[0];
            const ph = {
              id: raw.id,
              domainNames: raw.domainNames || (raw as any).domain_names || [],
              edgeHostId: raw.edgeHostId ?? (raw as any).edge_host_id,
              forwardScheme: (raw.forwardScheme || (raw as any).forward_scheme || 'http') as 'http' | 'https',
              forwardHost: raw.forwardHost || (raw as any).forward_host,
              forwardPort: raw.forwardPort ?? (raw as any).forward_port ?? 8080,
              certificateId: raw.certificateId ?? (raw as any).certificate_id,
              sslForced: Boolean(raw.sslForced ?? (raw as any).ssl_forced),
              hstsEnabled: Boolean(raw.hsts ?? (raw as any).hsts),
              http2Support: (raw.http2 ?? (raw as any).http2) !== false,
              websocketSupport: Boolean(raw.websocket ?? (raw as any).websocket),
              enabled: (raw.enabled !== undefined ? raw.enabled : (raw as any).enabled) !== false
            };
            const newHost = await this.provider.createHost({
              domainNames: ph.domainNames,
              forwardScheme: ph.forwardScheme,
              forwardHost: ph.forwardHost,
              forwardPort: ph.forwardPort,
              certificateId: ph.certificateId,
              sslForced: ph.sslForced,
              hstsEnabled: ph.hstsEnabled,
              http2Support: ph.http2Support,
              websocketSupport: ph.websocketSupport,
              enabled: ph.enabled
            });

            await db.execute(
              `UPDATE proxy_hosts SET edge_host_id = $1, drift_status = 'in_sync', last_synced_at = $2, updated_at = $2 WHERE id = $3`,
              [newHost.edgeId, new Date().toISOString(), ph.id]
            );
            reconciled++;
          }
        } else if (item.status === 'drifted' && item.panelHostId && item.edgeHostId) {
          const res = await db.query<ProxyHost>('SELECT * FROM proxy_hosts WHERE id = $1', [item.panelHostId]);
          if (res.rows.length > 0) {
            const raw = res.rows[0];
            const ph = {
              id: raw.id,
              domainNames: raw.domainNames || (raw as any).domain_names,
              forwardScheme: (raw.forwardScheme || (raw as any).forward_scheme || 'http') as 'http' | 'https',
              forwardHost: raw.forwardHost || (raw as any).forward_host,
              forwardPort: raw.forwardPort ?? (raw as any).forward_port,
              enabled: raw.enabled !== undefined ? raw.enabled : (raw as any).enabled
            };
            await this.provider.updateHost(item.edgeHostId, {
              domainNames: ph.domainNames,
              forwardScheme: ph.forwardScheme,
              forwardHost: ph.forwardHost,
              forwardPort: ph.forwardPort,
              enabled: ph.enabled
            });

            await db.execute(
              `UPDATE proxy_hosts SET drift_status = 'in_sync', last_synced_at = $1, updated_at = $1 WHERE id = $2`,
              [new Date().toISOString(), ph.id]
            );
            reconciled++;
          }
        }
      } catch (err: any) {
        errors.push(`Failed reconciling ${item.domain}: ${err.message}`);
      }
    }

    return { reconciled, errors };
  }
}
