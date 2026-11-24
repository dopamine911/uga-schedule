# Studio Scheduling System

Students book university studio time and equipment. Each booking needs a sponsor's approval and then studio staff confirmation. The system sends reminders before the event. After the event, equipment is checked back in and the results are published. Specs are in [`specs/`](specs/00-overview.md).

## Layout

All code lives in one pnpm workspace under `packages/`:

| Path | Package | What |
|---|---|---|
| `packages/domain` | `@studio/domain` | Pure TypeScript business rules: permissions, levels, availability, submission checks, event state machine, stage scheduling. Unit-tested. |
| `packages/api` | `@studio/api` | Hono HTTP API, SQLite via Drizzle (better-sqlite3), background jobs, ICS feeds |
| `packages/web` | `@studio/web` | React 19 + Vite + React Router + TanStack Query + shadcn/ui. Typed API client via `hono/client`. |
| `specs` | | Product specs (F-001 … F-010) |

`web` depends on `domain` and on `api`'s route types; `api` depends on `domain`; `domain` depends on nothing in the repo.

## Run

Requires Node 24+ and pnpm 10.

```sh
pnpm install
pnpm db:reset     # creates packages/api/data/studio.db with demo data
pnpm dev          # API on :3001, web on :5173 (proxies /api and /ics)
```

`pnpm dev` sets `DEV_MODE=1`, which turns on the demo sign-in and the clock controls. Without it the API has no sign-in route and refuses to start unless `SESSION_SECRET` is set. `CAMPUS_TZ` defaults to `America/New_York`.

Open http://localhost:5173 and sign in as any demo user. Dev sign-in replaces SSO.

| User | Role |
|---|---|
| Ada Admin | Admin |
| Eli Manager | Equipment manager |
| Sam Staff | Studio staff (Studio A, Studio C) |
| Tara Tech | Studio staff (Studio B) |
| Prof. Priya Patel, Prof. Minh Nguyen | Sponsors |
| Alice (L1), Ben (L2 + L3 expiring), Chloe (L3), Dan (no level) | Students |

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

React Doctor also runs on every pull request and on pushes to `main` (`.github/workflows/react-doctor.yml`). It comments with new findings and never fails the check; set `blocking` in that file to gate on them.

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
