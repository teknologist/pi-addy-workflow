# Slice 02 — Publisher CLI and shim

## Task 1: Expose `addy-progress` to prompt execution

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Slice 01.

### Objective

Add the standard-library CLI and extend the existing installer lifecycle so user-level prompts can invoke it by name.

### Context / files

Required context:

- Spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Steering: `AGENTS.md`
- Slice 01 plan and implemented external-progress exports.

Likely files:

- `bin/addy-progress.ts` (new)
- `package.json`
- `extensions/dashboard-installer/core.ts`
- `extensions/dashboard-installer.ts`
- `tests/external-progress.test.ts`
- `tests/dashboard-installer.test.ts`
- `tests/validate-assets.test.ts`

Relevant symbols:

- `ensureDashboardShim()`
- `defaultDashboardBinDir()`

### Implementation steps

1. Add failing CLI tests for `start`, `update`, and `finish`, including JSON stdin, exit codes, ownership mismatches, finish retry-facing errors, and generated run IDs.
2. Implement `bin/addy-progress.ts` with only Node.js standard-library parsing and the slice-01 persistence API. Require `--cwd` and `--source` on all operations and `--run` on update/finish.
3. Register `addy-progress` in the package `bin` map.
4. Extend the existing shim-writing lifecycle to install an executable `addy-progress` shim beside `addy-dashboard`. Reuse the current path and startup hooks; do not create another installer abstraction.
5. Test direct execution and command discovery from the same PATH shape used by Pi prompt execution.

### Acceptance criteria

- `start` prints only the reused/generated UUID on stdout.
- `update` and `finish` accept a small JSON object on stdin; prompt text is never shell-interpolated.
- Invalid commands or payloads return non-zero with concise stderr.
- The package binary and generated shim both execute through Node's type-stripping mode.
- Repeated installation is idempotent and preserves dashboard installation behavior.
- `~/.pi/agent/bin` is present on PATH in the actual prompt execution environment.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/external-progress.test.ts tests/dashboard-installer.test.ts tests/validate-assets.test.ts
npm run typecheck
npm run format:check
command -v addy-progress
addy-progress --help
```

Expected proof:

- Targeted tests fail before the CLI/shim exists and pass afterward.
- The resolved command points to `~/.pi/agent/bin/addy-progress` and executes successfully.
- Existing `addy-dashboard` shim tests remain green.

### Stop conditions

- Stop if the real prompt environment cannot resolve `addy-progress` through PATH after the existing lifecycle runs.
- Stop rather than inventing a second discovery mechanism, daemon, dependency, or installer framework.
