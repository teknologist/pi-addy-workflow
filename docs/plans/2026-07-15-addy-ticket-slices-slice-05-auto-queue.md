# Slice 05 — Addy Auto Ticket Queue

Index: `docs/plans/2026-07-15-addy-ticket-slices-index.md`
GitHub issue: [#12](https://github.com/teknologist/pi-addy-workflow/issues/12)
Previous: `docs/plans/2026-07-15-addy-ticket-slices-slice-04-finish-evidence.md`
Next: `docs/plans/2026-07-15-addy-ticket-slices-slice-06-presentation-stats.md`
Repository scope: current repository only.

## Required context

- Spec: `docs/specs/2026-07-15-addy-ticket-slices.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Completed Slices 01–04.
- Auto seams: `addy-auto-command.ts`, `auto-workflow-orchestrator.ts`, `auto-workflow-decision.ts`, `auto-lifecycle.ts`, `auto-prompt-dispatcher.ts`, `auto-watchdog.ts`, `fresh-continuation-*.ts`, `auto-runner-lock.ts`

Must preserve ADR constraints:

- Exactly one top-level Addy Auto runner dispatches for a project.
- Fresh continuations remain part of that owner.

## Task 1: Select and claim the deterministic queue frontier

<!-- addy-task-id: ticket-slices-05-queue-frontier -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

Start `/addy-auto --tickets [--label <value>]` by selecting and claiming exactly one runnable Ticket.

### Implementation steps

1. Persist queue selector intent separately from active claim.
2. Query through the tracker gateway; resolve configured AFK-ready mapping or explicit label.
3. Validate open state, objective/criteria/blockers, native ownership/managed claim, body structure, and revision.
4. Select oldest unblocked eligible ticket; local source uses numeric prefix then deterministic path fallback.
5. Consume discriminated mixed-category Queue Results and produce deterministic pause/completion reports.
6. Run the Slice 03 staged claim and locked-scope operation before BUILD.
7. Create `tests/ticket-queue.test.ts`; extend `addy-auto-command.test.ts` and `auto-workflow-orchestrator.test.ts`.

### Acceptance criteria

- Eligible A + blocked B selects A.
- No eligible + blocked B + claimed C + malformed D reports all three categories and pauses without mutation.
- Zero matches reports queue complete, distinct from all-blocked pause.
- Closed/resolved, excluded PR, claimed, malformed, and blocked tickets are never selected.
- Explicit `--label x` changes selection only; completion/lifecycle semantics remain configured.
- Competing claim after query but before claim stops without code edit.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-queue.test.ts tests/addy-auto-command.test.ts tests/auto-workflow-orchestrator.test.ts
```

Expected proof:

- GitHub/Linear/local and mixed-category frontier matrices pass.

### Stop conditions

- Stop if tracker guidance cannot determine open/completed blocker or native ownership state.

## Task 2: Drive Ticket actions through Auto/fresh-session infrastructure

<!-- addy-task-id: ticket-slices-05-auto-lifecycle -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 1.

### Objective

Reuse runner lock, dispatch, retries, watchdog, review-fix, and fresh continuation without a second lock or lease.

### Implementation steps

1. Route source-neutral Ticket actions through existing orchestrator/dispatcher seams.
2. Include ticket/run/claim/operation/attempt in pending and delivery keys.
3. Dispatch BUILD → VERIFY → REVIEW → FIX-ALL loops → FINISH from validated results. Queue Auto Mode never dispatches SIMPLIFY; `/addy-code-simplify` remains an explicit manual operation on the owned claim.
4. Reconcile stale tracker state before mutation; route to authoritative frontier.
5. Preserve claim across transport errors, retries, fresh sessions, process restart, and stop.
6. Auto ambiguity persists categorized pause (`configuration-ambiguous` or `scope-expansion-required`) and performs no mutation. Human resolution resumes via same command or `/addy-ticket add-repository`.
7. Corrupt Ticket state blocks dispatch/source switching but keeps startup/status available.
8. Extend existing Auto/fresh/runner tests; add `tests/ticket-auto-lifecycle.test.ts`.

### Acceptance criteria

- One pending Ticket action is delivered once across current/fresh fallback.
- Provider retry reuses action/marker and creates no duplicate comment.
- REVIEW findings route FIX-ALL → VERIFY → REVIEW; clean review alone sets Reviewed.
- A queue run never emits `/addy-code-simplify`; a manual simplify performed before Auto resumes is reconciled as status-neutral Activity and Auto continues with VERIFY.
- `/addy-auto stop` prevents next dispatch and preserves claim/state.
- Watchdog resumes owned claim rather than selecting another Ticket.
- Non-owner cannot dispatch but can observe.
- Ambiguity/scope expansion pauses with exact reason and no tracker/code mutation.
- Corrupt persisted Ticket state cannot silently start plan or queue work.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-auto-lifecycle.test.ts tests/auto-prompt-dispatcher.test.ts tests/auto-watchdog.test.ts tests/fresh-continuation*.test.ts tests/auto-runner-lock.test.ts tests/provider-transport-retry.test.ts tests/auto-agent-end.test.ts
```

Expected proof:

- Duplicate delivery, claim loss, ambiguity, corrupt state, and review-loop regressions pass.

### Stop conditions

- Stop if Ticket mode requires a second runner lock, timer lease, or auto-answer to a human decision.

## Task 3: Drain the queue only after validated Ticket closure

<!-- addy-task-id: ticket-slices-05-drain-queue -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 2.

### Objective

After one FINISH archives a Ticket, start a fresh context and select the next runnable Ticket until the queue completes or pauses.

### Implementation steps

1. Preserve selector after active Ticket archives.
2. On validated FINISH only, start fresh and rerun frontier selection.
3. Re-evaluate dependencies after each closure.
4. Stop as complete on empty; pause/report mixed blocked/claimed/ineligible/ambiguous categories.
5. Check user stop intent before next selection.
6. Create `tests/ticket-queue-drain.test.ts`; extend `session-start-handler.test.ts` and `task-closure-continuation.test.ts`.

### Acceptance criteria

- A→B dependency chain selects A, closes A, refetches, then selects B.
- Independent A/B each receive distinct run/claim IDs and fresh-session boundary.
- No selection occurs before current terminal result/evidence validates.
- User stop between tickets prevents selection and preserves selector/history.
- Empty queue terminates; all-blocked pauses; no ticket is selected twice.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-queue-drain.test.ts tests/session-start-handler.test.ts tests/task-closure-continuation.test.ts
```

Expected proof:

- Chain, independent frontier, mixed pause, empty, and stop-between-ticket fixtures pass.

### Stop conditions

- Stop if current Ticket state can clear before terminal state confirms.

## Completion audit

- [ ] Queue selection is deterministic and categorized.
- [ ] Auto lifecycle survives retry/fresh/restart without duplicate Activity.
- [ ] Claims are never silently dropped or stolen.
- [ ] Queue drains only after strict FINISH.
