# Addy Ticket Slice implementation plan

**Status:** Implementation-ready; published as GitHub issues #8–#14. Build remains unstarted.

## Objective

Implement `docs/specs/2026-07-15-addy-ticket-slices.md` so the complete Addy lifecycle can execute one `/to-tickets` ticket per slice from GitHub, Linear, or local markdown, either directly or by draining an AFK-ready/arbitrary-label queue.

## Required context

- Spec: `docs/specs/2026-07-15-addy-ticket-slices.md`
- Domain glossary: `CONTEXT.md`
- ADR: `docs/adr/0001-addy-auto-runner-lock.md`
- Steering: `AGENTS.md`
- GitHub tracker example: `docs/agents/issue-tracker.md`
- Upstream contracts and the Linear reference must be copied into repo-local, provenance-stamped test fixtures in Slice 02 before implementation depends on them.

## Architectural constraints

- Ticket execution is a parallel execution-source adapter, not a synthetic Slice Plan.
- Existing `activePlan`, Slice Plan parsing, plan identity, and plan Task Commit behavior remain unchanged when Ticket mode is absent.
- Tracker access is agent-mediated through repository setup docs; do not embed GitHub or Linear clients.
- Ticket bodies/comments are authoritative. Persisted Ticket state is a validated orchestration cache and must be reconciled before mutation.
- Addy Auto runner-lock ownership remains project-scoped and singular. Do not create a second extension-level runner lock or time-based Ticket lease.
- External `/implement-from-issues` progress remains a separate read-only presentation source.
- A claimed Ticket Slice is never silently released by timeout, `/addy-auto stop`, generic reset, corrupt-state recovery, or execution-source switching.
- Repository scope is normalized and locked during claim, before BUILD touches code.
- No ticket closes until all criteria/lifecycle gates and all locked-repository evidence are complete.

## Command matrix to preserve across all slices

| Command                       | Ticket form                   | Rule                                                                                     |
| ----------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| `/addy-build`                 | `--ticket <ref>`              | May validate and create a claim, then BUILD                                              |
| `/addy-code-simplify`         | `[--ticket <ref>]`            | Same owned claim; manual-only after Implemented and before Verified; no lifecycle status |
| `/addy-verify`                | `[--ticket <ref>]`            | Same owned claim; owns Verified only                                                     |
| `/addy-review`                | `[--ticket <ref>]`            | Same owned claim; owns Reviewed only when clean                                          |
| `/addy-fix-all`               | `[--ticket <ref>]`            | Same owned claim; fixes findings, then requires VERIFY → REVIEW                          |
| `/addy-finish`                | `[--ticket <ref>]`            | Same owned claim; requires all gates and repository evidence                             |
| `/addy-auto`                  | `--tickets [--label <label>]` | Drain deterministic runnable queue; never implicitly SIMPLIFY                            |
| `/addy-stats`                 | `--ticket <ref>`              | Read locally persisted Addy stats only                                                   |
| `/addy-ticket status`         | `<ref>`                       | Read claim and lifecycle state                                                           |
| `/addy-ticket release`        | `<ref>`                       | Release claim and restore a recorded selector when present                               |
| `/addy-ticket reclaim`        | `<ref>`                       | Transfer claim directly to the current run                                               |
| `/addy-ticket add-repository` | `<ref> <repository>`          | Explicit scope-expansion approval                                                        |

All lifecycle commands without `--ticket` use the active Ticket when Ticket mode is active. Only BUILD may create a claim. Ticket refs are opaque. A live or possibly corrupt claim blocks DEFINE, PLAN, SHIP, a different Ticket, a plan-path lifecycle command, or `/addy-auto <plan>` until explicit release or repair; stop/status/same-claim operations remain allowed.

## Slices

| Slice | Plan                                                                      | Purpose                                                                                     |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 01    | `docs/plans/2026-07-15-addy-ticket-slices-slice-01-command-state.md`      | Typed commands, strict state, corruption policy, and source-neutral identity                |
| 02    | `docs/plans/2026-07-15-addy-ticket-slices-slice-02-gateway-results.md`    | Frozen tracker fixtures, agent gateway, discriminated results, and deterministic harness    |
| 03    | `docs/plans/2026-07-15-addy-ticket-slices-slice-03-manual-lifecycle.md`   | Scope locking, retry-safe claims, manual lifecycle, clarification, and source-switch safety |
| 04    | `docs/plans/2026-07-15-addy-ticket-slices-slice-04-finish-evidence.md`    | Multi-repo evidence, manual FINISH, comments, and tracker closure                           |
| 05    | `docs/plans/2026-07-15-addy-ticket-slices-slice-05-auto-queue.md`         | Dependency-aware queue selection, Auto lifecycle, and drain                                 |
| 06    | `docs/plans/2026-07-15-addy-ticket-slices-slice-06-presentation-stats.md` | Ticket footer, dashboard, and stats projections                                             |
| 07    | `docs/plans/2026-07-15-addy-ticket-slices-slice-07-compatibility.md`      | Backend contract checks and complete legacy/external compatibility audit                    |

## Published Ticket Slices

| Slice | GitHub issue                                                     | Blocked by | Labels                    |
| ----- | ---------------------------------------------------------------- | ---------- | ------------------------- |
| 01    | [#8](https://github.com/teknologist/pi-addy-workflow/issues/8)   | None       | `ready-for-agent`, `addy` |
| 02    | [#9](https://github.com/teknologist/pi-addy-workflow/issues/9)   | #8         | `ready-for-agent`, `addy` |
| 03    | [#10](https://github.com/teknologist/pi-addy-workflow/issues/10) | #9         | `ready-for-agent`, `addy` |
| 04    | [#11](https://github.com/teknologist/pi-addy-workflow/issues/11) | #10        | `ready-for-agent`, `addy` |
| 05    | [#12](https://github.com/teknologist/pi-addy-workflow/issues/12) | #11        | `ready-for-agent`, `addy` |
| 06    | [#13](https://github.com/teknologist/pi-addy-workflow/issues/13) | #12        | `ready-for-agent`, `addy` |
| 07    | [#14](https://github.com/teknologist/pi-addy-workflow/issues/14) | #13        | `ready-for-agent`, `addy` |

Each dependency exists both in the issue body and as a native GitHub issue dependency.

## Ordered dependency chain

```text
01 command/state
  → 02 gateway/results
    → 03 scope/claim/manual lifecycle
      → 04 FINISH/evidence
        → 05 Auto queue/drain
          → 06 presentation/stats
            → 07 compatibility audit
```

Each slice must leave the existing local Slice Plan workflow green. Do not start a later slice while an earlier slice has unresolved verification or review findings.

## Completion audit

- [ ] Every slice task has implementation, verification, and review evidence.
- [ ] GitHub, Linear, and local fixture contracts cover query, fetch, native claim, targeted mutation, comments, and completion.
- [ ] Direct `--ticket` and queue `--tickets [--label]` flows work through BUILD → optional SIMPLIFY → VERIFY → REVIEW → FINISH.
- [ ] Partial claims and lost result envelopes reconcile without duplicate writes or guessed ownership.
- [ ] Live claims survive stop, fresh sessions, corrupt persisted state, and rejected source switches.
- [ ] Auto drains only runnable tickets and reports mixed blocked/claimed/ineligible/empty/ambiguous queues deterministically.
- [ ] Multi-repository closure requires complete per-repository evidence.
- [ ] Ticket Activity includes implementation, verification, findings, fixes, and final evidence without retry duplicates.
- [ ] Existing Slice Plan behavior/snapshots remain unchanged when Ticket mode is absent.
- [ ] External issue-workflow progress remains separately presented and never controls Ticket execution.
- [ ] `npm test`, `npm run typecheck`, and `npm run format:check` pass with no skipped checks.
- [ ] No unrelated files changed.
