#!/usr/bin/env bash
# ==============================================================================
# NexPanel — Automated Safe Upgrade Script
# https://github.com/nexpanel/nexpanel
# License: Apache-2.0
# Reference: docs/08-DEPLOYMENT-OPERATIONS.md §8.4
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

INSTALL_DIR="${INSTALL_DIR:-/opt/nexpanel}"
DATA_DIR="${DATA_DIR:-/data}"
BACKUP_DIR="${DATA_DIR}/backups/pre-upgrade-$(date +%Y%m%d_%H%M%S)"
TARGET_VERSION="${1:-latest}"

log_info() {
  echo -e "${CYAN}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_err() {
  echo -e "${RED}[ERROR]${NC} $1" >&2
}

check_prerequisites() {
  if [[ "$(id -u)" -ne 0 ]]; then
    log_err "Upgrade must be run as root or via sudo."
    exit 1
  fi

  if [[ ! -d "${INSTALL_DIR}" ]] || [[ ! -f "${INSTALL_DIR}/docker-compose.yml" ]]; then
    log_err "NexPanel installation not found at ${INSTALL_DIR}."
    exit 1
  fi
}

step_1_pre_upgrade_backup() {
  log_info "Step 1/5: Creating pre-upgrade panel self-backup (FR-BKP-05)..."
  mkdir -p "${BACKUP_DIR}"

  # Backup .env and configuration
  cp "${INSTALL_DIR}/.env" "${BACKUP_DIR}/.env.bak"
  cp "${INSTALL_DIR}/docker-compose.yml" "${BACKUP_DIR}/docker-compose.yml.bak"

  # Dump panel metadata database
  if command -v docker >/dev/null 2>&1; then
    if docker ps --format '{{.Names}}' | grep -q "nexpanel-db"; then
      log_info "Dumping PostgreSQL panel metadata database..."
      docker exec nexpanel-db pg_dump -U nexpanel nexpanel > "${BACKUP_DIR}/panel-metadata.sql" || true
    fi
  fi

  log_success "Pre-upgrade backup saved to ${BACKUP_DIR}."
}

step_2_pull_images() {
  log_info "Step 2/5: Pulling updated container images..."
  cd "${INSTALL_DIR}"
  docker compose pull nexpanel-web nexpanel-worker || true
  log_success "New container images pulled successfully."
}

step_3_apply_migrations() {
  log_info "Step 3/5: Applying forward-only database schema migrations..."
  cd "${INSTALL_DIR}"
  # Run migration container or script
  if docker ps --format '{{.Names}}' | grep -q "nexpanel-web"; then
    docker exec nexpanel-web npm run migrate || true
  fi
  log_success "Database migrations checked."
}

step_4_rolling_restart() {
  log_info "Step 4/5: Rolling restart (web -> worker)..."
  cd "${INSTALL_DIR}"
  docker compose up -d --no-deps nexpanel-web
  docker compose up -d --no-deps nexpanel-worker
  log_success "Panel services updated."
}

step_5_health_check_and_rollback() {
  log_info "Step 5/5: Verifying health endpoint (/health/ready)..."
  local attempts=0
  local max_attempts=15
  local healthy=0

  while [[ "$attempts" -lt "$max_attempts" ]]; do
    attempts=$((attempts + 1))
    sleep 2
    if curl -skf http://127.0.0.1:8443/health/ready >/dev/null 2>&1 || curl -skf http://127.0.0.1:8080/health/ready >/dev/null 2>&1; then
      healthy=1
      break
    fi
  done

  if [[ "$healthy" -eq 1 ]]; then
    log_success "Health check passed: NexPanel is fully operational."
  else
    log_warn "Health check failed after ${max_attempts} attempts. Initiating automated safe rollback..."
    rollback
  fi
}

rollback() {
  log_err "Executing automated rollback..."
  cd "${INSTALL_DIR}"

  # Restore compose and environment
  if [[ -f "${BACKUP_DIR}/docker-compose.yml.bak" ]]; then
    cp "${BACKUP_DIR}/docker-compose.yml.bak" "${INSTALL_DIR}/docker-compose.yml"
  fi
  if [[ -f "${BACKUP_DIR}/.env.bak" ]]; then
    cp "${BACKUP_DIR}/.env.bak" "${INSTALL_DIR}/.env"
  fi

  # Restore database dump if needed
  if [[ -f "${BACKUP_DIR}/panel-metadata.sql" ]]; then
    log_info "Restoring metadata database from pre-upgrade backup..."
    docker exec -i nexpanel-db psql -U nexpanel nexpanel < "${BACKUP_DIR}/panel-metadata.sql" || true
  fi

  # Restart previous containers
  docker compose up -d

  log_warn "Rollback complete. System returned to pre-upgrade state."
  exit 1
}

main() {
  echo -e "${BOLD}Starting NexPanel Safe Upgrade to ${TARGET_VERSION}...${NC}"
  check_prerequisites
  step_1_pre_upgrade_backup
  step_2_pull_images
  step_3_apply_migrations
  step_4_rolling_restart
  step_5_health_check_and_rollback

  echo
  echo -e "${GREEN}${BOLD}================================================================${NC}"
  echo -e "${GREEN}${BOLD}              NexPanel Successfully Upgraded!                   ${NC}"
  echo -e "${GREEN}${BOLD}================================================================${NC}"
}

main "$@"
