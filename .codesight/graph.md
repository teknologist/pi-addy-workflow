# Dependency Graph

## Most Imported Files (change these carefully)

- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **5** files
- `extensions/workflow-monitor/workflow-tracker.ts` — imported by **4** files
- `extensions/workflow-monitor/workflow-handler.ts` — imported by **3** files
- `extensions/agent-installer/core.ts` — imported by **2** files
- `extensions/bootstrap/core.ts` — imported by **2** files
- `extensions/workflow-monitor.ts` — imported by **2** files
- `extensions/workflow-monitor/warnings.ts` — imported by **1** files
- `extensions/bootstrap.ts` — imported by **1** files
- `extensions/agent-installer.ts` — imported by **1** files

## Import Map (who imports what)

- `extensions/workflow-monitor/workflow-transitions.ts` ← `extensions/workflow-monitor/warnings.ts`, `extensions/workflow-monitor/workflow-handler.ts`, `extensions/workflow-monitor/workflow-tracker.ts`, `extensions/workflow-monitor.ts`, `tests/workflow-tracker.test.ts`
- `extensions/workflow-monitor/workflow-tracker.ts` ← `extensions/workflow-monitor/workflow-handler.ts`, `extensions/workflow-monitor.ts`, `tests/workflow-monitor.test.ts`, `tests/workflow-tracker.test.ts`
- `extensions/workflow-monitor/workflow-handler.ts` ← `extensions/workflow-monitor.ts`, `tests/workflow-monitor.test.ts`, `tests/workflow-tracker.test.ts`
- `extensions/agent-installer/core.ts` ← `extensions/agent-installer.ts`, `tests/agent-installer.test.ts`
- `extensions/bootstrap/core.ts` ← `extensions/bootstrap.ts`, `tests/bootstrap.test.ts`
- `extensions/workflow-monitor.ts` ← `tests/validate-assets.test.ts`, `tests/workflow-monitor.test.ts`
- `extensions/workflow-monitor/warnings.ts` ← `extensions/workflow-monitor/workflow-handler.ts`
- `extensions/bootstrap.ts` ← `tests/validate-assets.test.ts`
- `extensions/agent-installer.ts` ← `tests/validate-assets.test.ts`
