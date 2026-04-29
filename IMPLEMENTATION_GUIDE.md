# Round 7.12 — Type of Job (multi-select), Unassigned filter, Archive count fix, Jobs by Type report

24 files. Three changes bundled into one round.

> **Important:** This round builds on Round 7.11p. Deploy 7.11p first
> if you haven't already, OR deploy them together — both are
> compatible. Don't try to deploy 7.12 on top of 7.11 (without 7.11p)
> because the briefer-detail and login files differ.

## What this round does

1. **Unassigned filter** — added "Unassigned" to the new Assignee
   dropdown in the dashboard filter bar. Pick it to see only jobs
   with no one assigned. The dropdown also now lists each team
   member by name so you can filter by individual person.

2. **Archive count fix** — the archive column count in the kanban
   now always reflects the real number of archived jobs in the
   workspace, even when "Hide archived" is toggled on. Previously
   it would show 0 when archived was hidden, which made it
   pointlessly hard to know how many archived items existed.

3. **Type of Job (multi-select)** — the existing free-text
   `content_type` field is replaced by a constrained multi-select
   field called "Type of Job" with 8 standard values:
   - Video
   - Graphic Design
   - Social Post
   - Website Update
   - Email Marketing
   - Print
   - Reports
   - Other

   Jobs can have multiple types (a video that's also shared as a
   social post gets both). UI is a checkbox-list popover. Visible
   in: staff job detail, staff create-job dialog, briefer detail,
   briefer brief-submit form. Filterable on the kanban (single-
   select filter — pick "Video" to see all jobs that include
   Video). New "Jobs by Type" breakdown on the reports page.

## File inventory (24 files)

### Library / types (7 files)
| File | Status | Why |
|---|---|---|
| `src/lib/postgres.ts` | MODIFIED | New `content_types TEXT[]` column + GIN index |
| `src/lib/types.ts` | MODIFIED | `ALLOWED_JOB_TYPES`, `JOB_TYPE_DESCRIPTIONS`, `Job.contentTypes` |
| `src/lib/db-mappers.ts` | MODIFIED | `mapContentTypes` helper, `rowToJob` returns array |
| `src/lib/permissions.ts` | MODIFIED | `content_type` → `content_types` in editable + audit field lists |
| `src/lib/job-filters.ts` | MODIFIED | `ASSIGNED_TO_UNASSIGNED` sentinel, `contentType` filter |
| `src/lib/reports.ts` | MODIFIED | `computeJobTypeBreakdown` function + `JobTypeRow` interface |
| `src/lib/comparison.ts` | MODIFIED | `contentTypeBreakdown` updated for multi-select |

### API routes (4 files)
| File | Status | Why |
|---|---|---|
| `src/app/api/jobs/route.ts` | MODIFIED | POST handles `contentTypes`, validates, dedupes, sorts |
| `src/app/api/jobs/[id]/route.ts` | MODIFIED | PATCH handles arrays + audit log uses comma-joined string |
| `src/app/api/jobs/brief-submit/route.ts` | REWRITTEN | Accepts `contentTypes` array |
| `src/app/api/reports/route.ts` | MODIFIED | Returns `allJobsInRange` (anchored on created_at) |

### Components (13 files)
| File | Status | Why |
|---|---|---|
| `src/components/job-type-picker.tsx` | NEW | Reusable checkbox-popover multi-select |
| `src/components/reports-jobs-by-type.tsx` | NEW | Horizontal-bar visualisation for the report |
| `src/components/job-detail-panel.tsx` | MODIFIED | Staff: JobTypePicker, "Type of Job" label |
| `src/components/briefer-job-detail.tsx` | MODIFIED | Briefer: JobTypePicker, array dirty/save logic |
| `src/components/brief-submit-form.tsx` | MODIFIED | Briefer brief: JobTypePicker |
| `src/components/job-create-dialog.tsx` | MODIFIED | Staff create: JobTypePicker |
| `src/components/dashboard-filters.tsx` | REWRITTEN | New Assignee + Type of Job dropdowns |
| `src/components/kanban-board.tsx` | MODIFIED | Type pills on cards + archiveTrueCount prop |
| `src/components/app-shell.tsx` | MODIFIED | Computes archiveTrueCount, passes to KanbanBoard |
| `src/components/reports-shell.tsx` | MODIFIED | Renders Jobs by Type section |
| `src/components/comparison-table.tsx` | MODIFIED | Shows contentTypes joined |
| `src/components/comparison-post-picker.tsx` | MODIFIED | Shows contentTypes joined |
| `src/components/report-comparison-pdf.tsx` | MODIFIED | PDF shows contentTypes joined |

## Schema migration

One additive migration. The `ensureSchema()` function picks it up
automatically on next app boot — no manual SQL needed.

```sql
-- New column: TEXT[] of allowed job types
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_types TEXT[]
  NOT NULL DEFAULT '{}';

-- GIN index for array-containment queries
CREATE INDEX IF NOT EXISTS jobs_content_types_gin_idx
  ON jobs USING GIN (content_types);
```

The legacy `content_type TEXT` column is **left in place** but
unused by application code. The mapper now returns null for
`Job.contentType` regardless of what's stored. We can drop it in
a future round once we're confident nothing reads it; keeping it
this round means rollback is trivial.

Per your earlier note: "the site is not live yet, all existing
entries are tests only" — no data migration is needed. New jobs
get an empty `content_types` array by default.

## Architecture notes worth knowing

### Multi-select counting in reports

A job with 3 types contributes +1 to **each** of those 3 type
buckets in the breakdown. So if you have 100 jobs and they all
have ['Video', 'Social Post'], the breakdown will show:
- Video: 100
- Social Post: 100

Total counts across buckets can exceed total jobs. Percentages
sum to >100%. This is the right answer for "how much of each
type of work did we do" — a multi-type job really did involve
doing both kinds of work. A note on the report explains this
to anyone viewing it.

Jobs with empty `content_types` arrays are bucketed as
"Uncategorised" so the gap is visible rather than hidden.
"Uncategorised" sinks to the bottom of the chart so it doesn't
get visually confused with the actual types.

### Reports date anchor for the Jobs by Type breakdown

The existing reports are anchored on `posted_at` — they show what
got POSTED in a date range. That's the right anchor for social
media metrics.

The new "Jobs by Type" breakdown is anchored on `created_at`
because:
- Design jobs and reports often never get a "posted_at" stage
- The question "how much work did we do" is about when work
  was BRIEFED, not when it was published

The reports endpoint now returns BOTH `jobs` (posted-at-anchored)
and `allJobsInRange` (created-at-anchored). Different breakdowns
use different slices.

### Validation strategy for content types

Values are validated at the API layer (POST + PATCH) against the
`ALLOWED_JOB_TYPES` constant in `src/lib/types.ts`. Invalid values
are silently dropped. Validated values are sorted in canonical
order before storage so the audit log diffs are stable
("Video, Social Post" not "Social Post, Video" — the order matches
ALLOWED_JOB_TYPES order regardless of selection sequence).

The Postgres column is unconstrained TEXT[] — no CHECK constraint,
no ENUM type. This means **adding a new value is a one-line code
change** in `ALLOWED_JOB_TYPES`. No DB migration. If you ever
remove a value, existing jobs with that value still display it
(reports surface it as a stray bucket) — but the picker won't
offer it anymore.

### Archive count

The kanban board now accepts an optional `archiveTrueCount` prop.
When set, it overrides the displayed count for the archive column
specifically. The parent (`app-shell.tsx`) computes this by
applying ALL filters EXCEPT `hideArchived`, then counting jobs
with `stage === 'archive'`. So:

- Filter by assignee=Alice → archive count shows Alice's archived
- Toggle "Hide archived" on → archive count still shows the same
  number, body of the column is empty

This matches the obvious user intent: "hide archived" should hide
them from the kanban body, not hide their existence.

## Step-by-step deploy

### Phase A — Apply

Replace 22 existing files. Add 2 new files. Note paths carefully:

**New files:**
- `src/components/job-type-picker.tsx`
- `src/components/reports-jobs-by-type.tsx`

**Modified files** — replace at their existing paths. The
bracketed-folder one is `src/app/api/jobs/[id]/route.ts` (Windows:
`src\app\api\jobs\[id]\route.ts`). Manually verify it's at the
right path after copy.

### Phase B — Build + deploy

```powershell
cd C:\Users\deano\Projects\content-hub-saas
git add -A
git commit -m "Round 7.12: Type of Job multi-select, Unassigned filter, archive count, Jobs by Type report"
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

The `--no-cache` build is required (we have new utility classes
in the new components — Tailwind needs to recompile fresh).

The schema migration runs automatically when the app boots and
hits `ensureSchema()`. You'll see the new column appear after the
first request to the running app. No manual psql commands.

### Phase C — Smoke test

Five tests. Each should take <2 minutes.

**Test 1: Schema migration ran**
```bash
docker exec -it content-hub-postgres psql -U content_hub -d content_hub -c "\d jobs" | grep content_types
```
Expected output: a line showing `content_types | text[] | not null`
and a GIN index in the index list. If you don't see content_types,
the schema migration didn't run — visit any page in the app and
try again.

**Test 2: Create a new job with multiple types (staff)**
1. Log in as admin
2. Click "+ New job" or whatever opens the create dialog
3. Fill in title "Test 7.12 Multi-Type"
4. Click the Type of Job dropdown
5. **Expected**: popover opens with 8 checkboxes, each with a
   description underneath. ALLOWED_JOB_TYPES order: Video,
   Graphic Design, Social Post, Website Update, Email Marketing,
   Print, Reports, Other.
6. Check "Video" and "Social Post"
7. **Expected**: button label updates to "Video, Social Post"
8. Click anywhere outside the popover. **Expected**: closes.
9. Save the job
10. Open it again from the kanban
11. **Expected**: Type of Job field shows both, kanban card shows
    two indigo pills "Video" and "Social Post"

**Test 3: Filter by Unassigned**
1. Make sure you have at least one unassigned job and one
   assigned job in your test workspace
2. Open the dashboard
3. **Expected**: a new Assignee dropdown is visible in the filter
   bar. Options: "Anyone", "Unassigned", then each team member by
   name.
4. Select "Unassigned"
5. **Expected**: only the unassigned jobs are shown
6. Select a specific team member
7. **Expected**: only their jobs are shown
8. Select "Anyone"
9. **Expected**: all jobs return

**Test 4: Filter by Type of Job + Archive count**
1. With one job tagged "Video, Social Post" and another tagged
   "Print" (or just tag a couple of test jobs differently), check
   the Type of Job filter dropdown.
2. **Expected**: dropdown lists "Any type" + 8 ALLOWED_JOB_TYPES.
3. Pick "Video"
4. **Expected**: only jobs that include Video are shown (the
   multi-type job is included).
5. Now archive a few jobs (drag to archive column or set stage)
6. With "Hide archived" UNCHECKED — note the count in the
   archive column header
7. Toggle "Hide archived" ON
8. **Expected**: archive column body becomes empty BUT the count
   in the header still shows the actual number of archived jobs.
9. Toggle "Hide archived" OFF again. **Expected**: column body
   shows all archived items, count unchanged.

**Test 5: Reports — Jobs by Type breakdown**
1. Navigate to /reports
2. Pick a workspace and a date range that includes some test jobs
3. **Expected**: a "Jobs by Type" section appears between
   "Platform breakdown" and "Top performers"
4. **Expected**: horizontal bars showing each type that has at
   least one job, with counts and percentages
5. **Expected**: a small note at the bottom explains that
   multi-type jobs are counted in each bucket
6. If you have any jobs with no types, an "Uncategorised" bar
   should appear at the bottom (with a slate-grey colour to
   distinguish from real types)

## Edge cases worth flagging

1. **Existing jobs with old `content_type` data**: per your note,
   no migration is needed. The deprecated column is left in place,
   the mapper returns null, the UI shows nothing. If you want to
   bulk-clear the old column at some point, it's a one-line SQL.

2. **Briefer multi-select editing**: briefers can now multi-select
   types on their own briefs (it's in `BRIEFER_EDITABLE_FIELDS`).
   Their changes appear in the audit log as
   "content_types: Video → Video, Social Post" (comma-joined for
   the diff). Audit-log readability is intentional — keeping
   stable ordering means a flip-flop edit shows clearly as no-op.

3. **Filter is single-select**: jobs CAN have multiple types but
   the filter is single-select (one type at a time). This was a
   deliberate choice — multi-select filtering with AND/OR gets
   confusing fast. If you need the comparison "how does Video
   stack up against Print?", that's what the Jobs by Type report
   gives you.

4. **Type pills on kanban cards**: each type renders as its own
   indigo-tinted pill on the card (matches the platform pill
   visually but coloured differently). A job with 4 types will
   show 4 pills which can crowd a card — at our usual 1-2 types
   per job this is fine. If it ever becomes ugly, we can collapse
   to "Video, +2 more" in a future round.

5. **Reports `posted_at` vs `created_at` anchors**: existing
   reports keep their `posted_at` anchor — Headline numbers, top
   posts, platform breakdown, time series all still answer "what
   did we PUBLISH in this range." The Jobs by Type breakdown is
   the only thing using the new `allJobsInRange` (created_at-
   anchored) slice. This keeps existing report semantics intact.

## Rollback

```bash
git revert HEAD
docker compose build --no-cache app
docker compose up -d
```

The `content_types` column will remain in the DB after revert
(harmlessly — just an extra empty array column). To remove it
entirely, run:

```sql
ALTER TABLE jobs DROP COLUMN IF EXISTS content_types;
DROP INDEX IF EXISTS jobs_content_types_gin_idx;
```

But there's no need to do this — it does nothing if the app
isn't reading it.

## What's NOT in this round (deliberately)

You mentioned **the brief-submit form needs to be properly
workshopped** — I left the field as optional for now. Future
round will: redesign the brief-submit form layout, decide
whether type is required at submit, adjust which fields are
visible to briefers based on the type they pick, etc.

Email Marketing, Print, Reports were added to the type list
even though they don't fit social platforms cleanly. That's
intentional — designers and the email marketer need their work
to appear in the same workflow. If "Print" briefs need fields
that "Social Post" briefs don't, we'll workshop that separately.
