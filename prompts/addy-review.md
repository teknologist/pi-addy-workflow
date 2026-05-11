---
description: "Addy workflow: conduct a five-axis code review"
thinking: medium
---

# Addy Review

Pi adaptation of Addy Osmani's `review` command.

Use the Pi `code-review-and-quality` skill.

Argument: `/addy-review [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, then review the current staged, unstaged, or recent changes against that plan.

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
- Review only; do not edit unless the user asks.
- If no issues are found, say `No issues found` and include the checked scope.
