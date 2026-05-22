# pi-addy-workflow — Overview

> **Navigation aid.** This article shows WHERE things live (routes, models, files). Read actual source files before implementing new features or making changes.

**pi-addy-workflow** is a typescript project built with raw-http.

## Scale

7 library files · 6 environment variables

## High-Impact Files

Changes to these files have the widest blast radius across the codebase:

- `extensions/workflow-monitor.ts` — imported by **2** files
- `tests/helpers.ts` — imported by **2** files
- `extensions/bootstrap/core.ts` — imported by **1** files
- `extensions/workflow-monitor/workflow-transitions.ts` — imported by **1** files
- `extensions/workflow-monitor/warnings.ts` — imported by **1** files
- `extensions/bootstrap.ts` — imported by **1** files

## Required Environment Variables

- `HOME` — `extensions/agent-installer/core.ts`
- `PI_ADDY_AUTO_FRESH_CONTEXT_BEFORE_REVIEW` — `tests/workflow-monitor.test.ts`
- `PI_ADDY_AUTO_FRESH_CONTEXT_BETWEEN_TASKS` — `tests/workflow-monitor.test.ts`
- `PI_ADDY_FRESH_CONTEXT_BEFORE_EVERY_STEP` — `tests/workflow-monitor.test.ts`
- `PI_ADDY_WORKFLOW_STATE_DIR` — `extensions/workflow-monitor/workflow-handler.ts`
- `PI_SUBAGENT_CHILD` — `extensions/workflow-monitor.ts`

---
_Back to [index.md](./index.md) · Generated 2026-05-22_