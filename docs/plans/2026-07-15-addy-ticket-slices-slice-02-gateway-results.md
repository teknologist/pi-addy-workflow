# Slice 02 — Tracker gateway, frozen contracts, and result envelopes

Index: `docs/plans/2026-07-15-addy-ticket-slices-index.md`
GitHub issue: [#9](https://github.com/teknologist/pi-addy-workflow/issues/9)
Previous: `docs/plans/2026-07-15-addy-ticket-slices-slice-01-command-state.md`
Next: `docs/plans/2026-07-15-addy-ticket-slices-slice-03-manual-lifecycle.md`
Repository scope: current repository only.

## Required context

- Spec: `docs/specs/2026-07-15-addy-ticket-slices.md`
- Completed Slice 01.
- Prompt surfaces: `prompts/addy-*.md`
- Agent-end surfaces: `agent-end-event.ts`, `agent-end-handler.ts`, `provider-transport-retry.ts`
- Immutable fixture sources:
  - GitHub tracker: `docs/agents/issue-tracker.md`, SHA-256 `d9949c929d688ad9add88aaa23fdbfb0bd2935639699c9c493fb48e828734c15`
  - GitHub labels: `docs/agents/triage-labels.md`, SHA-256 `9bbb882a64b0732794a61f3f097bca2ebe419f540d84d1529d03a55016633381`
  - Linear tracker: `/Users/eric/Dev/invoicehub-workflows/docs/agents/issue-tracker.md`, SHA-256 `65ffa571f78d2819a3ae0decae0c30d5d526948463d7c66325d6c2e0891e53ab`
  - Linear labels: `/Users/eric/Dev/invoicehub-workflows/docs/agents/triage-labels.md`, SHA-256 `4f53c9b40ce2651e3611aa090eaedbd6dbc9b71ef8c5f7e65eac0d8263190d0d`
  - Upstream commit: `mattpocock/skills@e9fcdf95b402d360f90f1db8d776d5dd450f9234`
  - Local tracker URL: `https://raw.githubusercontent.com/mattpocock/skills/e9fcdf95b402d360f90f1db8d776d5dd450f9234/skills/engineering/setup-matt-pocock-skills/issue-tracker-local.md`
  - `/to-tickets` URL: `https://raw.githubusercontent.com/mattpocock/skills/e9fcdf95b402d360f90f1db8d776d5dd450f9234/skills/engineering/to-tickets/SKILL.md`

## Task 1: Freeze representative tracker and ticket contracts

<!-- addy-task-id: ticket-slices-02-frozen-fixtures -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

### Objective

Make compatibility tests portable and immune to changes in external checkouts or unpinned upstream branches.

### Implementation steps

1. Create `tests/fixtures/tracker-config/github.md`, `linear.md`, and `local.md` from the exact immutable sources listed in Required context; verify each local SHA-256 before copying and fetch only the pinned upstream commit URLs.
2. Create `tests/fixtures/tracker-config/to-tickets-ticket.md` from the pinned `/to-tickets` body contract.
3. Add provenance headers containing the exact source URL/path, upstream commit and/or verified content hash, and capture date; do not retain credentials or repository-private ticket data.
4. Add one fixture loader/validator and a test that rejects missing provenance.
5. Future upstream refreshes must be explicit fixture updates, not live test reads.

### Acceptance criteria

- Tests run without `/Users/eric/Dev/invoicehub-workflows` and without network access.
- GitHub fixture defines query/fetch/assignment/comment/label/close and PR disambiguation.
- Linear fixture defines skill/tool use, fields/comments, labels, and completed-state semantics.
- Local fixture defines numbered frontier, `Status: claimed/resolved`, blockers, and `Comments`.
- `/to-tickets` fixture contains objective, criteria checkboxes, blockers, and no Addy block.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/tracker-config-fixtures.test.ts
```

Expected proof:

- Removing provenance or a required semantic operation fails the fixture test.

### Stop conditions

- Stop if a fixture would copy secrets or real private issue content; reduce it to the documented contract.

## Task 2: Define discriminated Queue and Ticket result envelopes

<!-- addy-task-id: ticket-slices-02-result-envelope -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Task 1.

### Objective

Create fail-closed machine results that do not parse narrative text.

### Implementation steps

1. Add `ticket-phase-result.ts` with two versioned variants:
   - Queue Result: selector plus counts/lists for eligible, blocked, claimed, ineligible, ambiguous, and selected ref; ticket/claim fields forbidden when no selection exists.
   - Ticket Result: operation, source/ref, run/claim/action/attempt, post-revision, lifecycle, activity marker, scope, review disposition, and repository evidence when owned.
2. Define outcomes: `succeeded`, `reconciled`, `blocked`, `failed`; define queue terminal reasons independently.
3. Extract exactly one hidden JSON envelope and reject unknown/forbidden fields, content payloads, identity/operation mismatches, stale actions, and invalid transitions.
4. Represent mixed queues with categorized counts/refs and deterministic precedence: selected eligible ticket first; otherwise configuration ambiguity, then all-ineligible/claimed/blocked/empty summary without pretending the queue is homogeneous.
5. Create `tests/ticket-phase-result.test.ts`.

### Acceptance criteria

- Empty Queue Result has no Ticket/claim identity and reports zero counts.
- Mixed blocked+claimed+ineligible Queue Result preserves each category and produces one deterministic pause summary.
- Ticket Result requires ticket/run/claim for bound operations; status on unclaimed ticket follows its explicitly allowed shape.
- Lost-envelope reconciliation can report observed completed mutation without marking a different phase successful.
- REVIEW distinguishes `clean` from `findings`; findings require `Reviewed=false`.
- Missing/duplicate/malformed/stale/mismatched envelopes never advance.
- Bodies, comments, prompts, logs, tokens, and secrets are rejected fields/content.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-phase-result.test.ts tests/agent-end-event.test.ts
```

Expected proof:

- Adversarial schema/identity/transition/mixed-queue fixtures pass.

### Stop conditions

- Stop if any queue, review, claim, or closure decision still requires free-form prose parsing.

## Task 3: Build the prompt gateway and deterministic source harness

<!-- addy-task-id: ticket-slices-02-prompt-harness -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Tasks 1–2.

### Objective

Delegate backend mechanics to setup docs while testing orchestration without pretending prompt-string assertions are live end-to-end tests.

### Implementation steps

1. Add `ticket-prompt.ts` for queue, status, claim, release, reclaim, add-repository, BUILD, SIMPLIFY, VERIFY, REVIEW, FIX-ALL, and FINISH.
2. Require guide reread, authoritative fetch, pre-write refetch, targeted merge, native operation, idempotent comment marker, post-write fetch/revision, and result envelope.
3. Enforce no skip/ship path in Ticket branches and exclusive lifecycle ownership.
4. Create `tests/fixtures/fake-ticket-source.ts`: an injectable in-memory source that accepts structured operation results, tracks expected body/comment/claim/selector/terminal post-state, and can simulate revision races, partial claims, lost envelopes, ambiguous routing, and backend failures.
5. Create `tests/ticket-prompt.test.ts` for prompt invariants and `tests/ticket-source-harness.test.ts` for deterministic operation post-states.

### Acceptance criteria

- GitHub/Linear/local prompt variants derive mechanics from their fixture docs; extension logic contains no backend API client.
- BUILD checks criteria + Implemented only; SIMPLIFY changes no lifecycle status; VERIFY/REVIEW own only their statuses; FINISH exposes no skip/ship.
- The harness proves expected orchestration/post-state for claim stages, comments, targeted mutation, completion, and revision conflicts.
- Prompt tests are labeled contract tests; authenticated mutation remains manual smoke testing in Slice 07.
- Parent tickets and excluded PRs are never mutation targets.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/ticket-prompt.test.ts tests/ticket-source-harness.test.ts tests/validate-assets.test.ts
```

Expected proof:

- Removing refetch/merge/idempotency/result requirements fails prompt tests.
- Simulated post-state mismatches fail harness tests.

### Stop conditions

- Stop if a backend command must be embedded in extension logic instead of setup guidance.

## Task 4: Ingest Ticket results before auto-only agent-end branches

<!-- addy-task-id: ticket-slices-02-agent-end -->

- [ ] Implemented
- [ ] Verified
- [ ] Reviewed

Depends on:

- Tasks 2–3.

### Objective

Record validated results for manual and Auto operations before current auto-only completion logic.

### Implementation steps

1. Ingest after provider transport handling and before the `autoMode` early return.
2. Persist manual evidence and stop without Auto dispatch.
3. Let Auto continue only from validated source-neutral actions.
4. Preserve pending keys on transport failure; reject stale envelopes.
5. Use structured review disposition, never prose findings, for Ticket routing.
6. Create `tests/agent-end-handler-ticket.test.ts`; extend transport and review-stats suites.

### Acceptance criteria

- Manual Ticket result persists while Auto remains off.
- Auto result advances once; duplicate same-action envelope is idempotent.
- Provider failure retains the same pending Ticket action/attempt.
- Free-form “success” and legacy commit/review parsers cannot complete Ticket operations.
- Plan-mode agent-end behavior remains unchanged.

### Verification

Run:

```sh
node --experimental-strip-types --test tests/agent-end-handler-ticket.test.ts tests/provider-transport-retry.test.ts tests/agent-end-review-stats.test.ts
```

Expected proof:

- Manual/Auto ordering and duplicate-result regressions pass.

### Stop conditions

- Stop if Ticket ingestion reorders legacy review stats or transport handling.

## Completion audit

- [ ] External contracts are frozen and portable.
- [ ] Queue and Ticket envelopes are structurally distinct.
- [ ] Deterministic harness tests post-state, not just wording.
- [ ] Manual and Auto result ingestion are fail closed.
