# ==============================================================================
# NexPanel — Production Multi-Stage Dockerfile (Deployment from Source)
# Builds backend, frontend, and CLI from source code.
# Target runtime: Node.js 22 LTS on Alpine Linux
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build stage
# ------------------------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /build

# Install build dependencies for native compilation if required
RUN apk add --no-cache python3 make g++

# Copy workspace package manifests
COPY package.json ./
COPY tsconfig.base.json ./
COPY brand.json ./

# Copy package manifests for sub-packages
COPY backend/package.json ./backend/
COPY cli/package.json ./cli/
COPY frontend/package.json ./frontend/

# Install all workspace dependencies
RUN npm run install:all

# Copy source trees and configurations
COPY backend/ ./backend/
COPY cli/ ./cli/
COPY frontend/ ./frontend/
COPY config/ ./config/

# Compile TypeScript and build bundles (backend, cli, frontend)
RUN npm run build

# Prune devDependencies for production runtime
RUN cd backend && npm prune --omit=dev && \
    cd ../cli && npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 2: Production runtime stage
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

# Install runtime utilities:
# - docker-cli: for site container lifecycle management (ContainerRunner)
# - curl: for container healthchecks
# - bash, tar, gzip: for CloudPanel backup archives & database imports
# - openssh-client: for remote SSH sync/import operations (Source C)
RUN apk add --no-cache docker-cli curl bash tar gzip openssh-client

WORKDIR /app

# Configure default production environment
ENV NODE_ENV=production \
    PANEL_PORT=8443 \
    PANEL_HOST=0.0.0.0 \
    FRONTEND_DIST_DIR=/app/frontend/dist \
    PANEL_DATA_DIR=/data/panel \
    SITES_DATA_DIR=/data/sites

# Create required persistent storage and runtime directories
RUN mkdir -p /data/panel /data/sites /data/backups

# Copy brand and configuration metadata
COPY brand.json /app/brand.json
COPY config/ /app/config/
COPY brand.json /app/backend/brand.json

# Copy compiled backend application and production node_modules
COPY --from=builder /build/backend/dist /app/backend/dist
COPY --from=builder /build/backend/node_modules /app/backend/node_modules
COPY --from=builder /build/backend/package.json /app/backend/package.json

# Copy compiled CLI & install symlink so nxctl is in system PATH
COPY --from=builder /build/cli/dist /app/cli/dist
COPY --from=builder /build/cli/node_modules /app/cli/node_modules
COPY --from=builder /build/cli/package.json /app/cli/package.json
RUN chmod +x /app/cli/dist/bin/nxctl.js && ln -s /app/cli/dist/bin/nxctl.js /usr/local/bin/nxctl

# Copy compiled React frontend SPA distribution
COPY --from=builder /build/frontend/dist /app/frontend/dist

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose internal panel port (8443)
# Non-negotiable Hard Rule R1: NPM exclusively owns ports 80 and 443;
# NexPanel never binds 80 or 443. Forward hosts use container name (nexpanel-web).
EXPOSE 8443

# Healthcheck probe using internal health endpoint
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:8443/health/ready || exit 1

WORKDIR /app/backend

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
