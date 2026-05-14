# Addy workflow session stats plan

Spec: `docs/specs/2026-05-14-135237-addy-auto-session-stats.md`

## Dependency graph

- `extensions/workflow-monitor.ts` is the integration point for Pi events, registered commands, auto dispatch, review text parsing, and final auto completion.
- `extensions/workflow-monitor/workflow-transitions.ts` owns `WorkflowState`, command-to-phase transitions, auto-mode toggling, and reset behavior.
- `extensions/workflow-monitor/workflow-handler.ts` owns state lookup/persistence through in-memory state, JSON files, session entries, and widget refresh.
- `extensions/workflow-monitor/workflow-tracker.ts` owns state normalization, plan task/slice detection, footer rendering, and next lifecycle action selection.
- `prompts/addy-*.md` define command-visible obligations for manual workflows and auto final reporting.
- `tests/workflow-tracker.test.ts`, `tests/workflow-monitor.test.ts`, and `tests/validate-assets.test.ts` cover state, extension behavior, and packaged prompts.

## Task 1: Persist task turn stats and expose `/addy-stats`

- [x] Implemented
- [x] Verified
- [x] Reviewed

### Acceptance criteria

- `WorkflowState` has compact optional stats with active session plus preserved history.
- Missing or legacy persisted stats normalize to an empty active stats state and empty history.
- Manual `/addy-build`, `/addy-verify`, `/addy-code-simplify`, `/addy-fix-all`, and `/addy-finish` turns increment the active task turn count when `autoMode` is false.
- Stats keys group by active plan/slice and current task index/title.
- New `/addy-stats [plan-path]` command is registered and read-only.
- `/addy-stats` renders current task/slice totals and `No Addy stats recorded yet` when empty.
- `/addy-workflow-reset` archives active stats into history instead of deleting historical stats.

### Verification

- Add tests for legacy stats migration, manual turn increments, `/addy-stats` read-only behavior, and reset preserving history.
- Run `npm test` and `npm run typecheck`.

### Checkpoint

- Stop after this task if stats persistence or reset-history semantics are unclear.

## Task 2: Count review runs and surfaced issues

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Acceptance criteria

- Each `/addy-review` execution for the active task increments `reviewRuns` exactly once.
- `No issues found` records zero surfaced issues.
- Parseable `Critical`, `Important`, and `Suggestion` findings increment total surfaced issues and severity buckets.
- Unparseable but explicit issue output records `unknown` only when the review clearly found issues.
- Review reruns after `/addy-fix-all` count as separate review runs.
- Existing auto review fix-loop behavior still uses the same finding detection semantics or a shared helper.

### Verification

- Add tests for clean review, severity-counted review findings, repeated review runs, and unknown issue fallback.
- Run `npm test` and `npm run typecheck`.

### Checkpoint

- Confirm issue counting remains aggregate-only and does not store full review text.

## Task 3: Aggregate stats during `/addy-auto` loops

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Acceptance criteria

- When `autoMode` is true, `/addy-auto` owns stats aggregation for dispatched build, verify, review, fix-all, finish, and commit continuation prompts.
- Auto-dispatched prompts increment the correct task and slice counters without double-counting the later expanded prompt input.
- Task commits and finish completion preserve stats and end/archive the active stats session with an appropriate end reason.
- `/addy-auto stop` preserves active and historical stats.
- Final auto completion notification/output includes aggregate stats for the completed or stopped loop.
- Slice grouping works when numbered slice plans advance through existing tracker logic.

### Verification

- Add tests for auto dispatch turn increments, no double-counting, stop preservation, finish archiving, and multi-slice grouping.
- Run `npm test` and `npm run typecheck`.

### Checkpoint

- Stop if accurate turn ownership requires Pi core changes rather than extension-level event handling.

## Task 4: Wire prompts, package validation, and completion summaries

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Acceptance criteria

- Add `prompts/addy-stats.md` with read-only command instructions.
- Update `prompts/addy-auto.md` to require final aggregate stats output.
- Update `prompts/addy-review.md` only as needed to keep review issue categories machine-readable.
- Update `prompts/addy-finish.md` only as needed to require single-task completion stats output.
- `tests/validate-assets.test.ts` includes `addy-stats` in packaged prompt validation.
- Existing prompt argument/path tests still pass.

### Verification

- Add or update prompt validation tests.
- Run `npm test` and `npm run typecheck`.

### Checkpoint

- Review final diff for scope creep: no metrics service, dashboard daemon, transcript storage, or telemetry exporter.

## Overall verification

- `npm test`
- `npm run typecheck`
- Manual smoke test with a small two-task plan:
  1. run one manual lifecycle step and inspect `/addy-stats`;
  2. run a clean review and inspect zero issues;
  3. simulate or run a review with findings;
  4. run `/addy-auto` through at least one task and confirm final grouped totals.

## Risks and decisions

- Turn counting must avoid double-counting auto-dispatched prompts when the expanded invocation returns through the normal input hook.
- Issue counting should reuse or centralize existing review finding parsing to avoid divergent review semantics.
- Historical stats retention means reset behavior must become archive-not-delete for `WorkflowState.stats`, while lifecycle fields still reset normally.
- Keep stored stats compact; no raw review text, logs, or transcripts.
