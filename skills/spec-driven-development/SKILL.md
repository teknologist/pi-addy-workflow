---
name: spec-driven-development
description: Create a concise spec before implementation. Use when starting new features, unclear requirements, or /addy-define.
---

# Spec-Driven Development

Before code:

1. Clarify objective, users, constraints, acceptance criteria.
2. Identify non-goals and risky assumptions.
3. For ambiguous, risky, domain-heavy, or architecture-sensitive specs, use `grill-with-docs` before finalizing the spec to challenge the idea against existing domain language, `CONTEXT.md`/`CONTEXT-MAP.md`, and documented decisions. Skip it for trivial specs where ordinary clarification is enough.
4. Discover relevant Architecture Decision Records (ADRs): user-mentioned or doc-linked ADRs first, then bounded ADR directories such as `docs/adr/`, `docs/adrs/`, `decisions/`, or `docs/decisions/` when titles, filenames, or summaries match the requested work.
5. Add a concise `Related ADRs / Architecture constraints` section that links relevant ADR paths and says “Before implementation, read ...”. Capture ADR conflicts as open questions or boundaries; do not rewrite or override ADR decisions without a superseding ADR or explicit human architecture decision.
6. Define exact verification commands or checks.
7. Save durable spec only when useful or requested.
8. Get user approval before implementation.

Keep specs concise and agent-verifiable.
