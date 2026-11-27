// Config used only by `pnpm coverage`, which passes it with `--config`. It is not
// named vitest.config.ts on purpose: vitest run inside a package with no config
// of its own searches parent directories and would pick that name up, turning
// `pnpm test` in packages/domain into a run of these root-relative projects.
//
// Running both test packages as projects of one run puts their results in one
// coverage report (coverage/), which scripts/coverage-to-markdown.ts turns into
// COVERAGE.md. packages/web has no tests, so it is not a project; its source is
// still left out of `include` so the report covers only tested packages.
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: ["packages/api", "packages/domain"],
    coverage: {
      provider: "v8",
      include: ["packages/api/src/**", "packages/domain/src/**"],
      exclude: ["**/*.test.ts", "packages/api/src/test/**"],
      reporter: ["text-summary", "html", "json-summary"],
    },
  },
})
