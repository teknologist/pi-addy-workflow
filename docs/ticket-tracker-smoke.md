# Ticket tracker compatibility checks

## Automated coverage

The repository's frozen tracker fixtures and deterministic fake source provide offline contract + harness coverage. They exercise query and direct fetch, queue selection, blockers, native and managed claims, targeted lifecycle mutation, Ticket Activity, review/fix, commit evidence, completion failure, lost-result recovery, and terminal post-states for GitHub, Linear, and local markdown.

This is not live tracker mutation coverage. It does not authenticate, call GitHub or Linear, or modify upstream Matt Pocock skills.

Run:

```sh
node --experimental-strip-types --test tests/tracker-config-fixtures.test.ts tests/ticket-prompt.test.ts tests/ticket-source-harness.test.ts tests/ticket-backend-contract-matrix.test.ts tests/ticket-claim.test.ts tests/ticket-finish.test.ts tests/ticket-queue*.test.ts
```

## Authenticated smoke tests (opt-in, non-CI)

These procedures are manual, opt-in, non-CI checks. They are **not executed** as part of this repository's test suite. Use an isolated test repository/workspace and disposable child ticket. Credentials are never stored in fixtures, commands, output, or this repository.

### GitHub

Prerequisites: an already authenticated `gh` session with access to the isolated repository, the repository's `docs/agents/issue-tracker.md`, and a disposable open issue carrying the mapped `ready-for-agent` label. Confirm the target number is an issue, not a pull request.

1. Run `/addy-ticket status <ticket-ref>` and confirm the issue remains unchanged.
2. Run `/addy-build --ticket <ticket-ref>` and confirm the issue is assigned to the current user, has one Addy managed claim block, and no longer has the queue label.
3. Complete BUILD → VERIFY → REVIEW. Confirm one idempotently marked comment per phase and only owned checkboxes/block fields changed.
4. Run `/addy-finish --ticket <ticket-ref>` after repository commit evidence exists. GitHub FINISH order: final Activity → terminal transition (close the issue) → confirming refetch.
5. For recovery, use another disposable issue: interrupt after assignment, then retry the same claim action. Confirm missing stages resume without a duplicate block or comment.

Record the repository, issue URL, UTC time, Addy run/claim IDs, and observed post-states outside this repository. Never record tokens or raw authenticated output.

### Linear

Prerequisites: an authenticated Linear skill/tool session, an isolated team/project with unambiguous routing and completed state, the repository's tracker/triage guides, and a disposable issue carrying the mapped queue label.

1. Run `/addy-ticket status <ticket-ref>` and confirm the issue remains unchanged.
2. Run `/addy-build --ticket <ticket-ref>` and confirm the configured assignee, managed claim block, and queue-label removal.
3. Complete BUILD → VERIFY → REVIEW and confirm one idempotently marked Linear comment per phase.
4. Run `/addy-finish --ticket <ticket-ref>` after commit evidence exists. Linear FINISH order: final Activity → terminal transition (move to the configured completed state) → confirming refetch.
5. In a separate test workspace with deliberately ambiguous completion routing, start Ticket Auto and confirm it pauses with a configuration reason and performs no mutation.

Record only issue URLs/identifiers, UTC time, run/claim IDs, and post-state summaries outside this repository. Never record credentials, tokens, comments, or raw tool responses.
