# Runbook: Nginx Proxy Manager (NPM) Outage & Recovery

Nginx Proxy Manager owns ports 80 and 443. This runbook explains how NexPanel detects NPM downtime, queues changes, and automatically recovers when NPM is restored.

## 1. What Happens When NPM Goes Down

1. **Edge State Queue (FR-PROXY-07):** If NPM is temporarily down or restarted, NexPanel does NOT fail site operations. All proxy host creations, updates, and certificate requests are stored in the persistent `proxy_mutation_queue` with status `pending`.
2. **Dashboard Indicator:** The Admin Dashboard displays an alert banner: `Edge proxy unreachable. Mutations queued.`
3. **Sites Impact:** Existing running sites continue to serve traffic if NPM's container is still functioning; if the NPM container has stopped, external traffic cannot reach ports 80/443.

## 2. Restoring NPM

### Check NPM Container Status
```bash
docker ps -a --filter "name=npm"
```

### Inspect NPM Error Logs
```bash
docker logs --tail 200 npm
```

### Restart NPM Container
```bash
docker restart npm
```

## 3. Queue Draining & Automatic Reconcile

Once NPM is back online:
1. NexPanel automatically detects NPM connectivity via the background health checker.
2. The mutation queue drains sequentially, replaying all queued proxy host modifications.
3. You can manually force an immediate reconciliation and drift check via CLI:
   ```bash
   nxctl proxy:sync --reconcile
   ```

## 4. Rebuilding NPM From Scratch (Disaster Scenario)

If NPM's SQLite database or volume is corrupted:
1. Remove corrupted NPM data volume:
   ```bash
   rm -rf /data/npm/data/*
   docker restart npm
   ```
2. Log into fresh NPM admin UI at `http://<IP>:81` and configure API token.
3. Run NexPanel 1-click reconciliation:
   ```bash
   nxctl proxy:sync --reconcile
   ```
   NexPanel will read all proxy host records from its PostgreSQL database and re-issue all proxy hosts in NPM.
