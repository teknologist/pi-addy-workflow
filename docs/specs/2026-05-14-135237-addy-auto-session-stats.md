# Addy workflow session stats spec

## Objective

Add durable, task-scoped stats for Addy workflow sessions so Pi users can see how much work each task or slice consumed during manual single-task flows and automated `/addy-auto` loops.

Primary users are Pi users running `pi-addy-workflow` prompts who want a concise end-of-run summary and an on-demand progress view while a task, slice, or loop is still active.

The stats must focus on:

- number of Addy workflow turns by task;
- number of review runs by task;
- number of surfaced review issues by task;
- slice-level grouping when a plan is divided into multiple slice plans.

Success means a user can run a task manually or let `/addy-auto` loop across tasks/slices, then receive a clear stats summary at the end, and can also run `/addy-stats` mid-loop to inspect current progress without changing workflow state.

### Acceptance criteria

- Addy workflow state records stats for the active workflow session without relying only on fragile final-response prose.
- Stats are stored by `/addy-auto` while auto mode is active and by individual `/addy-*` commands when no `/addy-auto` loop is active.
- Stats are grouped by task when a plan has tasks.
- Stats are additionally grouped by slice when the active plan is part of a slice sequence.
- A workflow turn counter increments for assistant turns associated with a concrete Addy task lifecycle action.
- `/addy-stats` displays the current stats snapshot while a task, slice, or `/addy-auto` loop is in progress.
- `/addy-stats` is read-only: it must not advance phases, mutate plan checkboxes, create commits, or change active task selection.
- At the end of a single-task workflow, the assistant prints the relevant task stats.
- At the end of an automated `/addy-auto` loop, the assistant prints aggregate stats for all completed tasks and slices covered by that loop.
- Review run count increments for every `/addy-review` execution associated with a task, including reruns after `/addy-fix-all`.
- Surfaced issue count increments from structured review findings associated with a task, grouped at minimum by total count and preferably by severity (`Critical`, `Important`, `Suggestion`) when available.
- `No issues found` reviews count as a review run with zero surfaced issues.
- Stats survive within the active project/session state across prompt turns and remain best-effort persisted through the existing Addy workflow state storage path.
- Stats are written as part of `WorkflowState`, not as a separate stats database, metrics service, transcript scan, or sidecar log.
- Workflow reset does not delete recorded stats; it may end the active stats session, but must preserve prior stats for future historical analysis.
- Existing Addy commands continue to work when stats are absent or when an older persisted workflow state lacks stats fields.
- Tests cover parsing, state migration defaults, rendering, and `/addy-stats` read-only behavior.

### Working definitions

- **Workflow session**: the current Addy workflow state for a project/session, starting when a task or `/addy-auto` loop begins and continuing until it is completed, reset, or superseded. Ending a session must archive its aggregate stats instead of deleting them.
- **Task**: the current plan task detected by existing workflow task parsing and displayed in the footer.
- **Slice**: the current plan file when slice progress can be inferred from numbered slice filenames or existing slice detection.
- **Turn**: one assistant turn that performs or reports a concrete Addy lifecycle action for the active task. Count build, verify, review, fix-all, finish, and auto continuation turns. Exclude read-only `/addy-stats` turns.
- **Review run**: one `/addy-review` execution scoped to the active task.
- **Surfaced issue**: one structured review finding categorized as `Critical`, `Important`, or `Suggestion`. If exact findings cannot be parsed safely, record an `unknown` issue count only when the review explicitly says issues were found.

## Commands

### New command

```text
/addy-stats [plan-path]
```

Behavior:

1. Resolve stats from the current Addy workflow state.
2. If a `plan-path` is supplied, show stats scoped to that plan/slice when present in the recorded stats.
3. If no path is supplied, show stats for the active task, active slice, and current workflow session.
4. Render a concise table-like summary:
   - slice path/name;
   - task index/title;
   - turns;
   - review runs;
   - surfaced issues total;
   - optional severity buckets.
5. Include a final total row when multiple tasks or slices are shown.
6. Report `No Addy stats recorded yet` when state has no stats instead of failing.
7. Do not mutate workflow lifecycle state.

Example output shape:

```text
Addy stats
Slice: docs/plans/feature-slice-01.md

Task                         Turns  Reviews  Issues
1. Track workflow events          4        1       2
2. Render /addy-stats             3        2       1

Totals                            7        3       3
```

### Existing command integration

- `/addy-build`, `/addy-verify`, `/addy-review`, `/addy-fix-all`, `/addy-finish`, and `/addy-auto` update stats as a side effect of normal workflow tracking.
- When `/addy-auto` is active, `/addy-auto` owns aggregation for the loop and records stats for each dispatched lifecycle prompt.
- When no `/addy-auto` loop is active, the individual `/addy-*` command being run records the stats for its active task.
- `/addy-review` must update review run and surfaced issue stats for the task it reviewed.
- `/addy-auto` final output must include the aggregate stats for the loop it just completed or stopped.
- Single-task workflows should print stats when a task reaches the end of its required lifecycle (`Implemented`, `Verified`, and `Reviewed`), or when `/addy-finish` reports task completion.
- `/addy-auto stop` must leave recorded stats intact.

## Session state storage

Use the existing Addy workflow session state as the source of truth for stats.

Current workflow state is handled by `extensions/workflow-monitor/workflow-handler.ts` and `extensions/workflow-monitor/workflow-tracker.ts`:

1. `getContextWorkflowState(ctx)` reads the newest state from the current Pi session branch, then `ctx.state`, then persisted session/project state.
2. `setContextWorkflowState(ctx, state, appendEntry)` refreshes plan task metadata, updates the in-memory state, persists JSON files, appends a `pi-addy-workflow-state` entry to Pi session history, and refreshes the footer widget.
3. State persistence is best-effort and already writes both:
   - a session-scoped key based on `sessionId`, `conversationId`, or `id` when available;
   - a project-scoped key based on `cwd` as fallback/shared project state.
4. The default persisted state directory is `~/.pi/agent/state/pi-addy-workflow`, overridable with `PI_ADDY_WORKFLOW_STATE_DIR`.
5. The persisted JSON envelope is `{ "type": "pi-addy-workflow-state", "state": <WorkflowState> }`.

Stats should therefore be added as a compact optional field on `WorkflowState`, normalized by `parseWorkflowState`/`normalizeWorkflowState`, validated by `coerceWorkflowState`, and preserved by `transitionWorkflow` when phases change. This keeps `/addy-auto` and manual `/addy-*` commands sharing the same durable state path.

Ownership rules:

- When `autoMode` is true, `/addy-auto` owns stats aggregation for the loop and records counters as it dispatches build, verify, review, fix-all, finish, and commit continuation prompts.
- When `autoMode` is false, each individual `/addy-*` command records its own stats contribution for the active task.
- `/addy-stats` only reads and renders the current `WorkflowState.stats` snapshot.
- `/addy-workflow-reset` must not delete stats. It may clear active lifecycle fields and start a new active stats session, but it must preserve historical stats in workflow state.
- `/addy-auto stop` must not clear stats.

## Project structure

Expected files to add or update:

```text
prompts/
├── addy-stats.md                 # new read-only stats command
├── addy-auto.md                  # require final aggregate stats output
├── addy-review.md                # require review/issue stats recording semantics
└── addy-finish.md                # require single-task completion stats output if needed

extensions/workflow-monitor/
├── workflow-transitions.ts       # add stats fields/types and command/event handling
├── workflow-tracker.ts           # render/normalize/parse stats state safely
├── workflow-handler.ts           # persist migrated stats and expose snapshots if needed
└── warnings.ts                   # unchanged unless stats warnings are needed

tests/
├── validate-assets.test.ts       # ensure addy-stats prompt is packaged and skill references are valid
├── workflow-transitions.test.ts  # stats mutation, migration, and read-only command behavior
└── workflow-tracker.test.ts      # stats parsing/rendering helpers if added
```

Preferred implementation:

- Extend the existing workflow monitor state instead of adding a separate database or background daemon.
- Persist stats through the existing `setContextWorkflowState` path so in-memory state, project/session JSON files, session history entries, and the footer widget remain consistent.
- Store compact aggregate counters, not full review text or full conversation transcripts.
- Reuse existing active plan, current task, task index, and slice detection helpers.
- Keep `/addy-stats` prompt-first and read-only; add runtime helpers only where necessary to make stats accurate and durable.

A possible state shape is:

```ts
type WorkflowStats = {
  activeSessionId?: string;
  active?: WorkflowStatsSession;
  history: WorkflowStatsSession[];
};

type WorkflowStatsSession = {
  id: string;
  startedAt: string;
  endedAt?: string;
  endReason?: "completed" | "reset" | "superseded" | "stopped";
  slices: Record<string, {
    label?: string;
    tasks: Record<string, {
      title: string;
      taskIndex?: number;
      turns: number;
      reviewRuns: number;
      surfacedIssues: number;
      issuesBySeverity?: {
        critical?: number;
        important?: number;
        suggestion?: number;
        unknown?: number;
      };
    }>;
  }>;
};
```

Use this only as a guide; keep the final type consistent with existing workflow state style.

## Code style

- Keep changes surgical and local to Addy workflow prompts and workflow-monitor state.
- Preserve TypeScript ES module style and current formatting.
- Prefer pure helper functions for stats normalization, keying, incrementing, and rendering.
- Make old persisted state forward-compatible: missing stats fields must normalize to empty active stats plus empty history.
- Avoid storing large text blobs, raw review output, or sensitive command logs in stats state.
- Use stable task keys that remain readable and deterministic across turns. Prefer plan path + task index + cleaned task title when available.
- Keep output concise enough for terminal use during active `/addy-auto` loops.
- Do not introduce dependencies for table rendering or persistence.

## Testing strategy

Run these checks before claiming implementation is complete:

```bash
npm test
npm run typecheck
```

Add or update tests so they verify:

- `prompts/addy-stats.md` is included in packaged prompt validation.
- Existing workflow states without stats parse successfully and receive empty stats defaults.
- A build/verify/review/fix lifecycle turn can increment the correct active task counter without corrupting phase state.
- `/addy-stats` is recognized as a read-only command and does not advance workflow phase or clear active plan/task.
- Review count increments once per `/addy-review` run.
- `No issues found` records zero surfaced issues.
- Structured `Critical`, `Important`, and `Suggestion` review findings are counted and grouped by severity when parseable.
- Stats render grouped by slice when slice progress is available.
- `/addy-auto stop` preserves stats.
- `/addy-workflow-reset` preserves historical stats and archives any active stats session instead of deleting it.
- Existing `/addy-build`, `/addy-verify`, `/addy-review`, `/addy-finish`, and `/addy-auto` tests still pass.

Manual verification:

1. Use a small plan with at least two tasks in one slice.
2. Run one task through build, verify, and review.
3. Run `/addy-stats` mid-workflow and confirm it reports the active task without changing plan checkboxes.
4. Run a review with no findings and confirm review count increments while issue count stays zero.
5. Run or simulate a review with findings and confirm issue totals update.
6. Run `/addy-auto` across two tasks or slices and confirm the final response includes grouped totals.

## Boundaries

Always do:

- Keep stats read-only from `/addy-stats`.
- Group by task first and by slice when slice information exists.
- Count review reruns separately; retries are useful signal.
- Keep stats best-effort but explicit when data is missing or unparseable.
- Preserve recorded stats across `/addy-workflow-reset` for future historical analysis.
- Preserve existing Addy lifecycle enforcement and checkbox ownership.
- Prefer small aggregate counters over broad transcript analysis.

Ask first only when:

- A change would require storing raw conversation text, review bodies, or other potentially sensitive history.
- The implementation would need a new persistence backend outside existing workflow state files.
- Accurate turn counting requires changing Pi core behavior rather than this package's extension/prompt layer.
- Product semantics conflict, such as whether to count all chat turns or only Addy lifecycle turns.

Never do:

- Never let stats tracking mark tasks implemented, verified, reviewed, or complete.
- Never let `/addy-stats` commit, stage, reset, edit plans, or advance slices.
- Never delete historical stats during `/addy-workflow-reset`.
- Never broaden this into a metrics server, dashboard daemon, telemetry exporter, or analytics product.
- Never store secrets, raw logs, full review text, or full transcripts in workflow stats.
- Never break old persisted workflow state that lacks stats.
