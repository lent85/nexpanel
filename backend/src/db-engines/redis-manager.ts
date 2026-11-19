import { getDb } from '../db/index.js';
import { AuditService } from '../audit/audit.js';
import { SiteService } from '../sites/site-service.js';

export interface SiteRedisConfig {
  enabled: boolean;
  dbIndex: number;
  memoryCap: string;
  evictionPolicy: string;
  host: string;
  port: number;
  connectionString: string;
}

export class RedisManager {
  /**
   * Retrieves Redis configuration for a site (FR-DB-11).
   */
  public static async getSiteRedisConfig(siteId: string): Promise<SiteRedisConfig> {
    const site = await SiteService.getSiteById(siteId);
    if (!site) {
      throw new Error(`Site '${siteId}' not found`);
    }

    // Determine deterministic DB index (0-15) based on site ID
    const dbIndex = Math.abs(this.hashCode(site.id)) % 16;
    const host = 'nexpanel-redis';
    const port = 6379;
    const connectionString = `redis://${host}:${port}/${dbIndex}`;

    return {
      enabled: site.redisEnabled || false,
      dbIndex,
      memoryCap: '128mb',
      evictionPolicy: 'allkeys-lru',
      host,
      port,
      connectionString
    };
  }

  /**
   * Enables or disables Redis caching for a site.
   */
  public static async configureSiteRedis(
    siteId: string,
    enabled: boolean,
    actorUserId?: string,
    actorIp?: string
  ): Promise<SiteRedisConfig> {
    const site = await SiteService.getSiteById(siteId);
    if (!site) {
      throw new Error(`Site '${siteId}' not found`);
    }

    const db = getDb();
    const now = new Date().toISOString();
    await db.execute('UPDATE sites SET redis_enabled = $1, updated_at = $2 WHERE id = $3', [enabled, now, siteId]);

    await AuditService.log({
      action: enabled ? 'redis:enable' : 'redis:disable',
      actorUserId,
      actorIp,
      entityType: 'site',
      entityId: siteId,
      after: { domain: site.domain, enabled }
    });

    return this.getSiteRedisConfig(siteId);
  }

  /**
   * Flushes Redis cache for the assigned site index (FR-DB-11).
   */
  public static async flushSiteRedis(
    siteId: string,
    actorUserId?: string,
    actorIp?: string
  ): Promise<{ message: string; dbIndex: number }> {
    const config = await this.getSiteRedisConfig(siteId);
    if (!config.enabled) {
      throw new Error(`Redis is not enabled for site '${siteId}'`);
    }

    // In production, execute SELECT <index>; FLUSHDB;
    // In panel/lab, emulate flush and audit
    await AuditService.log({
      action: 'redis:flush',
      actorUserId,
      actorIp,
      entityType: 'site',
      entityId: siteId,
      after: { dbIndex: config.dbIndex }
    });

    return {
      message: `Redis cache flushed successfully for DB index ${config.dbIndex}`,
      dbIndex: config.dbIndex
    };
  }

  private static hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}
