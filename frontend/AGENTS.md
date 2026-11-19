# Frontend Development Guidelines (`@nexpanel/frontend`)

## Architecture & Technology
- **Framework**: React 19 + TypeScript.
- **Build Tool**: Vite 6.
- **Styling**: Tailwind CSS 3.4 + PostCSS + Autoprefixer.
- **Icons**: Lucide React (`lucide-react`).
- **Specification Source**: Fully documented in [docs/07-UX-UI.md](file:///D:/Projects/#dev.support/cloudpanellite/docs/07-UX-UI.md).

## Key UI Screens & Workflows (per docs/07-UX-UI.md)
1. **First-Run Wizard**: Setup first administrator, generate recovery codes, set timezone.
2. **Dashboard Overview**: System health, active sites count, database engines status, edge proxy status.
3. **Sites Manager**:
   - Site list with search, filter by PHP version and type (WordPress, PHP, Node.js, Static, Python).
   - Site creation wizard (domain, PHP version, DB binding, edge proxy route).
   - Vhost configuration editor with `nginx -t` validation gate.
   - File manager with breadcrumbs and path traversal defense.
4. **Database Engines & Databases**:
   - Engine selector: `internal-docker` vs `external-docker` vs `external-remote`.
   - Database and user provisioning.
   - 1-click SSO access to phpMyAdmin / Adminer without exposing passwords in query params.
5. **Edge / NPM Status**:
   - Proxy host synchronization overview.
   - Drift detection badge and 1-click "Reconcile Drift" button.
6. **CloudPanel Import Wizard**:
   - File upload (`backup.tar` or `.tar.gz` pair) or SSH credentials.
   - Step 1: Tar inspection & metadata extraction.
   - Step 2: Dry-run simulation diff table.
   - Step 3: Execution with live streaming logs and 1-click rollback option.

## Code Standards
- Keep components modular and accessible.
- Use Lucide icons consistently.
- Ensure all API communications handle network errors gracefully and show user-friendly notifications.
