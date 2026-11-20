import { EdgeProvider, ProxyHostInput } from './types.js';
import { getDb } from '../db/index.js';

export interface QueuedProxyAction {
  id: string;
  action: 'create' | 'update' | 'delete' | 'enable' | 'disable';
  edgeHostId?: number;
  payload?: Partial<ProxyHostInput>;
  attempts: number;
  createdAt: string;
}

export class ProxyQueue {
  private static queue: QueuedProxyAction[] = [];
  private static autoDrainTimer: NodeJS.Timeout | null = null;

  public static enqueue(action: Omit<QueuedProxyAction, 'id' | 'attempts' | 'createdAt'>): QueuedProxyAction {
    const item: QueuedProxyAction = {
      id: Math.random().toString(36).substring(2),
      ...action,
      attempts: 0,
      createdAt: new Date().toISOString()
    };
    ProxyQueue.queue.push(item);

    // Asynchronously persist to database (non-blocking)
    try {
      const db = getDb();
      db.execute(
        `INSERT INTO proxy_mutation_queue (id, action, edge_host_id, payload, attempts, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          item.id,
          item.action,
          item.edgeHostId || null,
          item.payload ? JSON.stringify(item.payload) : null,
          item.attempts,
          item.createdAt
        ]
      ).catch(() => {});
    } catch {}

    return item;
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

  public static async drain(provider: EdgeProvider): Promise<{ processed: number; remaining: number }> {
    const check = await provider.verifyConnection();
    if (!check.ok) {
      return { processed: 0, remaining: ProxyQueue.queue.length };
    }

    // Load any persisted items from DB if queue is empty
    if (ProxyQueue.queue.length === 0) {
      try {
        const db = getDb();
        const res = await db.query('SELECT * FROM proxy_mutation_queue ORDER BY created_at ASC');
        for (const row of res.rows as any[]) {
          ProxyQueue.queue.push({
            id: row.id,
            action: row.action,
            edgeHostId: row.edge_host_id,
            payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            attempts: row.attempts || 0,
            createdAt: row.created_at || new Date().toISOString()
          });
        }
      } catch {}
    }

    let processed = 0;
    const remaining: QueuedProxyAction[] = [];

    for (const item of ProxyQueue.queue) {
      try {
        if (item.action === 'create' && item.payload) {
          const res = await provider.createHost(item.payload as ProxyHostInput);
          if (res?.edgeId) {
            try {
              const db = getDb();
              const domains = (item.payload as any).domainNames || [];
              const primaryDomain = domains[0];
              if (primaryDomain) {
                await db.execute(
                  `UPDATE proxy_hosts SET edge_host_id = $1, drift_status = 'in_sync', updated_at = $2 WHERE domain_names LIKE $3 OR forward_host = $4`,
                  [res.edgeId, new Date().toISOString(), `%${primaryDomain}%`, (item.payload as any).forwardHost]
                );
              }
            } catch {}
          }
        } else if (item.action === 'update' && item.edgeHostId && item.payload) {
          await provider.updateHost(item.edgeHostId, item.payload);
        } else if (item.action === 'delete' && item.edgeHostId) {
          await provider.deleteHost(item.edgeHostId);
        } else if (item.action === 'enable' && item.edgeHostId) {
          await provider.setHostEnabled(item.edgeHostId, true);
        } else if (item.action === 'disable' && item.edgeHostId) {
          await provider.setHostEnabled(item.edgeHostId, false);
        }

        processed++;

        // Clean up from persistent table
        try {
          const db = getDb();
          db.execute('DELETE FROM proxy_mutation_queue WHERE id = $1', [item.id]).catch(() => {});
        } catch {}
      } catch (err: any) {
        item.attempts++;
        if (item.attempts < 5) {
          remaining.push(item);
        } else {
          // Exceeded max attempts: mark drift status and log audit
          try {
            const db = getDb();
            db.execute('DELETE FROM proxy_mutation_queue WHERE id = $1', [item.id]).catch(() => {});
            if (item.edgeHostId) {
              db.execute(`UPDATE proxy_hosts SET drift_status = 'drift_detected' WHERE edge_host_id = $1`, [
                item.edgeHostId
              ]).catch(() => {});
            }
          } catch {}
        }
      }
    }

    ProxyQueue.queue = remaining;
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
