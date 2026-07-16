# Slice 01 — Ticket command, state, and identity contracts

Index: `docs/plans/2026-07-15-addy-ticket-slices-index.md`
GitHub issue: [#8](https://github.com/teknologist/pi-addy-workflow/issues/8)
Next: `docs/plans/2026-07-15-addy-ticket-slices-slice-02-gateway-results.md`
Repository scope: current repository only.

## Required context

- Spec: `docs/specs/2026-07-15-addy-ticket-slices.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Steering: `AGENTS.md`
- Existing contracts:
  - `extensions/workflow-monitor/workflow-core.ts`
  - `command-intake.ts`, `command-router.ts`, `workflow-host-events.ts`
  - `workflow-state-codec-*.ts`, `workflow-state-store*.ts`, `workflow-state-control.ts`
  - `workflow-task-identity.ts`, `auto-action-keys.ts`

Must preserve ADR constraints:

- One Addy Auto runner owns project dispatch; fresh sessions continue that owner.
- Ticket identity must not create independent dispatch ownership.

## Task 1: Implement the complete typed Ticket command matrix

<!-- addy-task-id: ticket-slices-01-command-grammar -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

Use one typed parser for command registration, transition intake, and prompt expansion while preserving all positional Slice Plan forms.

### Implementation steps

1. Create `extensions/workflow-monitor/ticket-command.ts` with discriminated results for every command form in the index matrix.
2. Preserve quoted arguments; reject duplicate/unknown/mutually exclusive flags and strict `/addy-ticket` arity.
3. Keep refs opaque and prevent `artifactFromText`/transition code from assigning Ticket args to `activePlan`.
4. Keep this task parser-only: return typed command intent without consulting not-yet-implemented Ticket state.
5. Create `tests/ticket-command.test.ts`; extend existing `command-intake`, `command-router`, `command-registry`, and `workflow-monitor` parsing suites.

### Acceptance criteria

- Input `/addy-build docs/plans/a b.md` preserves the existing quoted/path result.
- Input `/addy-build --ticket ENG-42` returns one opaque direct-Ticket target; adding a positional path is rejected.
- Inputs `/addy-code-simplify|verify|review|fix-all|finish --ticket ENG-42` parse as claim-required Ticket lifecycle intents; Task 2 owns runtime claim validation.
- Input `/addy-auto --tickets` selects configured AFK label; `--label x` overrides; `--label` without `--tickets`, `--tickets` on another command, and `stop --tickets` are rejected.
- `/addy-ticket status|release|reclaim ENG-42` and `add-repository ENG-42 ../repo` parse; missing/extra args fail.
- No Ticket ref appears in `activePlan` or is resolved as a path.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-command.test.ts tests/command-intake.test.ts tests/command-router.test.ts tests/command-registry.test.ts tests/workflow-monitor.test.ts
```

Expected proof:

- The command grammar matrix fails before implementation and passes after it.
- Existing plan-command fixtures remain unchanged.

### Stop conditions

- Stop if one parser cannot preserve current host-event and prompt-template quoting; document and isolate an adapter rather than silently changing plan behavior.

## Task 2: Persist strict Ticket execution state without orphaning claims

<!-- addy-task-id: ticket-slices-01-state-codec -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 1.

### Objective

Add a versioned Ticket execution branch beside legacy plan state, with explicit live-claim and corrupt-state safety.

### Implementation steps

1. Add an execution discriminator and optional strict `ticketRun` state containing safe orchestration facts only: source/ref, run/claim IDs, revision, queue selector, claim facts, lifecycle snapshot, locked repository scope, activity marker, pending clarification/scope request, and last validated result.
2. Extend codecs, coercers, transitions, project fallback, state controls, and fresh-session preservation. Legacy states default to Slice Plan mode without write churn.
3. Branch state refresh so Ticket mode never runs Slice Plan filesystem readers.
4. Define corrupt-state behavior: startup/read-only status remains available, but Ticket dispatch and source switching stay blocked with a recovery warning; never silently drop to plan mode.
5. Define controls: `/addy-auto stop` preserves a claim; generic reset refuses a live/corrupt possible claim and directs status/release/manual repair.
6. Add the execution-source switch guard now that Ticket state exists: a live or possibly corrupt claim rejects DEFINE, PLAN, SHIP, plan paths, plan Auto start, and another Ticket with exact status/release/manual-repair guidance. Permit stop, status, release/reclaim/add-repository, and lifecycle commands targeting the same owned claim.
7. Create `tests/workflow-state-codec-ticket.test.ts` and `tests/ticket-source-switch.test.ts`; extend project-control/state-control/store suites.

### Acceptance criteria

- A legacy state decodes and reserializes without Ticket fields.
- Unknown Ticket schema/field/source/lifecycle/evidence values are rejected.
- A valid Ticket state survives persistence, project fallback, fresh continuation, and stop.
- Corrupt Ticket state allows startup/status warning but blocks dispatch, plan fallback, reset, and source switch.
- `setContextWorkflowState` does not read an `activePlan` for Ticket mode.
- Reset succeeds normally when no live/possible Ticket claim exists.
- With a live ENG-42 claim, `/addy-plan`, `/addy-ship`, `/addy-build docs/plans/x.md`, `/addy-auto docs/plans/x.md`, and `--ticket ENG-43` fail with recovery guidance and no mutation.
- With corrupt possible-claim state, `/addy-ship` and every source switch fail until repair; status/startup remain available.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/workflow-state-codec-ticket.test.ts tests/ticket-source-switch.test.ts tests/workflow-state-codec*.test.ts tests/workflow-state-store-project-control.test.ts tests/workflow-state-store-persistence.test.ts tests/workflow-state-control.test.ts
```

Expected proof:

- Valid/invalid/legacy/corrupt/stop/reset fixtures assert exact post-state.
- Existing plan-state fixtures remain unchanged.

### Stop conditions

- Stop if Ticket safety requires weakening codec validation or silently clearing a possible tracker-side claim.

## Task 3: Add source-neutral action and identity interfaces

<!-- addy-task-id: ticket-slices-01-action-identity -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 2.

### Objective

Let orchestration, retries, stats, and continuation identify a plan task or Ticket Slice without synthetic plan keys.

### Implementation steps

1. Define discriminated plan-task and Ticket identities.
2. Define a source-neutral workflow action union while retaining all existing Slice Plan action fields.
3. Extend pending actions and Auto Action Keys with source identity, run/claim ID, operation, and attempt marker.
4. Adapt shared consumers only at composition/orchestration seams; leave `slice-plan-action.ts`, plan lifecycle, and plan commit identity behavior intact.
5. Extend `tests/workflow-task-identity.test.ts`, `auto-action-keys.test.ts`, and `fresh-continuation-state.test.ts`.

### Acceptance criteria

- Same Ticket/run/claim/operation/attempt yields the same key across fresh sessions and title/body edits.
- Different claim, run, operation, or attempt cannot collide.
- Existing plan identity/action keys and commit records remain compatible.
- No identity/action contains ticket body, comments, or display title as authoritative identity.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/auto-action-keys.test.ts tests/workflow-task-identity.test.ts tests/fresh-continuation-state.test.ts
```

Expected proof:

- Collision and legacy compatibility fixtures pass.

### Stop conditions

- Stop if generalization requires renaming persisted legacy plan/task fields; add adapters instead.

## Completion audit

- [ ] Complete command matrix and live-claim source-switch guard are proven.
- [ ] Corrupt state remains recoverable without claim loss.
- [ ] Ticket refs never become plan artifacts.
- [ ] Legacy command/state/identity fixtures remain unchanged.
