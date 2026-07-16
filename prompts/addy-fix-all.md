---
description: "Addy workflow: fix surfaced issues, implement suggestions, then rerun review"
thinking: medium
argument-hint: "[plan-path]"
---

# Addy Fix All

Pi adaptation of Addy Osmani's fix-after-review loop.

Argument: `/addy-fix-all [plan-path]` or `/addy-fix-all --ticket <ticket-ref>`.

Supplied plan path argument, if any: `$ARGUMENTS`.

Ticket form requires the current run's live claim and does not bypass VERIFY or REVIEW. The workflow monitor supplies the source-neutral tracker contract and records the phase Activity without changing lifecycle status directly.

Use the supplied plan path when present and update the Addy workflow state's active plan. If no path is supplied, use the active plan from workflow state when available.

This command is a fix pass, not a review pass. Fix only the issues and suggestions explicitly surfaced in the immediately preceding `/addy-review` result. That review result may include Crit comments, failing checks, or review notes; treat those as fix targets only when they were included in the immediately preceding review result. If the immediately preceding `/addy-review` result was clean but the active plan still has the current task's `Reviewed` checkbox unchecked, the only fix target is synchronizing that checkbox with the clean review evidence. Do not use older conversation context, unrelated comments, or newly discovered findings as fix targets.

Treat Critical and Important findings as required fixes. Treat Suggestions as applicable unless they are unsafe, conflicting, out of scope, or would add speculative complexity.

ADR-related review findings are actionable fix targets. If the immediately preceding `/addy-review` reports an ADR violation, skipped ADR-derived `must not` guardrail, missing superseding ADR, or missing ADR context for architecture-sensitive changes, auto-recover when safe by making the smallest scoped change that satisfies the finding:

- Fix implementation that violates an existing ADR or plan guardrail.
- Add missing spec/plan required context when an existing relevant ADR was omitted.
- Link an existing ADR from the spec or plan when that resolves the review finding.
- Stop instead of guessing when resolution requires creating or changing an ADR, making a product/security/architecture judgment, or choosing between conflicting ADRs.

Do not invent issues. Do not search for new review findings. If the immediately preceding assistant turn was not a `/addy-review` result with actionable issues or suggestions, or a clean `/addy-review` result whose only unresolved work is an unchecked `Reviewed` checkbox for the current task, stop and ask the user to run `/addy-review` first.

For each surfaced item:

1. Re-read the referenced file, immediate context, and relevant tests before editing.
2. Make the smallest code, test, prompt, or documentation change that resolves the item.
3. Preserve user intent and existing style; avoid unrelated refactors, formatting churn, dependency changes, or public API changes unless required by a surfaced issue.
4. If suggestions conflict, pick the safer simpler option and explain the skipped alternative.
5. If a previous-review suggestion is not implemented, record why it was skipped.

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
