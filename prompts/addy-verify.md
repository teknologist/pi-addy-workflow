---
description: "Addy workflow: verify behavior with TDD and Prove-It bug workflows"
thinking: medium
---

# Addy Verify

Pi adaptation of Addy Osmani's `verify` command.

Use the Pi `test-driven-development` skill.

Argument: `/addy-verify [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, otherwise verify the current implementation or bug context.

When an active/supplied plan exists, keep its task status checkboxes synchronized with evidence. Mark `[x] Verified` only for tasks whose verification was actually run and passed. Do not mark unverified or merely intended work as verified.

This checkbox synchronization is mandatory after every `/addy-verify` run. Before reporting completion, re-open the active/supplied plan and update each affected slice task so:

- `[x] Implemented` means the implementation exists in the working tree or recent commits.
- `[x] Verified` means the verification for that task was run and passed in this run or earlier recorded evidence.
- `[x] Reviewed` remains checked only if a review has actually covered that task.

If any status is uncertain, leave it unchecked and add a short note next to the task explaining what evidence is missing.

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
- Before reporting completion, update the active/supplied plan so implemented, verified, and reviewed checkboxes match the work actually completed. This is required for every `/addy-verify` run.
- Do not commit unless the user explicitly asks.
- Before claiming completion, follow `verification-before-completion` and report the exact checks run.
