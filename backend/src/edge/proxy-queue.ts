import { EdgeProvider, ProxyHostInput } from './types.js';
import { getDb } from '../db/index.js';

export interface QueuedProxyAction {
  id: string;
  action: 'create' | 'update' | 'delete' | 'enable' | 'disable';
  edgeHostId?: number;
  proxyHostId?: string;
  payload?: Partial<ProxyHostInput>;
  attempts: number;
  createdAt: string;
}

export class ProxyQueue {
  private static queue: QueuedProxyAction[] = [];
  private static autoDrainTimer: NodeJS.Timeout | null = null;

  public static async enqueue(action: Omit<QueuedProxyAction, 'id' | 'attempts' | 'createdAt'>): Promise<QueuedProxyAction> {
    const item: QueuedProxyAction = {
      id: Math.random().toString(36).substring(2),
      ...action,
      attempts: 0,
      createdAt: new Date().toISOString()
    };
    await getDb().execute(
      `INSERT INTO proxy_mutation_queue (id, action, edge_host_id, payload, attempts, created_at, proxy_host_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [item.id, item.action, item.edgeHostId ?? null, item.payload ? JSON.stringify(item.payload) : null,
        item.attempts, item.createdAt, item.proxyHostId ?? null]
    );
    ProxyQueue.queue.push(item);
    return item;
  }

  public static async recordCreatedHost(proxyHostId: string, edgeHostId: number): Promise<void> {
    const now = new Date().toISOString();
    await getDb().execute(
      `UPDATE proxy_hosts SET edge_host_id = $1, drift_status = $2, updated_at = $3, last_synced_at = $3 WHERE id = $4`,
      [edgeHostId, 'in_sync', now, proxyHostId]
    );
  }

  public static getPending(): QueuedProxyAction[] {
    return [...ProxyQueue.queue];
  }

  public static clear(): void {
    ProxyQueue.queue = [];
    try {
      const db = getDb();
      db.execute('DELETE FROM proxy_mutation_queue').catch(() => {});
    } catch {}
  }

  private static activeDrain?: Promise<{ processed: number; remaining: number }>;

  public static async drain(provider: EdgeProvider): Promise<{ processed: number; remaining: number }> {
    if (!this.activeDrain) {
      this.activeDrain = this.drainPending(provider).finally(() => { this.activeDrain = undefined; });
    }
    return this.activeDrain;
  }

  private static async drainPending(provider: EdgeProvider): Promise<{ processed: number; remaining: number }> {
    const check = await provider.verifyConnection();
    if (!check.ok) {
      return { processed: 0, remaining: ProxyQueue.queue.length };
    }

    const db = getDb();
    const { rows } = await db.query('SELECT * FROM proxy_mutation_queue ORDER BY created_at ASC');
    const items = new Map(ProxyQueue.queue.map((item) => [item.id, item]));
    for (const row of rows) {
      if (items.has(row.id)) continue;
      items.set(row.id, {
        id: row.id,
        action: row.action,
        edgeHostId: row.edge_host_id,
        proxyHostId: row.proxy_host_id,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        attempts: row.attempts || 0,
        createdAt: row.created_at
      });
    }

    let processed = 0;
    const remaining: QueuedProxyAction[] = [];

    for (const item of items.values()) {
      try {
        if (item.action === 'create' && item.payload) {
          const input = item.payload as ProxyHostInput;
          let edgeHostId = item.edgeHostId;
          if (!edgeHostId) {
            const existing = item.proxyHostId ? (await provider.listHosts()).find((host) =>
              host.forwardHost === input.forwardHost && host.forwardPort === input.forwardPort &&
              host.forwardScheme === input.forwardScheme && host.domainNames.length === input.domainNames.length &&
              host.domainNames.every((domain) => input.domainNames.includes(domain))
            ) : undefined;
            edgeHostId = existing?.id ?? (await provider.createHost(input)).edgeId;
            item.edgeHostId = edgeHostId;
          }
          if (item.proxyHostId) await ProxyQueue.recordCreatedHost(item.proxyHostId, edgeHostId);
        } else if (item.action === 'update' && item.edgeHostId && item.payload) {
          await provider.updateHost(item.edgeHostId, item.payload);
        } else if (item.action === 'delete' && item.edgeHostId) {
          await provider.deleteHost(item.edgeHostId);
        } else if (item.action === 'enable' && item.edgeHostId) {
          await provider.setHostEnabled(item.edgeHostId, true);
        } else if (item.action === 'disable' && item.edgeHostId) {
          await provider.setHostEnabled(item.edgeHostId, false);
        }

        await getDb().execute('DELETE FROM proxy_mutation_queue WHERE id = $1', [item.id]);
        processed++;
      } catch (error) {
        item.attempts++;
        remaining.push(item);
        await db.execute('UPDATE proxy_mutation_queue SET attempts = $1 WHERE id = $2', [item.attempts, item.id]);
        console.warn(`[ProxyQueue] Retry pending for ${item.action} ${item.id}`, (error as Error).name);
      }
    }

    const newlyQueued = ProxyQueue.queue.filter((item) => !items.has(item.id));
    ProxyQueue.queue = [...remaining, ...newlyQueued];
    return { processed, remaining: remaining.length };
  }

  public static startAutoDrain(intervalMs = 30000): void {
    if (ProxyQueue.autoDrainTimer) return;

    ProxyQueue.autoDrainTimer = setInterval(async () => {
      try {
        const { NpmEdgeProvider } = await import('./npm-provider.js');
        const provider = await NpmEdgeProvider.getDefault();
        const check = await provider.verifyConnection();
        if (check.ok) {
          const res = await ProxyQueue.drain(provider);
          if (res.processed > 0) {
            console.log(`[ProxyQueue] Auto-drained ${res.processed} pending proxy mutation(s).`);
          }
        }
      } catch {}
    }, intervalMs);

    if (ProxyQueue.autoDrainTimer.unref) {
      ProxyQueue.autoDrainTimer.unref();
    }
  }

  public static stopAutoDrain(): void {
    if (ProxyQueue.autoDrainTimer) {
      clearInterval(ProxyQueue.autoDrainTimer);
      ProxyQueue.autoDrainTimer = null;
    }
  }
}
