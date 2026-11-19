# Runbook: NexPanel Installation

This runbook guides administrators through installing NexPanel on Ubuntu 22.04 / 24.04, Debian 12 / 13, or any Docker-capable Linux server.

## 1. Prerequisites

- **Architecture:** x86_64 or aarch64 (ARM64)
- **Minimum hardware:** 1 vCPU, 2 GB RAM, 10 GB free disk space
- **Ports:** Ports 80 and 443 open for incoming traffic (owned by Nginx Proxy Manager). SSH port 22. Port 8443 is internal.
- **Root access:** Root or sudo privileges on the host.

## 2. Shapes of Deployment

NexPanel supports three installation shapes:
- **Shape A (Standard Fresh Install):** Automatically provisions NPM container, internal MySQL 8.4 engine, panel PostgreSQL metadata DB, web container, and worker container on the external `proxy` network.
- **Shape B (Minimal Edge):** Uses existing host edge or external DNS while panel manages sites on internal networks.
- **Shape C (Bring-Your-Own NPM / DB):** Connects to an already-running NPM (e.g. `jc21/nginx-proxy-manager:2.16.0`) and external database without stopping, touching, or altering them.

## 3. Quick Install (Single Command)

```bash
curl -fsSL https://get.nexpanel.example/install.sh | sudo bash
```

Alternatively, inspect before running:
```bash
curl -fsSL https://get.nexpanel.example/install.sh -o install.sh
less install.sh
sudo bash install.sh
```

## 4. First-Admin Setup Flow

1. Following installation, the panel enters **Setup Mode** (active for 15 minutes).
2. Visit the setup URL: `http://<SERVER_IP>:8443/setup` (or via SSH tunnel `ssh -L 8443:127.0.0.1:8443 user@server`).
3. Create your initial Administrator user:
   - Provide email, username, and a strong password (minimum 12 characters).
   - Configure timezone (e.g. `Asia/Bangkok`).
4. Once completed, the panel setup mode is permanently locked. Future user management is strictly authenticated via RBAC.

## 5. Security Post-Install Checklist

- [ ] Store an offline backup of `/data/panel/vault.key`.
- [ ] Configure the panel domain proxy host in NPM with SSL and an Access List.
- [ ] Enable 2-Factor Authentication (TOTP) under **Admin Area -> Security**.
- [ ] Review host firewall rules: `nxctl firewall:list`.
