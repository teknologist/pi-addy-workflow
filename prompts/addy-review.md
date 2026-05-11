---
description: "Addy workflow: conduct a five-axis code review"
thinking: medium
---

# Addy Review

Pi adaptation of Addy Osmani's `review` command.

Use the Pi `code-review-and-quality` skill.

Argument: `/addy-review [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, then review the current staged, unstaged, or recent changes against that plan.

When an active/supplied plan exists, keep its task status checkboxes synchronized with evidence. Mark `[x] Reviewed` only for tasks covered by this review. If the review finds blocking issues for a task, leave that task unchecked for review until fixes are verified or clearly record the blocker next to the checkbox.

This checkbox synchronization is mandatory after every `/addy-review` run. Before reporting completion, re-open the active/supplied plan and update each affected slice task so:

- `[x] Implemented` means the implementation exists in the working tree or recent commits.
- `[x] Verified` means verification has actually passed for that task.
- `[x] Reviewed` means this review covered the task and found no unresolved blocking issues.

If any status is uncertain, leave it unchecked and add a short note next to the task explaining what evidence is missing.

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
- Before reporting completion, update the active/supplied plan so implemented, verified, and reviewed checkboxes match the review scope and findings. This is required for every `/addy-review` run.
- Review only; do not edit source files unless the user asks. Updating the active/supplied plan status checkboxes is required.
- If no issues are found, say `No issues found` and include the checked scope.
