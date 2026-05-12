---
description: "Addy workflow: conduct a five-axis code review"
thinking: medium
---

# Addy Review

Pi adaptation of Addy Osmani's `review` command.

Use the Pi `code-review-and-quality` skill.

Argument: `/addy-review [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, then review the current staged, unstaged, or recent changes against that plan.

Before reviewing, check whether this would skip required workflow steps after build. If the active/supplied plan or Addy workflow state shows implemented work that has not been verified, warn the user that `/addy-review` would skip `/addy-verify`. Then call `ask_user_question` with one single-select question asking whether to run verification first or intentionally skip it. Options:

- `run verify` — run `/addy-verify <plan-path>` before reviewing.
- `skip verify` — intentionally continue to review without verified status.

Recommend `run verify`. Only continue review after the user explicitly chooses `skip verify`, or after verification has run and the plan has been rechecked. If the user explicitly chooses `skip verify`, continue the review with the workflow transition confirmation flag `--skip-verify-confirmed` so the footer may move from build to review after confirmation. Never silently skip verify between build and review.

When an active/supplied plan exists, read it before reviewing to identify the current verified task, but do not update the plan yet. Status checkbox updates happen only after review finishes. Mark `[x] Reviewed` only for tasks covered by this review. If the review finds blocking issues for a task, leave that task unchecked for review until fixes are verified or clearly record the blocker next to the checkbox.

This checkbox synchronization is mandatory after every `/addy-review` run. Before reporting completion, re-open the active/supplied plan and update each affected slice task so:

- `[x] Reviewed` means this review covered the task and found no unresolved blocking issues.
- Do not mark, unmark, or otherwise edit `[ ] Implemented` or `[ ] Verified` during review. Those checkboxes belong exclusively to `/addy-build` and `/addy-verify`.

If review status is uncertain or blocking issues remain, leave `[ ] Reviewed` unchecked and add a short note next to the task explaining what evidence is missing.

Review the current changes (staged, unstaged, or recent commits) across all five axes:

1. **Correctness** — Does it match the spec? Edge cases handled? Tests adequate?
2. **Readability** — Clear names? Straightforward logic? Well-organized?
3. **Architecture** — Follows existing patterns? Clean boundaries? Right abstraction level?
4. **Security** — Input validated? Secrets safe? Auth checked? Use the Pi `security-and-hardening` skill.
5. **Performance** — No N+1 queries? No unbounded ops? Use the Pi `performance-optimization` skill.

Categorize findings as Critical, Important, or Suggestion.
Output a structured review with specific `file:line` references and fix recommendations.

Pi-specific execution notes:

- Prefer `review_git_diff` for local changes.
- Before reporting completion, update only the review-owned `[ ] Reviewed` checkbox for the task this review covered and passed. This is required for every `/addy-review` run. Do not update implemented/verified checkboxes from `/addy-review`.
- Review only; do not edit source files unless the user asks. Updating the active/supplied plan status checkboxes is required.
- If no issues are found, say `No issues found` and include the checked scope.
