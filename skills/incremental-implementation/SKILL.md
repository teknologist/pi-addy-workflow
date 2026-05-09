---
name: incremental-implementation
description: Implement plans in small safe slices. Use for /addy-build and multi-file changes.
---

# Incremental Implementation

For each slice:

1. Pick one task.
2. Read acceptance criteria.
3. Add or run the narrowest relevant test.
4. Make the minimum change.
5. Verify immediately.
6. Update task status.

Prefer small diffs. Avoid unrelated refactors. Do not commit unless requested.
