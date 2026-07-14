# External issue-workflow progress spec

## Objective

Display implementation-loop progress from the user-level
`/df-implement-issues` and `/implement-from-issues` prompts in Addy's existing
widget and dashboard without changing regular Addy workflow behavior.

`/df-implement-issues` publishes aggregate wave progress.
`/implement-from-issues` publishes issue progress. Brief pre-loop setup and
post-loop validation may appear as boundary states. Issue-level live DF detail
remains owned and displayed exclusively by `pi-dynamic-workflows`.

Only this repository and these prompt templates may change:

- `/Users/eric/.pi/agent/prompts/df-implement-issues.md`, invoked as
  `/df-implement-issues`;
- `/Users/eric/.pi/agent/prompts/implement-from-issues.md`.

The prompt-owned embedded DF workflow script may be instrumented to publish
serialized checkpoints. The `pi-dynamic-workflows` package, grammar, storage,
and implementation must not change.

### Acceptance criteria

- Regular Addy workflows retain their current lifecycle, state schema,
  transitions, commands, persistence, reset behavior, and widget content.
- Without external progress, the Addy widget renders exactly its current lines
  and the dashboard continues to show regular Addy state normally.
- The widget and dashboard show every active external run for the current Git
  project and the newest terminal run. The newest terminal is selected by the
  greatest validated `finishedAt`, then `runId` as a deterministic tie-breaker.
- External runs appear separately and are never mapped to Addy's
  `define → plan → build → simplify → verify → review → finish` lifecycle.
- Addy observes external runs but cannot block, resume, retry, finish, or delete
  them.
- `/df-implement-issues` reports aggregate wave progress through implementation,
  verification, review/fix, commit/merge, and terminal outcome.
- `/implement-from-issues` reports issue progress through implementation,
  verification, review/fix, commit/merge, and terminal outcome.
- Setup/orientation and final validation appear only as brief `pre-loop` and
  `post-loop` boundary states.
- Direct and `/implement-afk-issues`-supervised invocations of
  `/implement-from-issues` produce one logical run. The existing quoted evidence
  payload contains literal `addy-run=<uuid>` text; resume logic extracts and
  validates that token without changing the AFK grammar or extension.
- Prompts publish through an Addy-owned `addy-progress` CLI rather than
  implementing persistence.
- The existing Addy lifecycle installs an `addy-progress` shim into
  `~/.pi/agent/bin/`. Tests must verify that directory is on `PATH` in the actual
  prompt execution environment. If it is not, executable discovery must be
  revisited rather than assumed.
- `start` is idempotent per project and source: it reuses an existing `running`
  or `blocked` run, establishing at most one active run for each pair.
- `update` and `finish` require `--cwd`, `--source`, and `--run`, and reject
  project, producer, or run ownership mismatches.
- Start and update persistence failures warn and allow the issue workflow to
  continue. A finish persistence failure retries exactly once, then warns and
  continues; the stale active snapshot may be reconciled later.
- Statuses are exactly `running`, `blocked`, `completed`, and `failed`.
  `completed` and `failed` are immutable terminal states.
- `blocked` means a human-required legal stop. Resume returns the same run to
  `running`; a technical failure that ends work uses `failed`.
- Updates are merge patches: omitted fields persist, `completed` is a
  non-negative integer that cannot decrease, `total` is fixed once established,
  and `completed` never exceeds `total`.
- Status and phase changes follow the loop-aware transition graphs in this spec;
  arbitrary regressions are rejected.
- `currentItem` is normalized by removing ANSI escapes, control characters, and
  bidi-control characters, collapsing line breaks, preserving ordinary Unicode,
  and limiting the result to 256 Unicode code points.
- Schema-version-1 readers reject unknown fields. Adding a field requires a
  schema-version bump.
- Snapshots contain only display-safe fields. They never contain prompt text,
  scripts, arguments, logs, results, journals, tokens, tracker comments, or
  secrets.
- Snapshot writes are atomic and do not dirty a repository or worktree.
- A non-updating active run receives a stale warning after 30 minutes without
  changing its reported status.
- Invalid snapshots fail open. The dashboard/API aggregates them into one
  concise, non-fatal warning; the compact widget never displays that warning.
- Retention is eventual best-effort after a successful finish. It retains all
  active runs and the newest 10 terminal runs per project, ordered by validated
  `finishedAt` then `runId`. Races may temporarily over-retain; active runs are
  never removed.

## Architecture

```text
/df-implement-issues ──────────┐
                              ├─ addy-progress CLI ── safe loop snapshots
/implement-from-issues ────────┘                           │
                                                          ▼
                                            Addy widget + dashboard

pi-dynamic-workflows ────────────────────────────── native live-agent panel
```

The feature has three boundaries:

1. **Prompts own implementation-loop meaning.** The embedded DF workflow script
   publishes serialized aggregate wave/phase checkpoints. The
   `/implement-from-issues` prompt publishes issue checkpoints.
2. **The CLI owns persistence mechanics.** It validates ownership and input,
   provides idempotent start, applies merge patches and transition rules, writes
   atomically, enforces terminal immutability, and applies retention.
3. **Addy owns read-only presentation.** It reads safe snapshots without adding
   them to `WorkflowState` or affecting Addy transitions.

Instrumentation is confined to prompt-owned text. Do not add a daemon,
background service, project, dependency, AFK grammar change, or integration with
`pi-dynamic-workflows` internals.

## Publisher CLI

Add a package binary named `addy-progress`, implemented with the Node.js standard
library. Install its shim through the existing Addy lifecycle and installer
pattern into `~/.pi/agent/bin/`; do not create a second installer abstraction.
Prompt execution may invoke `addy-progress` by name only after tests establish
that this directory is on its `PATH`. Otherwise, revise binary discovery.

Required operations:

```text
addy-progress start  --cwd <git-root> --source <source>
addy-progress update --cwd <git-root> --source <source> --run <run-id> --stdin
addy-progress finish --cwd <git-root> --source <source> --run <run-id> --stdin
```

`start` prints the newly created or reused active run ID to stdout. `update` and
`finish` accept a small JSON object on stdin so labels and issue titles require
no unsafe shell interpolation.

CLI behavior:

- Resolve the canonical absolute Git common directory before project-key
  derivation (for example with `git rev-parse --git-common-dir`). Pass that
  canonical directory to the shared `projectWorkflowStateKey()` implementation,
  which computes the SHA-256-based 24-character lowercase hexadecimal scope key.
  Writers and readers must use this same sequence; the utility must not be given
  an uncanonicalized checkout or worktree path.
- Generate new run IDs with `crypto.randomUUID()`.
- Make `start` idempotent for `(projectKey, source)`, including concurrent starts,
  by returning an existing `running` or `blocked` run when present.
- Require update and finish to find the named run under the derived project and
  verify its persisted `projectKey` and `source` against the supplied values.
- Treat update input as a merge patch. Preserve omitted fields.
- Reject unknown fields, invalid statuses, invalid counters, phase regressions,
  and text that cannot be normalized to the snapshot contract.
- Require `completed` to be a non-negative integer that never decreases. Require
  `total`, when supplied, to be a non-negative integer that cannot change once
  set. Enforce `completed <= total` whenever both exist.
- Normalize `currentItem` by stripping ANSI escapes, control characters, and
  bidi controls; collapse line breaks to spaces; retain ordinary Unicode; then
  truncate to 256 Unicode code points.
- Permit `blocked → running` on the same run. Reject changes to terminal runs.
- Write a same-directory temporary file and atomically rename it into place.
- Create storage with user-only permissions where supported.
- Apply retention only after a successful terminal write. Cleanup is
  best-effort and must never remove an active run.
- Return non-zero with a concise error on start or update failure; prompts warn
  and continue. On finish write failure, retry exactly once, then emit a concise
  warning and return control without stopping workflow execution.

The CLI is a persistence helper, not a workflow controller. It must not inspect
issue trackers, invoke prompts, mutate Addy state, or read
`pi-dynamic-workflows` storage.

## Snapshot contract

```ts
type IssueImplementationProgressSnapshot = {
  schemaVersion: 1;
  projectKey: string;
  runId: string;
  source: "df-implement-issues" | "implement-from-issues";
  status: "running" | "blocked" | "completed" | "failed";
  loopPhase:
    | "pre-loop"
    | "queue"
    | "implementation"
    | "verification"
    | "review-fix"
    | "commit-merge"
    | "post-loop";
  progressUnit?: "issues" | "waves";
  currentItem?: string;
  completed?: number;
  total?: number;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
};
```

Readers validate the exact known field set for the declared schema version and
reject unknown fields. Additive fields require `schemaVersion: 2` or later.
Terminal snapshots require a valid `finishedAt`; active snapshots must not have
one. Keep this schema independent of `WorkflowState`.

Allowed status transitions are:

```text
running → blocked | completed | failed
blocked → running | failed
completed → immutable
failed → immutable
```

Blocking and resuming preserve `runId`, counters, and `loopPhase`. `blocked` is
reserved for a human-required legal stop. A technical failure that ends work is
`failed`.

Same-phase checkpoints are allowed. Other phase transitions are limited to:

```text
pre-loop → queue
queue → implementation | post-loop
implementation → verification
verification → review-fix | commit-merge
review-fix → verification | commit-merge
commit-merge → queue | post-loop
post-loop → completed | failed (status transition)
```

The `verification ↔ review-fix` cycle represents fix and reverification gates.
`commit-merge → queue` advances to the next issue or wave. All unrelated
regressions are rejected.

Do not include an `agents` field. The prompt-owned publication cannot reliably
observe live queued and running agent transitions. Addy shows aggregate prompt
checkpoints; the native dynamic-workflow panel remains authoritative for live
agent details.

## Storage and selection

Store snapshots outside repositories and worktrees:

```text
~/.pi/addy-workflow/external-progress/projects/<project-key>/runs/<run-id>.json
```

Resolve the canonical absolute Git common directory first, then pass it to the
shared `projectWorkflowStateKey()` utility. Both writer and dashboard reader use
that sequence, producing the same SHA-256-based 24-character lowercase
hexadecimal key for a main checkout and its worktrees.

Selection rules:

1. Read only `.json` files that contain exactly the known fields and validate
   against the declared supported schema version.
2. Show all `running` and `blocked` runs for the project.
3. Also show the newest `completed` or `failed` run, ordered by validated
   `finishedAt`, then `runId`.
4. Mark an active snapshot stale when `updatedAt` is more than 30 minutes old,
   while preserving its producer-reported status.
5. Ignore invalid, corrupt, unreadable, unsupported, and unknown-field files.
   Aggregate all such failures into one concise, non-fatal dashboard/API warning.
   Never expose this warning in the compact widget.

Retention rules:

- Never remove `running` or `blocked` snapshots.
- After a successful terminal write, retain the newest 10 terminal snapshots per
  project, ordered by validated `finishedAt`, then `runId`.
- Cleanup is eventual best-effort. Concurrent finish races may temporarily
  over-retain terminal snapshots.
- Readers never perform cleanup or delete snapshots.

## Issue implementation-loop reporting

Each prompt publishes one logical run. It may briefly publish `pre-loop` while
preparing and `post-loop` while reconciling or validating, but these are not peer
lifecycle phases.

### `/df-implement-issues`

Use one Addy progress run for the aggregate wave implementation loop. Instrument
the prompt-owned embedded workflow script to publish serialized checkpoints;
do not modify `pi-dynamic-workflows`.

Required phase mapping:

```text
pre-loop       brief configuration and plan-worktree preparation
queue          queued/current wave and aggregate wave progress
implementation active wave implementation work
verification   explicit verification gate for the current wave
review-fix     review, fixes, and reverification cycles
commit-merge   commit and merge integration
post-loop      brief reconciliation and final validation
```

Always set `progressUnit` to `waves`. Publish aggregate wave `currentItem`,
`completed`, and `total` only from facts the prompt already owns. Explicit
verification gates, including fix/reverification cycles, remain inside the
existing workflow stages.

Pass the Addy run ID as an immutable `workflow` tool argument and return it in
the workflow result. The embedded script invokes `addy-progress` at serialized
wave/phase checkpoints so background turns and the outer prompt update the same
run.

Do not publish issue-level live detail, agent transitions, scripts, logs,
journals, results, dynamic-workflow storage, or internal run IDs. The native
workflow panel continues to display detailed live agents.

### `/implement-from-issues`

Use one Addy progress run for direct and supervised invocation. The prompt, not
the AFK supervisor, starts and finishes the issue implementation loop.

Required phase mapping:

```text
pre-loop       brief orientation
queue          issue selection and aggregate issue progress
implementation current issue implementation
verification   current issue verification gate
review-fix     review, fixes, and reverification cycles
commit-merge   current issue commit or merge
post-loop      brief final validation
```

Set `progressUnit` to `issues`. Update `currentItem`, `completed`, and `total`
only from issue-tracker facts the prompt has established.

To preserve the run across `/implement-afk-issues` wake-ups, embed literal
`addy-run=<uuid>` inside the existing quoted `AFK-LOOP` evidence payload. Do not
place it in `next` or `needs`, add a marker field, or change the AFK grammar or
extension. Resume logic regex-extracts and validates the UUID from that evidence
payload. When valid, it reuses the run without calling `start`; when absent or
malformed, it calls idempotent `start`. It must not infer a token from unrelated
resume text.

## Addy presentation

### Widget

- Preserve the existing Addy workflow strip and task lines.
- Append a compact external-workflow block only when selected snapshots exist.
- Show source, loop phase, `currentItem`, aggregate count and unit when known,
  terminal status, and stale indicator. DF displays aggregate waves;
  `/implement-from-issues` displays issues.
- Render `pre-loop` and `post-loop` as compact boundary labels, never as a
  replacement lifecycle strip.
- Never render invalid-snapshot warnings.
- Refresh external data without dispatching Addy events or mutating
  `WorkflowState`.

### Dashboard

- Preserve existing Addy panels and `/api/state` fields.
- Add an optional external-runs projection and separate **Issue workflows**
  section. The API projection carries at most one aggregate invalid-snapshot
  warning.
- Reuse the existing five-second browser refresh.
- Render active runs first and the newest terminal run last, selecting the latter
  by validated `finishedAt`, then `runId`.
- Emphasize loop phase and aggregate DF wave or issue-workflow completion; keep
  `pre-loop` and `post-loop` visually secondary.
- Keep the surface read-only.

## Compatibility invariants

External progress must never:

- add fields to persisted `WorkflowState`;
- alter Addy phase status, task identity, statistics, warnings, evidence, auto
  mode, or runner-lock ownership;
- trigger Addy transitions or prompt dispatch;
- be cleared by `/addy-workflow-reset` or `/addy-auto stop`;
- make regular Addy commands depend on either user-level prompt;
- make Addy startup depend on external progress files;
- replace the existing widget key or Pi footer;
- make the dashboard inspect issue trackers, worktrees, or raw workflow storage;
- modify the AFK extension or grammar; or
- modify or mirror `pi-dynamic-workflows`.

When snapshots are absent, existing regular Addy tests and widget lines remain
unchanged. Schema-version-1 compatibility is strict: unknown fields are invalid,
not forward-compatible additions.

## Related ADRs / architecture constraints

Before implementation, read
[`docs/adr/0001-addy-auto-runner-lock.md`](../adr/0001-addy-auto-runner-lock.md).
External progress is project-scoped and observable from multiple Pi sessions,
but it must not participate in Addy Auto runner ownership, fencing, dispatch, or
stop intent.

## Expected implementation surface

Keep the eventual change isolated. Likely areas are:

```text
bin/
└── addy-progress.ts

extensions/
├── dashboard-installer/
│   └── core.ts                         # existing shim lifecycle and PATH
└── workflow-monitor/
    ├── external-progress.ts            # strict codec, paths, validated reads
    ├── workflow-state-store-scope.ts   # shared project-key utility
    ├── workflow-widget-presenter.ts    # optional appended presentation
    └── dashboard-server.ts             # optional external-runs projection/UI

tests/
├── external-progress.test.ts
├── dashboard-installer.test.ts
├── workflow-widget-presenter.test.ts
└── dashboard-server.test.ts

/Users/eric/.pi/agent/prompts/
├── df-implement-issues.md              # embedded DF checkpoint publication
└── implement-from-issues.md
```

Before editing either user-level prompt, run `chezmoi source-path <path>` and edit
the managed source when one exists. No AFK extension or
`pi-dynamic-workflows` source file belongs in the implementation surface.

## Verification

Automated checks:

```bash
npm test
npm run typecheck
npm run format:check
```

Unit and integration tests must prove:

- CLI signatures require `--cwd` and `--source` for update and finish;
- update and finish reject project, source, and run ownership mismatches;
- start is idempotent per project/source, including concurrent starts;
- different sources may coexist while one project/source has at most one active
  run;
- canonical Git common-directory resolution plus the shared project-key utility
  produces identical writer and reader keys for main checkouts and worktrees;
- the existing lifecycle installs the shim and the actual prompt execution
  environment discovers `addy-progress` through `PATH`;
- statuses exclude `paused` and `aborted`;
- terminal states are immutable;
- blocked resume reuses the same run without resetting counters or phase;
- update omission preserves existing fields;
- `completed` is monotonic, `total` is fixed, and `completed <= total`;
- same-phase checkpoints, forward gates, verification/review-fix cycles, and
  commit-merge/queue cycles are accepted while arbitrary regressions are
  rejected;
- `currentItem` normalization removes ANSI, control, and bidi-control characters,
  collapses line breaks, retains ordinary Unicode, and limits output to 256
  Unicode code points;
- schema-version-1 snapshots with unknown fields are rejected;
- writes are atomic and do not dirty checkouts;
- active runs are preserved and the newest 10 terminals are ordered by validated
  `finishedAt`, then `runId`;
- 30-minute staleness is derived without status mutation;
- invalid snapshots fail open, produce one API/dashboard warning, and produce no
  widget warning;
- malicious display strings are escaped in the dashboard and width-bounded in
  the widget;
- absent external data preserves existing widget output;
- external data adds lines without changing regular Addy lifecycle state;
- dashboard selection shows all active runs plus the correctly ordered newest
  terminal run;
- finish persistence retries once, warns, and allows workflow continuation;
- start and update persistence errors warn without stopping either prompt;
- the embedded DF workflow publishes serialized aggregate wave/phase
  checkpoints and explicit verification, fix, and reverification gates;
- DF snapshots contain aggregate wave progress and no issue-level live detail;
- `/implement-from-issues` snapshots contain issue progress;
- pre-loop and post-loop remain brief boundary states;
- `/df-implement-issues` resumes the same run after its background workflow;
- AFK evidence contains literal `addy-run=<uuid>`, resume extracts it only from
  that payload, and direct and supervised invocation reuse one run ID; and
- existing regular Addy workflow, dashboard, reset, auto-mode, and runner-lock
  tests continue to pass.

Manual verification:

1. Run a regular Addy workflow without external snapshots and compare its widget
   and dashboard behavior with the current version.
2. From the actual prompt execution environment, confirm `addy-progress` resolves
   through `PATH`; if it does not, stop and revise binary discovery.
3. Run `/df-implement-issues` and confirm Addy shows aggregate wave progress and
   serialized implementation, verification, fix/reverification, commit/merge,
   and terminal gates while the native dynamic-workflow panel shows live agents.
4. Run `/implement-from-issues` directly and confirm issue, phase, and aggregate
   progress survive multiple turns.
5. Run `/implement-afk-issues`, inspect the quoted evidence payload for literal
   `addy-run=<uuid>`, and confirm wake-ups recover and reuse that run.
6. Invoke start repeatedly and concurrently for one source and confirm one active
   run is reused; start another source and confirm both sources appear.
7. Block a run for a human-required legal stop, resume it, and confirm the same
   run returns to `running` without resetting phase or counters.
8. Simulate a finish write failure and confirm one retry, one warning, continued
   workflow execution, and an active snapshot available for later reconciliation.
9. Stop updating a fixture snapshot for 30 minutes of simulated time and confirm
   it is stale but remains active.

## Non-goals

- Forking Addy or creating a new dashboard project.
- Modifying or replacing `pi-dynamic-workflows`.
- Reproducing its issue-level live agent panel in Addy.
- Reading raw dynamic-workflow persistence.
- Modifying the AFK extension or grammar.
- Monitoring arbitrary prompts or generic prompt lifecycles.
- Treating setup, orientation, reconciliation, or final validation as the core
  progress model.
- Controlling external runs from Addy.
- Storing raw logs, prompts, results, tracker content, or telemetry.
- Changing regular Addy lifecycle semantics.
- Adding a daemon, service, database, dependency, or installer abstraction.

Implementation must not begin until this spec is reviewed and explicitly
approved.
