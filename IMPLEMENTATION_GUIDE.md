# Round 7.11 — Briefer logins (venue accounts) + edit history

The biggest round in this project to date. 43 files. Adds a third
user role (`briefer`) that lets external venue staff log in to
Content Hub, see their workspace's jobs, submit new briefs, and
have a real conversation with the team — without any of the email
infrastructure we workshopped originally.

This round closes the loop on accountability: every brief edit is
captured in an audit log with the editing person's name, role, and
timestamp.

## What's in it

**Schema (additive, safe on existing data):**

- New role value `briefer` accepted in `users.role`
- New optional `users.workspace_id` FK → workspaces (NULL for staff,
  required for briefers)
- New `jobs.briefer_display_name` — the human's name at brief-submit
  time (the venue login is shared, so we capture WHO submitted)
- New `job_comments.display_name` — same, but per comment
- New `job_edits` audit table with full diff history

**Backend (new + modified):**

- New `lib/permissions.ts` — single source of truth for access checks.
  Search the codebase for `assertCan*` to find every enforcement point.
- New `lib/page-guards.ts` — `requireStaffPage()` / `requireBrieferPage()`
  for server components
- All workspace-scoped API endpoints now enforce briefer access:
  jobs (GET/PATCH/DELETE/POST), comments (all 4 routes),
  workspaces (all routes), users, columns, campaigns, snapshots,
  fetch-metrics, reports, comparison reports
- Briefers blocked from staff-only endpoints (reports, settings PUT,
  metrics, snapshots, workspace creation, column management)
- New `POST /api/jobs/brief-submit` — briefer-facing job creation
- New `GET /api/jobs/:id/edits` — audit log read
- New `POST /api/auth/set-display-name` — re-signs session with
  the per-session "who's using this account today" answer

**Frontend (new):**

- `/briefer` route tree:
  - `/briefer` — list of "your briefs"
  - `/briefer/jobs/[id]` — view + edit brief fields, see deliverables,
    use the comments thread
  - `/briefer/submit` — submission form
- `BrieferShell` component — top bar, "Who are you?" prompt that
  blocks all interaction until set, "Switch user" link, logout
- `BrieferJobsList`, `BrieferJobDetail`, `BriefSubmitForm` — the
  three screens
- `BrieferEditHistoryButton` — opens a modal showing the full
  per-field edit timeline. Wired into BOTH the briefer detail
  page AND the staff job-detail-panel

**Frontend (modified):**

- All four staff page files (`/app`, `/calendar`, `/reports`, `/settings`)
  now async server components that redirect briefers to `/briefer`
- Login page handles role-based redirect on success
- Settings → Team UI: admins can now create briefer accounts
  (role dropdown gets a third option; workspace dropdown appears
  when role=briefer is selected)
- Job detail panel shows briefer attribution + edit-history button

## What's NOT in this round

Per our workshop:

- **No email notifications** when briefers/staff comment. That's a
  separate feature we'll do later if useful — but with venue logins
  in place, it becomes optional rather than required. The original
  email-bridge architecture is fully retired.
- **No internal-only comments mode** for staff (deferred to 7.12)
- **No bulk operations**, no @mentions, no real-time updates
- **No notifications inbox** — briefers find new comments by
  visiting the app

## File inventory (43 files)

**Schema/lib (8):**
- `src/lib/postgres.ts` — schema additions
- `src/lib/types.ts` — UserRole union, SessionUser, JobEdit, etc.
- `src/lib/db-mappers.ts` — rowToUser, rowToJob, rowToJobComment, rowToJobEdit
- `src/lib/auth.ts` — session shape + requireStaff
- `src/lib/permissions.ts` (NEW) — access helpers
- `src/lib/page-guards.ts` (NEW) — page-level role redirects
- `src/middleware.ts` — adds /briefer prefix
- `src/app/api/auth/me/route.ts` — return new fields

**Auth API (3):**
- `src/app/api/auth/login/route.ts` — issue session with workspaceId/displayName, return redirectTo
- `src/app/api/auth/me/route.ts` (covered above)
- `src/app/api/auth/set-display-name/route.ts` (NEW) — re-sign session

**Jobs API (5):**
- `src/app/api/jobs/route.ts` — briefer GET filter, block briefer POST
- `src/app/api/jobs/[id]/route.ts` — full permission + edit logging
- `src/app/api/jobs/[id]/edits/route.ts` (NEW) — audit GET
- `src/app/api/jobs/[id]/fetch-metrics/route.ts` — block briefer
- `src/app/api/jobs/[id]/snapshot/route.ts` — block briefer
- `src/app/api/jobs/brief-submit/route.ts` (NEW) — briefer brief creation

**Comments API (2):**
- `src/app/api/jobs/[id]/comments/route.ts` — workspace check + display_name
- `src/app/api/jobs/[id]/comments/[commentId]/route.ts` — same

**Workspaces API (5):**
- `src/app/api/workspaces/route.ts` — briefer GET filter, block POST
- `src/app/api/workspaces/[id]/route.ts` — block briefer
- `src/app/api/workspaces/[id]/columns/route.ts` — briefer GET allowed, block POST
- `src/app/api/workspaces/[id]/columns/[columnId]/route.ts` — block briefer
- `src/app/api/workspaces/[id]/campaigns/route.ts` — workspace check
- `src/app/api/workspaces/reorder/route.ts` — block briefer

**Users API (2):**
- `src/app/api/users/route.ts` — briefer scoping + new role/workspaceId
- `src/app/api/users/[id]/route.ts` — same

**Reports API (2):**
- `src/app/api/reports/route.ts` — block briefer
- `src/app/api/reports/comparison/route.ts` — block briefer

**Page files (8):**
- `src/app/app/page.tsx` — staff guard
- `src/app/calendar/page.tsx` — staff guard
- `src/app/reports/page.tsx` — staff guard
- `src/app/settings/page.tsx` — staff guard
- `src/app/login/page.tsx` — role-based redirect
- `src/app/briefer/page.tsx` (NEW)
- `src/app/briefer/jobs/[id]/page.tsx` (NEW)
- `src/app/briefer/submit/page.tsx` (NEW)

**Components (7):**
- `src/components/settings-shell.tsx` — briefer role + workspace UI
- `src/components/job-detail-panel.tsx` — briefer attribution + edit history
- `src/components/briefer-shell.tsx` (NEW)
- `src/components/briefer-jobs-list.tsx` (NEW)
- `src/components/briefer-job-detail.tsx` (NEW)
- `src/components/briefer-edit-history-button.tsx` (NEW)
- `src/components/brief-submit-form.tsx` (NEW)

## Step-by-step deploy + verify

### Phase A — Apply

1. Replace all 36 modified files at their repo paths.
2. Add the 7 new files at:
   - `src/lib/permissions.ts`
   - `src/lib/page-guards.ts`
   - `src/app/api/auth/set-display-name/route.ts`
   - `src/app/api/jobs/[id]/edits/route.ts`
   - `src/app/api/jobs/brief-submit/route.ts`
   - `src/app/briefer/page.tsx`
   - `src/app/briefer/jobs/[id]/page.tsx`
   - `src/app/briefer/submit/page.tsx`
   - `src/components/briefer-shell.tsx`
   - `src/components/briefer-jobs-list.tsx`
   - `src/components/briefer-job-detail.tsx`
   - `src/components/briefer-edit-history-button.tsx`
   - `src/components/brief-submit-form.tsx`
3. Build:
   ```powershell
   rm -rf .next
   npm run build
   ```
   Should pass cleanly. No new packages required.

### Phase B — Verify schema migration

```bash
ssh deanadmin@<vps-ip>
docker exec -it content-hub-postgres psql -U content_hub -d content_hub
```

In psql:
```sql
\d users
-- Should show new column: workspace_id TEXT (foreign key on workspaces)

\d jobs
-- Should show new column: briefer_display_name TEXT

\d job_comments
-- Should show new column: display_name TEXT

\d job_edits
-- Should show the full table (id, job_id, field_name, old_value,
-- new_value, edited_by_user_id, edited_by_name, edited_by_role,
-- edited_at)

\q
```

The schema migrations run inside `ensureSchema()` on first request
after deploy, same as previous rounds. No manual migration step.

### Phase C — Critical: smoke-test the security boundary

Before letting anyone real use this, verify that briefers cannot
see other workspaces' data. This is the most important check.

1. **Create a test briefer account.** Log in as admin, go to
   Settings → Team. Add a user:
   - Email: `test-briefer@example.com`
   - Name: `Test Briefer`
   - Password: a secure 8+ chars
   - Role: **briefer**
   - Workspace: pick one of your existing workspaces (e.g. Mt Druitt)

2. **Log out, log back in as that briefer.** You should land on
   `/briefer`, NOT `/app`.

3. **Verify the "Who are you" prompt blocks everything.** You
   should see a modal asking for your name. Try refreshing without
   answering — it should keep coming back. Type a name and continue.

4. **Verify you only see one workspace's jobs.** The list should
   show ONLY jobs from the workspace you selected when creating
   the briefer account. If you see jobs from other workspaces,
   STOP — that's a security bug. (Should not happen with the
   current code, but verify.)

5. **Verify you can't reach staff routes.** Try navigating to
   `/app`, `/calendar`, `/reports`, `/settings` directly. Each
   should redirect you back to `/briefer`.

6. **Verify cross-workspace job access is blocked.** Open a real
   job in another workspace as admin (note the URL — it's like
   `/app/jobs/<some-uuid>` or whatever). Now as the briefer, try
   to manually navigate to:
   ```
   /briefer/jobs/<that-other-workspace-job-id>
   ```
   Should show "Brief not found, or you don't have access."
   The API call (`GET /api/jobs/<id>`) should return 404.

7. **Verify the API directly with curl** (more rigorous):
   ```bash
   # First, get the briefer's session cookie. Sign in via curl:
   curl -c briefer-cookies.txt -X POST https://<your-domain>/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test-briefer@example.com","password":"<password>"}'

   # Try to list all workspaces — should return only the briefer's own
   curl -b briefer-cookies.txt https://<your-domain>/api/workspaces

   # Try to access another workspace's job (replace UUID)
   curl -b briefer-cookies.txt https://<your-domain>/api/jobs/<other-workspace-job-id>
   # Should be: {"error":"Workspace not found"} with status 404

   # Try to PATCH another workspace's job
   curl -b briefer-cookies.txt -X PATCH https://<your-domain>/api/jobs/<other-workspace-job-id> \
     -H "Content-Type: application/json" \
     -d '{"title":"hacked"}'
   # Should be 404

   # Try to access reports
   curl -b briefer-cookies.txt "https://<your-domain>/api/reports?workspaceId=any&from=2025-01-01&to=2025-12-31"
   # Should be: {"error":"Forbidden"} with status 403

   # Try to PATCH a forbidden field on the briefer's OWN workspace's job
   # (replace UUID with one in their own workspace)
   curl -b briefer-cookies.txt -X PATCH https://<your-domain>/api/jobs/<own-workspace-job-id> \
     -H "Content-Type: application/json" \
     -d '{"notes":"shouldn'"'"'t be allowed","stage":"posted"}'
   # Should be 403 with error like: "Briefers cannot edit 'notes'"
   ```

If any of these checks fail, do not proceed. The permission
boundary is the security-critical part of this round.

### Phase D — Verify the briefer happy path

1. As the briefer, click "Submit a new brief". Fill out title,
   description, due date. Submit.
2. You should be redirected to the new job's detail page.
3. The job should show your name as briefer ("Briefed by [name]").
4. Edit the title and click save. The change should apply.
5. Click "View edit history" — you should see your title change
   logged with your name.
6. Add a comment in the comments thread. It should post as your
   display name.
7. Switch to staff (admin) view. Open the same job in the kanban.
   The detail panel should show:
   - "Briefed by: [name]" badge at the top
   - The "View edit history" button next to "Overview"
   - The comment from the briefer in the thread, with their name

### Phase E — Verify backwards compatibility

Existing staff workflows should be unchanged:

1. Log in as admin. You should land on `/app` as before.
2. Open the kanban. All jobs should be visible across all workspaces.
3. Edit a job — should work as before. (Edit history is now being
   logged for staff edits too — verify by clicking "View edit history".)
4. Create a new workspace — should work.
5. Create a new staff member (admin or member role) — should work.
6. Reports, calendar, settings — all should work.

### Phase F — Deploy

```powershell
git add -A
git commit -m "Round 7.11: briefer logins (venue accounts) + edit history audit log"
git push origin main
```

```bash
ssh deanadmin@<vps-ip>
cd ~/apps/content-hub-saas
git pull origin main
docker compose down
docker compose build --no-cache app
docker compose up -d
docker compose logs --tail 100 app
```

Watch the logs for any errors during the schema migration.

## Rollback

```bash
ssh deanadmin@<vps-ip>
cd ~/apps/content-hub-saas
git revert HEAD
docker compose build --no-cache app
docker compose up -d
```

The schema additions (workspace_id, briefer_display_name,
display_name, job_edits) are all additive — rolling back the code
leaves the columns/table in place but unused. Harmless. If you want
to clean up:

```sql
ALTER TABLE users DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE jobs DROP COLUMN IF EXISTS briefer_display_name;
ALTER TABLE job_comments DROP COLUMN IF EXISTS display_name;
DROP TABLE IF EXISTS job_edits;
DELETE FROM users WHERE role = 'briefer';  -- only if any were created
```

But I'd recommend leaving the schema in place — costs nothing and
avoids data loss if you re-deploy.

## Edge cases worth flagging

1. **Briefer's session expires while they're editing**: their PATCH
   will return 401, the page will redirect to /login. Their unsaved
   form changes are lost. Acceptable for a 14-day session lifetime.

2. **Admin demotes a staff member to briefer mid-session**: the
   demoted user's existing session JWT still claims role=member.
   They keep staff access until they log out and back in. Edge case
   that won't happen in normal use; fixable later by checking the
   live DB role on every API call (more expensive). Not worth it
   right now.

3. **Briefer is associated with a workspace, then admin deletes
   that workspace**: the briefer's user row is cascaded out via
   `ON DELETE CASCADE` on workspace_id. Their next login attempt
   will fail with "invalid email/password". Harsh but correct.

4. **The audit log grows indefinitely**: not pruned. At your
   volume (5-person team, ~100 jobs/month, a few edits per job)
   this is megabytes per year. Negligible. Add a cleanup later if
   ever needed.

5. **Briefer creates a brief, then admin reassigns them to a
   different workspace**: the OLD brief's `workspace_id` doesn't
   change — it stays in the workspace where it was submitted.
   The briefer can no longer see it (their session.workspaceId
   no longer matches). The brief still exists for staff. This is
   correct behaviour but worth knowing if it ever surprises someone.

## What's next

After this round deploys cleanly:

- **7.12** could add internal-only comments (an `is_internal` flag
  on job_comments hidden from briefers)
- **Email notifications** when comments arrive — now optional
  rather than required, since briefers can already see comments
  by visiting the app
- The briefer UI can be polished further as you observe real use
