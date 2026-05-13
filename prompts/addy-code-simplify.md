---
description: "Addy workflow: simplify code for clarity and maintainability without behavior changes"
thinking: medium
argument-hint: "[plan-path]"
---

# Addy Code Simplify

Pi adaptation of Addy Osmani's `code-simplify` command.

Use the Pi `code-simplification` skill.

Argument: `/addy-code-simplify [plan-path]`.

Supplied plan path argument, if any: `$ARGUMENTS`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, otherwise simplify the specified/recent change scope.

Simplify recently changed code (or the specified scope) while preserving exact behavior:

1. Read `AGENTS.md` and study project conventions
2. Identify the target code — recent changes unless a broader scope is specified
3. Understand the code's purpose, callers, edge cases, and test coverage before touching it
4. Scan for simplification opportunities:
   - Deep nesting → guard clauses or extracted helpers
   - Long functions → split by responsibility
   - Nested ternaries → if/else or switch
   - Generic names → descriptive names
   - Duplicated logic → shared functions
   - Dead code → remove after confirming
5. Apply each simplification incrementally — run tests after each change
6. Verify all tests pass, the build succeeds, and the diff is clean

If tests fail after a simplification, revert that change and reconsider. Use the Pi `code-review-and-quality` skill to review the result.

Pi-specific execution notes:

- Do not commit unless the user explicitly asks.
- Keep changes behavior-preserving and scoped.
- Before claiming completion, follow `verification-before-completion` and report the exact checks run.
