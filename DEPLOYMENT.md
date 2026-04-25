# Content Hub SaaS Deployment Notes

## Target
- Domain: `contenthub.missioncontroldb.online`
- VPS stack style: Docker + Caddy + Postgres
- Recommended VPS app path: `~/apps/content-hub-saas`

## Deploy steps
1. Copy repo to VPS under `~/apps/content-hub-saas`
2. Copy `.env.example` to `.env` and fill secrets
3. Update `docker-compose.yml` Postgres password to match `.env`
4. Start containers:
   ```bash
   docker compose up -d --build
   ```
5. Confirm app responds on port 3001 locally on the VPS
6. Add Caddy site route for `contenthub.missioncontroldb.online` proxying to `localhost:3001`
7. Reload Caddy
8. Visit `/login` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
9. Create the first workspace and first job to confirm DB writes are working

## Suggested Caddy block
```caddy
contenthub.missioncontroldb.online {
    encode gzip
    reverse_proxy 127.0.0.1:3001
}
```

## Notes
- Keep this app separate from Mission Control
- Use a separate Postgres DB/container unless you intentionally consolidate later
- First hosted version should focus on auth, workspaces, jobs, kanban, and reports shell before advanced desktop-specific features
