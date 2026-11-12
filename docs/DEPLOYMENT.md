# ReadFocus deployment

How ReadFocus 2.0 runs in production at $0: no payment method, billing
account, paid plan or add-on on any provider. Written in C14.6
(2026-11-12) from what was set up and checked that day; the free-tier
figures were read from each provider's own docs on 2026-11-12.

## Where it runs

| Part | Provider and plan | Address | Builds from |
|---|---|---|---|
| Frontend (React + Vite, static) | Vercel Hobby | https://readfocus-lake.vercel.app | `frontend/` (Root Directory), production branch **`readfocus-2.0`** until the release |
| Backend (FastAPI, Docker) | Render Free web service `readfocus-api` | https://readfocus-api.onrender.com | `Dockerfile` at the repo root, branch **`readfocus-2.0`** until the release, auto-deploy off |
| Database, auth, file storage | Supabase Free, project `lvfhuszvuiowyeizstru` (ap-south-1, Mumbai) | https://lvfhuszvuiowyeizstru.supabase.co | `supabase/migrations/` 001-015, all applied |
| CI | GitHub Actions, `.github/workflows/ci.yml` | github.com/asparagusD/readfocus/actions | every push |

Notes:

- **One Supabase project for dev and production** (decided at Gate G4,
  `docs/G4_PRODUCTION_MIGRATIONS.md`). Treat it as production: CLAUDE.md
  hard constraint 2.
- `readfocus-1` (Render, Oregon) is the pre-2.0 service, **suspended**,
  kept as a fallback until the release is verified; delete it after
  that. Suspended services use no instance hours.
- The region of `readfocus-api` was chosen as Singapore (closest to
  the database); confirm it in the dashboard (Render > `readfocus-api`)
  and correct this line if it differs. A region cannot be changed later.
- `render.yaml` describes the service (Free plan, Docker, `/health`,
  auto-deploy off, the variables below), but the live service was
  created in the dashboard, not from the blueprint: when they differ,
  the dashboard wins. Keep them in step by hand.

## Environment variables (names only)

Values live only in each provider's settings, never in git.

**Render (`readfocus-api` > Environment)**

| Name | What |
|---|---|
| `SUPABASE_URL` | the project URL |
| `SUPABASE_ANON_KEY` | the publishable key (read only by `backend/mcp_server.py`) |
| `SUPABASE_SERVICE_KEY` | the secret / service-role key; server-side only |
| `FRONTEND_URL` | `https://readfocus-lake.vercel.app`; one origin or several, comma-separated, no trailing `/` (`backend/cors.py`) |
| `FASTEMBED_CACHE` | `/app/.cache/fastembed`, where the image holds the model |
| `ENV` | `production`: no localhost origins in CORS |

`PORT` is set by Render (10000); do not set it. No LLM or embedding key
of any kind (CLAUDE.md constraint 1).

**Vercel (Settings > Environment Variables, Production and Preview, type Config)**

| Name | What |
|---|---|
| `VITE_API_URL` | `https://readfocus-api.onrender.com`, no trailing `/` |
| `VITE_SUPABASE_URL` | the project URL |
| `VITE_SUPABASE_ANON_KEY` | the **publishable** key only |
| `VITE_SITE_URL` | `https://readfocus-lake.vercel.app`; canonical link and share-image URLs |

`VITE_` values are built into the public JavaScript, so Vercel warns
when one is stored as a private type: they are public by design here.
A Vercel build stops if a required one is missing, not https, local,
ends in `/`, or the key is a secret or service-role key
(`frontend/src/deploy/deployEnv.js`); this needs "Automatically expose
System Environment Variables" on, for `VERCEL=1`.

**GitHub (Settings > Secrets and variables > Actions)**

| Name | What |
|---|---|
| `RENDER_DEPLOY_HOOK` | the deploy hook URL of `readfocus-api` (Render > Settings > Deploy Hook) |

**Supabase (Authentication > URL Configuration):** Site URL
`https://readfocus-lake.vercel.app`; redirect URLs
`https://readfocus-lake.vercel.app/**` and, for local dev,
`http://localhost:5173/**`.

## Free-tier limits and what happens at each

| Provider | Limit (docs, read 2026-11-12) | What happens | Source |
|---|---|---|---|
| Render Free | 0.1 CPU, 512 MB RAM | measured locally at those limits: idle about 252 MiB, ingestion peak 301-308 MiB (`docs/BENCHMARKS.md`, C14.1) | [blueprint spec](https://render.com/docs/blueprint-spec) |
| Render Free | spins down after 15 min with no inbound traffic; spin-up about 1 min | the first request waits; the frontend shows its warm-up screen | [render.com/docs/free](https://render.com/docs/free) |
| Render Free | 750 instance hours per workspace per month | every Free service suspended until the next month; one service always on needs at most 744 h | [render.com/docs/free](https://render.com/docs/free) |
| Render Free | ephemeral disk, no persistent disk, no shell, may restart at any time | nothing durable on disk: the model is in the image, ingestion resumes from `processing_jobs` | [render.com/docs/free](https://render.com/docs/free) |
| Render Hobby workspace | 500 build pipeline minutes per month | with no payment method, new builds stop for the month; the running service keeps running. One build here is a few minutes | [render.com/docs/build-pipeline](https://render.com/docs/build-pipeline) |
| Render | outbound bandwidth: included amount not shown on the pricing page when read | with no payment method, overage suspends Free services for the month | [render.com/docs/free](https://render.com/docs/free) |
| Vercel Hobby | 100 GB Fast Data Transfer, 1,000,000 CDN requests, 100 deployments a day | over a limit the feature waits 30 days; no billing | [vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby) |
| Vercel Hobby | non-commercial, personal use only | ReadFocus has no payments | [vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby) |
| Supabase Free | 2 active projects; paused after 1 week of inactivity | see "Supabase pause" below | [supabase.com/pricing](https://supabase.com/pricing) |
| Supabase Free | 500 MB database, 5 GB egress, 1 GB file storage, 50 MB max upload, 50,000 MAU, 1-day logs | a book over 50 MB cannot be uploaded | [supabase.com/pricing](https://supabase.com/pricing) |
| Supabase Free | **no automatic backups, no point-in-time recovery** | back up by hand before risky writes (below) | [platform backups](https://supabase.com/docs/guides/platform/backups) |
| GitHub Actions | the repository is public | Actions limits for public repositories were not checked in C14 | |

## Cold start

- After 15 idle minutes Render stops the backend. The next request
  starts it: Render's own spin-up (about a minute, per its docs), then
  uvicorn, then the embedding model loads from the image (no download).
  At 0.1 CPU in a local container the model was ready 20.0-21.0 s after
  process start (C14.1). The full cold start on Render itself was not
  timed.
- `/health` answers before the model is ready with `model_ready: false`;
  grading endpoints wait up to 20 s for it, then return 503.
- The frontend's landing page sends one `GET /health` on load to start
  waking the backend, and signed-in pages show a warm-up screen until
  `/health` answers (`frontend/src/lib/useBackendReady.js`).
- Render answers `/robots.txt` itself while the service is asleep, so
  crawlers do not wake it.

## Supabase pause

A Free project with no activity for a week is paused. While paused the
app cannot sign anyone in or load anything. To resume: Supabase
dashboard > the project > **Restore project** (or **Resume**); it takes a
few minutes. Any use of the app counts as activity.

## Backups

The database has no automatic backup. Before a migration or any write
that changes existing rows (CLAUDE.md constraint 2), the user runs, with
Docker running and the database password from Dashboard > Connect:

```bash
npx supabase db dump --db-url "<DB_URL>" -f readfocus_roles.sql --role-only
npx supabase db dump --db-url "<DB_URL>" -f readfocus_schema.sql
npx supabase db dump --db-url "<DB_URL>" -f readfocus_data.sql --use-copy --data-only
```

Check `npx supabase db dump --help` first: newer CLI versions replace
`--db-url` with `--remote`. Storage files (books, covers) are not in the
dump.

## Releasing (the "deploy" step)

Until the release both services build `readfocus-2.0`. To release:

1. Merge `readfocus-2.0` into `main` (`git merge --no-ff`) and push
   `main`, only on the user's "deploy".
2. Render > `readfocus-api` > Settings > Build & Deploy > Branch: `main`.
3. Vercel > Settings > Environments > Production > Branch Tracking:
   `main`. The push to `main` builds production; check it becomes
   **Current** for Production (a redeploy can land as Preview; then use
   **Promote to Production**).
4. CI on `main` runs the backend, frontend and graph jobs, then
   `deploy-render` POSTs `RENDER_DEPLOY_HOOK` with `ref=<commit>`, so
   Render deploys exactly the commit that passed.
5. Verify (next section).

## Redeploying

| What | How |
|---|---|
| Backend, new code | push to `main`: CI deploys after its checks. By hand: Render > `readfocus-api` > Manual Deploy > Deploy latest commit |
| Backend, changed variable | Render > Environment > edit > save and deploy |
| Frontend, new code | push to the production branch: Vercel builds it |
| Frontend, changed variable | Vercel > Deployments > the current Production deployment > ⋯ > Redeploy (build cache off). `VITE_` values are fixed at build time, so a variable change does nothing until a rebuild |
| Database schema | an additive migration in `supabase/migrations/`, a backup, the user's approval, then `npx supabase db push --linked --dry-run` and `npx supabase db push --linked` (the project is linked; history 001-015 matches) |

## Rolling back

| What | How |
|---|---|
| Backend | Render > `readfocus-api` > Events, a previous deploy > Rollback. Free services can roll back only to the two most recent previous deploys ([render.com/docs/free](https://render.com/docs/free)). Further back: Manual Deploy of an older commit, or POST the deploy hook with `&ref=<sha>` appended (the hook URL already has `?key=`) |
| Frontend | Vercel > Deployments > an older Ready production deployment > ⋯ > Promote to Production (or Instant Rollback where offered) |
| Whole release | revert the merge on `main` (`git revert -m 1 <merge>`) and push: CI redeploys the previous code. Never force-push `main` |
| Database | migrations are additive, so old code keeps working on the new schema. Data: restore from the last `db dump` |

## Verifying a deploy

```bash
curl -s https://readfocus-api.onrender.com/health          # {"status":"ok","model_ready":true,...}
curl -s -o /dev/null -D - -X OPTIONS https://readfocus-api.onrender.com/books \
  -H "Origin: https://readfocus-lake.vercel.app" -H "Access-Control-Request-Method: GET"   # 200, allow-origin = the site
curl -s -o /dev/null -w "%{http_code}\n" https://readfocus-lake.vercel.app/assets/missing.js  # 404
grep -rE "service_role|SUPABASE_SERVICE" frontend/dist                                    # nothing
```

Then in a browser: sign in, upload, ready, read (page turns, word
lookup), finish, test, results, dashboard, with the Network tab open:
the only hosts are the site, `readfocus-api.onrender.com` and
`lvfhuszvuiowyeizstru.supabase.co`. Dictionary, Wikipedia and Open
Library are called by the backend, never by the browser.

## What was verified on 2026-11-12 (C14.6)

On the live addresses, with both services building `readfocus-2.0` at
`7558abe`:

- `GET /health`: `{"status":"ok","model_ready":true,...}`; 19 routes,
  the 2.0 set.
- CORS: the site allowed (200, no credentials header); `localhost:5173`
  and another site refused (400); `PUT /sessions/{id}/position`
  preflight allowed.
- Vercel: prerendered landing page (20,689 B) with the canonical link
  and absolute share-image URLs; app routes return the page; a missing
  `/assets/` file is a 404; `/og.png` and `/robots.txt` served.
- All 24 JavaScript chunks of the live build: no `service_role`,
  `SUPABASE_SERVICE` or `sb_secret_`; no AI-provider host; the only API
  hosts are `readfocus-api.onrender.com` and the Supabase project.
  `grep -rE "service_role|SUPABASE_SERVICE" frontend/dist` on a local
  build: nothing.
- In-app browser on the landing page: requests only to the site and
  `readfocus-api.onrender.com`.
- The user's journey in their own browser, seen in the database: upload
  of `sample.pdf` ready with 7 embedded chunks, 55 questions, 57
  concepts and its job `done`; a session started, finished, tested and
  completed (01:22-01:25 UTC) with a `test_results` row; agent decisions
  for start, finish and submit; 8 mastery rows; new sessions after; word
  lookups (`design`, `tandem`, `applied`) answered from the dictionary
  through `readfocus-api`.

Not verified: the network tab of the signed-in pages (the user's own
browser; the bundle scan above is the evidence that no other host is
called); the reading position (`reading_progress.position` stayed null
for the test book: no page turn saved, cause not established); Render's
own memory graph and a timed cold start on Render; Lighthouse on the
live site.
