---
name: incremental-implementation
description: Implement plans in small safe slices. Use for /addy-build and multi-file changes.
---

# Incremental Implementation

For each slice:

1. Pick one task.
2. Read acceptance criteria.
3. Read required context from the active plan, including linked ADRs, spec sections, and steering files. Preserve ADR constraints and plan `must not` guardrails; stop if implementation would require a superseding ADR or explicit human architecture decision.
4. Add or run the narrowest relevant test.
5. Make the minimum change.
6. Verify immediately.
7. Update task status checkboxes in the active plan so `[x] Implemented`, `[x] Verified`, and `[x] Reviewed` reflect only work that actually happened.

Prefer small diffs. Avoid unrelated refactors. Do not commit unless requested.
