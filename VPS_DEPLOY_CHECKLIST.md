# VPS Deploy Checklist - Content Hub SaaS

## Target
- Domain: `contenthub.missioncontroldb.online`
- Recommended app path: `~/apps/content-hub-saas`

## 1. Copy project to VPS
```bash
mkdir -p ~/apps/content-hub-saas
cd ~/apps/content-hub-saas
```

## 2. Add environment file
Create `.env` from `.env.example` and set:
- DATABASE_URL
- NEXTAUTH_SECRET
- NEXTAUTH_URL
- APP_URL
- ADMIN_EMAIL
- ADMIN_PASSWORD

## 3. Start containers
```bash
docker compose up -d --build
```

## 4. Verify app is reachable on server
```bash
curl http://127.0.0.1:3001
```

## 5. Add Caddy route
Use the contents of `Caddyfile.contenthub` in the active Caddy config.

## 6. Reload Caddy
Example:
```bash
sudo systemctl reload caddy
```

## 7. Test in browser
- open `https://contenthub.missioncontroldb.online/login`
- sign in with ADMIN_EMAIL / ADMIN_PASSWORD
- create a workspace
- create a job
- edit/delete a job
- confirm protected route behavior

## 8. Rollback plan
- stop content hub containers:
```bash
docker compose down
```
- remove the Caddy site block
- reload Caddy
