# Directus Fork — Development & Deployment Guide

## Part 1: Local Development (Onboarding)

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22 | `nvm install 22` |
| pnpm | ≥10 <11 | `npm install -g pnpm@10.27.0` |
| Git | any | [git-scm.com](https://git-scm.com) |

### Step 1 — Clone & Switch Node Version

```bash
git clone https://github.com/SadmanYasar/directus.git
cd directus
nvm use 22   # or nvm install 22 if not installed
```

### Step 2 — Install Dependencies

```bash
pnpm install
```

> [!TIP]
> If you hit `ECONNRESET` errors, just re-run `pnpm install` — each attempt caches more packages and it will eventually complete.

### Step 3 — Create Environment File

Create `api/.env`:

```env
LOG_LEVEL=info
LOG_STYLE=pretty

DB_CLIENT=sqlite3
DB_FILENAME=./database/database.sqlite

SECRET=dev-secret-change-in-production
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=d1r3ctu5

HOST=0.0.0.0
PORT=8055

STORAGE_LOCATIONS=local
STORAGE_LOCAL_DRIVER=local
STORAGE_LOCAL_ROOT=./uploads
```

### Step 4 — Build All Packages

```bash
pnpm build
```

This builds all 35+ workspace packages (types, utils, SDK, Vue app, API, etc.). Takes a few minutes on first run.

### Step 5 — Bootstrap the Database

```bash
mkdir -p api/database api/uploads
cd api && pnpm cli bootstrap
```

This runs all migrations and creates the admin user from the `.env` credentials.

### Step 6 — Start Development Server

```bash
cd api && pnpm dev
```

| Detail | Value |
|--------|-------|
| **API URL** | http://localhost:8055 |
| **Admin login** | `admin@example.com` / `d1r3ctu5` |
| **Hot reload** | `tsx watch` — auto-restarts on file changes in `api/src/` |

### Daily Workflow

```bash
nvm use 22          # each new terminal session
cd api && pnpm dev  # start dev server
```

Edit files in `api/src/` → server auto-restarts on save.

> [!NOTE]
> The `docker-compose.yml` at the repo root is **only for spinning up test databases** (Postgres, MySQL, Redis, etc.). Directus itself runs locally via `pnpm dev`.

---

## Part 2: Deployment to VPS via GitHub Packages

### Overview

```
Push to main → GitHub Actions builds Docker image → Pushes to ghcr.io → VPS pulls & runs
```

### Step 1 — Create the GitHub Actions Workflow

Create `.github/workflows/build-and-push.yml` (already created in this repo):

```yaml
# See .github/workflows/build-and-push.yml
```

This workflow:
- Triggers on pushes to `main` branch
- Builds the production Docker image using the existing `Dockerfile`
- Pushes to `ghcr.io/sadmanyasar/directus:latest`

### Step 2 — Enable GitHub Packages

1. Go to your repo → **Settings** → **Actions** → **General**
2. Under **Workflow permissions**, select **Read and write permissions**
3. Click **Save**

No additional secrets are needed — `GITHUB_TOKEN` is provided automatically.

### Step 3 — Push to Trigger Build

```bash
git add .
git commit -m "Add CI/CD workflow"
git push origin main
```

The workflow will build and push the image. Monitor at: `https://github.com/SadmanYasar/directus/actions`

### Step 4 — VPS Setup

#### 4a. Install Docker on VPS

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in
```

#### 4b. Authenticate with GitHub Packages

Generate a **Personal Access Token (classic)** with `read:packages` scope at:
`https://github.com/settings/tokens`

```bash
echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

#### 4c. Create Production Environment File

Create `~/directus/.env` on the VPS:

```env
DB_CLIENT=sqlite3
DB_FILENAME=/directus/database/database.sqlite

SECRET=<generate-a-long-random-string-here>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_TTL=7d

ADMIN_EMAIL=admin@your-domain.com
ADMIN_PASSWORD=<strong-password>

STORAGE_LOCATIONS=local
STORAGE_LOCAL_DRIVER=local
STORAGE_LOCAL_ROOT=/directus/uploads
```

> [!CAUTION]
> Use a strong `SECRET` (32+ characters). Generate one with: `openssl rand -hex 32`

#### 4d. Create Production Docker Compose

Create `~/directus/docker-compose.yml` on the VPS:

```yaml
services:
  directus:
    image: ghcr.io/sadmanyasar/directus:latest
    restart: unless-stopped
    ports:
      - "8055:8055"
    env_file:
      - .env
    volumes:
      - ./database:/directus/database
      - ./uploads:/directus/uploads
      - ./extensions:/directus/extensions
```

#### 4e. Start Directus

```bash
cd ~/directus
mkdir -p database uploads extensions
docker compose up -d
```

### Step 5 — Updating the Deployment

After pushing changes to `main`:

```bash
# On VPS
cd ~/directus
docker compose pull
docker compose up -d
```

Or automate with a simple deploy script `~/directus/deploy.sh`:

```bash
#!/bin/bash
cd ~/directus
docker compose pull
docker compose up -d --remove-orphans
docker image prune -f
```

### Step 6 — (Optional) Reverse Proxy with Nginx

```nginx
server {
    listen 80;
    server_name directus.your-domain.com;

    location / {
        proxy_pass http://localhost:8055;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then add SSL with: `sudo certbot --nginx -d directus.your-domain.com`

---

## Quick Reference

| Action | Command |
|--------|---------|
| Start dev server | `cd api && pnpm dev` |
| Run tests | `pnpm test` |
| Build everything | `pnpm build` |
| Lint | `pnpm lint` |
| Format check | `pnpm format` |
| Deploy (VPS) | `docker compose pull && docker compose up -d` |
