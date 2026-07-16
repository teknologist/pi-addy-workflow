# Dependency Graph

## Most Imported Files (change these carefully)

- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **82** files
- `extensions/workflow-monitor/workflow-stats.ts` — imported by **23** files
- `extensions/workflow-monitor/command-router.ts` — imported by **21** files
- `extensions/workflow-monitor/workflow-state-store.ts` — imported by **18** files
- `extensions/workflow-monitor/workflow-core.ts` — imported by **17** files
- `extensions/workflow-monitor/auto-control.ts` — imported by **15** files
- `extensions/workflow-monitor/workflow-dispatch-options.ts` — imported by **10** files
- `extensions/workflow-monitor/workflow-tracker.ts` — imported by **8** files
- `extensions/workflow-monitor/auto-lifecycle.ts` — imported by **8** files
- `extensions/workflow-monitor/plan-task-lifecycle.ts` — imported by **8** files
- `extensions/workflow-monitor/workflow-runtime.ts` — imported by **7** files
- `extensions/workflow-monitor/auto-action-keys.ts` — imported by **7** files
- `extensions/workflow-monitor/ticket-phase-result.ts` — imported by **7** files
- `extensions/workflow-monitor/fresh-continuation.ts` — imported by **6** files
- `extensions/workflow-monitor/workflow-stats-target.ts` — imported by **6** files
- `extensions/workflow-monitor/ticket-result-ingestion.ts` — imported by **6** files
- `extensions/workflow-monitor/workflow-host-events.ts` — imported by **6** files
- `extensions/workflow-monitor/ticket-prompt.ts` — imported by **6** files
- `extensions/workflow-monitor/workflow-phases.ts` — imported by **6** files
- `extensions/workflow-monitor/ticket-command.ts` — imported by **5** files

## Import Map (who imports what)

- `extensions/workflow-monitor/workflow-transitions.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/agent-end-review-stats.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts` +77 more
- `extensions/workflow-monitor/workflow-stats.ts` ← `extensions/workflow-monitor/agent-end-review-stats.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/auto-loop.ts` +18 more
- `extensions/workflow-monitor/command-router.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-finish.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/auto-recovery-prompt-policy.ts` +16 more
- `extensions/workflow-monitor/workflow-state-store.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-agent-finish.ts`, `extensions/workflow-monitor/auto-prompt-dispatcher.ts` +13 more
- `extensions/workflow-monitor/workflow-core.ts` ← `extensions/workflow-monitor/dashboard-server.ts`, `extensions/workflow-monitor/renderers.ts`, `extensions/workflow-monitor/ticket-clarification.ts`, `extensions/workflow-monitor/ticket-presentation.ts`, `extensions/workflow-monitor/workflow-state-codec-auto-control.ts` +12 more
- `extensions/workflow-monitor/auto-control.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/auto-prompt-dispatcher.ts`, `extensions/workflow-monitor/auto-workflow-decision.ts`, `extensions/workflow-monitor/fresh-continuation-pending-state.ts`, `extensions/workflow-monitor/provider-transport-retry.ts` +10 more
- `extensions/workflow-monitor/workflow-dispatch-options.ts` ← `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-review-fix-loop.ts`, `extensions/workflow-monitor/auto-watchdog.ts`, `extensions/workflow-monitor/fresh-continuation-delivery.ts` +5 more
- `extensions/workflow-monitor/workflow-tracker.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/command-dispatch.ts`, `extensions/workflow-monitor/composition.ts`, `extensions/workflow-monitor/workflow-state-store.ts` +3 more
- `extensions/workflow-monitor/auto-lifecycle.ts` ← `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-loop.ts`, `extensions/workflow-monitor/auto-watchdog.ts`, `extensions/workflow-monitor/command-registry.ts` +3 more
- `extensions/workflow-monitor/plan-task-lifecycle.ts` ← `extensions/workflow-monitor/plan-task-reader.ts`, `extensions/workflow-monitor/plan-task-resolution.ts`, `extensions/workflow-monitor/workflow-state-codec-commits.ts`, `tests/auto-lifecycle.test.ts`, `tests/dashboard-server.test.ts` +3 more
