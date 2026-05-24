# pi-addy-workflow — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**pi-addy-workflow** is a typescript project built with raw-http.

## Scale

96 library files · 2 middleware layers · 6 environment variables

**Libraries:** 96 files — see [libraries.md](./libraries.md)

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **70** files
- `extensions/workflow-monitor/workflow-stats.ts` — imported by **21** files
- `extensions/workflow-monitor/command-router.ts` — imported by **20** files
- `extensions/workflow-monitor/workflow-state-store.ts` — imported by **18** files
- `extensions/workflow-monitor/workflow-core.ts` — imported by **14** files
- `extensions/workflow-monitor/workflow-dispatch-options.ts` — imported by **10** files

## Required Environment Variables

- `HOME` — `extensions/agent-installer/core.ts`
- `PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW` — `tests/workflow-monitor.test.ts`
- `PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS` — `tests/workflow-monitor.test.ts`
- `PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP` — `tests/workflow-monitor.test.ts`
- `PI_ADDY_WORKFLOW_STATE_DIR` — `extensions/workflow-monitor/workflow-state-store-scope.ts`
- `PI_SUBAGENT_CHILD` — `extensions/workflow-monitor/workflow-host-events.ts`

---
_Back to [index.md](./index.md) · Generated 2026-05-24_