#!/usr/bin/env bash
# ==============================================================================
# NexPanel — Support Bundle Generator
# Generates sanitized diagnostic bundle for troubleshooting.
# No secrets, no passwords, no vault keys included (NFR-SEC-01).
# ==============================================================================

set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
INSTALL_DIR="${INSTALL_DIR:-/opt/nexpanel}"
BUNDLE_DIR="/tmp/nexpanel-support-$(date +%Y%m%d_%H%M%S)"
OUTPUT_FILE="/tmp/nexpanel-support-bundle-$(date +%Y%m%d_%H%M%S).tar.gz"

mkdir -p "${BUNDLE_DIR}"

echo "Generating NexPanel support bundle..."

# 1. Host and System Information
cat > "${BUNDLE_DIR}/system-info.txt" << EOF
Hostname: $(hostname)
Date: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
OS: $(uname -a)
Uptime: $(uptime)
Memory:
$(free -m || true)
Disk:
$(df -h / || true)
EOF

# 2. Docker Status
if command -v docker >/dev/null 2>&1; then
  docker version > "${BUNDLE_DIR}/docker-version.txt" 2>&1 || true
  docker ps -a > "${BUNDLE_DIR}/docker-containers.txt" 2>&1 || true
  docker network inspect proxy > "${BUNDLE_DIR}/docker-network-proxy.json" 2>&1 || true
fi

# 3. Sanitized Environment Configuration (Masking all secrets)
if [[ -f "${INSTALL_DIR}/.env" ]]; then
  sed -E 's/(PASSWORD|SECRET|KEY|TOKEN)=.*/\1=••••••••/g' "${INSTALL_DIR}/.env" > "${BUNDLE_DIR}/env-sanitized.txt"
fi

# 4. Recent Logs (Last 500 lines, sanitized)
if command -v docker >/dev/null 2>&1; then
  docker logs --tail 500 nexpanel-web 2>&1 | sed -E 's/([Pp]assword|[Tt]oken|[Ss]ecret): "[^"]+"/\1: "••••••••"/g' > "${BUNDLE_DIR}/nexpanel-web.log" || true
  docker logs --tail 500 nexpanel-worker 2>&1 | sed -E 's/([Pp]assword|[Tt]oken|[Ss]ecret): "[^"]+"/\1: "••••••••"/g' > "${BUNDLE_DIR}/nexpanel-worker.log" || true
  docker logs --tail 200 npm 2>&1 > "${BUNDLE_DIR}/npm.log" || true
fi

# 5. Pack into tar.gz
tar -czf "${OUTPUT_FILE}" -C "/tmp" "$(basename "${BUNDLE_DIR}")"
rm -rf "${BUNDLE_DIR}"

echo "Support bundle created: ${OUTPUT_FILE}"
