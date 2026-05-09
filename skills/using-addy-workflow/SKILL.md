---
name: using-addy-workflow
description: Governs the Addy workflow package lifecycle. Use at session start or whenever the user invokes an /addy-* prompt.
---

# Using Addy Workflow

Workflow commands:

1. DEFINE with `/addy-spec`: clarify goal, users, constraints, acceptance criteria. Optional; user may skip.
2. PLAN with `/addy-plan`: create small vertical tasks and verification steps. Optional; user may skip or reuse an existing plan.
3. BUILD with `/addy-build`: implement incrementally, test first when useful, no auto-commit.
4. VERIFY with `/addy-test`: prove behavior with tests or reproduction.
5. REVIEW with `/addy-review`: check correctness, readability, architecture, security, performance.
6. SHIP with `/addy-ship`: decide GO/NO-GO with rollback and verification notes. Optional; user may run after any number of build/verify/review cycles.

Enforce only `BUILD → VERIFY → REVIEW`. Do not force DEFINE or PLAN before BUILD. Do not force SHIP after REVIEW.

Rules:

- `/addy-code-simplify` is cross-cutting; preserve behavior and do not advance phase.
- Ask before implementing a plan unless the user already ordered implementation.
- Use `todo` for multi-step tracking when available.
- Use `subagent` for review/ship fan-out when available.
- Never commit, push, deploy, or publish unless the user explicitly asks.
