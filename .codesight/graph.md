# Dependency Graph

## Most Imported Files (change these carefully)

- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **70** files
- `extensions/workflow-monitor/workflow-stats.ts` — imported by **21** files
- `extensions/workflow-monitor/command-router.ts` — imported by **20** files
- `extensions/workflow-monitor/workflow-state-store.ts` — imported by **18** files
- `extensions/workflow-monitor/workflow-core.ts` — imported by **14** files
- `extensions/workflow-monitor/workflow-dispatch-options.ts` — imported by **10** files
- `extensions/workflow-monitor/workflow-stats-target.ts` — imported by **7** files
- `extensions/workflow-monitor/workflow-runtime.ts` — imported by **7** files
- `extensions/workflow-monitor/plan-task-lifecycle.ts` — imported by **7** files
- `extensions/workflow-monitor/fresh-continuation.ts` — imported by **6** files
- `extensions/workflow-monitor/workflow-tracker.ts` — imported by **6** files
- `extensions/workflow-monitor/auto-lifecycle.ts` — imported by **6** files
- `extensions/workflow-monitor/workflow-task-identity.ts` — imported by **5** files
- `extensions/workflow-monitor/prompt-template.ts` — imported by **5** files
- `extensions/workflow-monitor/auto-control.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-phases.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-state-normalizer.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-state-codec.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-plan-continuation.ts` — imported by **4** files
- `extensions/workflow-monitor/command-dispatch.ts` — imported by **4** files

## Import Map (who imports what)

- `extensions/workflow-monitor/workflow-transitions.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/agent-end-review-stats.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts` +65 more
- `extensions/workflow-monitor/workflow-stats.ts` ← `extensions/workflow-monitor/agent-end-review-stats.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/auto-loop.ts` +16 more
- `extensions/workflow-monitor/command-router.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/auto-action-keys.ts`, `extensions/workflow-monitor/auto-agent-finish.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/auto-recovery-prompt-policy.ts` +15 more
- `extensions/workflow-monitor/workflow-state-store.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-agent-finish.ts`, `extensions/workflow-monitor/auto-prompt-dispatcher.ts` +13 more
- `extensions/workflow-monitor/workflow-core.ts` ← `extensions/workflow-monitor/renderers.ts`, `extensions/workflow-monitor/workflow-state-codec-auto-control.ts`, `extensions/workflow-monitor/workflow-state-codec-auto.ts`, `extensions/workflow-monitor/workflow-state-codec-metadata.ts`, `extensions/workflow-monitor/workflow-state-codec-review.ts` +9 more
- `extensions/workflow-monitor/workflow-dispatch-options.ts` ← `extensions/workflow-monitor/agent-end-handler.ts`, `extensions/workflow-monitor/auto-agent-end.ts`, `extensions/workflow-monitor/auto-review-fix-loop.ts`, `extensions/workflow-monitor/auto-watchdog.ts`, `extensions/workflow-monitor/fresh-continuation-delivery.ts` +5 more
- `extensions/workflow-monitor/workflow-stats-target.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/auto-lifecycle.ts`, `extensions/workflow-monitor/command-registry.ts`, `extensions/workflow-monitor/composition.ts` +2 more
- `extensions/workflow-monitor/workflow-runtime.ts` ← `extensions/workflow-monitor/auto-watchdog.ts`, `extensions/workflow-monitor/composition.ts`, `extensions/workflow-monitor/fresh-continuation-delivery.ts`, `extensions/workflow-monitor/fresh-continuation-runtime.ts`, `tests/auto-watchdog.test.ts` +2 more
- `extensions/workflow-monitor/plan-task-lifecycle.ts` ← `extensions/workflow-monitor/plan-task-reader.ts`, `extensions/workflow-monitor/plan-task-resolution.ts`, `extensions/workflow-monitor/workflow-state-codec-commits.ts`, `tests/auto-lifecycle.test.ts`, `tests/plan-task-resolution.test.ts` +2 more
- `extensions/workflow-monitor/fresh-continuation.ts` ← `extensions/workflow-monitor/addy-auto-command.ts`, `extensions/workflow-monitor/auto-loop.ts`, `extensions/workflow-monitor/auto-prompt-dispatcher.ts`, `extensions/workflow-monitor/auto-workflow-orchestrator.ts`, `extensions/workflow-monitor/command-registry.ts` +1 more
