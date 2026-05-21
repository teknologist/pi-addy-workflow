# Dependency Graph

## Most Imported Files (change these carefully)

- `extensions/workflow-monitor.ts` — imported by **2** files
- `tests/helpers.ts` — imported by **2** files
- `extensions/bootstrap/core.ts` — imported by **1** files
- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **1** files
- `extensions/workflow-monitor/warnings.ts` — imported by **1** files
- `extensions/bootstrap.ts` — imported by **1** files
- `extensions/agent-installer.ts` — imported by **1** files
- `extensions/workflow-monitor/config.ts` — imported by **1** files

## Import Map (who imports what)

- `extensions/workflow-monitor.ts` ← `tests/validate-assets.test.ts`, `tests/workflow-monitor.test.ts`
- `tests/helpers.ts` ← `tests/workflow-monitor.test.ts`, `tests/workflow-tracker.test.ts`
- `extensions/bootstrap/core.ts` ← `extensions/bootstrap.ts`
- `extensions/workflow-monitor/workflow-transitions.ts` ← `extensions/workflow-monitor/warnings.ts`
- `extensions/workflow-monitor/warnings.ts` ← `extensions/workflow-monitor/workflow-handler.ts`
- `extensions/bootstrap.ts` ← `tests/validate-assets.test.ts`
- `extensions/agent-installer.ts` ← `tests/validate-assets.test.ts`
- `extensions/workflow-monitor/config.ts` ← `tests/workflow-monitor.test.ts`
