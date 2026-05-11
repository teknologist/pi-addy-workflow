---
description: "Addy workflow: verify behavior with TDD and Prove-It bug workflows"
thinking: medium
---

# Addy Verify

Pi adaptation of Addy Osmani's `verify` command.

Use the Pi `test-driven-development` skill.

Argument: `/addy-verify [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, otherwise verify the current implementation or bug context.

For new features:

1. Write tests that describe the expected behavior (they should FAIL)
2. Implement the code to make them pass
3. Refactor while keeping tests green

For bug fixes (Prove-It pattern):

1. Write a test that reproduces the bug (must FAIL)
2. Confirm the test fails
3. Implement the fix
4. Confirm the test passes
5. Run the full test suite for regressions

For browser-related issues, also use the Pi `browser-testing-with-devtools` skill to verify with Chrome DevTools MCP.

Pi-specific execution notes:

- Use `systematic-debugging` or `debugging-and-error-recovery` for unexpected failures.
- Use `process` for long-running test watchers or dev servers.
- Do not commit unless the user explicitly asks.
- Before claiming completion, follow `verification-before-completion` and report the exact checks run.
