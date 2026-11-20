#!/bin/sh
set -e

# ==============================================================================
# NexPanel Container Entrypoint
# Handles database readiness checks and runs the application service.
# ==============================================================================

# Wait for PostgreSQL database if remote/container DB is configured
if [ -n "$PANEL_DB_HOST" ] && [ "$PANEL_DB_HOST" != "localhost" ] && [ "$PANEL_DB_USE_MEMORY" != "true" ]; then
  echo "[nexpanel] Checking database availability at ${PANEL_DB_HOST}:${PANEL_DB_PORT:-5432}..."
  timeout=30
  while ! nc -z "$PANEL_DB_HOST" "${PANEL_DB_PORT:-5432}" 2>/dev/null; do
    timeout=$((timeout - 1))
    if [ "$timeout" -le 0 ]; then
      echo "[nexpanel] Database check timed out after 30s. Proceeding with startup..."
      break
    fi
    sleep 1
  done
  echo "[nexpanel] Database connection ready."
fi

exec "$@"
