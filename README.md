# Studio Scheduling System

Students book university studio time and equipment. Each booking needs a sponsor's approval and then studio staff confirmation. The system sends reminders before the event. After the event, equipment is checked back in and the results are published. Specs are in [`specs/`](specs/00-overview.md).

## Layout

All code lives in one pnpm workspace under `packages/`:

| Path              | Package          | What                                                                                                                                      |
| ----------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain` | `@studio/domain` | Pure TypeScript business rules: permissions, levels, availability, submission checks, event state machine, stage scheduling. Unit-tested. |
| `packages/api`    | `@studio/api`    | Hono HTTP API, SQLite/Turso via Drizzle (libSQL), result files on Vercel Blob or local disk, background jobs, ICS feeds                   |
| `packages/web`    | `@studio/web`    | React 19 + Vite + React Router + TanStack Query + shadcn/ui. Typed API client via `hono/client`.                                          |
| `specs`           |                  | Product specs (F-001 … F-010)                                                                                                             |

`web` depends on `domain` and on `api`'s route types; `api` depends on `domain`; `domain` depends on nothing in the repo.

## Run

Requires Node 24+ and pnpm 10.

```sh
pnpm install
pnpm db:reset     # creates packages/api/data/studio.db with demo data (migrates first)
pnpm dev          # API on :3001, web on :5173 (proxies /api and /ics)
```

`pnpm dev` sets `DEV_MODE=1`, which turns on the demo sign-in and the clock controls. Without it the API has no sign-in route and refuses to start unless `SESSION_SECRET` is set. `CAMPUS_TZ` defaults to `America/New_York`. Set `TURSO_DATABASE_URL` (`libsql://…`, with `TURSO_AUTH_TOKEN`) to use Turso instead of the local file, and `BLOB_READ_WRITE_TOKEN` to store result files in Vercel Blob instead of `packages/api/data/uploads`.

Writing requests (anything but GET/HEAD) each run in one write transaction (`createApp.ts`), so a request's checks and writes commit together and writing requests run one at a time.

Open http://localhost:5173 and sign in as any demo user. Dev sign-in replaces SSO.

| User                                                           | Role                              |
| -------------------------------------------------------------- | --------------------------------- |
| Ada Admin                                                      | Admin                             |
| Eli Manager                                                    | Equipment manager                 |
| Sam Staff                                                      | Studio staff (Studio A, Studio C) |
| Tara Tech                                                      | Studio staff (Studio B)           |
| Prof. Priya Patel, Prof. Minh Nguyen                           | Sponsors                          |
| Alice (L1), Ben (L2 + L3 expiring), Chloe (L3), Dan (no level) | Students                          |

The **clock button** in the header is available in dev mode only. It moves time forward and runs the background jobs: reminders, request expiry, no-shows, overdue returns, lost items, and hold auto-clear. Use it to demo the full lifecycle without waiting.

## Checks

```sh
pnpm check         # everything below except doctor, in order
pnpm lint          # oxlint over all packages (.oxlintrc.json); warnings fail
pnpm lint:fix
pnpm format        # oxfmt, writes files (.oxfmtrc.json; also sorts Tailwind classes)
pnpm format:check
pnpm typecheck
pnpm test          # domain unit tests + API integration tests
pnpm doctor        # React Doctor scan of packages/web (pinned in devDependencies)
```

Lint and format configs live at the repo root and cover every package. oxlint doesn't flag undefined names in TypeScript; `pnpm typecheck` does.

`pnpm check` also runs in CI on every pull request and on pushes to `main` (`.github/workflows/check.yml`, Node 24, frozen lockfile). Make it a required status check in the branch protection settings to block merging on failures.

React Doctor also runs on every pull request and on pushes to `main` (`.github/workflows/react-doctor.yml`). It comments with new findings and never fails the check; set `blocking` in that file to gate on them.

## Deploy (Vercel)

`vercel.json` deploys the repo as one Vercel project with two [services](https://vercel.com/docs/services):

| Service | Root           | Public paths       | Runs as                                                                |
| ------- | -------------- | ------------------ | ---------------------------------------------------------------------- |
| `api`   | `packages/api` | `/api/*`, `/ics/*` | Vercel Function from `src/index.ts` (`server.ts` is local-only)        |
| `web`   | `packages/web` | everything else    | Static Vite build; unknown paths fall back to `index.html` for the SPA |

The browser calls `/api` on its own origin, so no service binding is needed. Background jobs run from a Vercel Cron request to `/api/jobs/tick` once a day at 11:00 UTC (the Hobby plan allows only daily cron), not on the 30-second interval `server.ts` uses. Jobs that depend on timing run up to a day late. Stage reminders found more than an hour after they were due are skipped rather than sent, so at a daily cadence almost none are delivered. Use a per-minute schedule on the Pro plan to restore them.

Data lives in Turso and result files in a private Vercel Blob store:

1. Add the Turso integration from the Vercel Marketplace and connect the database to the project; it sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Put the function region next to the database's.
2. Create a private Blob store and connect it to the project (`vercel blob create-store results --access private --yes`); it sets `BLOB_STORE_ID`, and the functions authenticate with OIDC.
3. Apply migrations before the first deploy and before any deploy that changes the schema: `TURSO_DATABASE_URL=… TURSO_AUTH_TOKEN=… pnpm db:migrate`. Functions never migrate.

Uploads go from the browser straight to Blob through presigned URLs, so the 4.5 MB function body limit does not apply; files of 100 MB and more upload in parts. Downloads redirect to a signed Blob URL that is valid for five minutes.

Project environment variables:

| Variable                                     | Required | Purpose                                                                                     |
| -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                             | yes      | Signs session cookies and calendar feed links                                               |
| `CRON_SECRET`                                | yes      | Vercel Cron sends it as a bearer token; `/api/jobs/tick` rejects requests without it        |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`     | yes      | The database; set by the Turso integration                                                  |
| `BLOB_STORE_ID` (or `BLOB_READ_WRITE_TOKEN`) | yes      | The Blob store; set when the store is connected. Without it files go to the function's disk |
| `PUBLIC_BASE_URL`                            | no       | Origin for links in notifications and feeds; defaults to the deployment URL (`VERCEL_URL`)  |
| `CAMPUS_TZ`                                  | no       | Defaults to `America/New_York`                                                              |

Preview deployments share the production database unless the integration gives them their own; connect a separate Turso database to the Preview environment to keep test data out of production.

Run both services locally the way Vercel does with `vercel dev --local` (set the variables above in the shell).

## v0 scope versus the specs

Built: the full request → sponsor approval → staff confirmation → checkout → check-in → results flow. Also levels, course grants and CSV roster import, inventory with per-unit status, studios with opening hours and blackouts, event types with reminder/task schedules, holds, in-app notifications, ICS calendar feeds, the audit log, and dev time travel.

Deferred (spec reference in brackets):

- University SSO; dev login stands in for it (F-001).
- Google and Outlook calendar API push; ICS feeds work with every client (F-009).
- Email delivery; notifications are in-app and logged to the API console (F-010).
- Equipment kits (F-003 BR-003-06).
- Photos at checkout and check-in (F-007).
- Signed download URLs and virus scanning (F-008).
- SIS API roster sync; paste/CSV import works instead (F-002).
