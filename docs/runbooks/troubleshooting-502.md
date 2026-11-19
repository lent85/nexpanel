# Runbook: Troubleshooting 502 Bad Gateway

A `502 Bad Gateway` error means the edge proxy (Nginx Proxy Manager) received a connection request for a domain, but could not connect to or receive a response from the origin site container.

## 1. Quick Checklist

| Step | Action | Command |
|---|---|---|
| **1. Is origin container running?** | Check docker status for `nexpanel-site-<slug>` | `docker ps -a \| grep <slug>` |
| **2. Is container on network `proxy`?** | Check if origin is connected to `proxy` network | `docker network inspect proxy` |
| **3. Is forward_host misconfigured?** | NPM forward_host must NOT be `localhost` or `127.0.0.1` | Check NPM proxy host details |
| **4. Is PHP-FPM / Origin crashed?** | Inspect origin logs for crash or fatal errors | `docker logs nexpanel-site-<slug>` |

## 2. Hard Rule R1: Never Use `localhost` / `127.0.0.1`

In Docker networking, `127.0.0.1` or `localhost` from within the NPM container resolves to **NPM itself**. NPM connecting to port 8080 on itself will fail with connection refused and emit a 502 Bad Gateway.

- **Bad:** `forward_host = 127.0.0.1` or `localhost`
- **Good:** `forward_host = nexpanel-site-<slug>` (container name on external network `proxy`)

## 3. Step-by-Step Diagnostic

### Step A: Check Origin Container
```bash
docker inspect --format '{{.State.Status}}' nexpanel-site-<slug>
```
If status is `exited`, check logs:
```bash
docker logs --tail 100 nexpanel-site-<slug>
```
Restart container if needed:
```bash
docker restart nexpanel-site-<slug>
```

### Step B: Check Network Connectivity
Test connection from inside the NPM container to the origin:
```bash
docker exec -it npm curl -sv http://nexpanel-site-<slug>:8080/
```
If connection times out, ensure the origin container is joined to the `proxy` network:
```bash
docker network connect proxy nexpanel-site-<slug>
```

### Step C: Check Nginx Origin Syntax
If origin failed to reload due to vhost syntax errors:
```bash
docker exec nexpanel-site-<slug> nginx -t
```
Restore the default vhost template via CLI if necessary:
```bash
nxctl site:list
```
