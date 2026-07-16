## What to build

Run the full external-progress acceptance matrix, repair only integration defects, and leave concrete compatibility proof.

## Required context

- [Master plan](https://github.com/teknologist/pi-addy-workflow/blob/feat/df-implement-issues-compat/docs/plans/2026-07-14-external-issue-workflow-progress.md)
- [This slice](https://github.com/teknologist/pi-addy-workflow/blob/feat/df-implement-issues-compat/docs/plans/2026-07-14-external-issue-workflow-progress-slice-07-integration.md)
- [Specification](https://github.com/teknologist/pi-addy-workflow/blob/feat/df-implement-issues-compat/docs/specs/2026-07-13-external-issue-workflow-progress.md)
- [ADR 0001](https://github.com/teknologist/pi-addy-workflow/blob/feat/df-implement-issues-compat/docs/adr/0001-addy-auto-runner-lock.md)
- [Repository guidance](https://github.com/teknologist/pi-addy-workflow/blob/feat/df-implement-issues-compat/AGENTS.md)

## Immutable constraints

- Keep external progress separate from `WorkflowState` and all Addy lifecycle, reset, auto, dispatch, statistics, warnings, and runner-lock ownership; Addy is read-only.
- Do not change AFK or `pi-dynamic-workflows` grammar, package, storage, journals, or live-agent model.
- Use Node.js standard library and existing utilities only: no dependency, daemon, database, or installer framework.
- Never persist prompts, scripts, arguments, logs, results, journals, tracker comments, tokens, secrets, or live-agent data.
- Before editing a user-level prompt, resolve and edit its chezmoi source, then apply it. Keep changes surgical; do not commit unless instructed; do not alter tool-owned `.codesight/` files.

## Acceptance criteria

- [x] Every specification acceptance criterion has command output, test output, or manual observable proof.
- [x] With no external data, widget lines and regular dashboard fields remain unchanged.
- [x] External data changes none of Addy lifecycle, commands, reset/auto behavior, warnings, statistics, runner locks, fencing, dispatch, or stop intent.
- [x] AFK grammar/extension and `pi-dynamic-workflows` files remain untouched.
- [x] Only approved snapshot fields persist; no sensitive/raw workflow content appears.
- [x] Working tree contains only intended feature, managed-prompt source, plan/spec, and tool-owned `.codesight` changes.

## Verification / proof

Run `node --experimental-strip-types --test tests/external-progress.test.ts tests/dashboard-installer.test.ts tests/workflow-widget-presenter.test.ts tests/dashboard-server.test.ts tests/validate-assets.test.ts`, `npm test`, `npm run typecheck`, `npm run format:check`, and `git diff --check`. Complete all nine specification manual checks and the slice completion audit; no skipped or hidden failures.

## Stop conditions

- Stop if any immutable boundary is violated or a required check cannot run in the real prompt environment.
- Do not weaken tests, change AFK/dynamic-workflow packages, or broaden into unrelated behavior.
- This is not independently actionable: first obtain implementation/review evidence from slices 01–06 and concrete direct, AFK-supervised, and multi-wave fixtures.

## Blocked by

- #3
- #4
- #5
- #6
