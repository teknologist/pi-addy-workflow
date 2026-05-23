# Dependency Graph

## Most Imported Files (change these carefully)

- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **13** files
- `extensions/workflow-monitor/command-router.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-stats.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-state-store.ts` — imported by **4** files
- `extensions/workflow-monitor/config.ts` — imported by **3** files
- `extensions/workflow-monitor/workflow-tracker.ts` — imported by **3** files
- `extensions/workflow-monitor/workflow-timer-loop.ts` — imported by **3** files
- `extensions/workflow-monitor/workflow-plan-path.ts` — imported by **3** files
- `extensions/workflow-monitor/task-commit-coordinator.ts` — imported by **2** files
- `extensions/workflow-monitor/command-dispatch.ts` — imported by **2** files
- `extensions/workflow-monitor.ts` — imported by **2** files
- `extensions/workflow-monitor/workflow-state-codec.ts` — imported by **2** files
- `tests/helpers.ts` — imported by **2** files
- `extensions/workflow-monitor/workflow-runtime.ts` — imported by **2** files
- `extensions/bootstrap/core.ts` — imported by **1** files
- `extensions/workflow-monitor/review-control.ts` — imported by **1** files
- `extensions/workflow-monitor/auto-control.ts` — imported by **1** files
- `extensions/workflow-monitor/repository-scope.ts` — imported by **1** files
- `extensions/workflow-monitor/plan-task-lifecycle.ts` — imported by **1** files
- `extensions/workflow-monitor/warnings.ts` — imported by **1** files

## Import Map (who imports what)

- `extensions/workflow-monitor/workflow-transitions.ts` ← `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/command-router.ts`, `extensions/workflow-monitor/review-control.ts`, `extensions/workflow-monitor/review-findings.ts` +8 more
- `extensions/workflow-monitor/command-router.ts` ← `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/prompt-template.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`, `extensions/workflow-monitor/workflow-stats.ts`
- `extensions/workflow-monitor/workflow-stats.ts` ← `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`, `extensions/workflow-monitor/workflow-state-codec.ts`, `tests/auto-agent-end.test.ts`
- `extensions/workflow-monitor/workflow-state-store.ts` ← `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/fresh-continuation.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`, `tests/workflow-state-store.test.ts`
- `extensions/workflow-monitor/config.ts` ← `extensions/workflow-monitor/command-dispatch.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`, `tests/workflow-monitor.test.ts`
- `extensions/workflow-monitor/workflow-tracker.ts` ← `extensions/workflow-monitor/command-dispatch.ts`, `tests/auto-action-keys.test.ts`, `tests/workflow-state-codec.test.ts`
- `extensions/workflow-monitor/workflow-timer-loop.ts` ← `extensions/workflow-monitor/fresh-continuation.ts`, `extensions/workflow-monitor.ts`, `tests/workflow-timer-loop.test.ts`
- `extensions/workflow-monitor/workflow-plan-path.ts` ← `extensions/workflow-monitor/task-commit-coordinator.ts`, `extensions/workflow-monitor/workflow-tracker.ts`, `extensions/workflow-monitor.ts`
- `extensions/workflow-monitor/task-commit-coordinator.ts` ← `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor.ts`
- `extensions/workflow-monitor/command-dispatch.ts` ← `extensions/workflow-monitor/fresh-continuation.ts`, `extensions/workflow-monitor/task-commit-coordinator.ts`
