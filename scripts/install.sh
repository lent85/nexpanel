#!/usr/bin/env bash
# ==============================================================================
# NexPanel — Automated Production Installer
# https://github.com/nexpanel/nexpanel
# License: Apache-2.0
# Reference: docs/08-DEPLOYMENT-OPERATIONS.md §8.2
# ==============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

INSTALL_DIR="${INSTALL_DIR:-/opt/nexpanel}"
DATA_DIR="${DATA_DIR:-/data}"
NETWORK_NAME="proxy"
DEFAULT_PHP="8.3"
DEFAULT_MYSQL_VERSION="8.4"
MIN_RAM_KB=2000000 # ~2 GB

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

banner() {
  cat << "EOF"
  _   _           ____                  _ 
 | \ | | _____  _|  _ \ __ _ _ __   ___| |
 |  \| |/ _ \ \/ / |_) / _` | '_ \ / _ \ |
 | |\  |  __/>  <|  __/ (_| | | | |  __/ |
 |_| \_|\___/_/\_\_|   \__,_|_| |_|\___|_|
   Docker-native Server Control Panel (v1.0.0)
EOF
  echo
}

check_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    log_err "Installer must be run as root or via sudo."
    exit 1
  fi
}

check_os() {
  log_info "Checking operating system..."
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VERSION="${VERSION_ID:-unknown}"
    log_info "Detected OS: ${PRETTY_NAME:-$OS_ID $OS_VERSION}"
  else
    log_warn "Unknown operating system. Proceeding with generic Linux assumptions."
  fi
}

check_resources() {
  log_info "Checking system resources..."
  # Check CPU cores
  CPUS=$(nproc || echo 1)
  log_info "CPU cores: ${CPUS}"

  # Check RAM
  if [[ -f /proc/meminfo ]]; then
    TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
    if [[ "$TOTAL_MEM_KB" -lt "$MIN_RAM_KB" ]]; then
      log_warn "Host RAM is ${TOTAL_MEM_MB} MB. Minimum recommended is 2048 MB (2 GB). Panel may experience memory pressure under load."
    else
      log_success "RAM: ${TOTAL_MEM_MB} MB (Meets 2 GB minimum requirement)."
    fi
  fi

  # Check Disk Free Space
  DISK_FREE_KB=$(df -k / | awk 'NR==2 {print $4}')
  DISK_FREE_GB=$((DISK_FREE_KB / 1024 / 1024))
  if [[ "$DISK_FREE_GB" -lt 5 ]]; then
    log_warn "Free disk space is only ${DISK_FREE_GB} GB. Recommended is at least 10 GB."
  else
    log_success "Available disk space: ${DISK_FREE_GB} GB."
  fi
}

check_ports() {
  log_info "Checking network ports (80, 443, 8443)..."
  
  check_port() {
    local port=$1
    if command -v ss >/dev/null 2>&1; then
      ss -tuln | grep -q ":${port} " && return 0 || return 1
    elif command -v netstat >/dev/null 2>&1; then
      netstat -tuln | grep -q ":${port} " && return 0 || return 1
    fi
    return 1
  }

  local conflict=0
  if check_port 80; then
    log_warn "Port 80 is currently in use. If an existing NPM container is running, NexPanel will connect to it (Shape C). If another service (like Apache or host Nginx) owns port 80, it must be stopped."
  fi

  if check_port 443; then
    log_warn "Port 443 is currently in use. If an existing NPM container is running, this is expected."
  fi
}

check_docker() {
  log_info "Verifying Docker and Docker Compose..."
  if ! command -v docker >/dev/null 2>&1; then
    log_info "Docker not found. Installing Docker CE via official script..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log_err "Docker Compose v2 is required but not installed."
    exit 1
  fi

  DOCKER_VER=$(docker --version | awk '{print $3}' | sed 's/,//')
  COMPOSE_VER=$(docker compose version | awk '{print $4}')
  log_success "Docker Engine: ${DOCKER_VER}, Docker Compose: ${COMPOSE_VER}"
}

generate_random_secret() {
  local len="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$((len / 2))"
  else
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$len" || echo "NexPanelDefaultRandomSecret2026!"
  fi
}

setup_directories() {
  log_info "Creating NexPanel directory structure..."
  mkdir -p "${INSTALL_DIR}"
  mkdir -p "${DATA_DIR}/panel"
  mkdir -p "${DATA_DIR}/sites"
  mkdir -p "${DATA_DIR}/npm/data"
  mkdir -p "${DATA_DIR}/npm/letsencrypt"
  mkdir -p "${DATA_DIR}/backups"

  # Restrict panel data directory permissions
  chmod 700 "${DATA_DIR}/panel"
}

setup_network() {
  log_info "Verifying external Docker network '${NETWORK_NAME}' (Rule R1)..."
  if ! docker network ls --format '{{.Name}}' | grep -wq "${NETWORK_NAME}"; then
    docker network create "${NETWORK_NAME}"
    log_success "Created external Docker network '${NETWORK_NAME}'."
  else
    log_success "External Docker network '${NETWORK_NAME}' already exists."
  fi
}

setup_environment_and_vault() {
  local env_file="${INSTALL_DIR}/.env"
  local vault_key_file="${DATA_DIR}/panel/vault.key"

  # 1. Generate AES-256-GCM Vault Key (32 bytes) if not present
  if [[ ! -f "${vault_key_file}" ]]; then
    log_info "Generating 32-byte AES-256-GCM secrets vault key..."
    if command -v openssl >/dev/null 2>&1; then
      openssl rand 32 > "${vault_key_file}"
    else
      head -c 32 /dev/urandom > "${vault_key_file}"
    fi
    chmod 600 "${vault_key_file}"
    log_success "Secrets vault key created at ${vault_key_file} (mode 0600)."
  fi

  # 2. Generate .env file if not present
  if [[ ! -f "${env_file}" ]]; then
    log_info "Generating environment configuration (.env)..."
    local db_password
    local mysql_root_password
    local npm_password
    local jwt_secret

    db_password=$(generate_random_secret 32)
    mysql_root_password=$(generate_random_secret 32)
    npm_password=$(generate_random_secret 32)
    jwt_secret=$(generate_random_secret 64)

    cat > "${env_file}" << EOF
# NexPanel Environment Configuration
# Generated on $(date -u +"%Y-%m-%dT%H:%M:%SZ")

PANEL_DOMAIN=panel.example.com
PANEL_BASE_URL=https://panel.example.com
PANEL_PORT=8443
PANEL_TIMEZONE=Asia/Bangkok
PANEL_DEFAULT_PHP=${DEFAULT_PHP}
PANEL_DEFAULT_DB_ENGINE=internal-mysql
VAULT_KEY_PATH=${vault_key_file}
JWT_SECRET=${jwt_secret}

# Panel Metadata Database (PostgreSQL 16)
PANEL_DB_NAME=nexpanel
PANEL_DB_USER=nexpanel
PANEL_DB_PASSWORD=${db_password}
PANEL_DB_HOST=nexpanel-db
PANEL_DB_PORT=5432

# Internal MySQL 8.4 Engine (Toggleable)
INTERNAL_MYSQL_ROOT_PASSWORD=${mysql_root_password}
INTERNAL_MYSQL_IMAGE=mysql:${DEFAULT_MYSQL_VERSION}

# External Nginx Proxy Manager (R1)
NPM_BASE_URL=http://npm:81
NPM_ADMIN_EMAIL=admin@example.com
NPM_ADMIN_PASSWORD=${npm_password}
NPM_NETWORK=${NETWORK_NAME}

# Site & Data Paths
PANEL_DATA_DIR=${DATA_DIR}/panel
SITES_DATA_DIR=${DATA_DIR}/sites
EOF

    chmod 600 "${env_file}"
    log_success "Environment file written to ${env_file} (mode 0600)."
  else
    log_info "Existing .env found at ${env_file}; retaining configuration."
  fi
}

setup_compose_file() {
  local compose_file="${INSTALL_DIR}/docker-compose.yml"
  if [[ ! -f "${compose_file}" ]]; then
    log_info "Writing production docker-compose.yml..."
    cat > "${compose_file}" << "EOF"
services:
  npm:
    image: jc21/nginx-proxy-manager:2.16.0
    container_name: npm
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "127.0.0.1:81:81"
    volumes:
      - /data/npm/data:/data
      - /data/npm/letsencrypt:/etc/letsencrypt
    networks:
      - proxy

  nexpanel-db:
    image: postgres:16-alpine
    container_name: nexpanel-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${PANEL_DB_NAME:-nexpanel}
      POSTGRES_USER: ${PANEL_DB_USER:-nexpanel}
      POSTGRES_PASSWORD: ${PANEL_DB_PASSWORD}
    volumes:
      - nexpanel-db-data:/var/lib/postgresql/data
    networks:
      - panel

  nexpanel-mysql:
    image: mysql:8.4
    container_name: nexpanel-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${INTERNAL_MYSQL_ROOT_PASSWORD}
    volumes:
      - nexpanel-mysql-data:/var/lib/mysql
    networks:
      - sites

  nexpanel-web:
    image: nexpanel/web:1.0.0
    container_name: nexpanel-web
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - /data/panel:/data/panel
      - /data/sites:/data/sites
    networks:
      - proxy
      - panel
      - sites
    depends_on:
      - nexpanel-db

  nexpanel-worker:
    image: nexpanel/worker:1.0.0
    container_name: nexpanel-worker
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - /data/panel:/data/panel
      - /data/sites:/data/sites
    networks:
      - proxy
      - panel
      - sites
    depends_on:
      - nexpanel-db

networks:
  proxy:
    name: proxy
    external: true
  panel:
    name: nexpanel-panel
  sites:
    name: nexpanel-sites

volumes:
  nexpanel-db-data:
  nexpanel-mysql-data:
EOF
    log_success "docker-compose.yml created at ${compose_file}."
  fi
}

install_cli_symlink() {
  log_info "Installing nxctl CLI symlink..."
  local cli_src="${INSTALL_DIR}/cli/dist/bin/nxctl.js"
  if [[ -f "${cli_src}" ]] && [[ ! -L /usr/local/bin/nxctl ]]; then
    chmod +x "${cli_src}"
    ln -sf "${cli_src}" /usr/local/bin/nxctl
    log_success "CLI linked: 'nxctl' is available system-wide."
  fi
}

print_summary() {
  local host_ip
  host_ip=$(hostname -I | awk '{print $1}' || echo "YOUR_SERVER_IP")

  echo
  echo -e "${GREEN}${BOLD}================================================================${NC}"
  echo -e "${GREEN}${BOLD}              NexPanel Installation Complete!                   ${NC}"
  echo -e "${GREEN}${BOLD}================================================================${NC}"
  echo
  echo -e "  ${BOLD}Web UI:${NC}            https://${host_ip}:8443 (via SSH tunnel or direct)"
  echo -e "  ${BOLD}One-Time Setup:${NC}    http://${host_ip}:8443/setup (Active for 15 minutes)"
  echo -e "  ${BOLD}NPM Proxy Manager:${NC} http://127.0.0.1:81 (Ports 80/443 owned by NPM)"
  echo -e "  ${BOLD}Install Directory:${NC} ${INSTALL_DIR}"
  echo -e "  ${BOLD}Data Directory:${NC}    ${DATA_DIR}"
  echo -e "  ${BOLD}Secrets Vault:${NC}     ${DATA_DIR}/panel/vault.key (0600)"
  echo
  echo -e "${YELLOW}${BOLD}Security Notice:${NC}"
  echo -e "  1. Complete first-admin setup in your browser within 15 minutes."
  echo -e "  2. Keep a secure offline backup of ${DATA_DIR}/panel/vault.key."
  echo -e "  3. Use 'nxctl --help' to manage sites, databases, and imports from CLI."
  echo -e "${GREEN}${BOLD}================================================================${NC}"
  echo
}

start_services() {
  log "Starting NexPanel stack with Docker Compose..."
  cd "${INSTALL_DIR}"
  if docker compose version >/dev/null 2>&1; then
    docker compose up -d
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose up -d
  else
    warn "Neither 'docker compose' nor 'docker-compose' found. Please run 'docker compose up -d' manually in ${INSTALL_DIR}."
    return 0
  fi

  log "Waiting for NexPanel services to be healthy..."
  local attempts=0
  local max_attempts=30
  local healthy=false

  while [ $attempts -lt $max_attempts ]; do
    if curl -skf "http://127.0.0.1:8443/health/live" >/dev/null 2>&1 || curl -skf "http://127.0.0.1:3000/health/live" >/dev/null 2>&1; then
      healthy=true
      break
    fi
    attempts=$((attempts + 1))
    sleep 2
  done

  if [ "$healthy" = true ]; then
    success "NexPanel stack is running and healthy."
  else
    warn "NexPanel container is starting in background. Check 'docker compose ps' in ${INSTALL_DIR}."
  fi
}

main() {
  banner
  check_root
  check_os
  check_resources
  check_ports
  check_docker
  setup_directories
  setup_network
  setup_environment_and_vault
  setup_compose_file
  start_services
  install_cli_symlink
  print_summary
}

main "$@"
