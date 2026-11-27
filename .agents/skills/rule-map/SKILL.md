---
name: rule-map
description: >
  Quick reference for which rules govern the current work. Consult mid-task
  when starting a new task type, touching unfamiliar code, or unsure which
  constraints apply. Pairs with the-craft skill (full manual). Trigger on:
  "which rules apply", "what rules should I follow", "check constraints",
  or proactively when switching task type mid-session. Also use when any
  two rules appear to conflict — the always-on rules explain precedence.
---

# Rule Map — Quick Reference

The authoritative map is `.agents/rules/rule-map.md`. This table summarises each rule's key constraint so you can pick without opening every file; open the rule before acting on it.

## Always-On (Every Task)

| Rule | Key constraint |
|------|---------------|
| `.agents/rules/the-posture.md` | Operating posture wins over everything. Agent-built codebase — defaults from typical projects are wrong here. Verbose+plain+boring code (Atwood: write for a junior, not to impress). Assume wrong, stop on surprise, one thing at a time, ask before continuing, nothing done until seen it run. |
| `.agents/rules/agent-discipline-general.md` | No TODOs in delivered code. No gold plating. Never weaken tests. No magic values. STUCK after 2 failed approaches. |
| `.agents/rules/broken-windows-general.md` | Fix broken windows when encountered, after the primary task; over ~15 minutes or 3 unrelated files, file a follow-up instead. Search before writing a derived expression; extract a helper at the third copy. |

## By Task Type

| Task | Rule file | Key constraint |
|------|-----------|---------------|
| Any TypeScript | `.agents/rules/agent-discipline-ts.md` | No `@ts-ignore` / `@ts-expect-error` / `as any` in tests; in production only with a why-comment. No `.skip` / `.only` without a tracked issue. Named constants in `SCREAMING_SNAKE_CASE`. |
| Any TypeScript | `.agents/rules/broken-windows-ts.md` | `pnpm check` (lint, format:check, typecheck, test) passes before done. No inline lint disables. Shared logic goes in `packages/domain/src/`, api helpers in `packages/api/src/lib/`, web helpers in `packages/web/src/lib/`. Run `pnpm build` when `packages/web` changes. |
| React UI (`packages/web`) | `react-doctor` skill | Run `pnpm doctor` on React changes. |

## Conflict Resolution

When two rules conflict, surface it immediately — do not silently pick a side. Precedence order:

1. `.agents/rules/the-posture.md` (wins over everything)
2. All other rules (use judgment; name which rule you're prioritizing and why)

If precedence is still unclear, ask the user.
