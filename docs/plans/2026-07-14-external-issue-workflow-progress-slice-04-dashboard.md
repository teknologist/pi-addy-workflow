# Slice 04 — Dashboard projection

## Task 1: Add the read-only Issue workflows dashboard section

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Slice 01.

### Objective

Expose selected external runs as an optional API projection and render them in a separate dashboard section without changing existing state fields or controls.

### Context / files

Required context:

- Spec: `docs/specs/2026-07-13-external-issue-workflow-progress.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Steering: `AGENTS.md`
- Slice 01 external-progress reader/selection API.

Likely files:

- `extensions/workflow-monitor/dashboard-server.ts`
- `tests/dashboard-server.test.ts`

Relevant symbols:

- `DashboardSnapshot`
- `dashboardSnapshot()`
- `dashboardHtml()`

### Implementation steps

1. Add failing tests that lock current `/api/state` fields and HTML behavior when no external snapshots exist.
2. Add optional external runs and one optional aggregate invalid-snapshot warning to `DashboardSnapshot`; preserve every existing field.
3. Read only through the slice-01 API using dashboard `cwd`. Keep the existing five-second browser refresh.
4. Add a separate **Issue workflows** section showing active runs first and newest terminal last, with phase/progress primary and boundary states secondary.
5. Escape all dynamic HTML and keep the surface read-only; add no action/control endpoint.

### Acceptance criteria

- Existing dashboard panels and `/api/state` fields are unchanged when external data is absent.
- Valid selected runs appear only in the optional external projection and separate section.
- Corrupt/unsupported files produce at most one concise dashboard/API warning and never break refresh.
- Dynamic text is escaped; no prompt/script/log/result data is exposed.
- Dashboard code does not inspect trackers, worktrees beyond project identity, raw dynamic-workflow storage, or Addy runner-lock state.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/dashboard-server.test.ts tests/external-progress.test.ts
npm run typecheck
npm run format:check
```

Expected proof:

- Regression tests fail before the optional projection exists and pass afterward.
- Tests cover no-data compatibility, active/terminal ordering, stale state, invalid warning aggregation, HTML escaping, and five-second refresh preservation.

### Stop conditions

- Stop if the implementation would change existing dashboard field meanings, add controls, or couple external progress to Addy lifecycle/ADR-0001 state.
