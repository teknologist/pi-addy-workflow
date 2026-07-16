# Addy Ticket Slice execution spec

**Status:** Grilling complete — approved for implementation planning.

## Objective

Make Addy's full workflow operate directly on tickets produced by `/to-tickets`, using the issue tracker and triage-label conventions configured by `/setup-matt-pocock-skills`.

Supported ticket sources:

- GitHub Issues;
- Linear issues;
- local `/to-tickets` markdown files.

Supported Addy phases and surfaces:

- `/addy-build`;
- `/addy-code-simplify` as an optional, status-neutral phase after BUILD and before VERIFY;
- `/addy-verify`;
- `/addy-review`;
- `/addy-fix-all`;
- `/addy-finish`;
- `/addy-auto`;
- `/addy-stats`;
- workflow footer/dashboard, frontier guards, retries, commit evidence, and fresh-session continuation.

## Source compatibility

This repository changes for compatibility with the current Matt Pocock skill contracts. The feature must not require changes to `/to-tickets` or `/setup-matt-pocock-skills`.

Addy reads the current repository's:

- `docs/agents/issue-tracker.md` as the sole authority for backend tools, reference resolution, query/fetch mechanics, native claiming, comments, and completion transitions;
- `docs/agents/triage-labels.md` for the configured `ready-for-agent` label mapping when present;
- local tickets under `.scratch/<feature-slug>/issues/<NN>-<slug>.md` when the tracker guide configures local markdown.

Do not create an Addy-specific duplicate tracker configuration. The tracker guide's prose is intentionally sufficient for the agent-mediated boundary: the GitHub example defines `gh` operations and issue assignment/closure, while the Linear example defines Linear skill/tool use, issue fields, comments, and movement to the appropriate completed state.

Tracker access is agent-mediated. The workflow monitor stores and routes opaque ticket references; each phase prompt reads the setup docs, uses the configured tracker tool or skill, refetches authoritative ticket state, performs a targeted mutation, and returns a machine-readable result to Addy. The extension must not embed separate GitHub or Linear clients. If required tracker semantics are absent or genuinely ambiguous, manual mode asks for clarification and Addy Auto Mode stops with a configuration report.

Each agent-mediated operation ends with exactly one versioned hidden JSON result envelope. Use discriminated variants:

- **Ticket Queue Result** for selection attempts that may have no ticket or claim identity, with categorized counts/reasons for empty, blocked, claimed, ineligible, and ambiguous matches, including mixed-category queues;
- **Ticket Phase Result** for ticket-bound selection/claim, BUILD, SIMPLIFY, VERIFY, REVIEW, FIX-ALL, FINISH, status, release, reclaim, and repository-scope approval.

The monitor validates the variant, ticket identity when required, claim/run identity when required, Auto Action Key, operation, attempt, and schema before advancing. Ticket-bound envelopes contain only:

- source kind and opaque ticket reference;
- run and claim identity when the operation is claim-bound;
- Auto Action Key and attempt identity;
- source revision/hash after mutation;
- operation and outcome (`succeeded`, `reconciled`, `blocked`, or `failed`);
- current lifecycle-status snapshot;
- structured review disposition when REVIEW owns it;
- Ticket Activity idempotency marker/comment ID;
- locked repository scope;
- commit evidence when FINISH owns it.

It must not contain ticket body text, comments, prompts, logs, secrets, or tokens. The envelope is orchestration evidence, not source of truth; every later phase refetches the authoritative ticket. Missing, malformed, stale, or mismatched envelopes fail closed and do not advance the workflow.

## Canonical execution model

### One ticket is one slice

A `/to-tickets` ticket is a **Ticket Slice**: one tracer-bullet vertical slice executed through Addy's BUILD → VERIFY → REVIEW lifecycle. Label-matched tickets are not grouped into one plan merely because they share a queue.

A Ticket Slice may contain multiple acceptance criteria, but it is one Addy lifecycle unit.

### Ticket body is authoritative

The ticket body owns:

- its build objective;
- blocking relationships;
- acceptance-criteria checkboxes;
- Addy's managed lifecycle state.

Addy appends at most one delimited **Ticket Lifecycle Block** and patches only:

- that managed block;
- the exact acceptance-criteria checkboxes completed by BUILD;
- local-file Ticket Activity entries under the tracker-configured comments section.

All other ticket content must be preserved.

The managed block records at least:

- schema/version marker;
- stable source ticket identity;
- `Implemented`, `Verified`, and `Reviewed` checkboxes;
- claim owner/run identity and claim timestamp;
- originating queue selector when applicable;
- repository scope;
- commit evidence;
- last completed Addy phase.

Malformed or duplicate managed-block sentinels are a stop condition.

### Acceptance criteria supplement lifecycle

Acceptance-criteria checkboxes do not replace Addy's lifecycle statuses.

- `/addy-build` checks each criterion whose outcome it implemented.
- `Implemented` remains unchecked until every required acceptance criterion is checked and build-owned targeted checks pass.
- `/addy-code-simplify` may run only after `Implemented` and before `Verified`; it posts Ticket Activity but owns no lifecycle checkbox.
- `/addy-verify` exclusively owns `Verified`.
- `/addy-review` exclusively owns `Reviewed`.
- `/addy-fix-all` records fixes but does not bypass verification or review.
- Ticket closure requires full Task Closure, including commit evidence.

## Ticket Activity

Narrative execution details are comments, not lifecycle state.

GitHub and Linear use native issue comments. Local ticket files append equivalent timestamped entries under the tracker-configured `## Comments` section.

Addy writes one idempotent activity entry per phase attempt:

- BUILD: progress, behavior/files changed, targeted checks, and criteria checked;
- VERIFY: commands run and proof obtained or failure details;
- REVIEW: findings with severity, or an explicit clean result;
- FIX-ALL: each finding addressed and the corresponding fix;
- FINISH: commit identities, repository results, and ticket closure.

Each entry carries a hidden stable action/attempt marker so fresh-session retries do not duplicate comments.

Activity must not contain secrets, tokens, unbounded logs, or raw prompt content.

## Ticket selection

### Commands

Preserve positional local Slice Plan paths. Add explicit ticket flags:

```text
/addy-build --ticket <ticket-ref>
/addy-code-simplify [--ticket <ticket-ref>]
/addy-verify [--ticket <ticket-ref>]
/addy-review [--ticket <ticket-ref>]
/addy-fix-all [--ticket <ticket-ref>]
/addy-finish [--ticket <ticket-ref>]
/addy-auto --tickets
/addy-auto --tickets --label <label>
/addy-stats --ticket <ticket-ref>
/addy-ticket status <ticket-ref>
/addy-ticket release <ticket-ref>
/addy-ticket reclaim <ticket-ref>
/addy-ticket add-repository <ticket-ref> <repository>
```

Ticket references are opaque to Addy and resolved according to `docs/agents/issue-tracker.md`; this preserves backend rules such as GitHub issue-versus-PR number disambiguation. BUILD may create a claim; every other explicit lifecycle override requires the same live claim to be owned by the current Addy run. Later phases default to the active Ticket Slice.

While a live Ticket Claim exists, commands that would switch to a different Ticket, a Slice Plan, DEFINE, or PLAN fail closed with exact status/release instructions. `/addy-ship` is also rejected while a live or possibly corrupt Ticket Claim exists. `/addy-auto stop`, `/addy-ticket status`, and operations on the same claim remain allowed.

### Queue semantics

A bare `--tickets` queue resolves the configured canonical `ready-for-agent` label. `--label <value>` selects an arbitrary label instead.

For local files:

- the default selector matches `**Status:** ready-for-agent` (or its configured mapping);
- arbitrary selectors may match either `Status` or an optional `**Labels:**` list;
- existing `/to-tickets` files remain valid without a Labels field.

Among matching tickets, Addy selects the oldest unblocked eligible ticket. Local ordering uses the numeric ticket prefix first and a deterministic fallback when no prefix exists.

If every matching ticket is blocked, claimed, or malformed, Addy stops with a categorized report rather than guessing.

### Eligibility

Queue mode skips and reports malformed tickets. Direct `--ticket` mode stops with exact missing requirements.

Minimum eligibility:

- a non-empty build objective;
- at least one checkable acceptance criterion;
- resolvable blocker information, where explicit “none” is valid;
- no unresolved blocking ticket;
- no conflicting live claim.

An explicit `--ticket` reference bypasses label membership but not eligibility, blockers, or claim safety.

## Claiming and recovery

Before BUILD, Addy refetches and claims the Ticket Slice through retry-safe stages:

1. Invoke the configured tracker's native claim convention when one exists (for example, assign the GitHub issue to the current user or set local `Status: claimed`).
2. Write the resulting native ownership and Addy claim identity into the Ticket Lifecycle Block.
3. Remove the selected queue label or selector as applicable.
4. Refetch and confirm all three postconditions before touching code.
5. Abort if a competing live claim appeared.

Each stage reuses the same action/idempotency marker. A retry refetches and resumes missing stages rather than repeating completed writes. If an envelope is lost after tracker mutation, the pending action reconciles the observed post-state and emits a `reconciled` result. Native ownership without a matching Addy claim, selector removal without recoverable claim identity, or conflicting partial state requires manual repair; Addy must not guess ownership.

For local files, claiming changes a matching queue `Status` away from `ready-for-agent` or removes the selected optional label, while preserving the original selector in the managed block.

The owning Addy workflow state resumes its claim automatically across fresh sessions. Other runs skip and report claimed tickets. There is no automatic timeout takeover.

Add a dedicated claim-management command:

```text
/addy-ticket status <ticket-ref>
/addy-ticket release <ticket-ref>
/addy-ticket reclaim <ticket-ref>
```

- `status` refetches and reports claim, lifecycle, blockers, revision, repository scope, and queue-selector facts without mutation.
- `release` clears the claim, restores its original queue selector when one existed, and posts Ticket Activity.
- `reclaim` transfers ownership directly to the current Addy run without briefly re-queuing the ticket, and posts Ticket Activity.
- `add-repository` is the explicit approval path for scope expansion; it validates the repository, updates the locked list before any edits there, and posts Ticket Activity.
- Release/reclaim operations use the same targeted-merge and Ticket Phase Result safety rules as lifecycle phases.

## Queue execution

`/addy-auto --tickets [--label <label>]` drains the runnable frontier:

1. Select and claim the oldest unblocked eligible Ticket Slice.
2. Run BUILD → VERIFY → REVIEW, including FIX-ALL loops when needed.
3. Commit all repositories in the managed repository scope.
4. Record commit evidence and close/complete the ticket only after Task Closure.
5. Start a fresh context and select the next runnable Ticket Slice.
6. Stop when the queue is empty, all matches are blocked/claimed/ineligible, an explicit stop is requested, or a human decision is required.

## Concurrent edits

Before every ticket-body write, refetch the latest body and perform a targeted merge.

- Preserve unrelated human edits.
- Patch only the managed block, the exact acceptance criterion being completed, or the local Comments section.
- Stop if a target criterion disappeared, became ambiguous, or changed meaning.
- Never use last-write-wins whole-body replacement.

## Repository scope

Ticket Slices support multiple repositories. At claim time, Addy resolves the initial list from optional ticket metadata compatible with existing Slice Plan conventions:

- `Repository scope:`;
- `Owner repo`;
- `Companion repo`.

When no repository metadata exists, scope defaults to the current repository. Addy normalizes and writes the resolved list into the Ticket Lifecycle Block before touching code. That managed list is authoritative for implementation, verification, review, commits, and closure.

Repository scope is locked before BUILD starts. If implementation discovers another required repository, manual mode asks one bounded approval question; Addy Auto Mode persists a `scope-expansion-required` pause and stops. Approval occurs through `/addy-ticket add-repository <ticket-ref> <repository>`, which updates the managed list and posts Ticket Activity before any edits in that repository. Commit evidence and closure must cover every listed repository.

Reuse existing `repository-scope.ts` resolution semantics where compatible; do not create a second conflicting path vocabulary.

## Closure semantics

A remote ticket moves through the completion transition defined by `docs/agents/issue-tracker.md`, and a configured local ticket becomes `Status: resolved`, only after Task Closure:

- all required acceptance criteria checked;
- `Implemented`, `Verified`, and `Reviewed` checked by their owning phases;
- matching commit evidence for every repository in scope;
- final FINISH activity posted.

Parent issues referenced by `/to-tickets` are never modified or closed.

## Relationship to existing external progress spec

`docs/specs/2026-07-13-external-issue-workflow-progress.md` specifies read-only presentation for external `/implement-from-issues` runs and explicitly forbids mapping those runs into Addy's lifecycle.

This spec introduces a separate execution path in which the user explicitly invokes Addy with `--ticket` or `--tickets`. The two modes coexist:

- external `/implement-from-issues` progress remains read-only and is never mapped into Addy's lifecycle;
- Addy Ticket Slice mode is first-class Addy execution and starts only through an explicit Addy command;
- a ticket claimed by an external implementation run is not eligible for simultaneous Addy execution;
- Addy does not adopt active external runs; any future handoff requires an explicit import/reclaim design outside this scope.

## Corrupt-state and ambiguity policy

Corrupt persisted Ticket state must not prevent Addy startup or read-only status reporting, but it must block Ticket dispatch and execution-source switching with a recovery warning. Addy must not silently discard the state and fall back to Slice Plan mode because that could orphan a tracker-side claim.

When required tracker routing or completion semantics are ambiguous, manual mode asks one bounded clarification question and persists the resolved fact for the active operation; Addy Auto Mode pauses with a categorized configuration reason and performs no mutation.

Ticket-mode prompts expose no lifecycle skip or ship path. SIMPLIFY is optional, manual-only, and status-neutral; Ticket queue Auto Mode never dispatches it implicitly. VERIFY, REVIEW, and FINISH gates remain mandatory.

## Non-goals

- Modifying Matt Pocock's skills as a prerequisite.
- Silently normalizing vague or malformed issues into executable tickets.
- Grouping all tickets with one label into one Addy slice.
- Time-based claim stealing.
- Last-write-wins ticket-body updates.
- Modifying or closing `/to-tickets` parent issues.

## Open decisions

None.

Implementation must not begin until an implementation plan is written and the user explicitly approves the spec and plan for build.
