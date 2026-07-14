# External issue-workflow progress spec

## Objective

Display the implementation-loop progress of the user-level
`/df-implement-issues` and `/implement-from-issues` prompts in Addy's existing
widget and dashboard without changing regular Addy workflow behavior.

Addy will show issue or queue/wave progress through implementation,
verification, review/fix, commit/merge, and terminal state. Brief pre-loop setup
and post-loop validation statuses may appear, but they are not the core progress
model. Detailed live agent progress remains owned and displayed by
`pi-dynamic-workflows`.

Only this repository and these prompt templates may change:

- `/Users/eric/.pi/agent/prompts/df-implement-issues.md`, invoked as
  `/df-implement-issues`;
- `/Users/eric/.pi/agent/prompts/implement-from-issues.md`.

`pi-dynamic-workflows` must not be modified.

### Acceptance criteria

- Regular Addy workflows retain their current lifecycle, state schema,
  transitions, commands, persistence, reset behavior, and widget content.
- When no external progress exists, the Addy widget renders exactly its current
  lines and the dashboard continues to show regular Addy state normally.
- The widget and dashboard show every active external run for the current Git
  project and the newest terminal run.
- External runs appear in a separate presentation section and are never mapped
  to Addy's `define → plan → build → simplify → verify → review → finish`
  lifecycle.
- Addy observes external runs but cannot pause, resume, abort, retry, or delete
  them.
- `/df-implement-issues` reports queue/wave or issue progress through
  implementation, verification, review/fix, commit/merge, and terminal outcome.
- `/implement-from-issues` reports current issue progress through implementation,
  verification, review/fix, commit/merge, and terminal outcome.
- Setup/orientation and final validation may appear only as brief pre-loop and
  post-loop statuses.
- Direct and `/implement-afk-issues`-supervised invocations of
  `/implement-from-issues` produce one logical progress run, not duplicates.
- The prompts publish through an Addy-owned CLI; they do not implement JSON
  persistence independently.
- Publisher failures warn and allow the issue workflow to continue.
- Snapshots contain only display-safe fields. They never contain prompt text,
  scripts, arguments, logs, results, journals, tokens, tracker comments, or
  secrets.
- Snapshot writes are atomic and do not dirty the source repository or any Git
  worktree.
- A non-updating active run receives a stale warning after 30 minutes. Staleness
  does not silently change its reported status.
- Storage retains all active runs and the newest 10 terminal runs per project.
- Missing, corrupt, unsupported, or unreadable snapshots do not prevent Addy or
  the dashboard from starting.

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

1. **Prompts own implementation-loop meaning.** Only the two prompt templates
   publish queue/wave or issue progress and loop phases through the CLI.
2. **The CLI owns persistence mechanics.** It validates input, generates run
   IDs, writes atomically, and applies retention.
3. **Addy owns read-only presentation.** It reads safe snapshots without adding
   them to `WorkflowState` or affecting Addy transitions.

Do not add a daemon, background service, new project, dependency, or integration
with `pi-dynamic-workflows` internals.

## Publisher CLI

Add a package binary named `addy-progress`, implemented with the Node.js standard
library.

Required operations:

```text
addy-progress start --cwd <git-root> --source <source>
addy-progress update --run <run-id> --stdin
addy-progress finish --run <run-id> --stdin
```

`start` prints the generated run ID to stdout. `update` and `finish` accept a
small JSON object on stdin so prompt-provided labels and issue titles do not need
unsafe shell interpolation.

CLI behavior:

- Resolve the canonical project identity from the absolute Git common directory
  so the main checkout and its worktrees share progress.
- Generate run IDs with `crypto.randomUUID()`.
- Reject unknown fields, invalid statuses, invalid counters, and oversized text.
- Write a same-directory temporary file and atomically rename it into place.
- Create storage with user-only permissions where supported.
- Apply retention only after a successful terminal write.
- Return non-zero with a concise error on failure; prompt instructions must warn
  and continue rather than abort implementation work.

The CLI is a persistence helper, not a workflow controller. It must not inspect
issue trackers, invoke prompts, mutate Addy state, or read
`pi-dynamic-workflows` storage.

## Snapshot contract

```ts
type IssueImplementationProgressSnapshot = {
  schemaVersion: 1;
  projectKey: string;
  runId: string;
  parentRunId?: string;
  source: "df-implement-issues" | "implement-from-issues";
  status: "running" | "paused" | "blocked" | "completed" | "failed" | "aborted";
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

`pre-loop` and `post-loop` are brief boundary statuses. The four active work
phases and queue progress are the primary model; terminal outcome remains in
`status`. Keep the persisted schema versioned and independent of `WorkflowState`.

Do not include an `agents` field. Under the immutable
`pi-dynamic-workflows` constraint, prompt-owned publication cannot reliably see
live queued and running agent transitions. Addy shows aggregate prompt
checkpoints; the native dynamic-workflow panel remains the source for live agent
details.

## Storage and selection

Store snapshots outside repositories and worktrees:

```text
~/.pi/addy-workflow/external-progress/projects/<project-key>/runs/<run-id>.json
```

Derive `<project-key>` from a hash of the canonical absolute Git common directory.
The dashboard already receives a project `cwd`, so it can derive the same key
without session identity or access to prompt state.

Selection rules:

1. Read only `.json` files that validate against the supported schema version.
2. Show all `running`, `paused`, and `blocked` runs for the project.
3. Also show the newest terminal run (`completed`, `failed`, or `aborted`).
4. Mark an active snapshot stale when `updatedAt` is more than 30 minutes old,
   but preserve its producer-reported status.
5. Ignore invalid files and optionally surface one concise, non-fatal warning.

Retention rules:

- Never remove active runs.
- After a terminal write, retain the newest 10 terminal snapshots for the
  project and remove older terminal snapshots best-effort.
- Addy's readers never perform retention or delete snapshots.

## Issue implementation-loop reporting

Both prompts publish one logical run whose primary state is the issue
implementation loop. They may briefly publish `pre-loop` while preparing and
`post-loop` while reconciling or validating, but must not model setup or final
validation as peer lifecycle phases.

### `/df-implement-issues`

Use one Addy progress run for the queue/wave implementation loop.

Required phase mapping:

```text
pre-loop       brief configuration and plan-worktree preparation
queue          queued/current wave or issue and aggregate progress
implementation active implementation work
verification   verification for the current wave or issue
review-fix     review and any resulting fix iterations
commit-merge   commit and merge integration
post-loop      brief reconciliation and final validation
```

Set `progressUnit` to `waves` when the prompt has a wave plan; otherwise use
`issues`. Publish `currentItem`, `completed`, and `total` from queue facts the
prompt already owns. Pass the Addy run ID as an additional immutable `workflow`
tool argument and return it in the workflow result so prompt-authored workflow
instructions and the outer prompt update the same run across background turns.

Do not parse or mirror the dynamic workflow's scripts, logs, journals, results,
or internal run ID. The prompt publishes only loop checkpoints and aggregate
queue progress through `addy-progress`; the native workflow panel continues to
display detailed live agents.

### `/implement-from-issues`

Use one Addy progress run for both direct and supervised invocation. The prompt,
not the AFK supervisor, starts and finishes the issue implementation loop.

Required phase mapping:

```text
pre-loop       brief orientation
queue          issue selection and aggregate issue progress
implementation current issue implementation
verification   current issue verification
review-fix     review and any resulting fix iterations
commit-merge   current issue commit or merge
post-loop      brief final validation
```

Set `progressUnit` to `issues`. Update `currentItem`, `completed`, and `total`
only from issue-tracker facts the prompt has already established.

To preserve the run ID across `/implement-afk-issues` wake-ups without modifying
that extension, include the Addy run ID inside the existing quoted
`AFK-LOOP` marker payload (`next`, `evidence`, or `needs`). The existing marker
grammar accepts this text and the supervisor includes it in its resume message.
The prompt must recover and reuse that ID instead of starting another progress
run.

## Addy presentation

### Widget

- Preserve the existing Addy workflow strip and task lines.
- Append a compact external-workflow block only when selected snapshots exist.
- Make loop phase and queue/wave or issue progress primary. Show source,
  `currentItem`, aggregate count with its unit when known, terminal status, and a
  stale indicator.
- Render `pre-loop` and `post-loop` only as compact boundary labels, never as a
  replacement lifecycle strip.
- Refresh external data without dispatching Addy events or mutating
  `WorkflowState`.

### Dashboard

- Preserve existing Addy panels and `/api/state` fields.
- Add an optional external-runs projection and a separate **Issue workflows**
  section.
- Reuse the existing five-second browser refresh.
- Render active runs first and the newest terminal run last.
- Emphasize current loop phase plus queue/wave or issue completion; keep pre-loop
  and post-loop statuses visually secondary.
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
- replace the existing widget key or Pi footer; or
- make the dashboard inspect issue trackers, worktrees, or raw workflow storage.

When external snapshots are absent, existing regular Addy tests and rendered
widget lines must remain unchanged.

## Related ADRs / architecture constraints

Before implementation, read
[`docs/adr/0001-addy-auto-runner-lock.md`](../adr/0001-addy-auto-runner-lock.md).
External progress is project-scoped and observable from multiple Pi sessions, but
it must not participate in Addy Auto runner ownership, fencing, dispatch, or stop
intent.

## Expected implementation surface

Keep the eventual change isolated. Likely areas are:

```text
bin/
└── addy-progress.ts

extensions/workflow-monitor/
├── external-progress.ts             # loop schema, paths, validated reads
├── workflow-widget-presenter.ts     # optional appended presentation
└── dashboard-server.ts              # optional external-runs projection/UI

tests/
├── external-progress.test.ts
├── workflow-widget-presenter.test.ts
└── dashboard-server.test.ts

/Users/eric/.pi/agent/prompts/
├── df-implement-issues.md
└── implement-from-issues.md
```

Before editing either user-level prompt, run `chezmoi source-path <path>` and edit
the managed source when one exists.

## Verification

Automated checks:

```bash
npm test
npm run typecheck
npm run format:check
```

Tests must prove:

- CLI start/update/finish behavior and validation;
- atomic writes and concurrent independent run files;
- worktrees resolve to the same project key as their main checkout;
- active-run preservation and newest-10 terminal retention;
- 30-minute stale derivation without status mutation;
- corrupt and unsupported snapshots fail open;
- malicious display strings are escaped in the dashboard and width-bounded in
  the widget;
- no external data preserves existing widget output;
- external data adds lines without changing regular Addy lifecycle state;
- dashboard selection shows all active runs plus the newest terminal run;
- both prompt mappings publish queue/wave or issue progress and the
  implementation, verification, review/fix, commit/merge, and terminal states;
- pre-loop and post-loop statuses remain brief boundary states rather than the
  primary display model;
- publisher errors do not stop either prompt;
- `/df-implement-issues` resumes the same run after its background workflow;
- direct and supervised `/implement-from-issues` reuse one run ID; and
- existing regular Addy workflow, dashboard, reset, auto-mode, and runner-lock
  tests continue to pass.

Manual verification:

1. Run a regular Addy workflow with no external snapshots and compare its widget
   and dashboard behavior with the current version.
2. Run `/df-implement-issues` and confirm Addy shows queue/wave progress and the
   current implementation-loop phase while the native dynamic-workflow panel
   shows live agents.
3. Run `/implement-from-issues` directly and confirm current issue, loop phase,
   and aggregate progress survive multiple turns.
4. Run `/implement-afk-issues` and confirm wake-ups reuse one progress run.
5. Start two external runs in the same project and confirm both appear without
   overwriting each other.
6. Stop updating a fixture snapshot for 30 minutes of simulated time and confirm
   it is marked stale but remains active.

## Non-goals

- Forking Addy or creating a new dashboard project.
- Modifying or replacing `pi-dynamic-workflows`.
- Reproducing its live agent panel in Addy.
- Reading raw dynamic-workflow persistence.
- Monitoring arbitrary prompts or generic prompt lifecycles.
- Treating setup, orientation, reconciliation, or final validation as the core
  progress model.
- Controlling external runs from Addy.
- Storing raw logs, prompts, results, tracker content, or telemetry.
- Changing regular Addy lifecycle semantics.
- Adding a daemon, service, database, or dependency.

Implementation must not begin until this spec is reviewed and explicitly
approved.
