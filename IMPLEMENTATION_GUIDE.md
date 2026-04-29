# Round 7.11p — Briefer polish + security fix

Five files. Polish round addressing the four issues found during
your first 7.11 smoke test:

1. **Security fix** — deleted users now lose access immediately
2. **"Who are you?" prompt fires on every fresh briefer login**
3. **Briefer archive view + search** — separate Active/Archived tabs
   plus a free-text title/description filter
4. **Approval buttons on briefer detail** — Approve / Request changes
   when a brief is awaiting

## File inventory

| File | Status | Why |
|---|---|---|
| `src/lib/auth.ts` | MODIFIED | `getSession()` now does live DB check |
| `src/app/api/auth/login/route.ts` | MODIFIED | Briefers get null displayName at login |
| `src/components/briefer-jobs-list.tsx` | MODIFIED | Tabs + search |
| `src/app/api/jobs/[id]/approval/route.ts` | NEW | Approval endpoint |
| `src/components/briefer-job-detail.tsx` | MODIFIED | Approval buttons + state |

## What's actually changing

### Fix 1 — Deleted users lose access (security)

`getSession()` previously trusted the JWT cookie unconditionally —
if you had a valid signed cookie, you were "in." That meant a user
who'd been deleted from the database kept browsing for up to 14
days until the JWT expired.

The fix: every authenticated request now does one extra DB query
(`SELECT id, role, workspace_id FROM users WHERE id = $1`) to
verify the user still exists AND that their role/workspaceId
still match what the JWT claims. If anything is out of sync,
`getSession()` returns null — same as if there was no cookie.

**Side benefit**: this also catches role demotions and workspace
reassignments. If admin demotes a member to briefer, the old
"member" JWT stops working immediately. Predictable.

**Cost**: one indexed primary-key SELECT per authenticated request.
Sub-millisecond. The pool is already warm from other queries.

### Fix 2 — Always re-prompt for "Who are you?"

Briefer logins previously inherited their profile name as the
session displayName. So if the venue admin set the profile name
to "Mt Druitt Login", that became the session displayName and
the prompt never appeared.

The fix is one line: `displayName: user.role === 'briefer' ? null : user.name`.
Briefer sessions now start with displayName=null, which triggers
the existing prompt component reliably.

For staff (admin/member), behaviour is unchanged — they identify
by their profile name.

### Fix 3 — Archive view + search

`briefer-jobs-list.tsx` now has:
- An Active/Archived tab toggle (with counts shown next to each)
- A search input that filters by title and description (case-insensitive)
- The filtered "no results" empty state explains why

All client-side filtering — at venue scale (dozens of briefs) the
list fits in memory and any keystroke filter is instant.

### Fix 4 — Approval buttons

New endpoint `POST /api/jobs/:id/approval` accepting `{decision: 'approved' | 'changes_requested'}`.
Validates that current state is 'awaiting' (any other state is a
409 — "this brief is not currently awaiting approval"). Logs the
transition to `job_edits` so it appears in the audit history.

UI: when a briefer opens a job with `approvalStatus === 'awaiting'`,
two buttons appear inside the status banner: **Approve** (green)
and **Request changes** (red). Either one PATCHes the status and
the banner updates to reflect the new state.

I deliberately did NOT add `approval_status` to
`BRIEFER_EDITABLE_FIELDS`. The dedicated endpoint enforces valid
transitions only — a briefer can't, for example, retroactively
"un-approve" something that's already approved.

## Step-by-step deploy

### Phase A — Apply

Replace 4 files at their existing paths:
- `src/lib/auth.ts`
- `src/app/api/auth/login/route.ts`
- `src/components/briefer-jobs-list.tsx`
- `src/components/briefer-job-detail.tsx`

Add 1 new file:
- `src/app/api/jobs/[id]/approval/route.ts` — note the bracketed
  directory `[id]`. On Windows the path is
  `src\app\api\jobs\[id]\approval\route.ts`. If you've had issues
  before with bracketed paths in PowerShell, manually verify after
  copying that the file is at the right place.

### Phase B — Build + deploy

```powershell
cd C:\Users\deano\Projects\content-hub-saas
git add -A
git commit -m "Round 7.11p: deleted-user security fix + briefer polish"
git push origin main
```

```bash
ssh deanadmin@<vps>
cd ~/apps/content-hub-saas
git fetch origin && git reset --hard origin/main
docker compose down
docker compose build --no-cache app
docker compose up -d
```

No schema migration needed — this round is pure code, no DB changes.

### Phase C — Smoke test

Five quick checks. Each should take <1 minute.

**Test 1: Deleted-user loses access (the security fix)**
1. As admin, create a test briefer (Settings → Team)
2. Open a different browser/incognito and log in as that briefer
3. Verify you're at `/briefer` and the page loads normally
4. Switch back to admin browser
5. Delete the test briefer from Settings → Team
6. Switch back to the briefer browser
7. Try to navigate anywhere — refresh the page, click a brief, anything
8. **Expected**: you should be redirected to `/login`. If you can still
   browse anywhere, the security fix didn't take.

**Test 2: "Who are you?" prompt fires reliably**
1. Create another test briefer (or recreate the one you just deleted)
2. Log in as that briefer in incognito
3. **Expected**: the "Who's using this account today?" prompt
   should appear immediately. Cancel button should NOT be visible
   (since displayName is null and they have no escape).
4. Type a name and continue. Page renders normally with "Hi, X" header.
5. Log out, log back in as the same briefer.
6. **Expected**: prompt appears AGAIN, even though the same person
   already set a name last session. Their previous name should NOT
   be remembered between sessions.

**Test 3: Archive view + search**
1. As briefer, view "My briefs"
2. **Expected**: see two tabs: "Active (N)" and "Archived (M)"
3. Click Archived. **Expected**: shows only archived briefs.
4. Click Active. **Expected**: shows non-archived only.
5. Type something in the search box. **Expected**: list filters in real time.
6. Clear the search. **Expected**: full list returns.

**Test 4: Approval buttons appear and work**
1. As admin, find a brief in the workspace and set its
   approvalStatus to "Awaiting approval" (in the staff detail panel).
2. Switch to briefer view, open that same brief.
3. **Expected**: status banner shows "Awaiting your approval"
   with two buttons underneath: green "Approve" and red "Request changes".
4. Click "Approve". **Expected**: banner updates to "Approved by you".
   Buttons disappear.
5. Click "View edit history". **Expected**: an entry shows
   "approval_status: awaiting → approved" attributed to your
   briefer name with `(briefer)` tag.

**Test 5: Approval transition guard works**
1. With the brief now in approvalStatus=approved, the buttons
   are gone. Open browser DevTools → Network tab.
2. From the JS console, run:
   ```js
   fetch('/api/jobs/<job-id>/approval', {
     method: 'POST',
     headers: {'Content-Type': 'application/json'},
     body: JSON.stringify({decision: 'changes_requested'})
   }).then(r => r.json()).then(console.log)
   ```
   Replace `<job-id>` with the job's actual UUID.
3. **Expected**: response is `{error: "This brief is not currently awaiting approval."}`
   with HTTP status 409. The state doesn't change.

## Edge cases worth flagging

1. **Cookie not cleared on deletion**: when a deleted user's
   `getSession()` returns null, we don't actively clear their
   cookie — clearing requires a response context that getSession
   doesn't always have. The cookie will linger until they log in
   again (which sets a new cookie) or it expires. Harmless: every
   subsequent request to a protected route will return null/401
   and bounce them to /login.

2. **Approval endpoint and staff**: staff can also call the
   approval endpoint. They could just as easily use the existing
   `PATCH /api/jobs/:id` route. Both paths log to the audit table.
   If you'd rather restrict the approval endpoint to briefers only,
   that's a one-line `if (session.role !== 'briefer') return 403`
   addition — let me know.

3. **Search performance**: at hundreds of briefs per workspace,
   client-side filtering will start to feel laggy. We're nowhere
   near that scale. When you are, swap to a server-side filter.

## Rollback

```bash
git revert HEAD
docker compose build --no-cache app
docker compose up -d
```

No schema changes to undo. The new `/api/jobs/:id/approval` route
disappears with the revert; any in-flight calls 404. Acceptable.
