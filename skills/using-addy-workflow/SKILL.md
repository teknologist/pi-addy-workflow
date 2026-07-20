---
name: using-addy-workflow
description: Governs the Addy workflow package lifecycle. Use at session start or whenever the user invokes an /addy-* prompt.
---

# Using Addy Workflow

Workflow commands:

1. DEFINE with `/addy-define`: clarify goal, users, constraints, acceptance criteria. Optional; user may skip.
2. PLAN with `/addy-plan`: create small vertical tasks and verification steps. Plans should be `/addy-auto` ready: each task must be autonomous, independently verifiable, and include proof requirements plus stop conditions. Optional; user may skip or reuse an existing plan.
3. BUILD with `/addy-build`: implement incrementally, test first when useful, no auto-commit.
4. SIMPLIFY with `/addy-code-simplify`: simplify code without behavior changes. Optional; user may skip.
5. VERIFY with `/addy-verify`: prove behavior with tests or reproduction.
6. REVIEW with `/addy-review`: check correctness, readability, architecture, security, performance.
7. FIX with `/addy-fix-all`: resolve surfaced review issues and suggestions, validate fixes, then rerun `/addy-review`. Optional; use after a review surfaces actionable follow-up.
8. FINISH with `/addy-finish`: choose whether to commit current work, build the next task or slice, or run `/addy-ship` when all slices are complete. Optional; user may run after any number of build/verify/review cycles.

Enforce only `BUILD → VERIFY → REVIEW`. Do not force DEFINE, PLAN, or SIMPLIFY before VERIFY. Do not force FINISH after REVIEW.

Rules:

- `/addy-code-simplify` maps to optional SIMPLIFY; preserve behavior.
- Keep active plan task checkboxes synchronized with reality: `[x] Implemented`, `[x] Verified`, and `[x] Reviewed` only when each step actually happened.
- Enforce checkbox ownership strictly:
  - `/addy-build` may only check `Implemented`.
  - `/addy-verify` may only check `Verified`.
  - `/addy-review` may only check `Reviewed`.
  - `/addy-auto` may not directly check lifecycle boxes; it dispatches the next owned phase.
- Treat checked lifecycle boxes as valid only when the owning phase actually ran for that task/slice. In particular, `[x] Reviewed` is not complete unless `/addy-review` ran for that task/slice.
- Ask before implementing a plan unless the user already ordered implementation.
- Use `todo` for multi-step tracking when available.
- Use `workflow` for complex review/ship fan-out when available.
- Never commit, push, deploy, or publish unless the user explicitly asks.
