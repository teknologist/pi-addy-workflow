# Fake Project Addy Auto Loop Test Plan

Assumptions:

- This is a test-plan document only; no implementation changes are included here.
- The target is the current `refactor` branch workflow-monitor Module graph after the architecture deepening refactor.
- The test should exercise the extension through its public/seam-facing workflow behavior, not by re-testing every small Implementation Module directly.
- A fake project should be disposable and created under a temporary directory during test execution.

## Goal

Create an end-to-end integration harness that drives a realistic Addy Auto Mode loop against a fake project with an index Slice Plan, multiple slice files, and multiple tasks per slice. The harness should prove that the current refactor still sequences build, verify, review, fix, task commit, slice advancement, finish, fresh continuation, and watchdog recovery without duplicate prompts or stale state.

The proof must be concrete and reviewer-readable across three surfaces:

1. **State proof**: Workflow State snapshots show the correct active plan, slice, task identity, lifecycle phase, stats, committed-task ledger, pending-action fields, and final auto-mode exit.
2. **Execution proof**: Captured prompts and simulated agent-end events show the exact Addy Auto sequence that ran, including build, verify, review, fix-all, task commit, slice handoff, and finish.
3. **Footer display proof**: Captured workflow widget/footer render output shows the user-visible task/slice progress matching the underlying State after each important transition.

## Success criteria

- `/addy-auto` can start from an index plan and select the first unfinished slice.
- Each task advances through Implemented, Verified, Reviewed, and Committed only when the corresponding evidence exists.
- Commit evidence is matched by Stable Task ID when present, with legacy fallback still covered by a separate case.
- The loop advances from task to task, then from slice to slice, then to `/addy-finish`.
- Auto mode exits cleanly after finish when all slices are closed.
- State proof, execution proof, and footer display proof agree at every task boundary, slice boundary, and finish boundary.
- No duplicate prompt is sent for the same pending action after idle delivery, session start, watchdog resume, or provider retry.
- Pending fresh continuations are consumed exactly once and do not leave stale `pendingFreshPrompt` state behind.
- Review findings route through `/addy-fix-all`, then verify, then review before commit.
- Unsafe evidence shortcuts are rejected: checked Reviewed without review evidence, checked Verified without verify evidence, and clean review without reviewed checkbox when closure still lacks required facts.

## Proposed test files

- `tests/addy-auto-fixture-loop.test.ts`
- `tests/fixtures/fake-project.ts`
- `tests/fixtures/fake-workflow-runtime.ts`

Keep fixture helpers test-only. Do not add production-only test hooks unless the current Interfaces cannot drive the scenario.

## Fake project shape

Create the fixture in a temp directory with a real git repository:

```text
addy-auto-fixture/
  .git/
  package.json
  src/index.ts
  tests/index.test.ts
  docs/plans/index.md
  docs/plans/001-setup.md
  docs/plans/002-feature.md
```

`docs/plans/index.md` should point at the numbered slices:

```md
# Fake Addy Auto Index

- [ ] [Setup](./001-setup.md)
- [ ] [Feature](./002-feature.md)
```

Each slice should contain two tasks with Stable Task IDs:

```md
# Slice 001 - Setup

## Task 1: Add baseline CLI

<!-- addy-task-id: setup-cli -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed
- [ ] Committed

## Task 2: Add config file

<!-- addy-task-id: setup-config -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed
- [ ] Committed
```

Use a second slice with different task IDs so slice advancement and cumulative progress can be asserted.

## Harness design

### Fake Runtime Shell

Provide a fake Runtime Shell / host context that records side effects instead of invoking a real Pi session:

- sent user messages
- workflow notifications
- widget/render calls if relevant
- scheduled idle callbacks
- fresh-session start requests
- stored workflow state snapshots
- rendered footer/widget text after state changes
- pending action keys observed during dispatch

The fake runtime should support these modes:

1. **Idle now**: delivery happens immediately.
2. **Busy then idle**: delivery is scheduled and later flushed.
3. **Fresh session available**: fresh continuation records a replacement-session request.
4. **Fresh session missing/cancelled**: fallback dispatches in the current session.
5. **Delivery failure**: pending action is preserved for watchdog retry.

### Workflow driver

Add a small test driver that can express one logical agent turn:

1. Send a user command or extension-injected prompt.
2. Apply plan checkbox edits or source file writes.
3. Feed tool/subagent events when the lifecycle expects verify/review evidence.
4. Feed an `agent_end` payload with final text.
5. Flush idle callbacks and session-start hooks when required.
6. Assert prompt/state deltas.
7. Capture the footer/widget render for the resulting state.

This driver should use existing workflow Modules where possible:

- Command/event registration through the current composition when practical.
- `Agent-End Handler` and `Input Handler` for event sequencing.
- `Auto Workflow Orchestrator` through the same dispatch path used by `/addy-auto`.
- Temp state persistence through the normal Workflow State Store path, scoped to the fixture repo.

## Core scenario

### Scenario A: happy path across two slices

1. Start `/addy-auto docs/plans/index.md`.
2. Assert the first prompt targets `/addy-build docs/plans/001-setup.md` and Task 1.
3. Mark Task 1 Implemented and emit a source-file write.
4. Feed agent-end text for successful build.
5. Assert next prompt is `/addy-verify` for Task 1.
6. Mark Task 1 Verified and emit passing verify evidence.
7. Assert next prompt is `/addy-review` for Task 1.
8. Mark Task 1 Reviewed and emit clean review evidence.
9. Assert next prompt is the task commit prompt.
10. Feed successful commit output with a fake commit hash.
11. Assert Task 2 becomes the next frontier.
12. Repeat for Task 2.
13. Assert the loop advances to `002-feature.md` after Slice 1 closure.
14. Complete both tasks in Slice 2.
15. Assert final prompt is `/addy-finish`.
16. Feed finish success text.
17. Assert auto mode is off, active stats are archived, and no pending action remains.
18. Produce a proof transcript that aligns each step's State, execution event, prompt, and footer display.

### Scenario B: review-fix loop

1. Drive one task to review.
2. Feed review text with an actionable file-line finding.
3. Assert `/addy-fix-all` is dispatched.
4. Feed fix-all completion.
5. Assert `/addy-verify` is dispatched.
6. Feed passing verify.
7. Assert `/addy-review` is dispatched again.
8. Feed clean review.
9. Assert commit prompt is dispatched only after the clean review and reviewed evidence exist.

### Scenario C: stale evidence rejection

Cover each case independently:

- Reviewed checkbox is checked by build output, but no review run exists: expect review, not commit.
- Verified checkbox is checked without verify evidence: expect verify, not review.
- A task title changes after commit evidence exists, but Stable Task ID is unchanged: expect commit evidence to still close the task.
- A final task in a slice is fully checked but has no commit evidence: expect task commit before next slice.

### Scenario D: delivery and recovery

Cover transport-sensitive paths:

- Busy runtime schedules an idle prompt and sends it once when flushed.
- Session start consumes a pending fresh continuation once.
- Missing fresh-session API falls back to current-session delivery.
- Provider transport failure preserves the pending action for watchdog retry.
- Watchdog supersedes stale pending actions and does not duplicate the latest one.

## Assertions to prefer

Assert externally meaningful facts instead of internal helper calls:

- prompt command and plan path
- current task ID, task index, task title, and slice index
- Workflow State auto-control fields
- pending action key presence/absence
- committed task ledger contents
- stats turns / verify runs / review runs where relevant
- final plan frontier and auto-mode exit state
- rendered footer/widget text for current task, next task, slice progress, total task progress, and phase strip

Each scenario should leave behind a compact proof object in the test failure output, for example:

```ts
type AddyAutoLoopProofStep = {
  label: string;
  state: {
    activePlan?: string;
    currentSliceIndex?: number;
    currentTaskId?: string;
    currentTaskIndex?: number;
    currentTask?: string;
    nextTask?: string;
    autoMode?: boolean;
    pendingAction?: string;
  };
  execution: {
    event:
      | "input"
      | "file-write"
      | "tool-result"
      | "agent-end"
      | "idle-flush"
      | "session-start";
    promptCommand?: string;
    promptPlan?: string;
    agentText?: string;
  };
  footer: {
    line?: string;
    containsTaskProgress: boolean;
    containsSliceProgress: boolean;
  };
};
```

The test should assert this proof object, not just print it. If a failure occurs, the proof object should make it obvious whether the bug is in State, execution sequencing, or footer presentation.

Avoid brittle assertions on complete prompt prose unless testing a prompt policy Module. Prefer matching command, plan, task identity, and required instruction fragments.

## Implementation steps

1. Add `tests/fixtures/fake-project.ts` to create and mutate a temp git-backed fake project.
2. Add `tests/fixtures/fake-workflow-runtime.ts` to record delivery, idle, state, and fresh-session effects.
3. Add a minimal workflow driver in `tests/addy-auto-fixture-loop.test.ts`.
4. Add a proof recorder that captures State snapshots, execution events, and footer/widget render output after every transition.
5. Implement Scenario A first as the single tracer-bullet end-to-end test, including proof assertions.
6. Add Scenario B for review-fix-loop behavior.
7. Add Scenario C evidence-rejection cases.
8. Add Scenario D delivery/recovery cases.
9. Run `npm run format`, `npm run lint`, and `npm test`.

## Non-goals

- Do not spawn a real Pi terminal or rely on an actual LLM response.
- Do not verify natural-language model quality.
- Do not duplicate all unit-test coverage for individual decision Modules.
- Do not require network access or external repositories.
- Do not commit inside the user's real repository from the fake loop; all fake git operations stay in the temp fixture repo.

## Risks and mitigations

- **Risk**: A full composition-level fake host may be too heavy.
  **Mitigation**: Start through the highest stable Module seam that can still exercise command, event, delivery, and state sequencing. Only move closer to composition if the first tracer bullet misses integration bugs.

- **Risk**: Prompt text changes make the test noisy.
  **Mitigation**: Assert command identity, plan path, task identity, and required routing fragments, not whole prompts.

- **Risk**: Temp git commits are slow or flaky.
  **Mitigation**: Use real git only for the fixture repo and keep commits minimal. For most commit-result branches, feed fake agent-end commit output and assert committed-task ledger state.

- **Risk**: Fresh continuation behavior depends on host APIs.
  **Mitigation**: Model only the Runtime Shell Interface outcomes: started, missing, cancelled, busy, idle, and failed delivery.
