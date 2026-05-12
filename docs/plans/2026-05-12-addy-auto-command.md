# `/addy-auto` implementation plan

## Dependency graph

`prompts/addy-auto.md` depends on existing plan-selection/lifecycle prompt rules from `/addy-build`, `/addy-verify`, and `/addy-review`.

Footer auto-mode display depends on workflow state in `workflow-transitions.ts`, persistence/coercion in `workflow-handler.ts`, and rendering in `workflow-tracker.ts`.

Asset validation depends on `tests/validate-assets.test.ts`; runtime state behavior depends on `tests/workflow-monitor.test.ts` and `tests/workflow-tracker.test.ts`.

## Task 1: Add packaged auto prompt

- [x] Implemented
- [x] Verified
- [x] Reviewed

### Acceptance criteria

- `prompts/addy-auto.md` exists and is included in the packaged prompt list.
- The prompt documents `/addy-auto [plan-path]` and `/addy-auto stop`.
- The prompt uses the active plan when no path is supplied and follows existing Addy plan-selection rules.
- The prompt states that `/addy-auto` may commit after build, verify, and review pass.

### Verification

- `npm test -- tests/validate-assets.test.ts`
- `npm test`

### Checkpoint

- `/addy-auto` is discoverable, but runtime auto-mode state may still be pending.

## Task 2: Store and render auto mode

- [x] Implemented
- [x] Verified
- [x] Reviewed

### Acceptance criteria

- Workflow state stores whether auto mode is active.
- `/addy-auto <plan-path>` or bare `/addy-auto` sets auto mode active without losing active spec, plan, or task progress.
- `/addy-auto stop` clears auto mode without clearing active spec, plan, or task progress.
- Footer renders `🔁 Addy Workflow:` only while auto mode is active.
- Manual mode continues to render `Addy Workflow:` with no emoji.

### Verification

- `npm test -- tests/workflow-monitor.test.ts tests/workflow-tracker.test.ts`
- `npm run typecheck`

### Checkpoint

- Users can see and stop auto mode before the full autonomous loop is relied on.

## Task 3: Define the autonomous task loop

- [x] Implemented
- [x] Verified
- [x] Reviewed

### Acceptance criteria

- The prompt instructs the agent to repeat build → verify → review → commit for each unfinished task.
- The loop re-reads the plan after every phase and keeps lifecycle checkbox ownership intact.
- The loop advances to the next unambiguous slice using active-plan links, index files, or ordered slice filenames.
- The loop tries autonomous recovery for failed tests, typecheck, review blockers, expected git state issues, and ambiguous-but-inferable next slices before stopping.
- The loop asks the user only for unsafe, destructive, external, or genuinely undecidable choices.

### Verification

- `npm test -- tests/validate-assets.test.ts`
- Manual prompt review against the spec boundaries.

### Checkpoint

- `/addy-auto` has full autonomous instructions; no implementation work should start from this plan unless explicitly requested.

## Task 4: Validate end-to-end workflow behavior

- [x] Implemented
- [x] Verified
- [x] Reviewed

### Acceptance criteria

- Tests cover prompt packaging, auto-mode rendering, stop behavior, and state preservation.
- Existing `/addy-build`, `/addy-verify`, `/addy-review`, `/addy-finish`, and workflow widget tests still pass.
- Manual smoke notes confirm `/addy-auto <plan-path>` can identify the current task and intended next lifecycle step from a heading/status slice plan.
- Final report includes checks run, review result, commit behavior, and any known limitations.

### Verification

- `npm test`
- `npm run typecheck`

### Manual smoke notes

- Active heading/status plan: `docs/plans/2026-05-12-addy-auto-command.md`.
- Current task identified from unchecked lifecycle status: `Task 4: Validate end-to-end workflow behavior`.
- Intended next lifecycle step from `/addy-auto docs/plans/2026-05-12-addy-auto-command.md`: continue with `/addy-build` for Task 4 because `Implemented` was unchecked.

### Final report checklist

- Include checks run.
- Include review result.
- Include commit behavior.
- Include known limitations.

### Checkpoint

- Feature is ready for user approval to build, verify, and review.
