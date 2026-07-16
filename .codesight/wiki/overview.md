# pi-addy-workflow — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**pi-addy-workflow** is a typescript project built with raw-http.

## Scale

1 API routes · 108 library files · 2 middleware layers · 7 environment variables

## Subsystems

- **[Dashboard-server](./dashboard-server.md)** — 1 routes — touches: auth, cache, queue

**Libraries:** 108 files — see [libraries.md](./libraries.md)

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **80** files
- `extensions/workflow-monitor/workflow-stats.ts` — imported by **22** files
- `extensions/workflow-monitor/command-router.ts` — imported by **21** files
- `extensions/workflow-monitor/workflow-state-store.ts` — imported by **18** files
- `extensions/workflow-monitor/workflow-core.ts` — imported by **16** files
- `extensions/workflow-monitor/auto-control.ts` — imported by **12** files

## Required Environment Variables

- `HOME` — `extensions/agent-installer/core.ts`
- `PATH` — `extensions/dashboard-installer/core.ts`
- `PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW` — `tests/addy-auto-fixture-loop.test.ts`
- `PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS` — `tests/addy-auto-fixture-loop.test.ts`
- `PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP` — `tests/addy-auto-fixture-loop.test.ts`
- `PI_ADDY_WORKFLOW_STATE_DIR` — `extensions/workflow-monitor/workflow-state-store-scope.ts`
- `PI_SUBAGENT_CHILD` — `extensions/workflow-monitor/auto-runner-lock.ts`

---
_Back to [index.md](./index.md) · Generated 2026-07-16_