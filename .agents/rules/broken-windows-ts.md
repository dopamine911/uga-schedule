---
trigger_phrase:
  haiku: "typescript code quality ratchet"
  opus: "typescript broken windows quality ratchet"
  sonnet: "typescript broken windows ratchet"
always_on: false
applies_to: [typescript, javascript]
---

# Broken Windows — TypeScript / JavaScript

TypeScript and JavaScript tooling and conventions for the patterns in `broken-windows-general.md`. Load alongside the general rule; this file supplies the language-specific commands, tools, and idioms.

If you're working in pure JavaScript, ignore the TypeScript-specific tooling (tsc, type-related rules) and apply the rest.

## Verification Suite — This Repo

Run these from the repo root (pnpm workspace; see `README.md` § Checks):

```bash
pnpm check          # composite gate: lint, format:check, typecheck, test, in that order
pnpm lint           # oxlint --type-aware --deny-warnings (.oxlintrc.json)
pnpm format         # oxfmt, writes files (.oxfmtrc.json)
pnpm typecheck      # tsc --noEmit in every package
pnpm test           # vitest in packages/domain and packages/api
pnpm build          # tsc -b + vite build for packages/web
pnpm doctor         # React Doctor scan of packages/web
```

`pnpm check` is the single command to run before declaring work done. The pre-commit hook and CI (`.github/workflows/check.yml`) run the same command.

## Broken Window Categories — TS/JS Forms

### Verification Suite Failures

Any test that was passing before your changes must still pass after. If you find a pre-existing failure (`pnpm test` reports a failure unrelated to your work), fix it.

### Static Analysis Violations

- **Type errors** — `tsc --noEmit` must produce zero errors. Fix any you find. Do not silence with `// @ts-expect-error`, `// @ts-ignore`, `as any`, or `as unknown as X` (see `agent-discipline-ts.md`).
- **Lint violations** — `pnpm lint` must report zero violations (warnings fail). Fix them. Do not disable rules inline (`// oxlint-disable-next-line`, `// eslint-disable-next-line`) to make them pass — fix the underlying issue.
- **Format violations** — `pnpm format:check` must pass. If it doesn't, run `pnpm format` and commit the result.

### Dead Code

- Commented-out code blocks (`// const oldImpl = ...` spanning multiple lines)
- Unused imports (most TS linters catch these — surface and remove)
- Unused variables, parameters, and exports
- Unreachable branches (often surfaced by TS with `error TS7027` or by linters)
- Orphan files: modules with no importers anywhere in the codebase. Run a quick check: `grep -r "from.*<module-name>" src/` — if there are zero references, the file is orphaned. Delete.

### Documentation Gaps

JSDoc/TSDoc on exported symbols (depending on project convention):

```ts
// Wrong (exported with no doc)
export function parseRequest(buf: Buffer): Request { ... }

// Right
/**
 * Parses a binary request payload into a Request object.
 * @throws DataError if the buffer is malformed or truncated.
 */
export function parseRequest(buf: Buffer): Request { ... }
```

Match the project's convention (some require `@param`/`@returns`, some don't; some use TSDoc strict mode). Look at neighboring exports.

### Magic Values

Extract literals to constants per `agent-discipline-ts.md` — same standard.

### Duplication

Before writing a new helper, search:

```bash
grep -rn "<pattern>" packages/*/src --include="*.ts" --include="*.tsx"
```

If the pattern appears in two or more files, extract to a shared utility. Where they live here:

- `packages/domain/src/` — business rules shared by api and web (no I/O, no framework imports)
- `packages/api/src/lib/` — api-only helpers (auth, errors, validation, storage, clock)
- `packages/web/src/lib/` — web-only helpers (`utils.ts`, `format.ts`, `api.ts`)

Check the existing files there before creating a new one.

## Build Output (for projects that bundle)

This repo ships two bundles: `packages/web` is built by Vite for browsers, and `packages/api` runs as a Vercel Function (Node) from `src/index.ts`. The bundled output has its own broken-window category: runtime-incompatible code that compiled fine but won't execute in production.

After `pnpm build`, inspect the output for:

- ES module syntax (`import`/`export`) when the runtime expects CommonJS or a different format
- Node.js globals (`Buffer`, `process`, `__dirname`) when targeting a runtime that lacks them
- Modern JS features beyond the runtime's supported version (e.g., `Array.prototype.at()` on a pre-ES2022 target)
- Dead code that the bundler didn't tree-shake (unused imports surviving the build)
- Source-map references when production builds shouldn't include them

Web code must not reach Node globals (`Buffer`, `process`, `__dirname`) or import from `packages/api` except its route types (`hono/client`). Api code runs on Vercel Functions: do not rely on in-process state surviving between requests (background jobs run from the `/api/jobs/tick` cron, not the interval in `server.ts`).

## Order — TS/JS Workflow

1. Complete primary task
2. Run `pnpm check`
3. If the change touches `packages/web`, run `pnpm build` and verify the output
4. Exercise the changed path in `pnpm dev` (web UI or API request)
5. Fix any broken windows surfaced
6. Re-run the relevant checks to confirm a clean state

Skipping step 3 is the most common silent-bug path for the web bundle — type checks and tests pass against the source, but the bundled output is what runs in production.
