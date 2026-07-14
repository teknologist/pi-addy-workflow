# External issue-workflow progress implementation plan

## Goal

Implement the approved external progress contract from `docs/specs/2026-07-13-external-issue-workflow-progress.md` without changing Addy lifecycle state, AFK grammar/extension behavior, or `pi-dynamic-workflows` internals.

This is a split plan. Each slice is an AFK-safe handoff boundary with one independently verifiable task.

## Required context

- Spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Steering: `AGENTS.md`
- Managed prompt sources:
  - `/Users/eric/.local/share/chezmoi/dot_pi/agent/prompts/df-implement-issues.md`
  - `/Users/eric/.local/share/chezmoi/dot_pi/agent/prompts/implement-from-issues.md`

## Immutable constraints

- External progress remains separate from persisted `WorkflowState` and Addy's lifecycle, reset, auto mode, dispatch, statistics, warnings, and runner-lock ownership.
- Addy is a read-only observer of external runs.
- Do not modify the AFK extension/grammar or `pi-dynamic-workflows` package, storage, journals, or live-agent model.
- Use Node.js standard library and existing repository utilities; add no dependency, daemon, database, or installer framework.
- Never store prompts, scripts, arguments, logs, results, journals, tracker comments, tokens, secrets, or live-agent data.
- Before editing either user-level prompt, resolve and edit its chezmoi source, then apply it.

## Discovery findings

- Shared project key: `projectWorkflowStateKey()` in `extensions/workflow-monitor/workflow-state-store-scope.ts`; pass the canonical absolute Git common directory as its `cwd`.
- Existing shim seam: `ensureDashboardShim()` and `defaultDashboardBinDir()` in `extensions/dashboard-installer/core.ts`, installed from `extensions/dashboard-installer.ts`.
- Widget seam: `renderWorkflowWidget()` in `extensions/workflow-monitor/workflow-widget-presenter.ts`; callers already pass project `cwd`.
- Dashboard seams: `DashboardSnapshot`, `dashboardSnapshot()`, and `dashboardHtml()` in `extensions/workflow-monitor/dashboard-server.ts`.
- Package binary convention: `bin/addy-dashboard.ts` and the `package.json` `bin` map.
- Existing focused tests: `tests/dashboard-installer.test.ts`, `tests/workflow-widget-presenter.test.ts`, and `tests/dashboard-server.test.ts`.

## Execution order

| Slice | Plan                                                                              | Purpose                                     | Depends on     |
| ----- | --------------------------------------------------------------------------------- | ------------------------------------------- | -------------- |
| 01    | `docs/plans/2026-07-14-external-issue-workflow-progress-slice-01-core.md`         | Snapshot contract, persistence, selection   | —              |
| 02    | `docs/plans/2026-07-14-external-issue-workflow-progress-slice-02-publisher.md`    | CLI, package binary, runtime shim           | 01             |
| 03    | `docs/plans/2026-07-14-external-issue-workflow-progress-slice-03-widget.md`       | Read-only widget projection                 | 01             |
| 04    | `docs/plans/2026-07-14-external-issue-workflow-progress-slice-04-dashboard.md`    | API/dashboard projection                    | 01             |
| 05    | `docs/plans/2026-07-14-external-issue-workflow-progress-slice-05-issue-prompt.md` | Direct and AFK issue prompt publication     | 02             |
| 06    | `docs/plans/2026-07-14-external-issue-workflow-progress-slice-06-df-prompt.md`    | DF aggregate-wave publication               | 02             |
| 07    | `docs/plans/2026-07-14-external-issue-workflow-progress-slice-07-integration.md`  | Cross-surface compatibility and smoke proof | 03, 04, 05, 06 |

Suggested dependency waves:

1. Slice 01.
2. Slice 02, then slices 03 and 04 may proceed independently.
3. Slices 05 and 06 may proceed independently after slice 02.
4. Slice 07 after all presentation and prompt slices.

## Plan-level verification

```sh
npm test
npm run typecheck
npm run format:check
```

The final slice owns full automated and manual compatibility proof. Targeted checks remain mandatory in every earlier slice.
