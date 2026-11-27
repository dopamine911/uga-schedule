# Rule Map

Maps the rules in `.agents/rules/` to task types for this repo. The Craft skill (`.agents/skills/the-craft/SKILL.md` §4) reads this to work out which rules apply.

Without this file the skill falls back to the `always_on` and `applies_to` frontmatter on each rule. This file wins when the two disagree.

---

## Always-on

Rules that apply to every task, regardless of work type:

- `.agents/rules/the-posture.md` — operating posture; wins over every other rule here
- `.agents/rules/agent-discipline-general.md` — output anti-patterns, STUCK criteria
- `.agents/rules/broken-windows-general.md` — code quality ratchet

## By task type

| Task type                                                            | Rules                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Any TypeScript in `packages/domain`, `packages/api`, `packages/web`, or `scripts/` | `.agents/rules/agent-discipline-ts.md`, `.agents/rules/broken-windows-ts.md` |
| React UI in `packages/web`                                           | the two TS rules above, plus the `react-doctor` skill (`.claude/skills/react-doctor/`) |

---

## Conventions for entries

- One rule per line in the always-on section
- One row per task type in the by-task-type table
- Reference rules by relative path from project root
- Add a short note after the dash describing what the rule covers - keeps the map readable without forcing a full read of each rule

## When to extend this map

Add a new entry when:

- You add a new rule file that should be loaded for a specific kind of work
- A task type recurs often enough that explicit mapping beats relying on frontmatter inference
- You want to override the default behavior (e.g., a rule that's normally `always_on` should be skipped for this project)

## What not to put here

- Rule content itself - that lives in the rule files
- Project conventions and commands - those live in `README.md`
- Product rules - those live in `specs/`

The map is metadata. Keep it lean.
