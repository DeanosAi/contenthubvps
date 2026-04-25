# Local Setup

## 1. Start Postgres locally
```powershell
docker compose up -d postgres
```

## 2. Start the web app
```powershell
npm install
npm run dev
```

## 3. Login
Use the credentials from `.env`:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

## 4. Smoke test
- create a workspace
- create a job
- edit a job
- delete a job
- log out and confirm `/app` redirects back to `/login`
