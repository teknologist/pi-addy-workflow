---
description: "Addy workflow: conduct a five-axis code review"
thinking: medium
argument-hint: "[plan-path]"
---

# Addy Review

Pi adaptation of Addy Osmani's `review` command.

Use the Pi `code-review-and-quality` skill.

Argument: `/addy-review [plan-path]`.

Supplied plan path argument, if any: `$ARGUMENTS`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, then review the current staged, unstaged, or recent changes against that plan.

If no path is supplied and the active plan is already fully complete while the current turn, recent context, or same-directory slice index clearly identifies the next unfinished slice, review against that next slice path and make it the active plan. A bare `/addy-review` must not keep using a completed stale slice when the work has moved to the next slice.

Before reviewing, check whether this would skip required workflow steps after build. If the active/supplied plan or Addy workflow state shows implemented work that has not been verified, warn the user that `/addy-review` would skip `/addy-verify`.

If Addy Auto Mode is active, do not call `ask_user_question`; `/addy-auto` is explicit permission to continue the required lifecycle autonomously. Run `/addy-verify <plan-path>` automatically, re-read the plan, and continue review only after fresh verification evidence exists. Stop only if verification is truly blocked, unsafe, or ambiguous in a way that cannot be resolved autonomously.

If Addy Auto Mode is not active, call `ask_user_question` with one single-select question asking whether to run verification first or intentionally skip it. Options:

- `run verify` — run `/addy-verify <plan-path>` before reviewing.
- `skip verify` — intentionally continue to review without verified status.

Recommend `run verify`. Only continue review after the user explicitly chooses `skip verify`, or after verification has run and the plan has been rechecked. If the user explicitly chooses `skip verify`, continue the review with the workflow transition confirmation flag `--skip-verify-confirmed` so the footer may move from build to review after confirmation. Never silently skip verify between build and review.

When an active/supplied plan exists, read it before reviewing to identify the current verified task, but do not update the plan yet. Status checkbox updates happen only after review finishes. Mark `[x] Reviewed` only for tasks covered by this review. If the review finds blocking issues for a task, leave that task unchecked for review until fixes are verified or clearly record the blocker next to the checkbox.

When the active/supplied plan or spec lists ADRs, `Required context`, or `Must preserve ADR constraints`, read those linked ADR/spec/steering files before reviewing. Enforce ADR-derived guardrails as part of review: flag any implementation that violates listed ADR constraints, skips a `must not` acceptance criterion, changes architecture decisions without a superseding ADR, or relies on behavior the ADR explicitly rejected. If ADR context appears missing but the changes are clearly architecture-sensitive, report that as an Important planning/spec gap instead of inventing ADR constraints. Make ADR-related Critical or Important findings actionable for `/addy-fix-all`: name whether the safe fix is updating implementation, adding missing spec/plan required context, linking an existing ADR, or stopping for a superseding ADR / explicit human architecture decision.

This checkbox synchronization is mandatory after every `/addy-review` run. Before reporting completion, re-open the active/supplied plan and update each affected slice task so:

- `[x] Reviewed` means this review covered the task and found no unresolved blocking issues.
- Do not mark, unmark, or otherwise edit `[ ] Implemented` or `[ ] Verified` during review. Those checkboxes belong exclusively to `/addy-build` and `/addy-verify`.

If review status is uncertain or blocking issues remain, leave `[ ] Reviewed` unchecked and add a short note next to the task explaining what evidence is missing.

Review the current changes (staged, unstaged, or recent commits) across all five axes:

1. **Correctness** — Does it match the spec? Edge cases handled? Tests adequate?
2. **Readability** — Clear names? Straightforward logic? Well-organized?
3. **Architecture** — Follows existing patterns? Clean boundaries? Right abstraction level? Preserves related ADR decisions and plan `must not` guardrails?
4. **Security** — Input validated? Secrets safe? Auth checked? Use the Pi `security-and-hardening` skill.
5. **Performance** — No N+1 queries? No unbounded ops? Use the Pi `performance-optimization` skill.

Categorize findings as Critical, Important, or Suggestion.
Output a structured review with specific `file:line` references and fix recommendations.

Keep issue categories machine-readable for stats parsing:

- Use `Critical:` for blocking correctness, data loss, security, or broken-build findings.
- Use `Important:` for non-blocking issues that should be fixed before acceptance.
- Use `Suggestion:` for optional improvements only.
- If no issues are found, include the exact phrase `No issues found`.

Pi-specific execution notes:

- Prefer `review_git_diff` for local changes.
- Before reporting completion, update only the review-owned `[ ] Reviewed` checkbox for the task this review covered and passed. This is required for every `/addy-review` run. Do not update implemented/verified checkboxes from `/addy-review`.
- Review only; do not edit source files unless the user asks. Updating the active/supplied plan status checkboxes is required.
- If no issues are found, say `No issues found` and include the checked scope.
