---
name: using-addy-workflow
description: Governs the Addy workflow package lifecycle. Use at session start or whenever the user invokes an /addy-* prompt.
---

# Using Addy Workflow

Workflow commands:

1. DEFINE with `/addy-define`: clarify goal, users, constraints, acceptance criteria. Optional; user may skip.
2. PLAN with `/addy-plan`: create small vertical tasks and verification steps. Optional; user may skip or reuse an existing plan.
3. BUILD with `/addy-build`: implement incrementally, test first when useful, no auto-commit.
4. SIMPLIFY with `/addy-code-simplify`: simplify code without behavior changes. Optional; user may skip.
5. VERIFY with `/addy-verify`: prove behavior with tests or reproduction.
6. REVIEW with `/addy-review`: check correctness, readability, architecture, security, performance.
7. FINISH with `/addy-finish`: choose whether to commit, commit and push, build the next slice, or run `/addy-ship`. Optional; user may run after any number of build/verify/review cycles.

Enforce only `BUILD → VERIFY → REVIEW`. Do not force DEFINE, PLAN, or SIMPLIFY before VERIFY. Do not force FINISH after REVIEW.

Rules:

- `/addy-code-simplify` maps to optional SIMPLIFY; preserve behavior.
- Ask before implementing a plan unless the user already ordered implementation.
- Use `todo` for multi-step tracking when available.
- Use `subagent` for review/ship fan-out when available.
- Never commit, push, deploy, or publish unless the user explicitly asks.
