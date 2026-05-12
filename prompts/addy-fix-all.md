---
description: "Addy workflow: fix surfaced issues, implement suggestions, then rerun review"
thinking: medium
---

# Addy Fix All

Pi adaptation of Addy Osmani's fix-after-review loop.

Argument: `/addy-fix-all [plan-path]`.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available, otherwise fix the current surfaced review scope.

Fix all surfaced issues and implement all applicable surfaced suggestions from the current conversation, latest `/addy-review` output, Crit comments, failing checks, or review notes. Treat Critical and Important findings as required fixes. Treat Suggestions as applicable unless they are unsafe, conflicting, out of scope, or would add speculative complexity.

Do not invent issues. If no surfaced issues or suggestions are available, run the Addy Review workflow once for the current scope, report that no fixes were applied yet, and stop.

For each surfaced item:

1. Re-read the referenced file, immediate context, and relevant tests before editing.
2. Make the smallest code, test, prompt, or documentation change that resolves the item.
3. Preserve user intent and existing style; avoid unrelated refactors, formatting churn, dependency changes, or public API changes unless required by a surfaced issue.
4. If suggestions conflict, pick the safer simpler option and explain the skipped alternative.
5. If a suggestion is not implemented, record why it was skipped.

After fixes:

1. Run the narrowest meaningful tests, typecheck, lint, build, or reproduction commands available for the changed scope.
2. If validation fails, follow the Pi `debugging-and-error-recovery` skill and fix the failure before continuing.
3. When an active/supplied plan exists and fixes changed code, tests, prompts, or docs covered by that plan, rerun the Addy Verify workflow for the same plan path before review by invoking `/addy-verify <plan-path>` when command invocation is available. If direct slash-command invocation is not available from this assistant turn, immediately perform the `/addy-verify` prompt's verification workflow in this same turn instead. This is required because fixes can invalidate prior `[x] Verified` and `[x] Reviewed` evidence.
4. Rerun the Addy Review workflow for the same plan path or change scope by invoking `/addy-review <plan-path>` when command invocation is available. If direct slash-command invocation is not available from this assistant turn, immediately perform the `/addy-review` prompt's review workflow in this same turn instead.
5. Do not merely print `/addy-verify` or `/addy-review` and stop. The verification and new review must actually run or be performed before reporting completion.

Final response format:

- **Fixed** — surfaced issues and suggestions implemented.
- **Skipped** — surfaced suggestions not implemented, with reasons.
- **Validation** — exact commands run and results.
- **Review rerun** — new `/addy-review` result or a clear blocker that prevented rerunning it.

Do not commit unless the user explicitly asks.
