# Slice 03 — Scope locking, retry-safe claims, and manual lifecycle

Index: `docs/plans/2026-07-15-addy-ticket-slices-index.md`
GitHub issue: [#10](https://github.com/teknologist/pi-addy-workflow/issues/10)
Previous: `docs/plans/2026-07-15-addy-ticket-slices-slice-02-gateway-results.md`
Next: `docs/plans/2026-07-15-addy-ticket-slices-slice-04-finish-evidence.md`
Repository scope: current repository only.

## Required context

- Spec: `docs/specs/2026-07-15-addy-ticket-slices.md`
- Completed Slices 01–02.
- `repository-scope.ts`, `command-registry.ts`, `manual-frontier-guard.ts`, `input-handler.ts`, `workflow-transitions.ts`

## Task 1: Normalize and lock repository scope before BUILD

<!-- addy-task-id: ticket-slices-03-repository-scope -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

Reuse current plan scope vocabulary for Ticket claims and lock the normalized list before any code edit.

### Implementation steps

1. Extract reusable normalization/resolution from `repository-scope.ts`, preserving its existing markdown adapter and semantics.
2. Seed Ticket scope from optional `Repository scope`, `Owner repo`, and `Companion repo`; otherwise current repository only.
3. Validate unique canonical repositories and write the list into the claim block/result before BUILD.
4. Add `add-repository` approval operation: validate, update locked block, and comment before touching the added repo.
5. Manual discovery of missing scope asks one bounded approval question; Auto behavior is implemented in Slice 05 as a persisted `scope-expansion-required` pause.
6. Create `tests/ticket-repository-scope.test.ts`; extend `repository-scope.test.ts`.

### Acceptance criteria

- Existing plan scope inputs produce identical outputs before/after extraction.
- Ticket with no metadata locks exactly the current repository.
- Ticket with owner/companion metadata locks the normalized unique declared repositories; no unapproved exclusion grammar exists.
- Invalid/unresolvable repo stops before claim completion or code changes.
- `/addy-ticket add-repository ENG-42 ../repo` updates scope/comment before any edit there; rejection leaves scope unchanged.
- Fresh sessions use locked scope, never touched-file inference.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/repository-scope.test.ts tests/ticket-repository-scope.test.ts
```

Expected proof:

- Shared normalization and approval ordering fixtures pass.

### Stop conditions

- Stop if extraction changes current plan path interpretation.

## Task 2: Claim direct Tickets with partial-state reconciliation

<!-- addy-task-id: ticket-slices-03-claim-admin -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 1.

### Objective

Support status/release/reclaim/direct BUILD while recovering safely from non-transactional tracker writes and lost envelopes.

### Implementation steps

1. Register `/addy-ticket status|release|reclaim|add-repository` and `/addy-build --ticket` prompt dispatch.
2. Claim in staged idempotent order: native ownership → locked managed block → selector removal → final refetch confirmation.
3. Reuse one action marker across retries and classify observed partial states:
   - native owner + matching pending action, block missing: resume block write;
   - matching block, selector present: resume selector removal;
   - complete post-state, envelope lost: emit reconciled result without duplicate writes/comments;
   - native owner without matching Addy identity, selector removed without recoverable identity, or conflicting owner/block: stop for manual repair.
4. Release restores an originating selector only when recorded; direct unlabeled tickets release without inventing a label.
5. Reclaim transfers directly, updates native/managed ownership, and never briefly requeues.
6. Create `tests/ticket-claim.test.ts`; extend command/codec tests.

### Acceptance criteria

- Direct unlabelled eligible ticket can be claimed; its release does not add a label.
- Each recoverable partial state resumes only missing stages and creates one comment/activity marker.
- Lost envelope after full tracker mutation reconciles to the same action and state.
- Conflicting native ownership or unrecoverable selector removal performs no further mutation.
- Generic reset/source switch remains blocked until release/manual repair.
- Existing plan commands are unaffected without a Ticket claim.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-claim.test.ts tests/ticket-command.test.ts tests/workflow-state-control.test.ts
```

Expected proof:

- Exact pre-state → operation → post-state matrices cover every partial claim and release/reclaim case.

### Stop conditions

- Stop if ownership would be inferred from assignment alone without a matching Addy claim identity.

## Task 3: Route manual BUILD through REVIEW with strict gates

<!-- addy-task-id: ticket-slices-03-manual-frontier -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 2.

### Objective

Run direct/manual BUILD → optional SIMPLIFY → VERIFY → REVIEW/FIX-ALL while preserving checkbox ownership and ambiguity handling.

### Implementation steps

1. Derive Ticket frontier from validated lifecycle + acceptance completeness.
2. Refetch each phase; stale cache returns `reconciled` and routes to the authoritative frontier without phase mutation.
3. Extend Manual Frontier Guard for Ticket actions without plan reads.
4. Enforce BUILD criteria/Implemented, status-neutral SIMPLIFY, VERIFY-only Verified, clean REVIEW-only Reviewed, and findings → FIX-ALL → VERIFY → REVIEW.
5. Tracker/config ambiguity in manual mode uses one bounded `ask_user` question, persists the resolved operation fact, then resumes; cancellation preserves claim and pauses.
6. Scope expansion uses Task 1 approval operation; no code edit occurs while approval is pending.
7. Create `tests/ticket-action.test.ts`; extend `manual-frontier-guard.test.ts`, `auto-agent-end.test.ts`, and `review-findings.test.ts`.

### Acceptance criteria

- REVIEW invoked while Implemented/Verified missing is redirected without reviewing/mutating.
- SIMPLIFY before Implemented or after Verified is rejected; valid SIMPLIFY posts Activity and changes no lifecycle checkbox.
- BUILD checks only completed criteria + Implemented; partial failure may leave completed criteria checked but Implemented false.
- REVIEW findings comment all findings, keep Reviewed false, and require FIX-ALL → VERIFY → REVIEW.
- Ambiguous routing asks once in manual mode; canceled question leaves a persisted pause and no mutation.
- Stale revision/criterion rename returns reconciled or blocked result and never last-write-wins.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-action.test.ts tests/manual-frontier-guard.test.ts tests/auto-agent-end.test.ts tests/review-findings.test.ts
```

Expected proof:

- Full lifecycle/status/ambiguity/simplify matrix passes.

### Stop conditions

- Stop if recovery requires one phase to check another phase's lifecycle status or expose skip/ship behavior.

## Completion audit

- [ ] Scope is locked before BUILD.
- [ ] Every partial claim state has deterministic recovery or manual stop.
- [ ] Live claim blocks unsafe source switches.
- [ ] Manual lifecycle through REVIEW preserves strict ownership and comments.
