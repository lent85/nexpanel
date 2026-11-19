import { EdgeProvider, ProxyHostInput } from './types.js';

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

  public static enqueue(action: Omit<QueuedProxyAction, 'id' | 'attempts' | 'createdAt'>): QueuedProxyAction {
    const item: QueuedProxyAction = {
      id: Math.random().toString(36).substring(2),
      ...action,
      attempts: 0,
      createdAt: new Date().toISOString()
    };
    ProxyQueue.queue.push(item);
    return item;
  }

  public static getPending(): QueuedProxyAction[] {
    return [...ProxyQueue.queue];
  }

  public static clear(): void {
    ProxyQueue.queue = [];
  }

  public static async drain(provider: EdgeProvider): Promise<{ processed: number; remaining: number }> {
    const check = await provider.verifyConnection();
    if (!check.ok) {
      return { processed: 0, remaining: ProxyQueue.queue.length };
    }

    let processed = 0;
    const remaining: QueuedProxyAction[] = [];

    for (const item of ProxyQueue.queue) {
      try {
        if (item.action === 'create' && item.payload) {
          await provider.createHost(item.payload as ProxyHostInput);
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
      } catch (err) {
        item.attempts++;
        if (item.attempts < 5) {
          remaining.push(item);
        }
      }
    }

    ProxyQueue.queue = remaining;
    return { processed, remaining: remaining.length };
  }
}
